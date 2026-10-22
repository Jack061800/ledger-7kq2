/* 雲端同步：把資料存在使用者自己 Google 雲端硬碟的 App 專用隱藏資料夾（appDataFolder）
 * 本機一律先存（離線也能記），有網路且登入有效時再和雲端合併：
 *   下載雲端檔案 → 與本機逐項合併（見 data.js mergeStates）→ 本機或雲端有落差就各自更新。 */
(function (global) {
  'use strict';

  const { Store, mergeStates, normalizeState } = global.GCT;
  const Auth = global.GCTAuth;
  const FILE_NAME = 'coin-ledger-data.json';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FILE_ID_KEY = 'gct:sync:fileId';
  const LAST_KEY = 'gct:sync:lastAt';

  const listeners = [];
  const Sync = {
    enabled: !!(Auth && Auth.enabled),
    status: 'idle', // idle | syncing | ok | offline | auth | error | off
    message: '',
    lastAt: Number(localStorage.getItem(LAST_KEY) || 0) || null,
    onStatus(fn) { listeners.push(fn); },
  };

  function setStatus(status, message = '') {
    Sync.status = status;
    Sync.message = message;
    listeners.forEach((fn) => fn(Sync));
  }

  class AuthError extends Error {}

  async function api(url, opts = {}) {
    const token = Auth.getToken();
    if (!token) throw new AuthError('需要重新登入 Google 才能同步');
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403) {
      if (res.status === 401) Auth.clearToken();
      const body = await res.text().catch(() => '');
      if (res.status === 401 || /insufficient|scope/i.test(body)) throw new AuthError('雲端權限已過期，請重新登入');
      throw new Error(`雲端硬碟拒絕存取（${res.status}）`);
    }
    if (!res.ok) {
      const e = new Error(`雲端硬碟回應錯誤（${res.status}）`);
      e.status = res.status;
      throw e;
    }
    return res;
  }

  async function findFileId() {
    const cached = localStorage.getItem(FILE_ID_KEY);
    if (cached) return cached;
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await api(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`);
    const json = await res.json();
    const id = json.files && json.files[0] ? json.files[0].id : null;
    if (id) localStorage.setItem(FILE_ID_KEY, id);
    return id;
  }

  async function download(id) {
    try {
      const res = await api(`${API}/files/${encodeURIComponent(id)}?alt=media`);
      return normalizeState(await res.json());
    } catch (e) {
      if (e.status === 404) { localStorage.removeItem(FILE_ID_KEY); return undefined; }
      throw e;
    }
  }

  async function upload(state, id) {
    const body = JSON.stringify({ app: 'game-currency-tracker', syncedAt: new Date().toISOString(), ...state });
    if (id) {
      await api(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      return id;
    }
    const boundary = 'gct' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const res = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
    const json = await res.json();
    localStorage.setItem(FILE_ID_KEY, json.id);
    return json.id;
  }

  // 只比較資料本身（不含每台裝置自己的備份時間）
  const fingerprint = (s) => JSON.stringify({ a: s.accounts, r: s.records, d: s.deleted, s: { ...s.settings, lastBackupAt: null } });

  let running = false; let again = false; let timer = null;

  async function syncNow() {
    if (!Sync.enabled) { setStatus('off'); return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    if (!Auth.getToken()) {
      setStatus('auth', Auth.driveDenied && Auth.driveDenied()
        ? '登入時沒有勾選「Google 雲端硬碟」權限。請按「重新登入 Google」，在權限清單把雲端硬碟那一項打勾。'
        : '需要重新登入 Google 才能同步');
      return;
    }
    if (running) { again = true; return; }
    running = true;
    setStatus('syncing');
    try {
      let id = await findFileId();
      let remote = id ? await download(id) : undefined;
      if (remote === undefined && id) { id = await findFileId(); remote = id ? await download(id) : undefined; }
      const local = Store.state;
      const merged = remote ? normalizeState(mergeStates(local, remote)) : local;
      const fp = fingerprint(merged);
      if (fingerprint(local) !== fp) Store.applySynced(merged);
      if (!remote || fingerprint(remote) !== fp) await upload(merged, id);
      Sync.lastAt = Date.now();
      localStorage.setItem(LAST_KEY, String(Sync.lastAt));
      setStatus('ok');
    } catch (e) {
      console.warn('同步失敗', e);
      if (e instanceof AuthError) setStatus('auth', e.message);
      else if (!navigator.onLine) setStatus('offline');
      else setStatus('error', e.message || '同步失敗');
    } finally {
      running = false;
      if (again) { again = false; schedule(300); }
    }
  }

  function schedule(delay = 1500) {
    if (!Sync.enabled) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, delay);
  }

  function start() {
    if (!Sync.enabled) { setStatus('off'); return; }
    // 使用者每次存檔後稍等一下再同步；同步自己帶進來的變更不用再觸發
    Store.onChange((source) => { if (source !== 'sync') schedule(); });
    global.addEventListener('online', () => schedule(0));
    global.addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
    setInterval(() => { if (document.visibilityState === 'visible') schedule(0); }, 5 * 60 * 1000);
    syncNow();
  }

  Object.assign(Sync, { start, syncNow, schedule });
  global.GCTSync = Sync;
})(window);
