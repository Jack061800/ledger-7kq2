/* 遊戲貨幣追蹤：資料層（儲存、驗證、計算、CSV）
 * 所有資料存在瀏覽器 localStorage，結構：
 * { version, settings: { currencyName, lastBackupAt, ... }, accounts: [...], records: [...], shipments: [...], deleted: [...] }
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'gct:data:v1';
  const PREV_KEY = 'gct:data:before-restore';
  const OWNER_KEY = 'gct:data:owner';
  const USER_KEY = 'gct:data:user:';
  const SCHEMA_VERSION = 1;
  const MAX_AMOUNT = 999999999999999;
  // 帳號顏色（依建立順序固定給每個帳號，不隨排名改變）
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

  /* ---------- 日期（一律使用本地時區的 YYYY-MM-DD 字串） ---------- */
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
  const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(parseISO(s)) === s;

  // 接受 2026-10-22、2026/10/22、2026.1.5 等寫法
  function normalizeDate(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!m) return null;
    const iso = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    return isISODate(iso) ? iso : null;
  }

  function eachDay(start, end) {
    const out = [];
    for (let d = start; d <= end && out.length < 4000; d = addDays(d, 1)) out.push(d);
    return out;
  }

  /* ---------- 數字 ---------- */
  const toHalfWidth = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[－−]/g, '-');

  // 解析非負整數，允許千分位逗號，也接受 20k、100m、1.5b 這種簡寫；回傳 { value } 或 { error }
  const UNITS = { k: 1e3, m: 1e6, b: 1e9 };
  function parseAmount(raw, { required = false } = {}) {
    const s = toHalfWidth(String(raw == null ? '' : raw)).trim().replace(/[,\s，_]/g, '');
    if (s === '') return required ? { error: '必填' } : { value: null };
    const u = s.match(/^(\d+(?:\.\d+)?|\.\d+)([kmb])$/i);
    if (u) {
      const x = Number(u[1]) * UNITS[u[2].toLowerCase()];
      const n = Math.round(x);
      if (Math.abs(x - n) > 1e-6) return { error: '換算後不是整數，請多打幾位數' };
      if (n > MAX_AMOUNT) return { error: '數字過大' };
      return { value: n };
    }
    if (/^[+-]?\d*\.\d+$/.test(s)) return { error: '請輸入整數，不可有小數' };
    if (!/^[+-]?\d+$/.test(s)) return { error: '只能輸入數字' };
    const n = Number(s);
    if (n < 0) return { error: '不可為負數' };
    if (n > MAX_AMOUNT) return { error: '數字過大' };
    return { value: n };
  }

  const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const fieldError = (errors) => Object.assign(new Error('資料有誤，請檢查欄位'), { fieldErrors: errors });

  /* ---------- 狀態 ---------- */
  // deleted：刪除紀錄（墓碑），跨裝置同步時用來避免已刪除的資料又被另一台裝置帶回來
  //   k = 'a:<帳號id>'、'r:<帳號id>|<日期>' 或 's:<出貨id>'，at = 刪除時間
  // shipments：每一筆出貨（日期、帳號、數量），和每天的 CF Bal 記錄分開記
  function emptyState() {
    // salesDay：Sales 算在哪一天。'prev' = 前一天（今天記的 CF Bal 減昨天的，就是昨天賺的）；'same' = 記錄當天
    return { version: SCHEMA_VERSION, settings: { currencyName: '金幣', lastBackupAt: null, monthlyGoal: null, salesDay: 'prev', updatedAt: null }, accounts: [], records: [], shipments: [], deleted: [] };
  }

  const nowISO = () => new Date().toISOString();
  const recKey = (r) => `${r.accountId}|${r.date}`;
  const TOMB_DAYS = 180;
  function pruneTombs(list) {
    const cutoff = new Date(Date.now() - TOMB_DAYS * 864e5).toISOString();
    const latest = new Map();
    list.forEach((t) => { if (t && t.k && t.at && t.at >= cutoff && (!latest.has(t.k) || latest.get(t.k) < t.at)) latest.set(t.k, t.at); });
    return Array.from(latest, ([k, at]) => ({ k, at }));
  }

  // 驗證並整理外部讀入的資料（localStorage 或備份檔），不合法就丟出錯誤，不做猜測修正
  function normalizeState(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.accounts) || !Array.isArray(obj.records)) {
      throw new Error('資料格式不正確：缺少 accounts 或 records');
    }
    const state = emptyState();
    if (obj.settings && typeof obj.settings === 'object') {
      if (obj.settings.currencyName) state.settings.currencyName = String(obj.settings.currencyName).slice(0, 12);
      if (obj.settings.lastBackupAt) state.settings.lastBackupAt = String(obj.settings.lastBackupAt);
      if (Number.isInteger(obj.settings.monthlyGoal) && obj.settings.monthlyGoal > 0) state.settings.monthlyGoal = obj.settings.monthlyGoal;
      if (obj.settings.updatedAt) state.settings.updatedAt = String(obj.settings.updatedAt);
      if (obj.settings.salesDay === 'same') state.settings.salesDay = 'same';
    }
    if (Array.isArray(obj.deleted)) state.deleted = pruneTombs(obj.deleted.map((t) => ({ k: String(t && t.k || ''), at: String(t && t.at || '') })));
    const ids = new Set();
    obj.accounts.forEach((a, i) => {
      if (!a || !a.id || !a.name) throw new Error(`第 ${i + 1} 個帳號缺少 id 或名稱`);
      if (ids.has(String(a.id))) throw new Error(`帳號 id 重複：${a.id}`);
      ids.add(String(a.id));
      state.accounts.push({
        id: String(a.id),
        name: String(a.name),
        gameId: String(a.gameId || ''),
        note: String(a.note || ''),
        status: a.status === 'inactive' ? 'inactive' : 'active',
        colorIndex: Number.isInteger(a.colorIndex) ? a.colorIndex : i % PALETTE.length,
        createdAt: a.createdAt || new Date().toISOString(),
        updatedAt: a.updatedAt || a.createdAt || new Date().toISOString(),
      });
    });
    const seen = new Set();
    const optInt = (v, where) => {
      if (v == null) return null;
      if (!Number.isInteger(v) || v < 0) throw new Error(`${where}取得量或使用量不是非負整數`);
      return v;
    };
    obj.records.forEach((r, i) => {
      const where = `第 ${i + 1} 筆記錄`;
      if (!r || !ids.has(String(r.accountId))) throw new Error(`${where}對應的帳號不存在`);
      if (!isISODate(r.date)) throw new Error(`${where}日期格式錯誤`);
      if (!Number.isInteger(r.balance) || r.balance < 0) throw new Error(`${where}餘額不是非負整數`);
      const key = r.accountId + '|' + r.date;
      if (seen.has(key)) throw new Error(`${where}與其他記錄重複（同帳號同日期）`);
      seen.add(key);
      const rec = {
        id: String(r.id || uid('r')),
        accountId: String(r.accountId),
        date: r.date,
        balance: r.balance,
        shipped: optInt(r.shipped, where),
        // 舊版欄位（取得／使用），保留不刪，畫面上已不再使用
        gained: optInt(r.gained, where),
        spent: optInt(r.spent, where),
        note: String(r.note || ''),
        updatedAt: r.updatedAt || new Date().toISOString(),
      };
      // 這次 CF Bal 增加的部分裡，有多少是出售東西得來的（只是標示，不改變 Stock／Sales 計算）
      if (r.fromSales != null) rec.fromSales = optInt(r.fromSales, where);
      state.records.push(rec);
    });
    const shipIds = new Set();
    (Array.isArray(obj.shipments) ? obj.shipments : []).forEach((x, i) => {
      const where = `第 ${i + 1} 筆出貨`;
      if (!x || !ids.has(String(x.accountId))) throw new Error(`${where}對應的帳號不存在`);
      if (!isISODate(x.date)) throw new Error(`${where}日期格式錯誤`);
      if (!Number.isInteger(x.amount) || x.amount <= 0) throw new Error(`${where}數量不是正整數`);
      const id = String(x.id || uid('s'));
      if (shipIds.has(id)) return;
      shipIds.add(id);
      const ship = {
        id, accountId: String(x.accountId), date: x.date, amount: x.amount,
        note: String(x.note || ''),
        createdAt: x.createdAt || x.updatedAt || new Date().toISOString(),
        updatedAt: x.updatedAt || new Date().toISOString(),
      };
      // 出售對象和單價（每 1B 多少 RM），選填
      if (x.buyer) ship.buyer = String(x.buyer).slice(0, 40);
      if (typeof x.price === 'number' && x.price >= 0) ship.price = x.price;
      // 被管理員退回的出貨：保留記錄給本人看，但不算進 Sales 和結算
      if (x.rejected && typeof x.rejected === 'object') ship.rejected = { reason: String(x.rejected.reason || ''), note: String(x.rejected.note || ''), at: String(x.rejected.at || '') };
      state.shipments.push(ship);
    });
    return state;
  }

  function nextColorIndex(state) {
    const used = new Set(state.accounts.map((a) => a.colorIndex % PALETTE.length));
    for (let i = 0; i < PALETTE.length; i++) if (!used.has(i)) return i;
    return state.accounts.length % PALETTE.length;
  }

  /* ---------- 跨裝置合併 ----------
   * 兩份資料（本機、雲端）逐項合併，不整份覆蓋：
   *   帳號依 id、記錄依「帳號＋日期」比對，各自保留修改時間較新的那一份；
   *   刪除紀錄比資料新的就刪掉；兩邊各自新增的同名帳號會合併成一個（保留較早建立的）。
   */
  function mergeStates(a, b) {
    const tombs = pruneTombs([...(a.deleted || []), ...(b.deleted || [])]);
    const tombAt = new Map(tombs.map((t) => [t.k, t.at]));
    const newer = (x, y) => ((x.updatedAt || '') >= (y.updatedAt || '') ? x : y);

    const accById = new Map();
    [...a.accounts, ...b.accounts].forEach((x) => { const cur = accById.get(x.id); accById.set(x.id, cur ? newer(cur, x) : x); });
    let accounts = Array.from(accById.values()).filter((x) => !(tombAt.get('a:' + x.id) >= (x.updatedAt || '')));
    accounts.sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : (x.id < y.id ? -1 : 1)));
    const remap = new Map();
    const byName = new Map();
    accounts = accounts.filter((x) => {
      const n = x.name.trim().toLowerCase();
      if (byName.has(n)) { remap.set(x.id, byName.get(n)); return false; }
      byName.set(n, x.id);
      return true;
    });
    const alive = new Set(accounts.map((x) => x.id));

    const recByKey = new Map();
    [...a.records, ...b.records].forEach((r0) => {
      const r = remap.has(r0.accountId) ? { ...r0, accountId: remap.get(r0.accountId) } : r0;
      if (!alive.has(r.accountId)) return;
      const k = recKey(r);
      const cur = recByKey.get(k);
      recByKey.set(k, cur ? newer(cur, r) : r);
    });
    const records = Array.from(recByKey.values())
      .filter((r) => !(tombAt.get('r:' + recKey(r)) >= (r.updatedAt || '')))
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.accountId < y.accountId ? -1 : 1));

    const shipById = new Map();
    [...(a.shipments || []), ...(b.shipments || [])].forEach((s0) => {
      const s = remap.has(s0.accountId) ? { ...s0, accountId: remap.get(s0.accountId) } : s0;
      if (!alive.has(s.accountId) || tombAt.get('s:' + s.id) >= (s.updatedAt || '')) return;
      const cur = shipById.get(s.id);
      shipById.set(s.id, cur ? newer(cur, s) : s);
    });
    const shipments = Array.from(shipById.values()).sort(byShipOrder);

    const sa = a.settings || {}; const sb = b.settings || {};
    const settings = { ...((sa.updatedAt || '') >= (sb.updatedAt || '') ? sa : sb) };
    const backups = [sa.lastBackupAt, sb.lastBackupAt].filter(Boolean).sort();
    settings.lastBackupAt = backups.length ? backups[backups.length - 1] : null;

    return { version: SCHEMA_VERSION, settings, accounts, records, shipments, deleted: tombs };
  }

  const byShipOrder = (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (x.createdAt || '') < (y.createdAt || '') ? -1 : 1);

  /* ---------- 衍生計算 ----------
   * 每筆記錄（balance = 當天輸入的 CF Bal，也就是 Stock 庫存）：
   *   net       庫存變化 = 這次 CF Bal − 同帳號前一次記錄的 CF Bal；首筆為 null
   *   shipped   這段期間的出貨量（出貨會讓庫存變少，但不算少賺）
   *             = 這段期間的出貨記錄（shipments）＋ 記錄上直接填的出貨（舊版／CSV 匯入）
   *   sales     賺到的 = 庫存變化 + 出貨；首筆沒有前一次可比，為 null
   *   salesDate Sales 算在哪一天：預設是記錄日的前一天（今天的 CF Bal − 昨天的 = 昨天賺的）
   *   gap       與前一次記錄相隔天數（>1 代表中間有沒記錄的日子，sales 是那幾天的合計）
   *   negative  sales 是負數（庫存少掉的比出貨還多，可能漏記出貨）
   *
   * 出貨記錄算進哪一筆 CF Bal：
   *   'prev'（早上記 CF Bal）：出貨日 ≥ 上次記錄日、且 < 這次記錄日 → 今天出的貨，明天記 CF Bal 時算進今天的 Sales
   *   'same'（晚上記 CF Bal）：出貨日 > 上次記錄日、且 ≤ 這次記錄日
   *   還沒有下一次 CF Bal 的出貨先放在 pending，記了之後才算進 Sales
   */
  function salesDateOf(date, settings) {
    return settings && settings.salesDay === 'same' ? date : addDays(date, -1);
  }
  function shipBelongs(shipDate, prevDate, recDate, settings) {
    if (settings && settings.salesDay === 'same') return (prevDate == null || shipDate > prevDate) && shipDate <= recDate;
    return (prevDate == null || shipDate >= prevDate) && shipDate < recDate;
  }
  function derive(state) {
    const byAccount = new Map();
    const byId = new Map();
    const shipsByAccount = new Map();
    const pending = new Map();
    state.accounts.forEach((a) => { byAccount.set(a.id, []); shipsByAccount.set(a.id, []); });
    state.records.forEach((r) => { const list = byAccount.get(r.accountId); if (list) list.push(r); });
    (state.shipments || []).forEach((s) => { const list = shipsByAccount.get(s.accountId); if (list) list.push(s); });
    byAccount.forEach((list, accountId) => {
      list.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
      const ships = shipsByAccount.get(accountId).sort(byShipOrder).filter((s) => !s.rejected);
      const used = new Set();
      let prev = null;
      list.forEach((r) => {
        const net = prev ? r.balance - prev.balance : null;
        const gap = prev ? daysBetween(prev.date, r.date) : null;
        const shipList = ships.filter((s) => !used.has(s) && shipBelongs(s.date, prev ? prev.date : null, r.date, state.settings));
        shipList.forEach((s) => used.add(s));
        const shipped = (r.shipped || 0) + shipList.reduce((t, s) => t + s.amount, 0);
        const sales = net == null ? null : net + shipped;
        byId.set(r.id, {
          record: r, prev, net, gap, shipped, shipList, sales,
          salesDate: salesDateOf(r.date, state.settings),
          negative: sales != null && sales < 0,
        });
        prev = r;
      });
      pending.set(accountId, ships.filter((s) => !used.has(s)));
    });
    return { byAccount, byId, shipsByAccount, pending };
  }

  /* ---------- Store ---------- */
  const Store = {
    state: emptyState(),
    loadError: null,
    _derived: null,
    _listeners: [],

    load() {
      this.loadError = null;
      this._derived = null;
      let raw = null;
      try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {
        this.loadError = '無法存取瀏覽器儲存空間（可能是隱私模式或封鎖了網站資料），新增的資料將無法保存。';
        return;
      }
      if (!raw) { this.state = emptyState(); return; }
      try {
        this.state = normalizeState(JSON.parse(raw));
      } catch (e) {
        const key = 'gct:data:corrupt:' + Date.now();
        try { localStorage.setItem(key, raw); } catch (_) { /* 盡力保存 */ }
        this.state = emptyState();
        this.loadError = `讀取既有資料失敗（${e.message}）。原始資料已另存在 localStorage「${key}」，沒有被覆蓋。`;
      }
    },

    onChange(fn) { this._listeners.push(fn); },

    // 本機資料屬於哪個 Gmail：換帳號登入時，把上一個人的資料收起來，換成這個人的（之後由雲端同步補齊）
    claim(email) {
      try {
        const owner = localStorage.getItem(OWNER_KEY);
        if (owner && owner !== email) {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) localStorage.setItem(`${USER_KEY}${owner}`, raw);
          const mine = localStorage.getItem(`${USER_KEY}${email}`);
          if (mine) { localStorage.setItem(STORAGE_KEY, mine); localStorage.removeItem(`${USER_KEY}${email}`); } else localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem('gct:sync:lastAt');
        }
        localStorage.setItem(OWNER_KEY, email);
      } catch (_) { /* 無法存取儲存空間時 load() 會提示 */ }
    },

    /* 唯讀檢視（管理員看朋友的帳本）：暫時把畫面換成別人的資料，不寫入本機，也不同步 */
    readOnly: false,
    viewing: null,
    enterView(state, who) {
      this.state = normalizeState(state);
      this.readOnly = true;
      this.viewing = who;
      this._derived = null;
      this.lastSource = 'view';
      this._listeners.forEach((fn) => fn('view'));
    },
    exitView() {
      if (!this.readOnly) return;
      this.readOnly = false;
      this.viewing = null;
      this.load();
      this.lastSource = 'view';
      this._listeners.forEach((fn) => fn('view'));
    },

    // 所有寫入都經過這裡：失敗時還原記憶體中的狀態，避免畫面與儲存不一致
    // source：'local'（使用者操作）或 'sync'（雲端同步帶進來的），讓監聽者分辨
    _commit(mutator, source = 'local') {
      if (this.readOnly) throw new Error('正在看別人的帳本（只能看），不能修改。請先按「回到我的帳本」。');
      const before = JSON.stringify(this.state);
      let result;
      try {
        result = mutator(this.state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {
        this.state = JSON.parse(before);
        this._derived = null;
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) throw new Error('瀏覽器儲存空間已滿，請先下載備份再清理資料。');
        throw e;
      }
      this._derived = null;
      this.lastSource = source;
      this._listeners.forEach((fn) => fn(source));
      return result;
    },

    _tomb(s, k) {
      s.deleted = pruneTombs([...(s.deleted || []), { k, at: nowISO() }]);
    },

    // 雲端同步合併後的結果寫回本機（不建立「還原前」暫存）
    applySynced(next) {
      return this._commit(() => { this.state = next; }, 'sync');
    },

    derived() {
      if (!this._derived) this._derived = derive(this.state);
      return this._derived;
    },

    /* 設定 */
    updateSettings(patch) {
      return this._commit((s) => { Object.assign(s.settings, patch, { updatedAt: nowISO() }); });
    },
    markBackup() {
      return this._commit((s) => { s.settings.lastBackupAt = new Date().toISOString(); });
    },

    /* 帳號 */
    accounts() { return this.state.accounts; },
    account(id) { return this.state.accounts.find((a) => a.id === id) || null; },
    // 回傳 CSS 變數，淺色／深色模式各自有一組顏色（見 app.css 的 --c1 ~ --c8）
    color(a) { return `var(--c${((a ? a.colorIndex : 0) % PALETTE.length) + 1})`; },
    recordCount(accountId) { return this.state.records.filter((r) => r.accountId === accountId).length; },

    validateAccount(input, excludeId) {
      const errors = {};
      const name = String(input.name || '').trim();
      const gameId = String(input.gameId || '').trim();
      if (!name) errors.name = '請輸入帳號名稱';
      else if (name.length > 40) errors.name = '名稱最多 40 個字';
      else if (this.state.accounts.some((a) => a.id !== excludeId && a.name.toLowerCase() === name.toLowerCase())) errors.name = '已經有同名的帳號';
      if (gameId.length > 60) errors.gameId = '遊戲內 ID 最多 60 個字';
      else if (gameId && this.state.accounts.some((a) => a.id !== excludeId && a.gameId && a.gameId.toLowerCase() === gameId.toLowerCase())) errors.gameId = '已經有帳號使用這個遊戲內 ID';
      return {
        errors,
        value: { name, gameId, note: String(input.note || '').trim().slice(0, 300), status: input.status === 'inactive' ? 'inactive' : 'active' },
      };
    },

    addAccount(input) {
      const { errors, value } = this.validateAccount(input);
      if (Object.keys(errors).length) throw fieldError(errors);
      return this._commit((s) => {
        const now = nowISO();
        const acc = { id: uid('a'), ...value, colorIndex: nextColorIndex(s), createdAt: now, updatedAt: now };
        s.accounts.push(acc);
        return acc;
      });
    },

    updateAccount(id, input) {
      const current = this.account(id);
      if (!current) throw new Error('找不到這個帳號');
      const { errors, value } = this.validateAccount({ ...current, ...input }, id);
      if (Object.keys(errors).length) throw fieldError(errors);
      return this._commit((s) => { Object.assign(s.accounts.find((a) => a.id === id), value, { updatedAt: nowISO() }); });
    },

    deleteAccount(id) {
      return this._commit((s) => {
        s.accounts = s.accounts.filter((a) => a.id !== id);
        s.records = s.records.filter((r) => r.accountId !== id);
        s.shipments = (s.shipments || []).filter((x) => x.accountId !== id);
        this._tomb(s, 'a:' + id);
      });
    },

    /* 出貨 */
    validateShipment(input) {
      const errors = {};
      const value = {};
      const date = normalizeDate(input.date);
      if (!date) errors.date = '請選擇有效日期'; else value.date = date;
      if (!input.accountId || !this.account(input.accountId)) errors.accountId = '請選擇帳號'; else value.accountId = input.accountId;
      const r = parseAmount(input.amount, { required: true });
      if (r.error) errors.amount = r.error;
      else if (r.value <= 0) errors.amount = '出貨要大於 0';
      else value.amount = r.value;
      value.note = String(input.note || '').trim().slice(0, 200);
      const buyer = String(input.buyer || '').trim().slice(0, 40);
      if (buyer) value.buyer = buyer;
      // 單價：每 1B 多少 RM，最多 4 位小數，選填
      const pt = String(input.price == null ? '' : input.price).replace(/[,\s]|RM/gi, '');
      if (pt) {
        if (!/^\d+(\.\d{1,4})?$|^\.\d{1,4}$/.test(pt)) errors.price = '單價請輸入數字，最多 4 位小數';
        else if (Number(pt) > 1e6) errors.price = '單價太大了，請檢查';
        else value.price = Number(pt);
      }
      return { errors, value };
    },
    addShipment(input) {
      const { errors, value } = this.validateShipment(input);
      if (Object.keys(errors).length) throw fieldError(errors);
      return this._commit((s) => {
        const now = nowISO();
        const ship = { id: uid('s'), ...value, createdAt: now, updatedAt: now };
        (s.shipments = s.shipments || []).push(ship);
        return ship;
      });
    },
    // 只改出售對象和單價（數量、日期、帳號不動，Stock／Sales 計算不受影響）
    updateShipmentSale(id, input) {
      const ship = (this.state.shipments || []).find((x) => x.id === id);
      if (!ship) throw new Error('找不到這筆出貨');
      const { errors, value } = this.validateShipment({ ...ship, buyer: input.buyer, price: input.price });
      if (errors.price) throw fieldError({ price: errors.price });
      return this._commit((s) => {
        const x = s.shipments.find((y) => y.id === id);
        if (value.buyer) x.buyer = value.buyer; else delete x.buyer;
        if (value.price != null) x.price = value.price; else delete x.price;
        x.updatedAt = nowISO();
        return x;
      });
    },
    deleteShipment(id) {
      return this._commit((s) => {
        s.shipments = (s.shipments || []).filter((x) => x.id !== id);
        this._tomb(s, 's:' + id);
      });
    },
    // 套用管理員的退回名單 { 出貨id: { reason, note, at } }：名單有的標成退回，沒有的取消退回
    // 回傳這次新被退回的出貨；沒有變動就不寫入
    applyShipmentRejects(rejects) {
      const want = rejects || {};
      const same = (a, b) => (!a && !b) || (a && b && a.at === b.at && a.reason === b.reason && a.note === b.note);
      const changed = (this.state.shipments || []).filter((x) => !same(x.rejected, want[x.id]));
      if (!changed.length) return [];
      return this._commit((s) => {
        const now = nowISO(); const added = [];
        s.shipments.forEach((x) => {
          if (same(x.rejected, want[x.id])) return;
          const r = want[x.id];
          if (r) { x.rejected = { reason: String(r.reason || ''), note: String(r.note || ''), at: String(r.at || now) }; added.push(x); } else delete x.rejected;
          x.updatedAt = now;
        });
        return added;
      });
    },

    /* 記錄 */
    recordFor(accountId, date) {
      return this.state.records.find((r) => r.accountId === accountId && r.date === date) || null;
    },

    validateRecord(input) {
      const errors = {};
      const value = {};
      const date = normalizeDate(input.date);
      if (!date) errors.date = '請選擇有效日期'; else value.date = date;
      if (!input.accountId || !this.account(input.accountId)) errors.accountId = '請選擇帳號'; else value.accountId = input.accountId;
      [['balance', true], ['shipped', false]].forEach(([k, required]) => {
        const r = parseAmount(input[k], { required });
        if (r.error) errors[k] = r.error; else value[k] = r.value;
      });
      value.note = String(input.note || '').trim().slice(0, 200);
      // 出售所得：只有表單有這一欄時才處理，其他地方存記錄不會把它清掉
      if ('fromSales' in input) {
        const r = parseAmount(input.fromSales);
        if (r.error) errors.fromSales = r.error;
        else if (r.value != null && r.value < 0) errors.fromSales = '不能是負數';
        else value.fromSales = r.value;
      }
      return { errors, value };
    },

    // 新增或修改單筆。editingId 為空時：同帳號同日期已有記錄就更新它（不產生重複）
    saveRecord(input, editingId) {
      const { errors, value } = this.validateRecord(input);
      if (Object.keys(errors).length) throw fieldError(errors);
      const clash = this.recordFor(value.accountId, value.date);
      if (editingId && clash && clash.id !== editingId) throw fieldError({ date: '這個帳號在這天已經有另一筆記錄' });
      const targetId = editingId || (clash && clash.id);
      return this._commit((s) => {
        const now = new Date().toISOString();
        const target = targetId && s.records.find((r) => r.id === targetId);
        if (target) {
          // 改了日期或帳號：舊的位置留下刪除紀錄，同步時才不會在另一台裝置變成兩筆
          if (recKey(target) !== recKey(value)) this._tomb(s, 'r:' + recKey(target));
          Object.assign(target, value, { updatedAt: now });
          return { record: target, mode: 'updated' };
        }
        const rec = { id: uid('r'), ...value, updatedAt: now };
        s.records.push(rec);
        return { record: rec, mode: 'created' };
      });
    },

    // 批次新增／更新（已驗證過的 value），以帳號＋日期判斷是否已存在
    saveMany(values) {
      return this._commit((s) => {
        let created = 0; let updated = 0;
        const now = new Date().toISOString();
        values.forEach((v) => {
          const target = s.records.find((r) => r.accountId === v.accountId && r.date === v.date);
          if (target) { Object.assign(target, v, { updatedAt: now }); updated++; } else { s.records.push({ id: uid('r'), ...v, updatedAt: now }); created++; }
        });
        return { created, updated };
      });
    },

    deleteRecord(id) {
      return this._commit((s) => {
        const r = s.records.find((x) => x.id === id);
        s.records = s.records.filter((x) => x.id !== id);
        if (r) this._tomb(s, 'r:' + recKey(r));
      });
    },

    // 套用 CSV 匯入計畫
    applyImport(analysis, { overwrite, createMissing }) {
      return this._commit((s) => {
        const keyToId = new Map();
        let accountsCreated = 0; let created = 0; let updated = 0; let skipped = 0;
        const now = new Date().toISOString();
        analysis.items.forEach((it) => {
          if (it.status === 'error') { skipped++; return; }
          let accountId = it.acctKey;
          if (it.isNewAccount) {
            if (!createMissing) { skipped++; return; }
            if (!keyToId.has(it.acctKey)) {
              const info = analysis.newAccounts.get(it.acctKey);
              const acc = { id: uid('a'), name: info.name, gameId: info.gameId || '', note: '由 CSV 匯入建立', status: 'active', colorIndex: nextColorIndex(s), createdAt: now, updatedAt: now };
              s.accounts.push(acc);
              keyToId.set(it.acctKey, acc.id);
              accountsCreated++;
            }
            accountId = keyToId.get(it.acctKey);
          }
          const existing = s.records.find((r) => r.accountId === accountId && r.date === it.value.date);
          if (existing) {
            if (!overwrite) { skipped++; return; }
            Object.assign(existing, it.value, { updatedAt: now });
            updated++;
          } else {
            s.records.push({ id: uid('r'), accountId, ...it.value, updatedAt: now });
            created++;
          }
        });
        return { accountsCreated, created, updated, skipped };
      });
    },

    /* 整體取代（還原備份、載入範例、清除），先把目前資料另存一份以便復原 */
    replaceState(next) {
      try {
        localStorage.setItem(PREV_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: this.state }));
      } catch (_) { /* 空間不足時仍允許繼續 */ }
      return this._commit(() => { this.state = this._asReplacement(next); });
    },
    // 「整份取代」在同步時也要成立：新資料標成最新、沒留下來的舊資料加上刪除紀錄
    _asReplacement(next) {
      const now = nowISO();
      const keepIds = new Set(next.accounts.map((a) => a.id));
      const keepKeys = new Set(next.records.map(recKey));
      next.shipments = next.shipments || [];
      const keepShips = new Set(next.shipments.map((x) => x.id));
      const tombs = [...(this.state.deleted || []), ...(next.deleted || [])];
      this.state.accounts.forEach((a) => { if (!keepIds.has(a.id)) tombs.push({ k: 'a:' + a.id, at: now }); });
      this.state.records.forEach((r) => { if (!keepKeys.has(recKey(r))) tombs.push({ k: 'r:' + recKey(r), at: now }); });
      (this.state.shipments || []).forEach((x) => { if (!keepShips.has(x.id)) tombs.push({ k: 's:' + x.id, at: now }); });
      next.accounts.forEach((a) => { a.updatedAt = now; });
      next.records.forEach((r) => { r.updatedAt = now; });
      next.shipments.forEach((x) => { x.updatedAt = now; });
      next.settings = { ...next.settings, updatedAt: now };
      next.deleted = pruneTombs(tombs).filter((t) => !(t.k.startsWith('a:') && keepIds.has(t.k.slice(2))) && !(t.k.startsWith('r:') && keepKeys.has(t.k.slice(2))) && !(t.k.startsWith('s:') && keepShips.has(t.k.slice(2))));
      return next;
    },
    previousSnapshot() {
      try { const raw = localStorage.getItem(PREV_KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
    },
    restorePrevious() {
      const snap = this.previousSnapshot();
      if (!snap) throw new Error('沒有可以復原的資料');
      const data = normalizeState(snap.data);
      this._commit(() => { this.state = this._asReplacement(data); });
      try { localStorage.removeItem(PREV_KEY); } catch (_) { /* ignore */ }
    },
    sizeBytes() {
      try { return (localStorage.getItem(STORAGE_KEY) || '').length * 2; } catch (_) { return 0; }
    },
  };

  /* ---------- 統計 ---------- */
  const Calc = {
    list(accountId) { return Store.derived().byAccount.get(accountId) || []; },
    info(recordId) { return Store.derived().byId.get(recordId) || null; },

    latestOnOrBefore(list, date) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].date <= date) return list[i];
      return null;
    },
    latestBefore(list, date) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].date < date) return list[i];
      return null;
    },
    firstAfter(list, date) {
      return list.find((r) => r.date > date) || null;
    },

    // 某帳號的全部出貨（依日期排序）、還沒算進 Sales 的出貨
    shipments(accountId) { return Store.derived().shipsByAccount.get(accountId) || []; },
    pendingShipments(accountId) { return Store.derived().pending.get(accountId) || []; },
    // 如果在 date 記一筆 CF Bal，會算進哪些出貨（用在輸入時的即時試算）
    shipmentsFor(accountId, date) {
      const prev = this.latestBefore(this.list(accountId), date);
      return this.shipments(accountId).filter((s) => !s.rejected && shipBelongs(s.date, prev ? prev.date : null, date, Store.state.settings));
    },

    /* 某帳號在 [start, end] 期間的統計（依 Sales 歸屬日 salesDate 判斷是否在期間內）
     *   sales    期間內 Sales 總和（庫存變化 + 出貨）
     *   shipped  期間內出貨總和
     *   covered  這些 Sales 涵蓋的天數（各記錄 gap 的總和）
     *   avg      每日平均 Sales = sales ÷ covered
     *   negatives Sales 為負數的筆數（可能漏記出貨）
     */
    windowStats(accountId, start, end) {
      const d = Store.derived();
      let sales = 0; let salesCount = 0; let covered = 0; let shipped = 0; let shippedCount = 0; let negatives = 0; let days = 0;
      this.list(accountId).forEach((r) => {
        const x = d.byId.get(r.id);
        if (x.salesDate < start || x.salesDate > end) return;
        days++;
        if (x.sales != null) { sales += x.sales; salesCount++; covered += x.gap; }
        if (x.shipped) { shipped += x.shipped; shippedCount++; }
        if (x.negative) negatives++;
      });
      return {
        days, salesCount, covered, shippedCount, negatives, shipped,
        sales: salesCount ? sales : null,
        avg: covered ? sales / covered : null,
      };
    },

    // 每日總庫存：每天把各帳號「當天或之前最近一筆」餘額加總；從未有記錄的帳號不計入
    totalStock(accountIds, dates) {
      const lists = accountIds.map((id) => this.list(id));
      const ptr = lists.map(() => -1);
      return dates.map((date) => {
        let total = 0; let have = 0; let exact = 0;
        lists.forEach((list, k) => {
          while (ptr[k] + 1 < list.length && list[ptr[k] + 1].date <= date) ptr[k]++;
          if (ptr[k] >= 0) { total += list[ptr[k]].balance; have++; if (list[ptr[k]].date === date) exact++; }
        });
        return have ? { value: total, have, exact, carried: have - exact } : { value: null, have: 0, exact: 0, carried: 0 };
      });
    },

    // 每日 Sales 序列（依歸屬日；沒有記錄的日子為 null，不當作 0）
    dailySales(accountId, dates) {
      const map = new Map(this.list(accountId).map((r) => { const x = this.info(r.id); return [x.salesDate, x]; }));
      return dates.map((d) => map.get(d) || null);
    },

    // 累計 Sales：從期間第一天開始把每日 Sales 加起來；第一筆 Sales 出現前為 null
    cumulativeSales(accountId, dates) {
      const daily = this.dailySales(accountId, dates);
      let sum = null;
      return daily.map((x) => {
        if (x && x.sales != null) sum = (sum || 0) + x.sales;
        return sum;
      });
    },
  };

  /* ---------- CSV ---------- */
  const CSV_COLUMNS = ['date', 'account', 'game_id', 'cf_bal', 'shipped', 'note'];
  const CSV_COMPUTED = ['shipped_total', 'stock_change', 'sales', 'sales_date', 'from_sales', 'net_change', 'recorded_profit', 'difference', 'gained', 'spent'];
  const ALIASES = {
    date: ['date', '日期'],
    account: ['account', 'account_name', 'name', '帳號', '帳號名稱', '账号'],
    game_id: ['game_id', 'gameid', 'game id', '遊戲內id', '遊戲id', '遊戲內 id'],
    balance: ['cf_bal', 'cf bal', 'cfbal', 'cf', 'balance', 'stock', '餘額', '當日餘額', '余额', '庫存', '库存'],
    shipped: ['shipped', 'ship', 'shipment', '出貨', '出货', '出貨量', '出货量'],
    note: ['note', 'notes', 'memo', '備註', '备注'],
  };

  const CSV = {
    COLUMNS: CSV_COLUMNS,

    escape(v) {
      const s = v == null ? '' : String(v);
      return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    },

    stringify(rows) {
      return '﻿' + rows.map((r) => r.map(CSV.escape).join(',')).join('\r\n') + '\r\n';
    },

    // RFC 4180 解析（支援引號、引號內換行、CRLF）
    parse(text) {
      const src = text.replace(/^﻿/, '');
      const firstLine = src.split(/\r?\n/, 1)[0] || '';
      const delim = !firstLine.includes(',') && firstLine.includes('\t') ? '\t' : ',';
      const rows = []; let row = []; let field = ''; let i = 0; let quoted = false;
      while (i < src.length) {
        const c = src[i];
        if (quoted) {
          if (c === '"') {
            if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
            quoted = false; i++; continue;
          }
          field += c; i++; continue;
        }
        if (c === '"' && field === '') { quoted = true; i++; continue; }
        if (c === delim) { row.push(field); field = ''; i++; continue; }
        if (c === '\r' || c === '\n') {
          row.push(field); rows.push(row); row = []; field = '';
          i += c === '\r' && src[i + 1] === '\n' ? 2 : 1;
          continue;
        }
        field += c; i++;
      }
      if (field !== '' || row.length) { row.push(field); rows.push(row); }
      return rows;
    },

    exportRecords(records) {
      const d = Store.derived();
      // shipped = 記錄上直接填的出貨（匯入時會讀回）；shipped_total = 含出貨記錄的合計（只供參考，匯入時忽略）
      const rows = [CSV_COLUMNS.concat(['shipped_total', 'stock_change', 'sales', 'sales_date', 'from_sales'])];
      records.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((r) => {
        const a = Store.account(r.accountId);
        const x = d.byId.get(r.id) || {};
        rows.push([r.date, a ? a.name : '', a ? a.gameId : '', r.balance, r.shipped, r.note, x.shipped, x.net, x.sales, x.salesDate, r.fromSales == null ? '' : r.fromSales]);
      });
      return CSV.stringify(rows);
    },

    template() {
      const today = todayISO();
      return CSV.stringify([CSV_COLUMNS, [today, '主帳號', 'TW-000001', 12345, 3000, '範例：可刪除此列']]);
    },

    // 匯入前檢查：欄位、格式、帳號對應、與既有資料及檔案內的重複
    analyze(text) {
      const rows = CSV.parse(text).filter((r) => r.some((c) => String(c).trim() !== ''));
      if (!rows.length) return { fatal: '檔案是空的' };
      const header = rows[0].map((h) => String(h).trim().toLowerCase());
      const col = {}; const ignored = [];
      header.forEach((h, i) => {
        const key = Object.keys(ALIASES).find((k) => ALIASES[k].includes(h));
        if (key && col[key] == null) col[key] = i;
        else if (!CSV_COMPUTED.includes(h) && h) ignored.push(rows[0][i]);
      });
      const missing = [];
      if (col.date == null) missing.push('date（日期）');
      if (col.balance == null) missing.push('cf_bal（CF Bal）');
      if (col.account == null && col.game_id == null) missing.push('account（帳號名稱）或 game_id（遊戲內 ID）');
      if (missing.length) return { fatal: `缺少必要欄位：${missing.join('、')}`, header: rows[0] };
      if (rows.length < 2) return { fatal: '檔案只有標題列，沒有資料' };

      const accounts = Store.accounts();
      const byName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));
      const byGid = new Map(accounts.filter((a) => a.gameId).map((a) => [a.gameId.toLowerCase(), a]));
      const newAccounts = new Map();
      const seen = new Map();
      const items = [];

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const line = i + 1;
        const get = (k) => (col[k] == null ? '' : String(r[col[k]] == null ? '' : r[col[k]]).trim());
        const errors = [];
        const date = normalizeDate(get('date'));
        if (!date) errors.push(`日期「${get('date')}」格式錯誤（應為 YYYY-MM-DD）`);
        const bal = parseAmount(get('balance'), { required: true });
        if (bal.error) errors.push(`CF Bal：${bal.error}`);
        const sh = parseAmount(get('shipped'));
        if (sh.error) errors.push(`出貨：${sh.error}`);

        const name = get('account'); const gid = get('game_id');
        let account = null; let acctKey = null; let newName = null;
        if (gid && byGid.has(gid.toLowerCase())) account = byGid.get(gid.toLowerCase());
        else if (name && byName.has(name.toLowerCase())) account = byName.get(name.toLowerCase());
        if (account) acctKey = account.id;
        else if (!name && !gid) errors.push('缺少帳號名稱或遊戲內 ID');
        else {
          newName = (name || gid).slice(0, 40);
          acctKey = 'new:' + newName.toLowerCase();
          if (!newAccounts.has(acctKey)) newAccounts.set(acctKey, { name: newName, gameId: gid });
        }

        let status = 'new'; let existing = null;
        if (!errors.length) {
          const k = acctKey + '|' + date;
          if (seen.has(k)) errors.push(`與第 ${seen.get(k)} 列重複（同帳號同日期），此列不會匯入`);
          else {
            seen.set(k, line);
            if (account) existing = Store.recordFor(account.id, date);
            if (existing) status = 'duplicate';
          }
        }
        if (errors.length) status = 'error';
        items.push({
          line, status, errors, acctKey, existing,
          accountName: account ? account.name : newName,
          isNewAccount: !account && !!newName,
          value: { date, balance: bal.value, shipped: sh.value == null ? null : sh.value, note: get('note').slice(0, 200) },
        });
      }
      // 只保留實際會用到的新帳號
      const used = new Set(items.filter((it) => it.status !== 'error' && it.isNewAccount).map((it) => it.acctKey));
      Array.from(newAccounts.keys()).forEach((k) => { if (!used.has(k)) newAccounts.delete(k); });
      return {
        items, newAccounts, ignored,
        counts: {
          total: items.length,
          fresh: items.filter((it) => it.status === 'new').length,
          freshNewAccount: items.filter((it) => it.status === 'new' && it.isNewAccount).length,
          duplicate: items.filter((it) => it.status === 'duplicate').length,
          error: items.filter((it) => it.status === 'error').length,
        },
      };
    },
  };

  /* ---------- 範例資料 ---------- */
  function buildDemoState() {
    let seed = 20261022;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const s = emptyState();
    const today = todayISO();
    const defs = [
      { name: '主帳號', gameId: 'TW-100231', start: 52000, rate: 2600, skip: 0.08, status: 'active', note: '每天打完日常與公會任務' },
      { name: '小號 A', gameId: 'TW-208817', start: 18000, rate: 1500, skip: 0.15, status: 'active', note: '' },
      { name: '小號 B', gameId: 'TW-311420', start: 9000, rate: 1100, skip: 0.22, status: 'active', note: '只掛機' },
      { name: '倉庫號', gameId: 'TW-402995', start: 120000, rate: 350, skip: 0.3, status: 'active', note: '囤貨用，偶爾轉出' },
      { name: '舊帳號', gameId: 'TW-099120', start: 30000, rate: 800, skip: 0.2, status: 'inactive', note: '已停止經營' },
    ];
    defs.forEach((def, i) => {
      const acc = { id: uid('a') + i, name: def.name, gameId: def.gameId, note: def.note, status: def.status, colorIndex: i, createdAt: new Date().toISOString() };
      s.accounts.push(acc);
      let bal = def.start;
      // 每天早上記 CF Bal；當天白天賺、出貨，隔天的 CF Bal 才看得到
      for (let k = 89; k >= 0; k--) {
        const date = addDays(today, -k);
        const recorded = !(def.status === 'inactive' && k < 40) && !(k === 0 && i >= 2) && !(k > 0 && rand() < def.skip);
        if (recorded) {
          s.records.push({ id: uid('r') + i + '_' + k, accountId: acc.id, date, balance: bal, shipped: null, note: '', updatedAt: new Date().toISOString() });
        }
        if (def.status === 'inactive' && k < 40) continue;
        const earned = Math.round((def.rate * (0.4 + rand() * 1.2)) / 10) * 10;
        const ship = k > 0 && rand() < 0.18 && bal > def.rate * 4 ? Math.round((bal * (0.2 + rand() * 0.3)) / 100) * 100 : 0;
        bal = Math.max(0, bal + earned - ship);
        if (ship) s.shipments.push({ id: uid('s') + i + '_' + k, accountId: acc.id, date, amount: ship, note: '出貨給客人', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
    });
    return s;
  }

  global.GCT = {
    Store, Calc, CSV, PALETTE, parseAmount, buildDemoState, normalizeState, mergeStates,
    D: { todayISO, addDays, daysBetween, isISODate, normalizeDate, eachDay, parseISO, toISO },
  };
})(window);
