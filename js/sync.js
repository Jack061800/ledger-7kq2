/* 雲端同步：每個人的帳本存在雲端資料庫 ledgers/{email}
 *   ledgers/{email}               設定、帳號、刪除紀錄
 *   ledgers/{email}/parts/{年份}  那一年的記錄和出貨（分年存，避免單筆資料太大）
 * 本機一律先存（離線也能記），有網路且登入有效時再和雲端合併：
 *   下載雲端 → 與本機逐項合併（見 data.js mergeStates）→ 本機或雲端有落差就各自更新。 */
(function (global) {
  'use strict';

  const { Store, mergeStates, normalizeState } = global.GCT;
  const Auth = global.GCTAuth;
  const Cloud = global.GCTCloud;
  const LAST_KEY = 'gct:sync:lastAt';

  const listeners = [];
  const Sync = {
    enabled: !!(Auth && Auth.enabled),
    status: 'idle', // idle | syncing | ok | offline | auth | denied | error | off
    message: '',
    lastAt: Number(localStorage.getItem(LAST_KEY) || 0) || null,
    onStatus(fn) { listeners.push(fn); },
  };

  function setStatus(status, message = '') {
    Sync.status = status;
    Sync.message = message;
    listeners.forEach((fn) => fn(Sync));
  }

  const ledgerPath = (email) => `ledgers/${email}`;
  const partPath = (email, year) => `ledgers/${email}/parts/${year}`;

  // 帳本拆成「主檔」和「每年一份」
  function split(state) {
    const main = JSON.stringify({ version: state.version, settings: state.settings, accounts: state.accounts, deleted: state.deleted || [] });
    const years = new Map();
    const bucket = (y) => { if (!years.has(y)) years.set(y, { records: [], shipments: [] }); return years.get(y); };
    state.records.forEach((r) => bucket(r.date.slice(0, 4)).records.push(r));
    (state.shipments || []).forEach((x) => bucket(x.date.slice(0, 4)).shipments.push(x));
    const parts = new Map();
    years.forEach((v, y) => parts.set(y, JSON.stringify(v)));
    return { main, parts };
  }

  // 讀某人的雲端帳本（管理員看別人的帳本也用這個）；還沒有資料回傳 null
  async function loadLedger(email) {
    const main = await Cloud.get(ledgerPath(email));
    if (!main) return null;
    const parts = await Cloud.list(`${ledgerPath(email)}/parts`);
    const m = JSON.parse(main.data.main || '{}');
    const records = []; const shipments = [];
    parts.forEach((p) => {
      const x = JSON.parse(p.data.data || '{}');
      records.push(...(x.records || []));
      shipments.push(...(x.shipments || []));
    });
    return { state: normalizeState({ ...m, records, shipments }), main, parts };
  }

  // 只比較資料本身（不含每台裝置自己的備份時間）
  const fingerprint = (s) => JSON.stringify({ a: s.accounts, r: s.records, h: s.shipments || [], d: s.deleted, s: { ...s.settings, lastBackupAt: null } });

  let running = false; let again = false; let timer = null;

  async function syncNow() {
    if (!Sync.enabled) { setStatus('off'); return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    if (Store.readOnly) { again = true; return; } // 正在看別人的帳本：回到自己的帳本後再同步
    const s = Auth.session();
    if (!s) { setStatus('auth', '需要重新登入 Google 才能同步'); return; }
    if (running) { again = true; return; }
    running = true;
    setStatus('syncing');
    try {
      const email = s.email;
      const remote = await loadLedger(email);
      if (Store.readOnly) { again = true; return; }
      const local = Store.state;
      const merged = remote ? normalizeState(mergeStates(local, remote.state)) : local;
      if (fingerprint(local) !== fingerprint(merged)) Store.applySynced(merged);

      const next = split(merged);
      const writes = [];
      const rMain = remote && remote.main;
      if (!rMain || rMain.data.main !== next.main) {
        writes.push({ path: ledgerPath(email), data: { main: next.main, updatedAt: new Date().toISOString() }, ...(rMain ? { ifUpdateTime: rMain.updateTime } : { ifMissing: true }) });
      }
      const rParts = new Map(((remote && remote.parts) || []).map((p) => [p.id, p]));
      next.parts.forEach((json, year) => {
        const rp = rParts.get(year);
        if (!rp || rp.data.data !== json) writes.push({ path: partPath(email, year), data: { data: json }, ...(rp ? { ifUpdateTime: rp.updateTime } : { ifMissing: true }) });
      });
      rParts.forEach((rp, year) => { if (!next.parts.has(year)) writes.push({ path: partPath(email, year), del: true, ifUpdateTime: rp.updateTime }); });

      try {
        await Cloud.commit(writes);
      } catch (e) {
        // 另一台裝置剛好也在寫：稍後重讀再合併一次
        if (Cloud.isConflict(e)) { again = true; setStatus('syncing'); return; }
        throw e;
      }
      Sync.lastAt = Date.now();
      localStorage.setItem(LAST_KEY, String(Sync.lastAt));
      setStatus('ok');
    } catch (e) {
      console.warn('同步失敗', e);
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
    // 使用者每次存檔後稍等一下再同步；同步自己帶進來的變更、切換檢視不用再觸發
    Store.onChange((source) => {
      if (source === 'view') { if (!Store.readOnly) schedule(300); return; }
      if (source !== 'sync') schedule();
    });
    global.addEventListener('online', () => schedule(0));
    global.addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
    setInterval(() => { if (document.visibilityState === 'visible') schedule(0); }, 5 * 60 * 1000);
    syncNow();
  }

  Object.assign(Sync, { start, syncNow, schedule, loadLedger });
  global.GCTSync = Sync;
})(window);
