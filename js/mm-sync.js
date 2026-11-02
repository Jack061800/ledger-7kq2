/* Maple M：雲端同步（和 M Sea 的帳本分開存）
 *   ledgers/{email}/games/maplem               設定、帳號、角色、刪除紀錄
 *   ledgers/{email}/games/maplem/parts/{YYYY-MM} 那個月的掛機記錄和 Mesos 庫存
 *   ledgers/{email}/games/maplem/parts/imp      匯入／同步紀錄（含原始資料）
 * 在原本的權限規則 ledgers/{email}/** 底下，所以不用改 Firebase 規則；M Sea 的 parts 不受影響。
 * 流程和 M Sea 一樣：本機先存 → 下載雲端 → 逐筆合併 → 有落差就各自更新。 */
(function (global) {
  'use strict';

  const { Store, normalizeState, mergeStates } = global.GCTMapleM;
  const Auth = global.GCTAuth;
  const Cloud = global.GCTCloud;
  const LAST_KEY = 'gct:mm:sync:lastAt';

  const listeners = [];
  const Sync = {
    enabled: !!(Auth && Auth.enabled && Cloud),
    status: 'idle',
    message: '',
    lastAt: Number(localStorage.getItem(LAST_KEY) || 0) || null,
    onStatus(fn) { listeners.push(fn); },
  };
  const setStatus = (status, message = '') => { Sync.status = status; Sync.message = message; listeners.forEach((fn) => fn(Sync)); };

  const mainPath = (email) => `ledgers/${email}/games/maplem`;
  const partsPath = (email) => `${mainPath(email)}/parts`;

  // 雲端資料庫每筆上限約 1MB：超過 800KB 就接著存到 2026-11_2、2026-11_3…（讀取時全部合併，不受影響）
  const LIMIT = 800 * 1024;
  const encoder = new TextEncoder();
  const bytes = (v) => encoder.encode(JSON.stringify(v)).length;
  function chunks(out, key, items) {
    let cur = {}; let size = 0; let n = 1;
    const flush = () => { if (size) { out.set(n === 1 ? key : `${key}_${n}`, JSON.stringify(cur)); n++; cur = {}; size = 0; } };
    items.forEach(([kind, x]) => {
      const len = bytes(x) + 1;
      if (size && size + len > LIMIT) flush();
      (cur[kind] = cur[kind] || []).push(x);
      size += len;
    });
    flush();
  }
  function split(state) {
    const main = JSON.stringify({ version: state.version, settings: state.settings, accounts: state.accounts, characters: state.characters, deleted: state.deleted });
    const months = new Map();
    const add = (m, kind, x) => { if (!months.has(m)) months.set(m, []); months.get(m).push([kind, x]); };
    state.sessions.forEach((x) => add(x.date.slice(0, 7), 'sessions', x));
    state.mesos.forEach((x) => add(x.date.slice(0, 7), 'mesos', x));
    const out = new Map();
    months.forEach((items, m) => chunks(out, m, items));
    // 單次匯入紀錄大到放不下時，雲端只留摘要（原始資料還在匯入的那台裝置上）
    chunks(out, 'imp', state.imports.map((b) => ['imports', bytes(b) > LIMIT ? { ...b, rows: [] } : b]));
    return { main, parts: out };
  }

  async function load(email) {
    const main = await Cloud.get(mainPath(email));
    if (!main) return null;
    const parts = await Cloud.list(partsPath(email));
    const m = JSON.parse(main.data.main || '{}');
    const sessions = []; const mesos = []; const imports = [];
    parts.forEach((p) => {
      const x = JSON.parse(p.data.data || '{}');
      sessions.push(...(x.sessions || [])); mesos.push(...(x.mesos || [])); imports.push(...(x.imports || []));
    });
    return { state: normalizeState({ ...m, sessions, mesos, imports }), main, parts };
  }

  const fingerprint = (s) => JSON.stringify(s);
  let running = false; let again = false; let timer = null;

  async function syncNow() {
    if (!Sync.enabled) { setStatus('off'); return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    const s = Auth.session();
    if (!s) { setStatus('auth', '需要重新登入 Google 才能同步'); return; }
    if (running) { again = true; return; }
    running = true;
    setStatus('syncing');
    try {
      const remote = await load(s.email);
      const local = Store.state;
      const merged = remote ? normalizeState(mergeStates(local, remote.state)) : local;
      if (fingerprint(local) !== fingerprint(merged)) Store.applySynced(merged);
      const next = split(merged);
      const writes = [];
      const rMain = remote && remote.main;
      if (!rMain || rMain.data.main !== next.main) writes.push({ path: mainPath(s.email), data: { main: next.main, updatedAt: new Date().toISOString() }, ...(rMain ? { ifUpdateTime: rMain.updateTime } : { ifMissing: true }) });
      const rParts = new Map(((remote && remote.parts) || []).map((p) => [p.id, p]));
      next.parts.forEach((json, k) => {
        const rp = rParts.get(k);
        if (!rp || rp.data.data !== json) writes.push({ path: `${partsPath(s.email)}/${k}`, data: { data: json }, ...(rp ? { ifUpdateTime: rp.updateTime } : { ifMissing: true }) });
      });
      rParts.forEach((rp, k) => { if (!next.parts.has(k)) writes.push({ path: `${partsPath(s.email)}/${k}`, del: true, ifUpdateTime: rp.updateTime }); });
      try { await Cloud.commit(writes); } catch (e) {
        if (Cloud.isConflict(e)) { again = true; setStatus('syncing'); return; }
        throw e;
      }
      Sync.lastAt = Date.now();
      localStorage.setItem(LAST_KEY, String(Sync.lastAt));
      setStatus('ok');
    } catch (e) {
      console.warn('Maple M 同步失敗', e);
      if (e.status === 401) setStatus('auth', e.message);
      else if (e.status === 403) setStatus('denied', e.message);
      else if (!navigator.onLine) setStatus('offline');
      else setStatus('error', e.message || '同步失敗');
    } finally {
      running = false;
      if (again) { again = false; schedule(800); }
    }
  }
  function schedule(delay = 1500) {
    if (!Sync.enabled) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, delay);
  }
  function start() {
    if (!Sync.enabled) { setStatus('off'); return; }
    Store.onChange((source) => { if (source !== 'sync' && source !== 'drive-status') schedule(); });
    global.addEventListener('online', () => schedule(0));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
    setInterval(() => { if (document.visibilityState === 'visible') schedule(0); }, 5 * 60 * 1000);
    syncNow();
  }
  // 換了 Gmail 登入時，上次同步時間要重算
  function reset() { localStorage.removeItem(LAST_KEY); Sync.lastAt = null; }

  Object.assign(Sync, { start, syncNow, schedule, reset });
  global.GCTMMSync = Sync;
})(window);
