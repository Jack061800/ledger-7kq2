/* Google（Gmail）登入
 * 1. 打開 App 時先用 Google 登入，換成 Firebase 的登入憑證（之後讀寫雲端資料庫都用它）。
 * 2. 管理員以外的帳號，要在雲端的允許名單（allow/{email}）裡才能進入；名單由管理員在「設定」管理。
 * 3. 真正的權限由 Firebase 的安全規則把關（見 firestore.rules），這裡只是決定要不要顯示畫面。
 * 為了不把信箱公開在程式碼裡，管理員信箱只放 SHA-256 雜湊值。 */
(function (global) {
  'use strict';

  const CONFIG = {
    // Google Cloud 專案 coin-ledger → Google Auth Platform → 客戶端 → coin-ledger-web
    clientId: '53004788735-3vv53g58s8sio2up1irogcdtbdkhh1dt.apps.googleusercontent.com',
    // Firebase 專案 coin-ledger-512414 → 專案設定 → 網頁應用程式 coin-ledger-web（apiKey 本來就是公開的，權限靠安全規則）
    apiKey: 'AIzaSyDxr0iXDl8ycK4pNI8ZiYrEctcqEGDDxI8',
    projectId: 'coin-ledger-512414',
    // 管理員信箱（小寫）的 SHA-256
    adminEmailHash: '943b9780db53b026485335d8c02b847caeeac270d77f0d599c209b275f314b67',
    // 只在正式網址啟用；本機雙擊 index.html 或 localhost 開發時不上鎖、不同步
    hosts: ['jack061800.github.io'],
    sessionDays: 30,
    scope: 'openid email profile',
  };

  const SESSION_KEY = 'gct:auth:v1';
  const FB_KEY = 'gct:auth:fb';
  const NONCE_KEY = 'gct:auth:nonce';
  const BACK_KEY = 'gct:auth:back';
  const SILENT_KEY = 'gct:auth:silentAt';
  const enabled = !!CONFIG.clientId && CONFIG.hosts.includes(location.hostname);
  const redirectUri = location.origin + location.pathname.replace(/index\.html$/, '');

  // 舊版（Google 雲端硬碟同步）留下的資料，用不到了
  ['gct:auth:token', 'gct:auth:noDrive', 'gct:sync:fileId'].forEach((k) => localStorage.removeItem(k));

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

  /* ---------- Firebase 登入憑證 ----------
   * idToken 約 1 小時有效，過期就用 refreshToken 換新的（不用再跳到 Google） */
  const saveFb = (idToken, refreshToken, expiresIn) => {
    localStorage.setItem(FB_KEY, JSON.stringify({ idToken, refreshToken, exp: Date.now() + (Number(expiresIn) || 3600) * 1000 }));
  };
  const dropFb = () => localStorage.removeItem(FB_KEY);

  async function firebaseSignIn(googleIdToken) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${CONFIG.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postBody: `id_token=${googleIdToken}&providerId=google.com`, requestUri: location.origin, returnSecureToken: true }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.idToken) throw new Error((json.error && json.error.message) || `HTTP ${res.status}`);
    saveFb(json.idToken, json.refreshToken, json.expiresIn);
    return json.idToken;
  }

  let refreshing = null;
  async function refreshFb(refreshToken) {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CONFIG.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) { dropFb(); return null; } // 憑證失效，要重新登入
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    saveFb(json.id_token, json.refresh_token, json.expires_in);
    return json.id_token;
  }

  // 讀寫雲端前呼叫；回傳 null 代表要重新登入
  async function getToken() {
    const fb = readJSON(FB_KEY);
    if (!fb || !fb.refreshToken) return null;
    if (fb.exp > Date.now() + 60 * 1000) return fb.idToken;
    if (!refreshing) refreshing = refreshFb(fb.refreshToken).finally(() => { refreshing = null; });
    return refreshing;
  }

  // 非管理員：確認在允許名單裡（只讀得到自己那一筆）
  async function checkAllowed(email, idToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}/databases/(default)/documents/allow/${encodeURIComponent(email)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (res.ok) return true;
    if (res.status === 404 || res.status === 403) return false;
    throw new Error(`HTTP ${res.status}`);
  }

  // Google 登入完成後會帶著 #id_token=...&state=... 回到這個網址
  async function handleRedirect() {
    const h = location.hash;
    if (!/[#&](id_token|error)=/.test(h)) return null;
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

    const raw = p.get('id_token');
    let claims;
    try { claims = JSON.parse(b64urlDecode(raw.split('.')[1])); } catch (_) { return { error: '讀不到登入資料，請再試一次。' }; }
    if (claims.aud !== CONFIG.clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) return { error: '登入資料不正確，請再試一次。' };
    if (!nonce || claims.nonce !== nonce || p.get('state') !== nonce) return { error: '登入逾時或來源不符，請再試一次。' };
    if (!claims.exp || claims.exp * 1000 < Date.now() - 5 * 60 * 1000) return { error: '登入已過期，請再試一次。' };

    const email = String(claims.email || '').trim().toLowerCase();
    if (!claims.email_verified) return { error: '這個 Google 帳號的信箱還沒驗證，無法登入。' };
    const admin = (await sha256(email)) === CONFIG.adminEmailHash;
    let fbToken;
    try { fbToken = await firebaseSignIn(raw); } catch (e) {
      console.warn('Firebase 登入失敗', e);
      return { error: `連不上雲端資料庫（${e.message}），請稍後再試。` };
    }
    if (!admin) {
      let ok;
      try { ok = await checkAllowed(email, fbToken); } catch (e) { return { error: `無法確認使用權限（${e.message}），請稍後再試。` }; }
      if (!ok) {
        dropFb();
        localStorage.removeItem(SESSION_KEY);
        return { error: `${email} 沒有使用權限。請管理員先在「設定 → 使用者」加入這個 Gmail。` };
      }
    }
    const prev = readSession();
    const session = { email, name: claims.name || '', admin, exp: prev && prev.email === email ? prev.exp : Date.now() + CONFIG.sessionDays * 864e5 };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
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
      response_type: 'id_token',
      scope: CONFIG.scope,
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
        <p class="auth-note">只有管理員加入名單的 Gmail 可以進入。你的帳本存在 App 的雲端資料庫，只有你自己和管理員看得到；沒網路時也能照常記，連線後自動同步。</p>
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
    // 已登入但沒有雲端憑證（舊版升級上來、或憑證失效）：有網路就先悄悄向 Google 換一張（不用再點帳號）
    const fb = readJSON(FB_KEY);
    if ((!fb || !fb.refreshToken) && navigator.onLine && !(r && r.silentFailed)) {
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
    dropFb();
    location.reload();
  }

  global.GCTAuth = {
    ready, enabled, logout, getToken, dropToken: dropFb,
    session: readSession,
    isAdmin: () => { const s = readSession(); return !!(s && s.admin); },
    reconnect: () => startLogin(),
    sessionDays: CONFIG.sessionDays,
    projectId: CONFIG.projectId,
  };
})(window);
