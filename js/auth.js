/* Google（Gmail）登入
 * 1. 打開 App 時先確認是不是允許的 Google 帳號，才顯示內容。
 * 2. 同時取得「只能讀寫本 App 隱藏資料夾」的 Google 雲端硬碟權限（drive.appdata），
 *    讓手機、電腦用同一個 Gmail 登入時看到同一份資料。
 * 為了不把信箱公開在程式碼裡，這裡只放信箱的 SHA-256 雜湊值。 */
(function (global) {
  'use strict';

  const CONFIG = {
    // Google Cloud 專案 coin-ledger → Google Auth Platform → 客戶端 → coin-ledger-web
    clientId: '53004788735-3vv53g58s8sio2up1irogcdtbdkhh1dt.apps.googleusercontent.com',
    // 允許登入的信箱（小寫）之 SHA-256；可放多個
    allowedEmailHashes: ['943b9780db53b026485335d8c02b847caeeac270d77f0d599c209b275f314b67'],
    // 只在正式網址啟用；本機雙擊 index.html 或 localhost 開發時不上鎖、不同步
    hosts: ['jack061800.github.io'],
    sessionDays: 30,
    scope: 'openid email profile https://www.googleapis.com/auth/drive.appdata',
  };

  const SESSION_KEY = 'gct:auth:v1';
  const TOKEN_KEY = 'gct:auth:token';
  const NONCE_KEY = 'gct:auth:nonce';
  const BACK_KEY = 'gct:auth:back';
  const SILENT_KEY = 'gct:auth:silentAt';
  const NO_DRIVE_KEY = 'gct:auth:noDrive';
  const enabled = !!CONFIG.clientId && CONFIG.hosts.includes(location.hostname);
  const redirectUri = location.origin + location.pathname.replace(/index\.html$/, '');

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function b64urlDecode(s) {
    let t = s.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    const bin = atob(t);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
  function readSession() {
    const s = readJSON(SESSION_KEY);
    return s && s.exp > Date.now() ? s : null;
  }
  // 雲端硬碟用的存取權杖（約 1 小時有效）
  function getToken() {
    const t = readJSON(TOKEN_KEY);
    return t && t.exp > Date.now() + 60 * 1000 ? t.token : null;
  }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  // Google 登入完成後會帶著 #id_token=...&access_token=...&state=... 回到這個網址
  async function handleRedirect() {
    const h = location.hash;
    if (!/[#&](id_token|access_token|error)=/.test(h)) return null;
    const p = new URLSearchParams(h.replace(/^#/, ''));
    const back = localStorage.getItem(BACK_KEY) || '#/entry';
    history.replaceState(null, '', location.pathname + back);
    const nonce = localStorage.getItem(NONCE_KEY);
    localStorage.removeItem(NONCE_KEY);
    const err = p.get('error');
    if (err) {
      // 靜默更新失敗（需要重新點選帳號）不算錯誤，之後再請使用者登入即可
      if (/interaction_required|login_required|consent_required|account_selection_required/.test(err)) return { silentFailed: true };
      return { error: err === 'access_denied' ? '已取消登入。' : `登入失敗（${err}），請再試一次。` };
    }

    let claims;
    try { claims = JSON.parse(b64urlDecode(p.get('id_token').split('.')[1])); } catch (_) { return { error: '讀不到登入資料，請再試一次。' }; }
    if (claims.aud !== CONFIG.clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) return { error: '登入資料不正確，請再試一次。' };
    if (!nonce || claims.nonce !== nonce || p.get('state') !== nonce) return { error: '登入逾時或來源不符，請再試一次。' };
    if (!claims.exp || claims.exp * 1000 < Date.now() - 5 * 60 * 1000) return { error: '登入已過期，請再試一次。' };

    const email = String(claims.email || '').trim().toLowerCase();
    if (!claims.email_verified || !CONFIG.allowedEmailHashes.includes(await sha256(email))) {
      clearToken();
      localStorage.removeItem(SESSION_KEY);
      return { error: `${email || '這個帳號'} 沒有使用權限，請改用允許的 Google 帳號。` };
    }
    const prev = readSession();
    const session = { email, name: claims.name || '', exp: prev && prev.email === email ? prev.exp : Date.now() + CONFIG.sessionDays * 864e5 };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    const token = p.get('access_token');
    const granted = String(p.get('scope') || '');
    if (token && (!granted || granted.includes('drive.appdata'))) {
      localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 }));
      localStorage.removeItem(NO_DRIVE_KEY);
    } else {
      // Google 同意畫面上「雲端硬碟」那一項沒有勾選：登入成功，但不能同步
      clearToken();
      localStorage.setItem(NO_DRIVE_KEY, '1');
    }
    return { session };
  }

  function startLogin({ silent = false } = {}) {
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(NONCE_KEY, nonce);
    const back = location.hash && !/id_token|access_token|error=/.test(location.hash) ? location.hash : '#/entry';
    localStorage.setItem(BACK_KEY, back);
    const params = {
      client_id: CONFIG.clientId,
      redirect_uri: redirectUri,
      response_type: 'id_token token',
      scope: CONFIG.scope,
      include_granted_scopes: 'true',
      nonce,
      state: nonce,
      prompt: silent ? 'none' : 'select_account',
    };
    const s = readSession();
    if (s && s.email) params.login_hint = s.email;
    location.href = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(params)}`;
  }

  const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.2-13.4-9.9l-8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';

  function showGate(message) {
    document.documentElement.classList.add('auth-locked');
    const gate = document.createElement('div');
    gate.className = 'auth-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-label', '登入貨幣帳本');
    gate.innerHTML = `
      <div class="auth-card">
        <span class="brand-mark auth-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V6.5"/><path d="M5 12v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V12"/></svg></span>
        <h1>貨幣帳本</h1>
        <p class="auth-sub">用你的 Google 帳號登入，手機和電腦看到同一份資料</p>
        <button type="button" class="google-btn" data-login>${GOOGLE_G}<span>使用 Google 登入</span></button>
        <p class="auth-msg" role="alert"></p>
        <p class="auth-note">只有指定的 Gmail 帳號可以進入。記帳資料會存在你自己 Google 雲端硬碟的 App 專用隱藏資料夾，別人看不到；沒網路時也能照常記，連線後自動同步。</p>
      </div>`;
    document.body.append(gate);
    const msg = gate.querySelector('.auth-msg');
    const setMsg = (t) => { msg.textContent = t || ''; };
    setMsg(message);
    if (!navigator.onLine) setMsg('目前沒有網路，連上網路後才能登入。');
    gate.querySelector('[data-login]').addEventListener('click', () => {
      if (!navigator.onLine) { setMsg('目前沒有網路，連上網路後才能登入。'); return; }
      gate.querySelector('[data-login]').disabled = true;
      setMsg('正在前往 Google 登入…');
      startLogin();
    });
  }

  // App 等這個 Promise 完成才會載入資料、顯示畫面
  const ready = (async () => {
    if (!enabled) return null;
    const r = await handleRedirect();
    const s = (r && r.session) || readSession();
    if (!s) {
      showGate(r && r.error);
      return new Promise(() => {}); // 尚未登入：停在登入畫面
    }
    // 已登入但雲端權杖過期：有網路就先悄悄向 Google 換一張新的（不用再點帳號）
    if (!getToken() && navigator.onLine && !(r && r.silentFailed) && !localStorage.getItem(NO_DRIVE_KEY)) {
      const last = Number(localStorage.getItem(SILENT_KEY) || 0);
      if (Date.now() - last > 2 * 60 * 1000) {
        localStorage.setItem(SILENT_KEY, String(Date.now()));
        startLogin({ silent: true });
        return new Promise(() => {}); // 正在跳轉
      }
    }
    return s;
  })();

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    clearToken();
    location.reload();
  }

  global.GCTAuth = {
    ready, enabled, logout, getToken, clearToken,
    driveDenied: () => !!localStorage.getItem(NO_DRIVE_KEY),
    session: readSession,
    reconnect: () => startLogin(),
    sessionDays: CONFIG.sessionDays,
  };
})(window);
