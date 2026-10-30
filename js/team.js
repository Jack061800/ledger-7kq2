/* 多人：使用者名單、朋友出貨的定價、付款與欠款
 *   allow/{email}   允許登入的名單（只有管理員能改）
 *   settle/{email}  某位朋友的結算：{ prices: { 出貨id: { p: 每 1B 的 RM 單價, at } }, payments: [{ id, date, amount, note, at }],
 *                   rejects: { 出貨id: { reason, note, at, amount, date } },
 *                   adjustments: [{ id, amount, reason, by, target, at, before, after, cancelledAt? }] }
 *   resp/{email}    朋友自己的審批回覆（只有本人能寫）：{ adj: { 調整id: { status: 'approved'|'rejected', by, at, note, before, after } } }
 * 朋友用「出貨」按鈕記的每一筆，管理員填單價後算出金額，就是管理員欠朋友的錢；付款後扣掉。
 * 記錯的出貨管理員可以退回（rejects）：朋友的 App 讀到後會把那筆標成退回，不再算進 Sales 和結算。
 * 結算調整（Settlement-only adjustment）只改欠款金額，不碰任何人的 Stock／出貨／帳本；
 * 管理員發起後要等朋友在自己的 resp 文件批准才算數（管理員改不了 resp，朋友改不了 settle）。 */
(function (global) {
  'use strict';

  const Auth = global.GCTAuth;
  const Cloud = global.GCTCloud;
  const Sync = global.GCTSync;
  const CACHE_KEY = 'gct:team:v1';
  const UNIT = 1e9; // 單價以每 1B 計

  const listeners = [];
  const cache = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (_) { return {}; } })();

  const emptySettle = () => ({ prices: {}, payments: [], rejects: {}, adjustments: [] });
  const readSettle = (doc) => {
    if (!doc) return emptySettle();
    try {
      const x = JSON.parse(doc.data.data || '{}');
      return { prices: x.prices || {}, payments: x.payments || [], rejects: x.rejects || {}, adjustments: Array.isArray(x.adjustments) ? x.adjustments : [] };
    } catch (_) { return emptySettle(); }
  };
  const settleOf = (email) => ({ ...emptySettle(), ...(Team.settle[email] || {}) });
  const emptyResp = () => ({ adj: {} });
  const readResp = (doc) => {
    if (!doc) return emptyResp();
    try { const x = JSON.parse(doc.data.data || '{}'); return { adj: x.adj || {} }; } catch (_) { return emptyResp(); }
  };
  // 回覆文件讀不到（例如雲端規則還沒更新）時當作沒有回覆，不影響其他結算資料
  const safeGet = async (path) => { try { return await Cloud.get(path); } catch (e) { console.warn(`讀取 ${path} 失敗`, e); return null; } };
  const SEEN_KEY = 'gct:rejects:seen';
  // 管理員端只需要朋友的帳號名稱和出貨，存在本機讓離線時也能看結算
  const slim = (state) => ({ accounts: state.accounts.map((a) => ({ id: a.id, name: a.name, colorIndex: a.colorIndex })), shipments: state.shipments || [] });
  const round2 = (n) => Math.round(n * 100) / 100;
  const fmtQty = (n) => (n >= 1e9 ? `${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : Number(n).toLocaleString('en-US'));
  const normEmail = (s) => String(s || '').trim().toLowerCase();
  const uid = () => `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  const Team = {
    enabled: !!(Sync && Sync.enabled),
    UNIT,
    users: cache.users || [],        // 管理員：[{ email, name, addedAt }]
    ledgers: cache.ledgers || {},    // 管理員：email → { accounts, shipments }
    settle: cache.settle || {},      // email → { prices, payments, rejects, adjustments }（朋友只有自己的）
    resp: cache.resp || {},          // email → { adj }：朋友對結算調整的批准／拒絕
    loadedAt: cache.loadedAt || null,
    loading: false,
    error: '',
    onChange(fn) { listeners.push(fn); },
    isAdmin: () => !!(Auth && Auth.isAdmin && Auth.isAdmin()),
    me: () => { const s = Auth && Auth.session && Auth.session(); return s ? s.email : ''; },
    user(email) { return this.users.find((u) => u.email === email) || null; },
    nameOf(email) { const u = this.user(email); return (u && u.name) || email; },
  };

  // 登入後呼叫：快取若是別的帳號留下的就丟掉
  Team.init = function init() {
    if (cache.me && cache.me === Team.me()) return;
    Team.users = []; Team.ledgers = {}; Team.settle = {}; Team.resp = {}; Team.loadedAt = null;
  };

  function emit() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ me: Team.me(), users: Team.users, ledgers: Team.ledgers, settle: Team.settle, resp: Team.resp, loadedAt: Team.loadedAt }));
    } catch (_) { /* 空間不足時只是不留快取 */ }
    listeners.forEach((fn) => fn(Team));
  }

  let inflight = null;
  Team.refresh = function refresh() {
    if (!Team.enabled || !navigator.onLine || !Team.me()) return Promise.resolve();
    if (inflight) return inflight;
    Team.loading = true;
    inflight = (async () => {
      try {
        if (Team.isAdmin()) {
          const docs = await Cloud.list('allow');
          Team.users = docs.map((d) => ({ email: d.id, name: d.data.name || '', addedAt: d.data.addedAt || '' }))
            .sort((a, b) => (a.addedAt < b.addedAt ? -1 : 1));
          const ledgers = {}; const settle = {}; const resp = {};
          await Promise.all(Team.users.map(async (u) => {
            const [led, st, rs] = await Promise.all([Sync.loadLedger(u.email), Cloud.get(`settle/${u.email}`), safeGet(`resp/${u.email}`)]);
            ledgers[u.email] = led ? slim(led.state) : { accounts: [], shipments: [] };
            settle[u.email] = readSettle(st);
            resp[u.email] = readResp(rs);
          }));
          Team.ledgers = ledgers; Team.settle = settle; Team.resp = resp;
        } else {
          const me = Team.me();
          const [st, rs] = await Promise.all([Cloud.get(`settle/${me}`), safeGet(`resp/${me}`)]);
          Team.settle = { [me]: readSettle(st) };
          Team.resp = { [me]: readResp(rs) };
          applyRejects(Team.settle[me].rejects);
        }
        Team.loadedAt = Date.now();
        Team.error = '';
      } catch (e) {
        console.warn('讀取結算資料失敗', e);
        Team.error = e.message || '讀取失敗';
      } finally {
        Team.loading = false;
        inflight = null;
        emit();
      }
    })();
    return inflight;
  };

  /* ---------- 朋友端：套用退回 ---------- */
  // 把管理員的退回名單寫進自己的帳本（同步後管理員那邊看到的帳本也會更新）
  function applyRejects(rejects) {
    const Store = global.GCT && global.GCT.Store;
    if (!Store || Store.readOnly || Team.isAdmin()) return;
    try {
      const added = Store.applyShipmentRejects(rejects);
      if (added.length) Team.justRejected = added;
    } catch (e) { console.warn('套用退回失敗', e); }
  }
  // 朋友端：被退回但還沒按「知道了」的出貨
  Team.unseenRejects = function unseenRejects(shipments) {
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)) || []; } catch (_) { /* 沒有就當全部沒看過 */ }
    return (shipments || []).filter((s) => s.rejected && !seen.includes(`${s.id}@${s.rejected.at}`));
  };
  Team.markRejectsSeen = function markRejectsSeen(shipments) {
    const keys = (shipments || []).filter((s) => s.rejected).map((s) => `${s.id}@${s.rejected.at}`);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(keys.slice(-300))); } catch (_) { /* 只是提醒，存不了沒關係 */ }
    listeners.forEach((fn) => fn(Team));
  };

  /* ---------- 計算 ---------- */
  // 某人的出貨列表（含單價、金額）。source 是 { accounts, shipments }：管理員用快取的朋友資料，朋友用自己的帳本
  // 退回的出貨看管理員的名單（立即生效）或帳本上的標記（朋友端套用後），不計價
  Team.rows = function rows(email, source) {
    const st = settleOf(email);
    const names = new Map((source.accounts || []).map((a) => [a.id, a]));
    return (source.shipments || []).map((s) => {
      // 管理員以退回名單為準（復原後立刻生效）；朋友以自己帳本上的標記為準（和 Sales 計算一致）
      const rejected = (Team.isAdmin() ? st.rejects[s.id] : s.rejected) || null;
      const pr = rejected ? null : st.prices[s.id];
      const price = pr && typeof pr.p === 'number' ? pr.p : null;
      return { ...s, rejected, account: names.get(s.accountId) || null, price, money: price == null ? null : round2((s.amount / UNIT) * price) };
    }).sort((a, b) => (a.date === b.date ? ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1) : a.date < b.date ? 1 : -1));
  };
  // 結算調整（含狀態）：撤回 > 對方的回覆 > 待批准。只有「已批准」會算進欠款
  Team.adjustments = function adjustments(email) {
    const st = settleOf(email);
    const rs = (Team.resp[email] || emptyResp()).adj;
    return st.adjustments.map((a) => {
      const r = rs[a.id] || null;
      const status = a.cancelledAt ? 'cancelled' : r && (r.status === 'approved' || r.status === 'rejected') ? r.status : 'pending';
      return { ...a, status, decision: r };
    }).sort((x, y) => (x.at < y.at ? 1 : -1));
  };
  Team.ADJ_STATUS = { pending: '待對方批准', approved: '已批准', rejected: '已拒絕', cancelled: '已撤回' };

  Team.summary = function summary(email, source) {
    const all = Team.rows(email, source);
    const list = all.filter((r) => !r.rejected);
    const st = settleOf(email);
    const owed = round2(list.reduce((t, r) => t + (r.money || 0), 0));
    const paid = round2(st.payments.reduce((t, p) => t + (Number(p.amount) || 0), 0));
    const adj = Team.adjustments(email);
    const adjust = round2(adj.filter((a) => a.status === 'approved').reduce((t, a) => t + (Number(a.amount) || 0), 0));
    const adjPending = adj.filter((a) => a.status === 'pending');
    const pending = list.filter((r) => r.price == null);
    return {
      owed, paid, adjust, balance: round2(owed + adjust - paid),
      adjPending: adjPending.length, adjPendingAmount: round2(adjPending.reduce((t, a) => t + (Number(a.amount) || 0), 0)),
      pending: pending.length, pendingAmount: pending.reduce((t, r) => t + r.amount, 0), count: list.length, rejected: all.length - list.length,
    };
  };
  Team.sourceFor = (email) => Team.ledgers[email] || { accounts: [], shipments: [] };
  // 管理員：所有朋友待定價的筆數（側欄徽章）
  Team.pendingTotal = () => (Team.isAdmin() ? Team.users.reduce((t, u) => t + Team.summary(u.email, Team.sourceFor(u.email)).pending, 0) : 0);
  Team.isPriced = (email, shipId) => { const st = settleOf(email); return !!st.prices[shipId] && !st.rejects[shipId]; };

  /* ---------- 管理員操作 ---------- */
  function requireAdmin() {
    if (!Team.isAdmin()) throw new Error('只有管理員可以這樣做');
    if (!navigator.onLine) throw new Error('目前沒有網路，連線後再試');
  }

  // 讀最新的結算 → 修改 → 寫回（若同時被別的裝置改過就重來一次）
  async function updateSettle(email, mutate) {
    requireAdmin();
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = await Cloud.get(`settle/${email}`);
      const st = readSettle(doc);
      if (mutate(st) === false) return readSettle(doc); // 沒有要改的（例如重複送出）
      if (!Object.keys(st.rejects).length) delete st.rejects;
      if (!st.adjustments.length) delete st.adjustments;
      try {
        await Cloud.commit([{ path: `settle/${email}`, data: { data: JSON.stringify(st), updatedAt: new Date().toISOString() }, ...(doc ? { ifUpdateTime: doc.updateTime } : { ifMissing: true }) }]);
        Team.settle = { ...Team.settle, [email]: readSettle({ data: { data: JSON.stringify(st) } }) };
        emit();
        return st;
      } catch (e) {
        if (!Cloud.isConflict(e) || attempt === 2) throw e;
      }
    }
    return null;
  }

  Team.setPrices = (email, shipIds, price) => updateSettle(email, (st) => {
    const at = new Date().toISOString();
    shipIds.forEach((id) => { if (price == null) delete st.prices[id]; else st.prices[id] = { p: price, at }; });
  });
  Team.addPayment = (email, { date, amount, note }) => updateSettle(email, (st) => {
    st.payments.push({ id: uid(), date, amount: round2(amount), note: String(note || '').trim().slice(0, 200), at: new Date().toISOString() });
  });
  Team.deletePayment = (email, id) => updateSettle(email, (st) => { st.payments = st.payments.filter((p) => p.id !== id); });

  // 退回出貨的理由（選單）
  Team.REJECT_REASONS = ['重複記錄（記了兩次）', '數量記錯', '帳號選錯', '日期記錯', '沒有收到這批貨', '其他'];
  // 退回：寫進退回名單，並取消定價（不再算錢）
  Team.rejectShipments = (email, ships, reason, note) => updateSettle(email, (st) => {
    const at = new Date().toISOString();
    ships.forEach((s) => {
      st.rejects[s.id] = { reason: String(reason || '').slice(0, 40), note: String(note || '').trim().slice(0, 200), at, amount: s.amount, date: s.date };
      delete st.prices[s.id];
    });
  });
  Team.unrejectShipment = (email, id) => updateSettle(email, (st) => { delete st.rejects[id]; });

  /* ---------- 結算調整（不影響 Stock） ---------- */
  Team.newAdjustmentId = () => `adj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  // 管理員發起：id 由表單開啟時產生，重送同一個 id 不會變成兩筆
  // amount 為正：你多欠他；為負：從欠款扣掉
  Team.addAdjustment = async (email, { id, amount, reason }) => {
    requireAdmin();
    if (!Team.user(email)) throw new Error('找不到這位使用者');
    const amt = round2(Number(amount));
    if (!Number.isFinite(amt) || amt === 0) throw new Error('調整金額不能是 0');
    if (Math.abs(amt) > 1e7) throw new Error('調整金額太大了，請檢查');
    const why = String(reason || '').trim().slice(0, 200);
    if (why.length < 2) throw new Error('請寫調整原因');
    // 先抓最新的回覆，讓「調整前」金額用最新的已批准狀態計算
    Team.resp = { ...Team.resp, [email]: readResp(await safeGet(`resp/${email}`)) };
    let dup = false;
    await updateSettle(email, (st) => {
      if (st.adjustments.some((a) => a.id === id)) { dup = true; return false; }
      Team.settle = { ...Team.settle, [email]: st };
      const before = Team.summary(email, Team.sourceFor(email)).balance;
      st.adjustments.push({ id, amount: amt, reason: why, by: Team.me(), target: email, at: new Date().toISOString(), before, after: round2(before + amt) });
      return true;
    });
    if (!dup) writeSeen([...(readSeen() || []), `adj:${id}:pending`]); // 自己發起的不算未讀
    return { duplicate: dup };
  };
  // 管理員撤回還沒被處理的調整（已批准／已拒絕的不能撤回，保留紀錄）
  Team.cancelAdjustment = async (email, id) => {
    requireAdmin();
    const rs = readResp(await safeGet(`resp/${email}`));
    Team.resp = { ...Team.resp, [email]: rs };
    if (rs.adj[id]) throw new Error('對方已經處理過這筆調整，不能撤回');
    await updateSettle(email, (st) => {
      const a = st.adjustments.find((x) => x.id === id);
      if (!a || a.cancelledAt) return false;
      a.cancelledAt = new Date().toISOString();
      return true;
    });
  };
  // 被調整的本人批准／拒絕：寫在自己的 resp 文件；已經處理過的不能再改
  Team.respondAdjustment = async (id, decision, note) => {
    if (Team.isAdmin()) throw new Error('結算調整要由被調整的使用者自己批准');
    if (!navigator.onLine) throw new Error('目前沒有網路，連線後再試');
    if (decision !== 'approved' && decision !== 'rejected') throw new Error('不明的操作');
    const me = Team.me();
    for (let attempt = 0; attempt < 3; attempt++) {
      const [sd, rd] = await Promise.all([Cloud.get(`settle/${me}`), Cloud.get(`resp/${me}`)]);
      const st = readSettle(sd); const rs = readResp(rd);
      Team.settle = { ...Team.settle, [me]: st }; Team.resp = { ...Team.resp, [me]: rs };
      const a = st.adjustments.find((x) => x.id === id);
      if (!a) throw new Error('找不到這筆調整（可能已被刪除）');
      if (a.cancelledAt) { emit(); throw new Error('管理員已撤回這筆調整'); }
      if (rs.adj[id]) { emit(); throw new Error(`這筆調整已經${rs.adj[id].status === 'approved' ? '批准' : '拒絕'}過了`); }
      const before = Team.summary(me, global.GCT.Store.state).balance;
      rs.adj[id] = { status: decision, by: me, at: new Date().toISOString(), note: String(note || '').trim().slice(0, 200), before, after: decision === 'approved' ? round2(before + Number(a.amount)) : before };
      try {
        await Cloud.commit([{ path: `resp/${me}`, data: { data: JSON.stringify(rs), updatedAt: new Date().toISOString() }, ...(rd ? { ifUpdateTime: rd.updateTime } : { ifMissing: true }) }]);
        Team.resp = { ...Team.resp, [me]: rs };
        // 自己做的決定不用再通知自己
        writeSeen([...(readSeen() || []), `adj:${id}:${decision}`]);
        emit();
        return rs.adj[id];
      } catch (e) {
        if (!Cloud.isConflict(e) || attempt === 2) throw e;
      }
    }
    return null;
  };

  /* ---------- 通知（從看得到的資料算出來，每個人只看到自己權限內的） ---------- */
  const seenKey = () => `gct:notif:seen:${Team.me()}`;
  const readSeen = () => { try { return JSON.parse(localStorage.getItem(seenKey())); } catch (_) { return null; } };
  const writeSeen = (keys) => { try { localStorage.setItem(seenKey(), JSON.stringify(keys.slice(-500))); } catch (_) { /* 只是已讀狀態 */ } };
  const amt = (n) => `${n < 0 ? '−' : '+'}RM ${Math.abs(n).toFixed(2)}`;

  // { key, title, who, detail, at, status, tone, action, email, adjId, link }
  //   action：需要我處理（例如批准）；tone：pending／ok／bad／info
  Team.notifications = function notifications() {
    if (!Team.enabled || !Team.me()) return [];
    const out = [];
    const shipLabel = (s, accts) => { const a = accts.find((x) => x.id === s.accountId); return `${a ? a.name + ' · ' : ''}${fmtQty(s.amount)}`; };
    if (Team.isAdmin()) {
      Team.users.forEach((u) => {
        const name = u.name || u.email;
        const src = Team.sourceFor(u.email);
        const link = `#/settle?u=${encodeURIComponent(u.email)}`;
        Team.rows(u.email, src).forEach((r) => {
          if (r.rejected || r.price != null) return;
          out.push({ key: `ship:${u.email}:${r.id}:pending`, title: '出貨待你定價', who: name, detail: shipLabel(r, src.accounts || []), at: r.createdAt || r.date, status: '待處理', tone: 'pending', action: true, link });
        });
        Team.adjustments(u.email).forEach((a) => {
          if (a.status === 'pending') out.push({ key: `adj:${a.id}:pending`, title: '結算調整等待對方批准', who: '你', detail: `${name} · ${amt(a.amount)} · ${a.reason}`, at: a.at, status: Team.ADJ_STATUS.pending, tone: 'pending', action: false, link });
          else if (a.status === 'approved' || a.status === 'rejected') out.push({ key: `adj:${a.id}:${a.status}`, title: a.status === 'approved' ? `${name} 批准了結算調整` : `${name} 拒絕了結算調整`, who: name, detail: `${amt(a.amount)} · ${a.reason}${a.decision.note ? `（${a.decision.note}）` : ''}`, at: a.decision.at, status: Team.ADJ_STATUS[a.status], tone: a.status === 'approved' ? 'ok' : 'bad', action: false, link });
        });
      });
    } else {
      const me = Team.me();
      const Store = global.GCT && global.GCT.Store;
      const accts = Store ? Store.state.accounts : [];
      const st = settleOf(me);
      const link = '#/settle';
      Team.adjustments(me).forEach((a) => {
        const detail = `${amt(a.amount)} · ${a.reason}`;
        if (a.status === 'pending') out.push({ key: `adj:${a.id}:pending`, title: '管理員發起結算調整，需要你批准', who: '管理員', detail, at: a.at, status: '待你批准', tone: 'pending', action: true, adjId: a.id, link });
        else if (a.status === 'cancelled') out.push({ key: `adj:${a.id}:cancelled`, title: '管理員撤回了結算調整', who: '管理員', detail, at: a.cancelledAt, status: Team.ADJ_STATUS.cancelled, tone: 'info', action: false, link });
        else out.push({ key: `adj:${a.id}:${a.status}`, title: a.status === 'approved' ? '你批准了結算調整' : '你拒絕了結算調整', who: '管理員', detail, at: a.decision.at, status: Team.ADJ_STATUS[a.status], tone: a.status === 'approved' ? 'ok' : 'bad', action: false, link });
      });
      Team.rows(me, Store ? Store.state : { shipments: [] }).forEach((r) => {
        const detail = shipLabel(r, accts);
        if (r.rejected) out.push({ key: `ship:${r.id}:rejected:${r.rejected.at}`, title: '出貨被管理員退回', who: '管理員', detail: `${detail} · ${r.rejected.reason}`, at: r.rejected.at, status: '已退回', tone: 'bad', action: false, link });
        else if (r.price != null) out.push({ key: `ship:${r.id}:priced`, title: '管理員已定價你的出貨', who: '管理員', detail: `${detail} · RM ${r.money.toFixed(2)}`, at: (st.prices[r.id] || {}).at || r.date, status: '已定價', tone: 'ok', action: false, link });
        else out.push({ key: `ship:${r.id}:pending`, title: '出貨已提交，等管理員定價', who: '你', detail, at: r.createdAt || r.date, status: '待處理', tone: 'pending', action: false, link });
      });
    }
    const seen = readSeen();
    // 第一次用通知：舊的資訊類通知直接當已讀，免得一次跳出一大堆
    if (seen == null) { writeSeen(out.filter((n) => !n.action).map((n) => n.key)); }
    const seenSet = new Set(readSeen() || []);
    out.forEach((n) => { n.unread = !seenSet.has(n.key); });
    return out.sort((a, b) => (b.action - a.action) || ((a.at || '') < (b.at || '') ? 1 : -1));
  };
  // 徽章數字：要我處理的 ＋ 還沒看過的
  Team.notifBadge = () => Team.notifications().filter((n) => n.action || n.unread).length;
  Team.markNotificationsSeen = () => {
    const keys = new Set(readSeen() || []);
    Team.notifications().forEach((n) => keys.add(n.key));
    writeSeen(Array.from(keys));
    listeners.forEach((fn) => fn(Team));
  };

  Team.validateEmail = (raw) => {
    const email = normEmail(raw);
    if (!email) return { error: '請輸入 Gmail' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: '信箱格式不正確' };
    if (email === Team.me()) return { error: '這是你自己的帳號' };
    if (Team.user(email)) return { error: '這個 Gmail 已經在名單裡' };
    return { email };
  };
  Team.addUser = async (raw, name) => {
    requireAdmin();
    const v = Team.validateEmail(raw);
    if (v.error) throw new Error(v.error);
    await Cloud.commit([{ path: `allow/${v.email}`, data: { name: String(name || '').trim().slice(0, 40), addedAt: new Date().toISOString() } }]);
    Team.users = [...Team.users, { email: v.email, name: String(name || '').trim().slice(0, 40), addedAt: new Date().toISOString() }];
    emit();
    Team.refresh();
    return v.email;
  };
  Team.renameUser = async (email, name) => {
    requireAdmin();
    const u = Team.user(email);
    if (!u) return;
    await Cloud.commit([{ path: `allow/${email}`, data: { name: String(name || '').trim().slice(0, 40), addedAt: u.addedAt || new Date().toISOString() } }]);
    Team.users = Team.users.map((x) => (x.email === email ? { ...x, name: String(name || '').trim().slice(0, 40) } : x));
    emit();
  };
  // 移除登入權限；他的帳本和結算資料保留，之後再加回來就會看到
  Team.removeUser = async (email) => {
    requireAdmin();
    await Cloud.commit([{ path: `allow/${email}`, del: true }]);
    Team.users = Team.users.filter((u) => u.email !== email);
    emit();
  };

  // 讀某位朋友完整的帳本（給「看他的帳本」用，需要網路）
  Team.loadFullLedger = async (email) => {
    requireAdmin();
    const led = await Sync.loadLedger(email);
    return led ? led.state : null;
  };

  // 同步完成後順便更新結算資料（最多每分鐘一次）
  if (Sync && Sync.onStatus) {
    Sync.onStatus((s) => {
      if (s.status === 'ok' && (!Team.loadedAt || Date.now() - Team.loadedAt > 60 * 1000)) Team.refresh();
    });
  }
  // App 開著時每 2 分鐘、回到前景時，檢查有沒有新的審批和通知
  const stale = () => !Team.loadedAt || Date.now() - Team.loadedAt > 60 * 1000;
  setInterval(() => { if (document.visibilityState === 'visible' && stale()) Team.refresh(); }, 120 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && stale()) Team.refresh(); });

  global.GCTTeam = Team;
})(window);
