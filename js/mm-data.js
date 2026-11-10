/* Maple M：資料層（和 M Sea 完全分開存放）
 * 本機儲存：gct:mm:v1:<Gmail>（沒登入時 gct:mm:v1:local），不會讀寫 M Sea 的 gct:data:v1。
 * 結構：
 * { version, settings: { rules, drive, updatedAt },
 *   accounts:   [{ id, name, note, status, order, createdAt, updatedAt }]
 *   characters: [{ id, accountId, name, job, note, status, order, createdAt, updatedAt }]
 *   sessions:   [{ id, charId, date, start, end, minutes, note, createdAt, updatedAt }]   掛機記錄，一個角色一天可以很多段
 *   mesos:      [{ id, charId, date, time, red, yellow, remain, source, batchId, note, createdAt, updatedAt }]  每個角色每天一筆庫存（當天最後一次讀數；remain = 自動戰鬥剩餘秒數）
 *   imports:    [{ id, source, label, ref, at, hash, counts, headers, mapping, rows }]  每次匯入／同步的紀錄和原始資料
 *   deleted:    [{ k, at }] }  刪除紀錄（跨裝置同步時避免被帶回來）
 */
(function (global) {
  'use strict';

  const { D, parseAmount, CSV } = global.GCT;
  const KEY = 'gct:mm:v1:';
  const SCHEMA = 1;
  const MAX_MESOS = 999999999999999;
  const MAX_IMPORTS = 40;      // 只保留最近 40 次匯入紀錄
  const MAX_RAW_ROWS = 400;    // 每次匯入最多保留 400 列原始資料（有變動或有錯的列）
  const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

  /* ---------- 掛機規則（只用在 Maple M） ----------
   * dailyFree   每天可以免費領取的分鐘數（120）
   * warnAfter   自動戰鬥剩餘超過這個分鐘數就警示：可能無法領取（240 → 241 分起警示）
   * strongFrom  接近上限的強烈警示從幾分鐘開始（330）
   * cap         自動戰鬥剩餘的累計上限（360），超過算超限
   * 「每日免費 120」和「累計上限 360」是兩件事：前者是每天送多少，後者是最多能累積到多少。 */
  const RULES_DEFAULT = { dailyFree: 120, warnAfter: 240, strongFrom: 330, cap: 360 };
  /* ---------- 掛機排程設定 ----------
   * logins  每天進遊戲的時間（每次進去選角色開始掛，一直掛到下次進遊戲或時間用完）
   * refill  每天幾點每個角色加 dailyFree 分（最多到 cap） */
  const PLAN_DEFAULT = { logins: ['06:00', '12:00', '17:30'], refill: '00:00' };

  const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const nowISO = () => new Date().toISOString();
  const fieldError = (errors) => Object.assign(new Error('資料有誤，請檢查欄位'), { fieldErrors: errors });
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const sameName = (a, b) => str(a, 80).toLowerCase() === str(b, 80).toLowerCase();

  function emptyState() {
    return {
      version: SCHEMA,
      settings: { rules: { ...RULES_DEFAULT }, drive: driveDefault(), plan: normPlan(null), updatedAt: null },
      accounts: [], characters: [], sessions: [], mesos: [], imports: [], deleted: [],
    };
  }
  // Drive 同步設定。type：'sheet' = Google 試算表（要授權）、'csv' = 公開的 CSV 連結、'' = 不自動同步
  function driveDefault() {
    return { type: '', sheet: '', tab: '', csvUrl: '', auto: true, dateOrder: 'mdy', overwriteManual: false, defaultAccount: '', mapping: null, lastSyncAt: null, lastCheckAt: null, lastStatus: '', lastError: '' };
  }

  /* ---------- 時間 ---------- */
  // 'HH:MM' → 一天中的第幾分鐘；格式錯回傳 null
  function parseTime(s) {
    const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1]; const mi = +m[2];
    return h < 24 && mi < 60 ? h * 60 + mi : null;
  }
  const fmtClock = (min) => { const x = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
  // 一段掛機的起訖（分鐘）。結束早於開始 = 跨過午夜，整段算在開始那天
  function span(s) {
    const a = parseTime(s.start);
    if (a == null) return null;
    const b = parseTime(s.end);
    const end = b == null ? a + s.minutes : b <= a ? b + 1440 : b;
    return { from: a, to: end };
  }

  /* ---------- 正規化（讀取、還原、同步時都會跑） ---------- */
  function normRules(r) {
    const out = { ...RULES_DEFAULT };
    if (r && typeof r === 'object') {
      ['dailyFree', 'warnAfter', 'strongFrom', 'cap'].forEach((k) => { const n = Number(r[k]); if (Number.isInteger(n) && n >= 0 && n <= 1440) out[k] = n; });
    }
    if (!(out.warnAfter < out.cap && out.strongFrom > out.warnAfter && out.strongFrom <= out.cap && out.dailyFree >= 1)) return { ...RULES_DEFAULT };
    return out;
  }
  function normPlan(p) {
    const logins = p && Array.isArray(p.logins) ? [...new Set(p.logins.map((t) => parseTime(t)).filter((t) => t != null))].sort((a, b) => a - b).slice(0, 8).map(fmtClock) : [];
    const refill = p && parseTime(p.refill) != null ? fmtClock(parseTime(p.refill)) : PLAN_DEFAULT.refill;
    return { logins: logins.length ? logins : PLAN_DEFAULT.logins.slice(), refill };
  }
  function normDrive(d) {
    const out = driveDefault();
    if (!d || typeof d !== 'object') return out;
    if (['sheet', 'csv', ''].includes(d.type)) out.type = d.type;
    out.sheet = str(d.sheet, 300); out.tab = str(d.tab, 100); out.csvUrl = str(d.csvUrl, 600);
    out.auto = d.auto !== false;
    out.dateOrder = d.dateOrder === 'dmy' ? 'dmy' : 'mdy';
    out.overwriteManual = !!d.overwriteManual;
    out.defaultAccount = str(d.defaultAccount, 40);
    out.mapping = d.mapping && typeof d.mapping === 'object' ? Object.fromEntries(Object.entries(d.mapping).filter(([k, v]) => FIELDS.includes(k) && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 100)])) : null;
    ['lastSyncAt', 'lastCheckAt'].forEach((k) => { out[k] = typeof d[k] === 'string' ? d[k] : null; });
    out.lastStatus = ['ok', 'same', 'error', 'auth', ''].includes(d.lastStatus) ? d.lastStatus : '';
    out.lastError = str(d.lastError, 300);
    return out;
  }
  const intOrNull = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(MAX_MESOS, Math.round(Number(v))) : null);
  function normalizeState(raw) {
    const s = emptyState();
    if (!raw || typeof raw !== 'object') return s;
    const st = raw.settings || {};
    s.settings = { rules: normRules(st.rules), drive: normDrive(st.drive), plan: normPlan(st.plan), updatedAt: typeof st.updatedAt === 'string' ? st.updatedAt : null };
    const stamp = (x) => ({ createdAt: typeof x.createdAt === 'string' ? x.createdAt : nowISO(), updatedAt: typeof x.updatedAt === 'string' ? x.updatedAt : (typeof x.createdAt === 'string' ? x.createdAt : nowISO()) });
    const ids = new Set();
    const fresh = (x) => x && typeof x.id === 'string' && !ids.has(x.id) && ids.add(x.id);
    (Array.isArray(raw.accounts) ? raw.accounts : []).forEach((a, i) => {
      if (!fresh(a) || !str(a.name, 40)) return;
      s.accounts.push({ id: a.id, name: str(a.name, 40), note: str(a.note, 300), status: a.status === 'inactive' ? 'inactive' : 'active', order: Number.isFinite(a.order) ? a.order : i, ...stamp(a) });
    });
    const accIds = new Set(s.accounts.map((a) => a.id));
    (Array.isArray(raw.characters) ? raw.characters : []).forEach((c, i) => {
      if (!fresh(c) || !accIds.has(c.accountId) || !str(c.name, 40)) return;
      s.characters.push({ id: c.id, accountId: c.accountId, name: str(c.name, 40), job: str(c.job, 40), note: str(c.note, 300), status: c.status === 'inactive' ? 'inactive' : 'active', order: Number.isFinite(c.order) ? c.order : i, ...stamp(c) });
    });
    const charIds = new Set(s.characters.map((c) => c.id));
    (Array.isArray(raw.sessions) ? raw.sessions : []).forEach((x) => {
      if (!fresh(x) || !charIds.has(x.charId) || !D.isISODate(x.date)) return;
      const minutes = Math.round(Number(x.minutes));
      if (!(minutes >= 1 && minutes <= 1440)) return;
      const start = parseTime(x.start) == null ? '' : x.start;
      const end = start && parseTime(x.end) != null ? x.end : '';
      s.sessions.push({ id: x.id, charId: x.charId, date: x.date, start, end, minutes, note: str(x.note, 200), ...stamp(x) });
    });
    // 庫存：同一角色同一天只留一筆（較新的）
    const byKey = new Map();
    (Array.isArray(raw.mesos) ? raw.mesos : []).forEach((x) => {
      if (!fresh(x) || !charIds.has(x.charId) || !D.isISODate(x.date)) return;
      const red = intOrNull(x.red); const yellow = intOrNull(x.yellow); const remain = intOrNull(x.remain);
      if (red == null && yellow == null && remain == null) return;
      const m = { id: x.id, charId: x.charId, date: x.date, time: parseTime(x.time) == null ? '' : x.time, red, yellow, remain, source: ['manual', 'drive', 'csv', 'file', 'paste'].includes(x.source) ? x.source : 'manual', batchId: typeof x.batchId === 'string' ? x.batchId : null, note: str(x.note, 200), ...stamp(x) };
      const k = `${m.charId}|${m.date}`;
      const prev = byKey.get(k);
      if (!prev || prev.updatedAt < m.updatedAt) byKey.set(k, m);
    });
    s.mesos = Array.from(byKey.values());
    (Array.isArray(raw.imports) ? raw.imports : []).forEach((x) => {
      if (!fresh(x) || typeof x.at !== 'string') return;
      s.imports.push({
        id: x.id, source: str(x.source, 20), label: str(x.label, 200), ref: str(x.ref, 600), at: x.at, hash: str(x.hash, 40),
        counts: x.counts && typeof x.counts === 'object' ? x.counts : {}, headers: Array.isArray(x.headers) ? x.headers.slice(0, 40).map((h) => str(h, 80)) : [],
        mapping: x.mapping && typeof x.mapping === 'object' ? x.mapping : null, total: Number(x.total) || 0, note: str(x.note, 300),
        rows: Array.isArray(x.rows) ? x.rows.slice(0, MAX_RAW_ROWS) : [],
      });
    });
    s.imports.sort((a, b) => (a.at < b.at ? 1 : -1));
    s.imports = s.imports.slice(0, MAX_IMPORTS);
    // 帳號、角色的刪除紀錄一定保留（否則整個帳號會被其他裝置帶回來）；單筆記錄的只留最近 3000 筆
    const del = (Array.isArray(raw.deleted) ? raw.deleted : []).filter((d) => d && typeof d.k === 'string' && typeof d.at === 'string');
    const isOwner = (d) => /^mm[ac]_/.test(d.k);
    s.deleted = [...del.filter(isOwner), ...del.filter((d) => !isOwner(d)).slice(-3000)];
    return s;
  }

  /* ---------- 合併（兩台裝置的資料）：每一筆看 updatedAt，新的贏；刪除紀錄比資料新就刪 ---------- */
  function mergeStates(a, b) {
    const del = new Map();
    [...a.deleted, ...b.deleted].forEach((d) => { const p = del.get(d.k); if (!p || p < d.at) del.set(d.k, d.at); });
    const pick = (la, lb) => {
      const m = new Map();
      [...la, ...lb].forEach((x) => { const p = m.get(x.id); if (!p || p.updatedAt < x.updatedAt) m.set(x.id, x); });
      return Array.from(m.values()).filter((x) => { const t = del.get(x.id); return !t || t < x.updatedAt; });
    };
    const sa = a.settings.updatedAt || ''; const sb = b.settings.updatedAt || '';
    const imports = new Map();
    [...a.imports, ...b.imports].forEach((x) => { if (!imports.has(x.id) && !del.has(x.id)) imports.set(x.id, x); });
    return {
      version: SCHEMA,
      settings: sa >= sb ? a.settings : b.settings,
      accounts: pick(a.accounts, b.accounts),
      characters: pick(a.characters, b.characters),
      sessions: pick(a.sessions, b.sessions),
      mesos: pick(a.mesos, b.mesos),
      imports: Array.from(imports.values()),
      deleted: Array.from(del.entries()).map(([k, at]) => ({ k, at })),
    };
  }

  /* ---------- 匯入：欄位辨識 ---------- */
  const FIELDS = ['date', 'time', 'account', 'character', 'red', 'yellow', 'remain', 'total', 'check', 'note'];
  const FIELD_LABEL = { date: '日期', time: '時間', account: '帳號', character: '角色', red: '紅色 Mesos', yellow: '黃色 Mesos', remain: '自動戰鬥剩餘', total: '合計', check: '核對', note: '備註' };
  const DEFAULT_ACCOUNT = '未分帳號';
  const SUMMARY_ROW = /^(全部角色|全部|合计|合計|总计|總計|total|all)$/i;
  const CHECK_OK = /^(对|對|ok|✓|√|true|yes|y)$/i;
  const SYN = {
    date: ['date', 'day', '日期', '日子', '更新时间', '更新時間'],
    time: ['time', '時間', '时间'],
    remain: ['remain', 'remaining', 'autobattle', '自动战斗剩余', '自動戰鬥剩餘', '剩余', '剩餘'],
    total: ['total', 'sum', '合计', '合計', '总计', '總計'],
    check: ['check', 'verify', '核对', '核對'],
    account: ['account', 'acc', 'acct', '帳號', '账号', '帳戶', '账户', '帐号'],
    character: ['character', 'char', 'ign', 'charname', '角色', '角色名', '角色名稱', '角色名称', '人物', 'name', '名字', '名稱', '名称'],
    red: ['red', 'redmesos', 'redmeso', '紅', '红', '紅色', '红色', '紅色mesos', '红色mesos', '紅幣', '红币', '紅楓幣', '红枫币'],
    yellow: ['yellow', 'yellowmesos', 'yellowmeso', '黃', '黄', '黃色', '黄色', '黃色mesos', '黄色mesos', '黃幣', '黄币', '黃楓幣', '黄枫币'],
    note: ['note', 'notes', 'memo', 'remark', 'remarks', '備註', '备注', '說明', '说明'],
  };
  const normHead = (h) => String(h == null ? '' : h).toLowerCase().replace(/[\s_\-.:：()（）[\]【】]/g, '');
  function guessField(h) {
    const n = normHead(h);
    if (!n) return null;
    for (const f of FIELDS) if (SYN[f].includes(n)) return f;
    // 部分符合：例如「紅色 Mesos 數量」「Yellow (M)」
    if (/剩余|剩餘|remain/.test(n)) return 'remain';
    if (/紅|红|^red|red$/.test(n)) return 'red';
    if (/黃|黄|yellow/.test(n)) return 'yellow';
    if (/日期|^date/.test(n)) return 'date';
    if (/帳號|账号|帐号|account/.test(n)) return 'account';
    if (/角色|character/.test(n)) return 'character';
    if (/備註|备注|note|memo/.test(n)) return 'note';
    return null;
  }
  // 在前 10 列裡找標題列：至少要認得「角色」加上「紅色或黃色」
  function detectHeader(table) {
    let best = null;
    for (let i = 0; i < Math.min(10, table.length); i++) {
      const map = {};
      (table[i] || []).forEach((h, col) => { const f = guessField(h); if (f && map[f] == null) map[f] = col; });
      const score = Object.keys(map).length;
      if (map.character != null && (map.red != null || map.yellow != null) && (!best || score > best.score)) best = { row: i, map, score };
    }
    return best;
  }

  // 日期：2026-11-01、2026/11/1、11/1/2026（或日/月/年）、11/1（沒寫年份 → 今年，若變成未來就算去年）、試算表的日期序號
  function parseDateCell(v, order, today = D.todayISO()) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(1899, 11, 30); d.setDate(d.getDate() + Math.floor(v));
      return D.toISO(d);
    }
    const s = String(v).trim().replace(/[年月]/g, '/').replace(/日$/, '');
    const iso = D.normalizeDate(s.replace(/\s.*$/, ''));
    if (iso) return iso;
    let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/);
    const pad = (n) => String(n).padStart(2, '0');
    const make = (y, mo, d) => { const x = `${y}-${pad(mo)}-${pad(d)}`; return D.isISODate(x) ? x : null; };
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return order === 'dmy' ? make(y, +m[2], +m[1]) : make(y, +m[1], +m[2]);
    }
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
    if (m) {
      const y = Number(today.slice(0, 4));
      const [mo, d] = order === 'dmy' ? [+m[2], +m[1]] : [+m[1], +m[2]];
      const x = make(y, mo, d);
      if (x && D.daysBetween(today, x) > 7) return make(y - 1, mo, d);
      return x;
    }
    return null;
  }
  // 數量：1,234、$1,234、1.5B、300m、（空白 = 沒有這個欄位）
  function parseMesosCell(v) {
    if (v == null || v === '') return { value: null };
    if (typeof v === 'number') return v >= 0 && v <= MAX_MESOS ? { value: Math.round(v) } : { error: '數字不正確' };
    const s = String(v).trim().replace(/[$＄]/g, '').replace(/^rm/i, '').trim();
    if (s === '' || s === '-' || s === '—') return { value: null };
    const r = parseAmount(s);
    return r.error ? { error: r.error } : { value: r.value };
  }

  // 自動戰鬥剩餘 → 秒：260:46（分:秒）、4:20:46（時:分:秒）、純數字 = 分鐘
  function parseRemainCell(v) {
    if (v == null || v === '') return { value: null };
    if (typeof v === 'number') return v >= 0 && v < 100000 ? { value: Math.round(v * 60) } : { error: '自動戰鬥剩餘的數字不正確' };
    const s = String(v).trim();
    if (s === '' || s === '-' || s === '—') return { value: null };
    let m = s.match(/^(\d{1,5}):([0-5]\d)$/);
    if (m) return { value: Number(m[1]) * 60 + Number(m[2]) };
    m = s.match(/^(\d{1,4}):([0-5]\d):([0-5]\d)$/);
    if (m) return { value: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) };
    if (/^\d{1,5}(\.\d+)?$/.test(s)) return { value: Math.round(Number(s) * 60) };
    return { error: `自動戰鬥剩餘看不懂（${s}）` };
  }
  const fmtRemain = (sec) => (sec == null ? '—' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
  // 時間：21:29、21:29:05、試算表的時間小數；日期格裡也可能帶時間（2026-11-02 07:01）
  function parseTimeCell(v) {
    if (typeof v === 'number') { if (v < 0 || v >= 1) return ''; return fmtClock(Math.round(v * 1440)); }
    const m = String(v == null ? '' : v).match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
    if (!m) return '';
    const t = parseTime(`${m[1]}:${m[2]}`);
    return t == null ? '' : fmtClock(t);
  }

  // 雜湊（判斷同一批資料有沒有匯入過；不是加密用）
  function hashOf(text) {
    let h1 = 0x811c9dc5; let h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
  const cellText = (v) => (v == null ? '' : typeof v === 'number' ? String(v) : String(v));

  /* ---------- 計算 ---------- */
  // minutes = 自動戰鬥剩餘分鐘；null = 沒有讀數
  function idleStatus(minutes, rules) {
    const r = rules;
    if (minutes == null) return { key: 'none', minutes: null, toWarn: null, toCap: null };
    const key = minutes > r.cap ? 'over' : minutes >= r.strongFrom ? 'strong' : minutes > r.warnAfter ? 'warn' : 'ok';
    return {
      key, minutes,
      toWarn: r.warnAfter - minutes,   // 距離 240 還差（負數 = 已超過）
      toCap: r.cap - minutes,          // 距離 360 還差（負數 = 超限多少）
    };
  }

  const listeners = [];
  const Store = {
    state: emptyState(),
    owner: 'local',
    loadError: null,
    RULES_DEFAULT, FIELDS, FIELD_LABEL, COLORS,
    onChange(fn) { listeners.push(fn); },
    _emit(source) { listeners.forEach((fn) => { try { fn(source); } catch (e) { console.error(e); } }); },
    key() { return KEY + this.owner; },

    load(owner) {
      this.owner = owner || 'local';
      try {
        const raw = localStorage.getItem(this.key());
        this.state = raw ? normalizeState(JSON.parse(raw)) : emptyState();
        this.loadError = null;
      } catch (e) {
        this.state = emptyState();
        this.loadError = '讀不到 Maple M 的本機資料（可能已損壞），請從備份還原。M Sea 的資料不受影響。';
      }
    },
    save() {
      try { localStorage.setItem(this.key(), JSON.stringify(this.state)); } catch (e) {
        throw new Error('瀏覽器儲存空間不足，Maple M 的資料沒有存到。可以先下載備份，再刪除舊的匯入紀錄。');
      }
    },
    // 所有修改都經過這裡：先改複本，存檔成功才換上
    _commit(fn, source = 'user') {
      const before = JSON.stringify(this.state);
      const draft = JSON.parse(before);
      const out = fn(draft);
      const next = normalizeState(draft);
      this.state = next;
      try { this.save(); } catch (e) { this.state = normalizeState(JSON.parse(before)); throw e; }
      this._emit(source);
      return out;
    },
    applySynced(next) { this.state = normalizeState(next); this.save(); this._emit('sync'); },
    replaceState(next) { return this._commit((s) => { Object.keys(s).forEach((k) => delete s[k]); Object.assign(s, normalizeState(next)); }); },

    get rules() { return this.state.settings.rules; },
    get drive() { return this.state.settings.drive; },
    get plan() { return this.state.settings.plan; },

    /* ----- 帳號 ----- */
    accounts() { return this.state.accounts.slice().sort((a, b) => a.order - b.order); },
    account(id) { return this.state.accounts.find((a) => a.id === id) || null; },
    color(id) { const i = this.accounts().findIndex((a) => a.id === id); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; },
    _validAccount(input, id) {
      const name = str(input.name, 40);
      const errors = {};
      if (!name) errors.name = '請輸入帳號名稱';
      else if (this.state.accounts.some((a) => a.id !== id && sameName(a.name, name))) errors.name = '已經有同名的帳號';
      if (Object.keys(errors).length) throw fieldError(errors);
      return { name, note: str(input.note, 300), status: input.status === 'inactive' ? 'inactive' : 'active' };
    },
    addAccount(input) {
      const v = this._validAccount(input, null);
      const a = { id: uid('mma'), ...v, order: this.state.accounts.length ? Math.max(...this.state.accounts.map((x) => x.order)) + 1 : 0, createdAt: nowISO(), updatedAt: nowISO() };
      this._commit((s) => { s.accounts.push(a); });
      return a;
    },
    updateAccount(id, input) {
      const v = this._validAccount({ ...this.account(id), ...input }, id);
      this._commit((s) => { const a = s.accounts.find((x) => x.id === id); Object.assign(a, v, { updatedAt: nowISO() }); });
    },
    // 刪除帳號會一起刪掉底下的角色、掛機記錄、庫存
    deleteAccount(id) {
      this._commit((s) => {
        const at = nowISO();
        const chars = new Set(s.characters.filter((c) => c.accountId === id).map((c) => c.id));
        // 只記帳號和角色的刪除紀錄：底下的記錄找不到角色時，讀取和合併都會自動丟掉
        const gone = [id, ...chars];
        s.accounts = s.accounts.filter((a) => a.id !== id);
        s.characters = s.characters.filter((c) => !chars.has(c.id));
        s.sessions = s.sessions.filter((x) => !chars.has(x.charId));
        s.mesos = s.mesos.filter((x) => !chars.has(x.charId));
        gone.forEach((k) => s.deleted.push({ k, at }));
      });
    },

    /* ----- 角色 ----- */
    characters(accountId) {
      const order = new Map(this.accounts().map((a, i) => [a.id, i]));
      return this.state.characters.filter((c) => !accountId || c.accountId === accountId)
        .sort((a, b) => (order.get(a.accountId) - order.get(b.accountId)) || a.order - b.order);
    },
    character(id) { return this.state.characters.find((c) => c.id === id) || null; },
    _validChar(input, id) {
      const errors = {};
      const name = str(input.name, 40);
      if (!this.account(input.accountId)) errors.accountId = '請選擇帳號';
      if (!name) errors.name = '請輸入角色名稱';
      else if (this.state.characters.some((c) => c.id !== id && c.accountId === input.accountId && sameName(c.name, name))) errors.name = '這個帳號已經有同名的角色';
      if (Object.keys(errors).length) throw fieldError(errors);
      return { accountId: input.accountId, name, job: str(input.job, 40), note: str(input.note, 300), status: input.status === 'inactive' ? 'inactive' : 'active' };
    },
    addCharacter(input) {
      const v = this._validChar(input, null);
      const c = { id: uid('mmc'), ...v, order: this.state.characters.length ? Math.max(...this.state.characters.map((x) => x.order)) + 1 : 0, createdAt: nowISO(), updatedAt: nowISO() };
      this._commit((s) => { s.characters.push(c); });
      return c;
    },
    updateCharacter(id, input) {
      const v = this._validChar({ ...this.character(id), ...input }, id);
      this._commit((s) => { const c = s.characters.find((x) => x.id === id); Object.assign(c, v, { updatedAt: nowISO() }); });
    },
    deleteCharacter(id) {
      this._commit((s) => {
        s.characters = s.characters.filter((c) => c.id !== id);
        s.sessions = s.sessions.filter((x) => x.charId !== id);
        s.mesos = s.mesos.filter((x) => x.charId !== id);
        s.deleted.push({ k: id, at: nowISO() });
      });
    },
    counts(charIds) {
      const set = new Set(charIds);
      return { sessions: this.state.sessions.filter((x) => set.has(x.charId)).length, mesos: this.state.mesos.filter((x) => set.has(x.charId)).length };
    },

    /* ----- 掛機記錄 ----- */
    sessionsFor(charId, date) {
      return this.state.sessions.filter((x) => x.charId === charId && x.date === date)
        .sort((a, b) => (a.start || '99') .localeCompare(b.start || '99') || a.createdAt.localeCompare(b.createdAt));
    },
    /* 某角色某天：累計分鐘（重疊的時間只算一次）和衝突
     *   timed    有起訖時間的段落合併後的分鐘
     *   untimed  只填時長的段落（無法判斷重疊，直接相加）
     *   overlap  重疊而沒有重複計算的分鐘
     *   conflicts 有和別段重疊的記錄 id */
    dayIdle(charId, date, sessions) {
      const list = sessions || this.sessionsFor(charId, date);
      const timed = list.map((x) => ({ x, sp: span(x) })).filter((t) => t.sp).sort((a, b) => a.sp.from - b.sp.from);
      const conflicts = new Set();
      let union = 0; let cur = null; let raw = 0;
      timed.forEach((t, i) => {
        raw += t.sp.to - t.sp.from;
        for (let j = i + 1; j < timed.length && timed[j].sp.from < t.sp.to; j++) { conflicts.add(t.x.id); conflicts.add(timed[j].x.id); }
        if (!cur || t.sp.from > cur.to) { if (cur) union += cur.to - cur.from; cur = { ...t.sp }; } else cur.to = Math.max(cur.to, t.sp.to);
      });
      if (cur) union += cur.to - cur.from;
      const untimed = list.filter((x) => !span(x)).reduce((n, x) => n + x.minutes, 0);
      const total = union + untimed;
      return { total, timed: union, untimed, overlap: raw - union, conflicts, sessions: list };
    },
    idleStatus(minutes) { return idleStatus(minutes, this.rules); },
    // 檢查一段新的（或修改後的）記錄：重複就不能存，重疊要提醒
    checkSession(input, editingId) {
      const v = this._validSession(input);
      const others = this.sessionsFor(v.charId, v.date).filter((x) => x.id !== editingId);
      const sp = span(v);
      if (sp && others.some((x) => x.start === v.start && span(x) && span(x).to === sp.to)) return { v, duplicate: true, overlaps: [] };
      if (!sp && others.some((x) => !span(x) && x.minutes === v.minutes && x.note === v.note)) return { v, duplicate: false, maybeDuplicate: true, overlaps: [] };
      const overlaps = sp ? others.filter((x) => { const o = span(x); return o && o.from < sp.to && sp.from < o.to; })
        .map((x) => { const o = span(x); return { session: x, minutes: Math.min(o.to, sp.to) - Math.max(o.from, sp.from) }; }) : [];
      const after = this.dayIdle(v.charId, v.date, [...others, { ...v, id: editingId || '_new' }]);
      return { v, duplicate: false, overlaps, after };
    },
    _validSession(input) {
      const errors = {};
      if (!this.character(input.charId)) errors.charId = '請選擇角色';
      if (!D.isISODate(input.date)) errors.date = '請選擇日期';
      else if (input.date > D.todayISO()) errors.date = '不能記未來的日子';
      let start = String(input.start || '').trim(); let end = String(input.end || '').trim(); let minutes = null;
      if (start && parseTime(start) == null) errors.start = '時間格式要像 09:30';
      if (end && parseTime(end) == null) errors.end = '時間格式要像 13:00';
      if (start && end && !errors.start && !errors.end) {
        const a = parseTime(start); const b = parseTime(end);
        minutes = b > a ? b - a : b + 1440 - a;
        if (a === b) errors.end = '結束時間不能和開始一樣';
      } else {
        const raw = String(input.minutes == null ? '' : input.minutes).trim();
        if (!raw) { if (!errors.start && !errors.end) errors[start ? 'end' : 'minutes'] = start ? '請填結束時間或時長' : '請填時長，或填開始和結束時間'; } else if (!/^\d{1,4}$/.test(raw)) errors.minutes = '請輸入整數分鐘';
        else minutes = Number(raw);
        if (minutes != null && (minutes < 1 || minutes > 1440)) errors.minutes = '時長要在 1–1440 分鐘之間';
        if (start && minutes && !errors.minutes) end = fmtClock(parseTime(start) + minutes);
        if (!start) end = '';
      }
      if (Object.keys(errors).length) throw fieldError(errors);
      return { charId: input.charId, date: input.date, start: start ? fmtClock(parseTime(start)) : '', end: end ? fmtClock(parseTime(end)) : '', minutes, note: str(input.note, 200) };
    },
    saveSession(input, editingId) {
      const chk = this.checkSession(input, editingId);
      if (chk.duplicate) throw fieldError({ start: '這個角色這天已經有一筆一模一樣的時段' });
      const v = chk.v;
      let saved;
      this._commit((s) => {
        if (editingId) {
          const x = s.sessions.find((y) => y.id === editingId);
          if (!x) throw new Error('找不到這筆記錄，可能已被刪除');
          Object.assign(x, v, { updatedAt: nowISO() }); saved = x;
        } else {
          saved = { id: uid('mms'), ...v, createdAt: nowISO(), updatedAt: nowISO() };
          s.sessions.push(saved);
        }
      });
      return { session: saved, overlaps: chk.overlaps };
    },
    deleteSession(id) {
      this._commit((s) => { s.sessions = s.sessions.filter((x) => x.id !== id); s.deleted.push({ k: id, at: nowISO() }); });
    },

    /* ----- Mesos 庫存 ----- */
    mesosFor(charId) { return this.state.mesos.filter((x) => x.charId === charId).sort((a, b) => (a.date < b.date ? -1 : 1)); },
    snapshot(charId, date) { return this.state.mesos.find((x) => x.charId === charId && x.date === date) || null; },
    // 某天的餘額：紅、黃各自取「這天或之前」最近一次有填的數字
    // 最近一次的自動戰鬥剩餘（還可以掛機多久）
    latestRemain(charId, date) {
      const list = this.mesosFor(charId).filter((x) => x.date <= date && x.remain != null);
      const x = list[list.length - 1];
      return x ? { remain: x.remain, date: x.date, time: x.time } : null;
    },
    // 某天看到的剩餘和警示；不滿一分鐘算一分鐘（240:10 已超過 240 分）
    dayRemain(charId, date) {
      const reading = this.latestRemain(charId, date);
      const minutes = reading ? Math.ceil(reading.remain / 60) : null;
      return { reading, minutes, status: idleStatus(minutes, this.rules) };
    },
    /* 掛機排程：從現在之後的第一次進遊戲開始，排 days 天
     *   一個帳號同時只能掛一個角色；每次進遊戲每個帳號選一個角色，掛到下次進遊戲或時間用完
     *   選角色：先選「不掛的話下次加時間會超過上限、浪費掉」最多的，再選這段能掛最久的，再選剩最多的
     *   起點是每個角色最近一次的自動戰鬥剩餘（讀數之後經過的加時間會補上，讀數之後掛過的不知道）
     * 回傳 { windows: [{ start, end, refills, lanes: [{ account, char, before, used, stopAt, after }] }], chars, totals } */
    idlePlan({ now = new Date(), days = 3 } = {}) {
      const r = this.rules; const p = this.plan;
      const MS = 60000;
      const at = (iso, min) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, Math.floor(min / 60), min % 60).getTime(); };
      const today = D.todayISO();
      const chars = this.characters().filter((c) => c.status === 'active' && (this.account(c.accountId) || {}).status === 'active');
      const state = new Map();
      const noReading = [];
      chars.forEach((c) => {
        const x = this.latestRemain(c.id, today);
        if (!x) { noReading.push(c); return; }
        state.set(c.id, { c, rem: x.remain / 60, reading: x, readingAt: at(x.date, parseTime(x.time) == null ? 0 : parseTime(x.time)), used: 0, waste: 0 });
      });
      // 進遊戲時間（現在之前 30 分鐘內的也算，剛進遊戲的這次也一起排）
      const loginMins = p.logins.map(parseTime);
      const logins = [];
      for (let k = -1; k <= days + 1; k++) loginMins.forEach((m) => logins.push(at(D.addDays(today, k), m)));
      const firstIdx = logins.findIndex((t) => t >= now.getTime() - 30 * MS);
      const wins = [];
      for (let i = firstIdx; i < logins.length - 1 && logins[i] < now.getTime() + days * 1440 * MS; i++) wins.push([logins[i], logins[i + 1]]);
      const start = wins.length ? wins[0][0] : now.getTime();
      const refillMin = parseTime(p.refill);
      const refills = [];
      const earliest = Math.min(start, ...Array.from(state.values()).map((s) => s.readingAt));
      const back = Math.ceil((start - earliest) / (1440 * MS)) + 1;
      for (let k = -back; k <= days + 2; k++) refills.push(at(D.addDays(today, k), refillMin));
      // 加時間：超過上限的部分算浪費
      const refillAll = () => state.forEach((s) => {
        const add = Math.min(r.dailyFree, Math.max(0, r.cap - s.rem));
        s.waste += r.dailyFree - add;
        s.rem += add;
      });
      // 讀數之後、開始排程之前的加時間
      state.forEach((s) => {
        refills.filter((t) => t > s.readingAt && t <= start).forEach(() => { s.rem = Math.min(r.cap, s.rem + r.dailyFree); });
        s.start = s.rem;
      });
      const lanes = new Map();
      state.forEach((s) => { const k = s.c.accountId; if (!lanes.has(k)) lanes.set(k, []); lanes.get(k).push(s); });
      const laneList = this.accounts().filter((a) => lanes.has(a.id)).map((a) => ({ account: a, list: lanes.get(a.id) }));
      const windows = wins.map(([t0, t1]) => {
        const len = (t1 - t0) / MS;
        const nextRefill = refills.find((t) => t > t0);
        const picks = laneList.map(({ account, list }) => {
          const cand = list.filter((s) => s.rem >= 1);
          if (!cand.length) return { account, char: null, before: 0, used: 0, stopAt: null, after: 0 };
          const score = (s) => {
            const runFor = Math.min(s.rem, ((nextRefill && nextRefill <= t1 ? nextRefill : t1) - t0) / MS);
            const wasteNo = Math.max(0, s.rem + r.dailyFree - r.cap);
            const wasteRun = Math.max(0, s.rem - runFor + r.dailyFree - r.cap);
            return (wasteNo - wasteRun) * 1e6 + Math.min(s.rem, len) * 1e3 + s.rem;
          };
          const s = cand.reduce((best, x) => (score(x) > score(best) ? x : best));
          return { account, s, char: s.c, before: s.rem, used: 0, stopAt: null, running: true };
        });
        // 一段一段算：掛到加時間的那一刻先加（還在掛的角色會繼續掛），再掛到下次進遊戲
        const inWin = refills.filter((t) => t > t0 && t <= t1);
        let cur = t0;
        const runTo = (b) => {
          picks.forEach((pk) => {
            if (!pk.s || !pk.running) return;
            const use = Math.min(pk.s.rem, (b - cur) / MS);
            pk.s.rem -= use; pk.used += use; pk.s.used += use;
            if (pk.s.rem < 1e-6) { pk.s.rem = 0; pk.running = false; pk.stopAt = cur + use * MS; }
          });
          cur = b;
        };
        inWin.forEach((b) => { runTo(b); refillAll(); });
        if (cur < t1) runTo(t1);
        return {
          start: t0, end: t1, len, refills: inWin,
          lanes: picks.map((pk) => ({ account: pk.account, char: pk.char, before: pk.before, used: pk.used, stopAt: pk.char ? (pk.stopAt || t1) : null, after: pk.s ? pk.s.rem : 0, idle: len - pk.used })),
        };
      });
      const list = Array.from(state.values());
      return {
        start, end: wins.length ? wins[wins.length - 1][1] : start, windows, lanes: laneList.map((l) => l.account), noReading,
        chars: list.map((s) => ({ char: s.c, reading: s.reading, start: s.start, used: s.used, waste: s.waste, end: s.rem })),
        totals: { used: list.reduce((t, s) => t + s.used, 0), waste: list.reduce((t, s) => t + s.waste, 0), perDay: list.length * r.dailyFree, laneTime: windows.reduce((t, w) => t + w.len * laneList.length, 0) },
      };
    },
    // 只看那一天自己的讀數（期間統計用，不沿用之前的數字）
    remainOn(charId, date) {
      const x = this.snapshot(charId, date);
      return x && x.remain != null ? Math.ceil(x.remain / 60) : null;
    },
    balanceAt(charId, date) {
      let red = null; let yellow = null; let redDate = null; let yellowDate = null;
      this.mesosFor(charId).forEach((x) => {
        if (x.date > date) return;
        if (x.red != null) { red = x.red; redDate = x.date; }
        if (x.yellow != null) { yellow = x.yellow; yellowDate = x.date; }
      });
      return { red, yellow, redDate, yellowDate, date: [redDate, yellowDate].filter(Boolean).sort().pop() || null };
    },
    // 多個角色每天的紅／黃合計（沒更新的日子沿用前一次的數字）
    series(charIds, start, end) {
      const days = D.eachDay(start, end);
      const per = charIds.map((id) => {
        const list = this.mesosFor(id);
        let i = 0; let red = null; let yellow = null;
        list.forEach((x) => { if (x.date < start) { if (x.red != null) red = x.red; if (x.yellow != null) yellow = x.yellow; } });
        while (i < list.length && list[i].date < start) i++;
        return days.map((d) => {
          while (i < list.length && list[i].date <= d) { if (list[i].red != null) red = list[i].red; if (list[i].yellow != null) yellow = list[i].yellow; i++; }
          return { red, yellow };
        });
      });
      return days.map((d, k) => {
        let red = null; let yellow = null;
        per.forEach((p) => { if (p[k].red != null) red = (red || 0) + p[k].red; if (p[k].yellow != null) yellow = (yellow || 0) + p[k].yellow; });
        return { date: d, red, yellow, updates: this.state.mesos.filter((x) => x.date === d && charIds.includes(x.charId)).length };
      });
    },
    _validMesos(input) {
      const errors = {};
      if (!this.character(input.charId)) errors.charId = '請選擇角色';
      if (!D.isISODate(input.date)) errors.date = '請選擇日期';
      else if (input.date > D.todayISO()) errors.date = '不能記未來的日子';
      const red = parseMesosCell(input.red); const yellow = parseMesosCell(input.yellow); const remain = parseRemainCell(input.remain);
      if (red.error) errors.red = red.error;
      if (yellow.error) errors.yellow = yellow.error;
      if (remain.error) errors.remain = remain.error;
      if (!errors.red && !errors.yellow && !errors.remain && red.value == null && yellow.value == null && remain.value == null) errors.red = '紅色、黃色、自動戰鬥剩餘至少填一個';
      if (Object.keys(errors).length) throw fieldError(errors);
      return { charId: input.charId, date: input.date, red: red.value, yellow: yellow.value, remain: remain.value, note: str(input.note, 200) };
    },
    // 手動記錄或修正：同一角色同一天已有記錄就更新它，來源改成「手動」（之後同步預設不會蓋掉）
    saveMesos(input, editingId) {
      const v = this._validMesos(input);
      let saved;
      this._commit((s) => {
        let x = editingId ? s.mesos.find((y) => y.id === editingId) : null;
        const clash = s.mesos.find((y) => y.charId === v.charId && y.date === v.date && (!x || y.id !== x.id));
        if (clash && x) { s.mesos = s.mesos.filter((y) => y.id !== clash.id); s.deleted.push({ k: clash.id, at: nowISO() }); }
        if (!x) x = clash;
        if (x) { Object.assign(x, v, { source: 'manual', batchId: null, updatedAt: nowISO() }); saved = x; } else {
          saved = { id: uid('mmm'), ...v, source: 'manual', batchId: null, createdAt: nowISO(), updatedAt: nowISO() };
          s.mesos.push(saved);
        }
      });
      return saved;
    },
    deleteMesos(id) {
      this._commit((s) => { s.mesos = s.mesos.filter((x) => x.id !== id); s.deleted.push({ k: id, at: nowISO() }); });
    },

    /* ----- 設定 ----- */
    updateRules(input) {
      const n = {};
      const errors = {};
      ['dailyFree', 'warnAfter', 'strongFrom', 'cap'].forEach((k) => {
        const raw = String(input[k] == null ? '' : input[k]).trim();
        if (!/^\d{1,4}$/.test(raw) || Number(raw) > 1440) errors[k] = '請輸入 0–1440 的整數'; else n[k] = Number(raw);
      });
      if (!errors.dailyFree && n.dailyFree < 1) errors.dailyFree = '至少 1 分鐘';
      if (!errors.warnAfter && !errors.cap && n.warnAfter >= n.cap) errors.warnAfter = '要小於累計上限';
      if (!errors.strongFrom && !errors.warnAfter && n.strongFrom <= n.warnAfter) errors.strongFrom = '要大於開始警示的分鐘數';
      if (!errors.strongFrom && !errors.cap && n.strongFrom > n.cap) errors.strongFrom = '不能大於累計上限';
      if (Object.keys(errors).length) throw fieldError(errors);
      this._commit((s) => { s.settings.rules = n; s.settings.updatedAt = nowISO(); });
    },
    // logins：'06:00, 12:00, 17:30' 或陣列
    updatePlan(input) {
      const raw = Array.isArray(input.logins) ? input.logins : String(input.logins || '').split(/[,，、\s]+/).filter(Boolean);
      const errors = {};
      const bad = raw.filter((t) => parseTime(t) == null);
      if (!raw.length) errors.logins = '至少填一個時間';
      else if (bad.length) errors.logins = `時間格式要像 06:00（看不懂：${bad.slice(0, 3).join('、')}）`;
      else if (raw.length > 8) errors.logins = '最多 8 個時間';
      if (parseTime(input.refill) == null) errors.refill = '時間格式要像 00:00';
      if (Object.keys(errors).length) throw fieldError(errors);
      this._commit((s) => { s.settings.plan = normPlan({ logins: raw, refill: input.refill }); s.settings.updatedAt = nowISO(); });
    },
    updateDrive(patch, source = 'user') {
      this._commit((s) => { s.settings.drive = { ...s.settings.drive, ...patch }; s.settings.updatedAt = nowISO(); }, source);
    },
    // 這台裝置上次檢查／同步 Drive 的結果（每台裝置各自記，不上傳雲端）
    driveStatus() {
      try { return { lastSyncAt: null, lastCheckAt: null, lastStatus: '', lastError: '', ...(JSON.parse(localStorage.getItem(`gct:mm:drive:status:${this.owner}`)) || {}) }; } catch (_) { return { lastSyncAt: null, lastCheckAt: null, lastStatus: '', lastError: '' }; }
    },
    setDriveStatus(patch) {
      try { localStorage.setItem(`gct:mm:drive:status:${this.owner}`, JSON.stringify({ ...this.driveStatus(), ...patch })); } catch (_) { /* ignore */ }
      this._emit('drive-status');
    },
    deleteImport(id) {
      this._commit((s) => { s.imports = s.imports.filter((x) => x.id !== id); s.deleted.push({ k: id, at: nowISO() }); });
    },

    /* ----- 匯入（Drive 同步、CSV 檔、貼上表格都走這裡） -----
     * analyze(table, opts) 只分析不寫入，用來預覽；apply(analysis, meta) 才真的寫入
     *   opts.mapping     { date: 欄位標題或 '#3', ... }，沒給就自動辨識
     *   opts.dateOrder   'mdy'（11/1 = 11 月 1 日）或 'dmy'
     *   opts.fallbackDate 沒有日期欄時用這天
     *   opts.defaultAccount 沒有帳號欄時，角色要放在哪個帳號（名稱）
     */
    analyze(table, opts = {}) {
      const rows = (table || []).map((r) => (Array.isArray(r) ? r : []));
      const nonEmpty = rows.filter((r) => r.some((c) => cellText(c).trim() !== ''));
      const out = { headerRow: -1, headers: [], mapping: {}, cols: {}, items: [], errors: [], total: 0, hash: '', newAccounts: [], newChars: [], missing: [] };
      if (!nonEmpty.length) { out.errors.push('表格是空的'); return out; }
      out.hash = hashOf(JSON.stringify(rows.map((r) => r.map(cellText))));
      // 找標題列
      let headerRow = -1; let cols = {};
      if (opts.mapping && Object.keys(opts.mapping).length) {
        for (let i = 0; i < Math.min(10, rows.length) && headerRow < 0; i++) {
          const hs = rows[i].map((h) => normHead(h));
          const c = {};
          Object.entries(opts.mapping).forEach(([f, h]) => {
            if (!h) return;
            const ix = /^#\d+$/.test(h) ? Number(h.slice(1)) : hs.indexOf(normHead(h));
            if (ix >= 0 && ix < Math.max(rows[i].length, 1) + 40) c[f] = ix;
          });
          if (c.character != null && (c.red != null || c.yellow != null)) { headerRow = i; cols = c; }
        }
      }
      if (headerRow < 0) {
        const det = detectHeader(rows);
        if (det) { headerRow = det.row; cols = det.map; }
      }
      if (headerRow < 0) {
        out.errors.push('找不到標題列：需要「角色」欄，以及「紅色」或「黃色」欄（可以在預覽裡手動對應欄位）');
        out.headers = (rows[0] || []).map(cellText);
        return out;
      }
      out.headerRow = headerRow;
      out.headers = rows[headerRow].map(cellText);
      out.cols = cols;
      out.mapping = Object.fromEntries(Object.entries(cols).map(([f, ix]) => [f, out.headers[ix] && normHead(out.headers[ix]) ? out.headers[ix] : `#${ix}`]));
      ['date', 'account', 'character', 'red', 'yellow'].forEach((f) => { if (cols[f] == null) out.missing.push(f); });
      if (cols.date == null && !D.isISODate(opts.fallbackDate || '')) out.errors.push('沒有「日期」欄：請選一個日期當作這批資料的日期');

      const accs = this.state.accounts; const chars = this.state.characters;
      const newAcc = new Map(); const newChar = new Map();
      const seen = new Map();
      for (let i = headerRow + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r.some((c) => cellText(c).trim() !== '')) continue;
        const get = (f) => (cols[f] == null ? null : r[cols[f]]);
        // 表格最後的合計列不是角色
        if (SUMMARY_ROW.test(str(get('character'), 40))) continue;
        out.total++;
        const it = { n: i + 1, cells: r.slice(0, 30).map(cellText), date: null, time: '', account: '', character: '', red: null, yellow: null, remain: null, note: '', error: '', key: '' };
        const errs = [];
        it.date = cols.date == null ? (opts.fallbackDate || null) : parseDateCell(get('date'), opts.dateOrder || 'mdy');
        if (!it.date) errs.push(cols.date == null ? '沒有日期' : `日期看不懂（${cellText(get('date')) || '空白'}）`);
        else if (it.date > D.todayISO()) errs.push('日期在未來');
        it.character = str(get('character'), 40);
        if (!it.character) errs.push('沒有角色名稱');
        it.time = cols.time != null ? parseTimeCell(get('time')) : parseTimeCell(get('date'));
        it.account = str(get('account'), 40);
        const red = parseMesosCell(get('red')); const yellow = parseMesosCell(get('yellow')); const remain = parseRemainCell(get('remain'));
        if (red.error) errs.push(`紅色：${red.error}`); else it.red = red.value;
        if (yellow.error) errs.push(`黃色：${yellow.error}`); else it.yellow = yellow.value;
        if (remain.error) errs.push(remain.error); else it.remain = remain.value;
        if (!red.error && !yellow.error && !remain.error && it.red == null && it.yellow == null && it.remain == null) errs.push('紅色、黃色都是空的');
        it.note = str(get('note'), 200);
        // 來源表格自己的檢查：核對欄不是「對」、或合計對不上，這列可能讀錯了，不要寫進庫存
        const checkText = str(get('check'), 20);
        if (checkText && !CHECK_OK.test(checkText)) errs.push(`核對欄是「${checkText}」`);
        const total = parseMesosCell(get('total'));
        if (!total.error && total.value != null && it.red != null && it.yellow != null && total.value !== it.red + it.yellow) errs.push(`合計 ${total.value} 不等於紅＋黃 ${it.red + it.yellow}`);
        // 對應角色
        if (!errs.length) {
          let ch = null;
          if (it.account) {
            const acc = accs.find((a) => sameName(a.name, it.account));
            if (acc) ch = chars.find((c) => c.accountId === acc.id && sameName(c.name, it.character));
            else if (!newAcc.has(it.account.toLowerCase())) newAcc.set(it.account.toLowerCase(), it.account);
          } else {
            // 沒有帳號欄：用角色名稱找（角色移到別的帳號也對得上）；沒見過的先放在預設帳號，之後可以在「帳號與角色」改
            const hits = chars.filter((c) => sameName(c.name, it.character));
            if (hits.length > 1) errs.push(`有 ${hits.length} 個帳號都有叫「${it.character}」的角色，請加上帳號欄`);
            else if (hits.length === 1) { ch = hits[0]; it.account = this.account(ch.accountId).name; } else {
              it.account = str(opts.defaultAccount, 40) || DEFAULT_ACCOUNT;
              if (!accs.some((a) => sameName(a.name, it.account)) && !newAcc.has(it.account.toLowerCase())) newAcc.set(it.account.toLowerCase(), it.account);
            }
          }
          if (!errs.length) {
            it.charId = ch ? ch.id : null;
            const ck = `${it.account.toLowerCase()}|${it.character.toLowerCase()}`;
            if (!ch && !newChar.has(ck)) newChar.set(ck, { account: it.account, character: it.character });
            it.key = `${ck}|${it.date}`;
            const prevIx = seen.get(it.key);
            if (prevIx != null) {
              // 同一角色同一天有多次讀數：庫存留最後一次（看時間，同時間看列的順序），缺的欄位用較早的補
              const prev = out.items[prevIx];
              const [old, cur] = it.time && prev.time && it.time < prev.time ? [it, prev] : [prev, it];
              ['red', 'yellow', 'remain'].forEach((k) => { if (cur[k] == null) cur[k] = old[k]; });
              old.merged = true;
              old.error = cur.time || old.time ? `同一天較早的讀數（${old.time || '沒寫時間'}），用 ${cur.time || `第 ${cur.n} 列`} 那次` : `同一批資料裡第 ${cur.n} 列也是同一角色同一天，用那一列`;
              seen.set(it.key, cur === it ? out.items.length : prevIx);
            } else seen.set(it.key, out.items.length);
          }
        }
        if (!it.merged) it.error = errs.join('；');
        out.items.push(it);
      }
      out.newAccounts = Array.from(newAcc.values());
      out.newChars = Array.from(newChar.values());
      // 和現有資料比較：新增、更新、沒變、保留手動
      const overwrite = !!opts.overwriteManual;
      out.items.forEach((it) => {
        if (it.merged) { it.result = 'merged'; return; }
        if (it.error) { it.result = 'error'; return; }
        const ex = it.charId ? this.snapshot(it.charId, it.date) : null;
        if (!ex) { it.result = 'added'; return; }
        it.existing = { red: ex.red, yellow: ex.yellow, remain: ex.remain, source: ex.source };
        const changed = (it.red != null && it.red !== ex.red) || (it.yellow != null && it.yellow !== ex.yellow) || (it.remain != null && it.remain !== ex.remain);
        if (!changed) it.result = 'unchanged';
        else if (ex.source === 'manual' && !overwrite) it.result = 'kept';
        else it.result = 'updated';
      });
      out.counts = ['added', 'updated', 'unchanged', 'kept', 'merged', 'error'].reduce((o, k) => ({ ...o, [k]: out.items.filter((x) => x.result === k).length }), {});
      return out;
    },
    // 同一個來源、一模一樣的資料之前匯入過嗎
    seenBatch(hash, ref) { return this.state.imports.find((x) => x.hash === hash && (!ref || x.ref === ref)) || null; },
    apply(an, meta = {}) {
      if (an.headerRow < 0 || an.errors.length) throw new Error(an.errors[0] || '資料無法匯入');
      const batchId = uid('mmi');
      const at = nowISO();
      const source = meta.source || 'file';
      let created = { accounts: 0, characters: 0 };
      this._commit((s) => {
        const findAcc = (name) => s.accounts.find((a) => sameName(a.name, name));
        an.newAccounts.forEach((name) => {
          if (findAcc(name)) return;
          s.accounts.push({ id: uid('mma'), name, note: '匯入時自動建立', status: 'active', order: s.accounts.length ? Math.max(...s.accounts.map((x) => x.order)) + 1 : 0, createdAt: at, updatedAt: at });
          created.accounts++;
        });
        const findChar = (accName, name) => { const a = findAcc(accName); return a ? s.characters.find((c) => c.accountId === a.id && sameName(c.name, name)) : null; };
        an.newChars.forEach((x) => {
          if (findChar(x.account, x.character)) return;
          s.characters.push({ id: uid('mmc'), accountId: findAcc(x.account).id, name: x.character, job: '', note: '匯入時自動建立', status: 'active', order: s.characters.length ? Math.max(...s.characters.map((c) => c.order)) + 1 : 0, createdAt: at, updatedAt: at });
          created.characters++;
        });
        an.items.forEach((it) => {
          if (it.result !== 'added' && it.result !== 'updated') return;
          const ch = it.charId ? s.characters.find((c) => c.id === it.charId) : findChar(it.account, it.character);
          if (!ch) return;
          const ex = s.mesos.find((m) => m.charId === ch.id && m.date === it.date);
          if (ex) {
            if (it.red != null) ex.red = it.red;
            if (it.yellow != null) ex.yellow = it.yellow;
            if (it.remain != null) ex.remain = it.remain;
            if (it.time) ex.time = it.time;
            Object.assign(ex, { source, batchId, updatedAt: at });
            if (it.note) ex.note = it.note;
          } else {
            s.mesos.push({ id: uid('mmm'), charId: ch.id, date: it.date, time: it.time, red: it.red, yellow: it.yellow, remain: it.remain, source, batchId, note: it.note, createdAt: at, updatedAt: at });
          }
        });
        // 匯入紀錄：只保留有變動、被保留或有錯的列（原始資料 + 結果），方便之後對差異；
        // 同一天較早的讀數只在那天有變動時才留，不然每次同步都會重複列出
        const changedKeys = new Set(an.items.filter((it) => it.result === 'added' || it.result === 'updated').map((it) => it.key));
        const keep = an.items.filter((it) => (it.result === 'merged' ? changedKeys.has(it.key) : it.result !== 'unchanged')).slice(0, MAX_RAW_ROWS).map((it) => ({
          n: it.n, cells: it.cells, result: it.result, msg: it.error || (it.result === 'updated' || it.result === 'kept' ? diffText(it) : ''),
          date: it.date, account: it.account, character: it.character, red: it.red, yellow: it.yellow,
        }));
        s.imports.unshift({
          id: batchId, source, label: str(meta.label, 200), ref: str(meta.ref, 600), at, hash: an.hash, total: an.total,
          counts: { ...an.counts, newAccounts: created.accounts, newChars: created.characters }, headers: an.headers.slice(0, 40), mapping: an.mapping, rows: keep, note: str(meta.note, 300),
        });
        s.imports = s.imports.slice(0, MAX_IMPORTS);
      }, meta.auto ? 'sync-drive' : 'user');
      return { batchId, counts: { ...an.counts, newAccounts: created.accounts, newChars: created.characters } };
    },
  };

  function diffText(it) {
    const e = it.existing || {};
    const f = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
    const parts = [];
    if (it.red != null && it.red !== e.red) parts.push(`紅 ${f(e.red)} → ${f(it.red)}`);
    if (it.yellow != null && it.yellow !== e.yellow) parts.push(`黃 ${f(e.yellow)} → ${f(it.yellow)}`);
    if (it.remain != null && it.remain !== e.remain) parts.push(`剩餘 ${fmtRemain(e.remain)} → ${fmtRemain(it.remain)}`);
    return (it.result === 'kept' ? '手動修正過，沒有覆蓋：' : '') + parts.join('，');
  }

  // CSV 範本（匯入用）
  function template() {
    const t = D.todayISO();
    return CSV.stringify([['date', 'time', 'account', 'character', 'remain', 'yellow', 'red', 'note'], [t, '21:30', '帳號A', '角色1', '260:46', 3500000, 12000000, '範例：可刪除此列'], [t, '21:35', '帳號A', '角色2', '', '', 8000000, '黃色沒填 = 沿用之前的數字；帳號欄可以不要']]);
  }

  global.GCTMapleM = { Store, normalizeState, mergeStates, parseDateCell, parseMesosCell, parseRemainCell, fmtRemain, parseTimeCell, parseTime, fmtClock, span, hashOf, template, RULES_DEFAULT };
})(window);
