/* Maple M：從 Google Drive 讀 Mesos 資料
 * 兩種來源：
 *   1. Google Drive 檔案（sheet）：.xlsx 或 Google 試算表。用你的 Google 帳號授權唯讀 Drive，App 只下載你指定的那個檔案。
 *      授權只存在這台裝置、約 1 小時有效；過期後按「重新連接」（已經允許過就不用再按同意）。
 *      Google 不允許在 localhost 授權，所以只在正式網址能用。
 *   2. 公開 CSV 連結（csv）：試算表「檔案 → 共用 → 發布到網路 → CSV」產生的連結，不用授權，但有連結的人都看得到。
 * 讀到的表格交給 Store.analyze／apply：同一批資料（內容完全一樣）不會重複匯入。 */
(function (global) {
  'use strict';

  const Auth = global.GCTAuth;
  const { Store } = global.GCTMapleM;
  const { CSV } = global.GCT;
  const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
  const TOKEN_KEY = 'gct:mm:drive:token';
  const NONCE_KEY = 'gct:mm:drive:nonce';
  const BACK_KEY = 'gct:mm:drive:back';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const MAX_FILE = 10 * 1024 * 1024;

  /* ---------- 讀 .xlsx（瀏覽器內建解壓縮，不用外部套件）---------- */
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= 0 && i >= buf.byteLength - 70000; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not zip');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip');
      const method = dv.getUint16(p + 10, true); const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true); const extra = dv.getUint16(p + 30, true); const comment = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      files.set(name, { method, data: new Uint8Array(buf, start, size) });
      p += 46 + nameLen + extra + comment;
    }
    return async (name) => {
      const f = files.get(name);
      if (!f) return null;
      const bytes = f.method === 8 ? await inflate(f.data) : f.data;
      return new DOMParser().parseFromString(dec.decode(bytes), 'application/xml');
    };
  }
  const tags = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
  const colIndex = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  // 回傳 [{ name, rows }]；rows 的位置對應實際列號，空白列也保留
  const readXlsx = async (buf) => {
    let open;
    try { open = await unzip(buf); } catch (e) { throw new DriveError('這個檔案不是有效的 .xlsx。', 'setup'); }
    const wb = await open('xl/workbook.xml');
    if (!wb) throw new DriveError('這個檔案不是有效的 .xlsx。', 'setup');
    const rels = await open('xl/_rels/workbook.xml.rels');
    const target = new Map(tags(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
    const sst = await open('xl/sharedStrings.xml');
    const textOf = (el) => tags(el, 't').map((t) => t.textContent).join('');
    const shared = sst ? tags(sst, 'si').map(textOf) : [];
    const out = [];
    for (const s of tags(wb, 'sheet')) {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const t = String(target.get(rid) || '');
      const doc = await open(t.startsWith('/') ? t.slice(1) : `xl/${t}`);
      if (!doc) continue;
      const rows = [];
      tags(doc, 'row').forEach((row, i) => {
        const at = (Number(row.getAttribute('r')) || i + 1) - 1;
        const cells = [];
        tags(row, 'c').forEach((c, j) => {
          const ref = c.getAttribute('r');
          const col = ref ? colIndex(ref) : j;
          const ty = c.getAttribute('t');
          const v = tags(c, 'v')[0];
          let val = '';
          if (ty === 'inlineStr') val = textOf(c);
          else if (v) val = ty === 's' ? (shared[Number(v.textContent)] || '') : ty === 'str' || ty === 'e' ? v.textContent : ty === 'b' ? v.textContent === '1' : Number(v.textContent);
          while (cells.length < col) cells.push('');
          cells[col] = val;
        });
        while (rows.length < at) rows.push([]);
        rows[at] = cells;
      });
      out.push({ name: s.getAttribute('name') || `Sheet${out.length + 1}`, rows });
    }
    if (!out.length) throw new DriveError('這個 .xlsx 裡沒有工作表。', 'setup');
    return out;
  };
  // 沒指定分頁：選第一個有日期欄的（例如「记录」），不選只有最新值的分頁
  const pickTab = (sheets, want) => {
    if (want) {
      const hit = sheets.find((x) => x.name === want);
      if (!hit) throw new DriveError(`檔案裡沒有叫「${want}」的分頁。現有分頁：${sheets.map((x) => x.name).join('、')}`, 'notfound');
      return hit;
    }
    const scored = sheets.map((x) => ({ x, an: Store.analyze(x.rows, {}) }));
    const dated = scored.find((y) => y.an.headerRow >= 0 && y.an.cols.date != null && !(y.an.headers[y.an.cols.date] || '').includes('更新'));
    const any = scored.find((y) => y.an.headerRow >= 0);
    return (dated || any || scored[0]).x;
  };

  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
  const Drive = {
    SCOPE, readXlsx, pickTab,
    // 只有正式網址（有 Google 登入）才能授權
    canAuthorize: !!(Auth && Auth.enabled && Auth.clientId),
    redirectError: '',
    justConnected: false,
    running: false,
  };

  /* ---------- 授權（和登入一樣跳到 Google 再回來） ---------- */
  // Google 帶著 #access_token=...&state=mmdrive.xxx 回到 App：收下授權、還原原本的頁面
  (function consumeRedirect() {
    const h = location.hash;
    if (!/[#&]state=mmdrive\./.test(h)) return;
    const p = new URLSearchParams(h.replace(/^#/, ''));
    const nonce = localStorage.getItem(NONCE_KEY);
    const back = localStorage.getItem(BACK_KEY) || '#/mm/sync';
    localStorage.removeItem(NONCE_KEY);
    history.replaceState(null, '', location.pathname + back);
    if (!nonce || p.get('state') !== `mmdrive.${nonce}`) { Drive.redirectError = '授權逾時或來源不符，請再按一次「連接 Google」。'; return; }
    const err = p.get('error');
    if (err) { Drive.redirectError = err === 'access_denied' ? '你取消了授權，App 沒有拿到讀取試算表的權限。' : `授權失敗（${err}）`; return; }
    const token = p.get('access_token');
    const scopes = String(p.get('scope') || '');
    if (!token) { Drive.redirectError = 'Google 沒有回傳授權，請再試一次。'; return; }
    if (scopes && !scopes.includes('drive')) { Drive.redirectError = '授權時沒有勾選查看 Google Drive 檔案，請再連接一次並勾選。'; return; }
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 }));
    Drive.justConnected = true;
  })();

  Drive.token = () => { const t = readJSON(TOKEN_KEY); return t && t.token && t.exp > Date.now() + 60 * 1000 ? t.token : null; };
  Drive.tokenExp = () => { const t = readJSON(TOKEN_KEY); return t && t.exp > Date.now() ? t.exp : null; };
  Drive.disconnect = () => localStorage.removeItem(TOKEN_KEY);
  // silent：已經同意過，只是授權過期 → 不顯示同意畫面
  Drive.connect = ({ silent = false } = {}) => {
    if (!Drive.canAuthorize) throw new Error('只有在正式網址（jack061800.github.io）才能連接 Google；這裡可以先用公開 CSV 連結或匯入檔案。');
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(NONCE_KEY, nonce);
    localStorage.setItem(BACK_KEY, /^#\/mm\//.test(location.hash) ? location.hash.split('&access_token')[0] : '#/mm/sync');
    const s = Auth.session();
    const params = {
      client_id: Auth.clientId,
      redirect_uri: location.origin + location.pathname.replace(/index\.html$/, ''),
      response_type: 'token',
      scope: SCOPE,
      include_granted_scopes: 'true',
      state: `mmdrive.${nonce}`,
      prompt: silent ? 'none' : 'consent',
    };
    if (s && s.email) params.login_hint = s.email;
    location.href = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(params)}`;
  };

  // Drive 連結 → 檔案 id：drive.google.com/file/d/…、docs.google.com/spreadsheets/d/…、open?id=…，也接受直接貼 id
  Drive.parseSheet = (input) => {
    const s = String(input || '').trim();
    const m = s.match(/\/(?:spreadsheets|file)\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
    const id = m ? m[1] : /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
    return id ? { id } : null;
  };

  function DriveError(msg, kind) { const e = new Error(msg); e.kind = kind || 'error'; return e; }
  Drive.DriveError = DriveError;

  async function api(url) {
    const token = Drive.token();
    if (!token) throw new DriveError('Google 授權已過期或還沒連接，請按「連接 Google」。', 'auth');
    let res;
    try { res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }); } catch (e) { throw new DriveError(navigator.onLine ? '連不上 Google（網路問題），稍後再試。' : '目前沒有網路。', 'offline'); }
    if (res.ok) return res;
    let msg = ''; let reason = '';
    try { const j = await res.json(); msg = j.error.message || ''; reason = [j.error.status, ...(j.error.errors || []).map((d) => d.reason), ...(j.error.details || []).map((d) => d.reason)].filter(Boolean).join(','); } catch (_) { /* ignore */ }
    if (res.status === 401) { Drive.disconnect(); throw new DriveError('Google 授權已過期，請按「重新連接」。', 'auth'); }
    if (res.status === 403 && /SERVICE_DISABLED|accessNotConfigured|has not been used|disabled/i.test(`${reason} ${msg}`)) throw new DriveError('Google Cloud 專案還沒啟用「Google Drive API」，請照同步頁的說明啟用一次。', 'setup');
    if (res.status === 403 && /insufficient/i.test(`${reason} ${msg}`)) { Drive.disconnect(); throw new DriveError('授權範圍不夠，請按「連接 Google」重新允許查看 Drive 檔案。', 'auth'); }
    if (res.status === 403) throw new DriveError('你的 Google 帳號沒有權限讀這個檔案（確認檔案是你的，或有分享給你）。', 'denied');
    if (res.status === 404) throw new DriveError('找不到這個檔案，請檢查連結。如果檔案是重新上傳的，連結會變，要貼新的。', 'notfound');
    throw new DriveError(`Google 回應錯誤（${res.status}${msg ? `：${msg}` : ''}）`);
  }

  // 下載指定的檔案（.xlsx、Google 試算表或 CSV），回傳所有分頁和選到的分頁
  Drive.readSheet = async (sheetInput, tab) => {
    const ref = Drive.parseSheet(sheetInput);
    if (!ref) throw new DriveError('檔案連結看不懂，請貼上整個網址（https://drive.google.com/file/d/…）。', 'setup');
    const meta = await (await api(`${API}/${ref.id}?fields=name,mimeType,size&supportsAllDrives=true`)).json();
    if (Number(meta.size) > MAX_FILE) throw new DriveError('檔案超過 10MB，太大了。', 'setup');
    let sheets;
    if (meta.mimeType === 'text/csv') {
      sheets = [{ name: meta.name, rows: CSV.parse(await (await api(`${API}/${ref.id}?alt=media&supportsAllDrives=true`)).text()) }];
    } else {
      const isXlsx = meta.mimeType === XLSX_MIME || /\.xlsx$/i.test(meta.name || '');
      if (meta.mimeType !== SHEET_MIME && !isXlsx) throw new DriveError(`這個檔案是 ${meta.mimeType}，只能讀 .xlsx、Google 試算表或 CSV。`, 'setup');
      const url = meta.mimeType === SHEET_MIME ? `${API}/${ref.id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}` : `${API}/${ref.id}?alt=media&supportsAllDrives=true`;
      sheets = await Drive.readXlsx(await (await api(url)).arrayBuffer());
    }
    const pick = Drive.pickTab(sheets, String(tab || '').trim());
    return { rows: pick.rows, sheets, tab: pick.name, label: `${meta.name || '檔案'} · ${pick.name}`, ref: `sheet:${ref.id}:${pick.name}` };
  };

  // 讀公開的 CSV 連結
  Drive.readCsvUrl = async (url) => {
    const u = String(url || '').trim();
    if (!/^https:\/\//.test(u)) throw new DriveError('CSV 連結要以 https:// 開頭。', 'setup');
    if (/\/spreadsheets\/d\/[^/]+\/edit|drive\.google\.com\/file\//.test(u)) throw new DriveError('這是 Drive 的檔案連結，不是 CSV。請用「檔案 → 共用 → 發布到網路」選 CSV 取得的連結，或改用「Google Drive 檔案（授權）」。', 'setup');
    let res;
    try { res = await fetch(u, { cache: 'no-store' }); } catch (e) { throw new DriveError(navigator.onLine ? '讀不到這個連結（可能沒有發布到網路，或網址不允許其他網站讀取）。' : '目前沒有網路。', 'offline'); }
    if (!res.ok) throw new DriveError(`讀取 CSV 失敗（HTTP ${res.status}）`, res.status === 404 ? 'notfound' : 'error');
    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) throw new DriveError('連結回傳的是網頁，不是 CSV。請確認發布時選的是「逗號分隔值 (.csv)」。', 'setup');
    return { rows: CSV.parse(text), label: 'CSV 連結', ref: `csv:${u}` };
  };

  /* ---------- 同步：讀取 → 分析 → 沒變就跳過 → 有變就寫入並留下紀錄 ----------
   * 回傳 { status: 'ok'|'same'|'error'|'auth'|'needs-mapping', message, counts, analysis } */
  Drive.fetchTable = async () => {
    const d = Store.drive;
    if (d.type === 'sheet') return { ...(await Drive.readSheet(d.sheet, d.tab)), source: 'drive' };
    if (d.type === 'csv') return { ...(await Drive.readCsvUrl(d.csvUrl)), source: 'csv' };
    throw new DriveError('還沒設定資料來源。', 'setup');
  };
  Drive.syncNow = async ({ auto = false } = {}) => {
    if (Drive.running) return { status: 'busy' };
    const d = Store.drive;
    if (!d.type) return { status: 'off' };
    Drive.running = true;
    const at = new Date().toISOString();
    const finish = (patch) => {
      const { mapping, ...status } = patch;
      Store.setDriveStatus({ lastCheckAt: at, ...status });
      // 欄位對應有變才存（會跟著雲端同步到其他裝置）
      if (mapping && JSON.stringify(mapping) !== JSON.stringify(Store.drive.mapping)) { try { Store.updateDrive({ mapping }, 'sync-drive'); } catch (e) { console.warn(e); } }
    };
    try {
      const t = await Drive.fetchTable();
      const an = Store.analyze(t.rows, { mapping: d.mapping, dateOrder: d.dateOrder, overwriteManual: d.overwriteManual, defaultAccount: d.defaultAccount });
      if (an.headerRow < 0 || an.errors.length) {
        const msg = `資料格式對不上：${an.errors[0] || '找不到欄位'}。請到同步頁按「預覽並匯入」重新對應欄位。`;
        finish({ lastStatus: 'error', lastError: msg });
        return { status: 'needs-mapping', message: msg, analysis: an, table: t };
      }
      const prev = Store.seenBatch(an.hash, t.ref);
      const changes = (an.counts.added || 0) + (an.counts.updated || 0);
      if (prev || !changes) {
        finish({ lastStatus: 'same', lastError: '', lastSyncAt: at });
        return { status: 'same', message: prev ? '資料和上次同步一樣，沒有變化' : '沒有新的或改變的數字', counts: an.counts, analysis: an };
      }
      const r = Store.apply(an, { source: t.source, label: t.label, ref: t.ref, auto });
      finish({ lastStatus: 'ok', lastError: '', lastSyncAt: at, mapping: an.mapping });
      return { status: 'ok', counts: r.counts, batchId: r.batchId, analysis: an };
    } catch (e) {
      const kind = e.kind || 'error';
      finish({ lastStatus: kind === 'auth' ? 'auth' : 'error', lastError: e.message || '同步失敗' });
      return { status: kind === 'auth' ? 'auth' : 'error', message: e.message || '同步失敗', kind };
    } finally {
      Drive.running = false;
    }
  };

  // 自動同步：打開 Maple M 時、之後每 15 分鐘（畫面開著、有網路、授權有效時）
  let timer = null;
  Drive.autoTick = () => {
    const d = Store.drive;
    if (!d.type || !d.auto || !navigator.onLine || document.visibilityState !== 'visible') return Promise.resolve(null);
    if (d.type === 'sheet' && !Drive.token()) return Promise.resolve(null);
    const st = Store.driveStatus();
    const last = st.lastCheckAt ? Date.parse(st.lastCheckAt) : 0;
    if (Date.now() - last < 10 * 60 * 1000) return Promise.resolve(null);
    return Drive.syncNow({ auto: true });
  };
  Drive.startAuto = (onResult) => {
    if (timer) return;
    const tick = () => Drive.autoTick().then((r) => { if (r && onResult) onResult(r); });
    timer = setInterval(tick, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
    global.addEventListener('online', tick);
    setTimeout(tick, 1500);
  };

  global.GCTMMDrive = Drive;
})(window);
