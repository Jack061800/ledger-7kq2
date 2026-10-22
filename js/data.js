/* 遊戲貨幣追蹤：資料層（儲存、驗證、計算、CSV）
 * 所有資料存在瀏覽器 localStorage，結構：
 * { version, settings: { currencyName, lastBackupAt }, accounts: [...], records: [...] }
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'gct:data:v1';
  const PREV_KEY = 'gct:data:before-restore';
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

  // 解析非負整數，允許千分位逗號；回傳 { value } 或 { error }
  function parseAmount(raw, { required = false } = {}) {
    const s = toHalfWidth(String(raw == null ? '' : raw)).trim().replace(/[,\s，_]/g, '');
    if (s === '') return required ? { error: '必填' } : { value: null };
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
  function emptyState() {
    return { version: SCHEMA_VERSION, settings: { currencyName: '金幣', lastBackupAt: null, monthlyGoal: null }, accounts: [], records: [] };
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
    }
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
      state.records.push({
        id: String(r.id || uid('r')),
        accountId: String(r.accountId),
        date: r.date,
        balance: r.balance,
        gained: optInt(r.gained, where),
        spent: optInt(r.spent, where),
        note: String(r.note || ''),
        updatedAt: r.updatedAt || new Date().toISOString(),
      });
    });
    return state;
  }

  function nextColorIndex(state) {
    const used = new Set(state.accounts.map((a) => a.colorIndex % PALETTE.length));
    for (let i = 0; i < PALETTE.length; i++) if (!used.has(i)) return i;
    return state.accounts.length % PALETTE.length;
  }

  /* ---------- 衍生計算 ----------
   * 每筆記錄：
   *   net      每日淨變化 = 當日餘額 − 同帳號前一次（較早日期）記錄的餘額；首筆為 null
   *   gap      與前一次記錄相隔天數（>1 代表中間有未記錄的日期，net 是多天合計）
   *   recorded 記錄收益 = 取得量 − 使用量（只要填了其中一欄就計算，未填的一欄視為 0）
   *   diff     差異 = net − recorded（兩者都有值時）
   */
  function derive(state) {
    const byAccount = new Map();
    const byId = new Map();
    state.accounts.forEach((a) => byAccount.set(a.id, []));
    state.records.forEach((r) => { const list = byAccount.get(r.accountId); if (list) list.push(r); });
    byAccount.forEach((list) => {
      list.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
      let prev = null;
      list.forEach((r) => {
        const net = prev ? r.balance - prev.balance : null;
        const gap = prev ? daysBetween(prev.date, r.date) : null;
        const recorded = r.gained == null && r.spent == null ? null : (r.gained || 0) - (r.spent || 0);
        const diff = net != null && recorded != null ? net - recorded : null;
        const mismatch = diff != null && diff !== 0;
        // strict：與前一天相連卻對不上，最需要檢查；跨多天的差異可能來自未記錄的日期
        byId.set(r.id, { record: r, prev, net, gap, recorded, diff, mismatch, strict: mismatch && gap === 1 });
        prev = r;
      });
    });
    return { byAccount, byId };
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

    // 所有寫入都經過這裡：失敗時還原記憶體中的狀態，避免畫面與儲存不一致
    _commit(mutator) {
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
      this._listeners.forEach((fn) => fn());
      return result;
    },

    derived() {
      if (!this._derived) this._derived = derive(this.state);
      return this._derived;
    },

    /* 設定 */
    updateSettings(patch) {
      return this._commit((s) => { Object.assign(s.settings, patch); });
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
        const acc = { id: uid('a'), ...value, colorIndex: nextColorIndex(s), createdAt: new Date().toISOString() };
        s.accounts.push(acc);
        return acc;
      });
    },

    updateAccount(id, input) {
      const current = this.account(id);
      if (!current) throw new Error('找不到這個帳號');
      const { errors, value } = this.validateAccount({ ...current, ...input }, id);
      if (Object.keys(errors).length) throw fieldError(errors);
      return this._commit((s) => { Object.assign(s.accounts.find((a) => a.id === id), value); });
    },

    deleteAccount(id) {
      return this._commit((s) => {
        s.accounts = s.accounts.filter((a) => a.id !== id);
        s.records = s.records.filter((r) => r.accountId !== id);
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
      [['balance', true], ['gained', false], ['spent', false]].forEach(([k, required]) => {
        const r = parseAmount(input[k], { required });
        if (r.error) errors[k] = r.error; else value[k] = r.value;
      });
      value.note = String(input.note || '').trim().slice(0, 200);
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
        if (target) { Object.assign(target, value, { updatedAt: now }); return { record: target, mode: 'updated' }; }
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
      return this._commit((s) => { s.records = s.records.filter((r) => r.id !== id); });
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
              const acc = { id: uid('a'), name: info.name, gameId: info.gameId || '', note: '由 CSV 匯入建立', status: 'active', colorIndex: nextColorIndex(s), createdAt: now };
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
      return this._commit(() => { this.state = next; });
    },
    previousSnapshot() {
      try { const raw = localStorage.getItem(PREV_KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
    },
    restorePrevious() {
      const snap = this.previousSnapshot();
      if (!snap) throw new Error('沒有可以復原的資料');
      const data = normalizeState(snap.data);
      this._commit(() => { this.state = data; });
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

    /* 某帳號在 [start, end] 期間的統計
     *   net     期間內每筆記錄淨變化的總和（= 期間最後餘額 − 期間開始前最後一筆餘額）
     *   covered 這些淨變化涵蓋的天數（各記錄 gap 的總和）
     *   avg     每日平均 = net ÷ covered
     *   recorded 期間內記錄收益（取得 − 使用）的總和
     */
    windowStats(accountId, start, end) {
      const d = Store.derived();
      let net = 0; let netCount = 0; let covered = 0; let recorded = 0; let recordedCount = 0; let mismatch = 0; let days = 0;
      this.list(accountId).forEach((r) => {
        if (r.date < start || r.date > end) return;
        const x = d.byId.get(r.id);
        days++;
        if (x.net != null) { net += x.net; netCount++; covered += x.gap; }
        if (x.recorded != null) { recorded += x.recorded; recordedCount++; }
        if (x.strict) mismatch++;
      });
      return {
        days, netCount, covered, recordedCount, mismatch,
        net: netCount ? net : null,
        avg: covered ? net / covered : null,
        recorded: recordedCount ? recorded : null,
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

    // 每日淨變化序列（沒有記錄的日期為 null，不當作 0）
    dailyNet(accountId, dates) {
      const map = new Map(this.list(accountId).map((r) => [r.date, this.info(r.id)]));
      return dates.map((d) => map.get(d) || null);
    },

    // 累計淨變化：該日（或之前最近一筆）餘額 − 期間開始前最後一筆餘額
    cumulative(accountId, dates) {
      const list = this.list(accountId);
      if (!dates.length) return [];
      const start = dates[0]; const end = dates[dates.length - 1];
      const base = this.latestBefore(list, start) || list.find((r) => r.date >= start && r.date <= end) || null;
      if (!base) return dates.map(() => null);
      let p = -1;
      return dates.map((date) => {
        while (p + 1 < list.length && list[p + 1].date <= date) p++;
        if (p < 0 || list[p].date < base.date) return null;
        return list[p].balance - base.balance;
      });
    },
  };

  /* ---------- CSV ---------- */
  const CSV_COLUMNS = ['date', 'account', 'game_id', 'balance', 'gained', 'spent', 'note'];
  const CSV_COMPUTED = ['net_change', 'recorded_profit', 'difference'];
  const ALIASES = {
    date: ['date', '日期'],
    account: ['account', 'account_name', 'name', '帳號', '帳號名稱', '账号'],
    game_id: ['game_id', 'gameid', 'game id', '遊戲內id', '遊戲id', '遊戲內 id'],
    balance: ['balance', '餘額', '當日餘額', '余额'],
    gained: ['gained', 'gain', 'income', '取得', '取得量', '當日取得量'],
    spent: ['spent', 'spend', 'expense', '使用', '使用量', '當日使用量'],
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
      const rows = [CSV_COLUMNS.concat(CSV_COMPUTED)];
      records.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((r) => {
        const a = Store.account(r.accountId);
        const x = d.byId.get(r.id) || {};
        rows.push([r.date, a ? a.name : '', a ? a.gameId : '', r.balance, r.gained, r.spent, r.note, x.net, x.recorded, x.diff]);
      });
      return CSV.stringify(rows);
    },

    template() {
      const today = todayISO();
      return CSV.stringify([CSV_COLUMNS, [today, '主帳號', 'TW-000001', 12345, 1500, 300, '範例：可刪除此列']]);
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
      if (col.balance == null) missing.push('balance（餘額）');
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
        if (bal.error) errors.push(`餘額：${bal.error}`);
        const g = parseAmount(get('gained'));
        if (g.error) errors.push(`取得量：${g.error}`);
        const sp = parseAmount(get('spent'));
        if (sp.error) errors.push(`使用量：${sp.error}`);

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
          value: { date, balance: bal.value, gained: g.value == null ? null : g.value, spent: sp.value == null ? null : sp.value, note: get('note').slice(0, 200) },
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
      for (let k = 89; k >= 0; k--) {
        const date = addDays(today, -k);
        const gained = Math.round((def.rate * (0.4 + rand() * 1.2)) / 10) * 10;
        const spent = rand() < 0.3 ? Math.round((def.rate * rand() * 1.6) / 10) * 10 : 0;
        let realDelta = gained - spent;
        const injectMismatch = rand() < 0.04;
        if (injectMismatch) realDelta += 200;
        bal = Math.max(0, bal + realDelta);
        if (def.status === 'inactive' && k < 40) continue;
        if (k === 0 && i >= 2) continue; // 今天還沒記錄的帳號，用來展示提醒
        if (k > 0 && rand() < def.skip) continue; // 缺漏日期
        const detailed = rand() < 0.85;
        s.records.push({
          id: uid('r') + i + '_' + k, accountId: acc.id, date, balance: bal,
          gained: detailed ? gained : null,
          spent: detailed ? spent : null,
          note: injectMismatch ? '有一筆交易忘了記' : '',
          updatedAt: new Date().toISOString(),
        });
      }
    });
    return s;
  }

  global.GCT = {
    Store, Calc, CSV, PALETTE, parseAmount, buildDemoState, normalizeState,
    D: { todayISO, addDays, daysBetween, isISODate, normalizeDate, eachDay, parseISO, toISO },
  };
})(window);
