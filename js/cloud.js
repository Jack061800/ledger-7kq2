/* 雲端資料庫（Firebase Firestore）的讀寫，直接呼叫 REST API，不需要額外套件
 * 欄位只用字串、數字、布林；複雜的資料先轉成 JSON 字串再存。 */
(function (global) {
  'use strict';

  const Auth = global.GCTAuth;
  const DB = `projects/${Auth.projectId}/databases/(default)/documents`;
  const BASE = `https://firestore.googleapis.com/v1/${DB}`;

  class CloudError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code || ''; }
  }

  async function call(url, opts = {}) {
    const token = await Auth.getToken();
    if (!token) throw new CloudError('需要重新登入 Google 才能同步', 401);
    const headers = { Authorization: `Bearer ${token}` };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 404 && !opts.method) return null; // 讀取時「不存在」不算錯誤
    if (!res.ok) {
      let code = ''; let msg = '';
      try { const j = await res.json(); code = j.error.status || ''; msg = j.error.message || ''; } catch (_) { /* ignore */ }
      if (res.status === 401) { Auth.dropToken(); throw new CloudError('登入已過期，請重新登入 Google', 401, code); }
      if (res.status === 403) throw new CloudError('這個 Gmail 沒有使用權限（可能已被管理員移除）', 403, code);
      throw new CloudError(`雲端回應錯誤（${res.status}${msg ? '：' + msg : ''}）`, res.status, code);
    }
    return res.json();
  }

  const enc = (v) => (v == null ? { nullValue: null }
    : typeof v === 'boolean' ? { booleanValue: v }
      : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
        : { stringValue: String(v) });
  const dec = (f) => ('stringValue' in f ? f.stringValue
    : 'integerValue' in f ? Number(f.integerValue)
      : 'doubleValue' in f ? f.doubleValue
        : 'booleanValue' in f ? f.booleanValue : null);
  const encFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
  const decDoc = (d) => ({
    id: decodeURIComponent(d.name.split('/').pop()),
    updateTime: d.updateTime,
    data: Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)])),
  });
  const seg = (path) => path.split('/').map(encodeURIComponent).join('/');

  const Cloud = {
    CloudError,
    // 讀一筆；不存在回傳 null
    async get(path) {
      const d = await call(`${BASE}/${seg(path)}`);
      return d ? decDoc(d) : null;
    },
    // 讀一整個集合
    async list(path) {
      const out = []; let page = '';
      do {
        const j = await call(`${BASE}/${seg(path)}?pageSize=300${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
        if (!j) break;
        (j.documents || []).forEach((d) => out.push(decDoc(d)));
        page = j.nextPageToken || '';
      } while (page);
      return out;
    },
    /* 一次寫入多筆（全部成功或全部失敗）
     *   { path, data }            整筆取代
     *   { path, del: true }       刪除
     *   ifUpdateTime / ifMissing  只有在雲端還是讀到時的版本才寫（避免兩台裝置互相覆蓋）
     * 版本不符時丟出 code 為 FAILED_PRECONDITION 的錯誤，呼叫端重讀後再試 */
    async commit(writes) {
      if (!writes.length) return null;
      const body = {
        writes: writes.map((w) => {
          const name = `${DB}/${w.path}`;
          const x = w.del ? { delete: name } : { update: { name, fields: encFields(w.data) } };
          if (w.ifUpdateTime) x.currentDocument = { updateTime: w.ifUpdateTime };
          else if (w.ifMissing) x.currentDocument = { exists: false };
          return x;
        }),
      };
      return call(`${BASE}:commit`, { method: 'POST', body: JSON.stringify(body) });
    },
    isConflict: (e) => !!e && (e.code === 'FAILED_PRECONDITION' || e.code === 'ABORTED' || e.code === 'ALREADY_EXISTS' || e.code === 'NOT_FOUND'),
  };

  global.GCTCloud = Cloud;
})(window);
