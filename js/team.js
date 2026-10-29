/* 多人：使用者名單、朋友出貨的定價、付款與欠款
 *   allow/{email}   允許登入的名單（只有管理員能改）
 *   settle/{email}  某位朋友的結算：{ prices: { 出貨id: { p: 每 1B 的 RM 單價, at } }, payments: [{ id, date, amount, note, at }],
 *                   rejects: { 出貨id: { reason, note, at, amount, date } } }
 * 朋友用「出貨」按鈕記的每一筆，管理員填單價後算出金額，就是管理員欠朋友的錢；付款後扣掉。
 * 記錯的出貨管理員可以退回（rejects）：朋友的 App 讀到後會把那筆標成退回，不再算進 Sales 和結算。 */
(function (global) {
  'use strict';

  const Auth = global.GCTAuth;
  const Cloud = global.GCTCloud;
  const Sync = global.GCTSync;
  const CACHE_KEY = 'gct:team:v1';
  const UNIT = 1e9; // 單價以每 1B 計

  const listeners = [];
  const cache = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (_) { return {}; } })();

  const emptySettle = () => ({ prices: {}, payments: [], rejects: {} });
  const readSettle = (doc) => {
    if (!doc) return emptySettle();
    try { const x = JSON.parse(doc.data.data || '{}'); return { prices: x.prices || {}, payments: x.payments || [], rejects: x.rejects || {} }; } catch (_) { return emptySettle(); }
  };
  const settleOf = (email) => ({ ...emptySettle(), ...(Team.settle[email] || {}) });
  const SEEN_KEY = 'gct:rejects:seen';
  // 管理員端只需要朋友的帳號名稱和出貨，存在本機讓離線時也能看結算
  const slim = (state) => ({ accounts: state.accounts.map((a) => ({ id: a.id, name: a.name, colorIndex: a.colorIndex })), shipments: state.shipments || [] });
  const round2 = (n) => Math.round(n * 100) / 100;
  const normEmail = (s) => String(s || '').trim().toLowerCase();
  const uid = () => `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  const Team = {
    enabled: !!(Sync && Sync.enabled),
    UNIT,
    users: cache.users || [],        // 管理員：[{ email, name, addedAt }]
    ledgers: cache.ledgers || {},    // 管理員：email → { accounts, shipments }
    settle: cache.settle || {},      // email → { prices, payments }（朋友只有自己的）
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
    Team.users = []; Team.ledgers = {}; Team.settle = {}; Team.loadedAt = null;
  };

  function emit() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ me: Team.me(), users: Team.users, ledgers: Team.ledgers, settle: Team.settle, loadedAt: Team.loadedAt }));
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
          const ledgers = {}; const settle = {};
          await Promise.all(Team.users.map(async (u) => {
            const [led, st] = await Promise.all([Sync.loadLedger(u.email), Cloud.get(`settle/${u.email}`)]);
            ledgers[u.email] = led ? slim(led.state) : { accounts: [], shipments: [] };
            settle[u.email] = readSettle(st);
          }));
          Team.ledgers = ledgers; Team.settle = settle;
        } else {
          const me = Team.me();
          Team.settle = { [me]: readSettle(await Cloud.get(`settle/${me}`)) };
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
  Team.summary = function summary(email, source) {
    const all = Team.rows(email, source);
    const list = all.filter((r) => !r.rejected);
    const st = settleOf(email);
    const owed = round2(list.reduce((t, r) => t + (r.money || 0), 0));
    const paid = round2(st.payments.reduce((t, p) => t + (Number(p.amount) || 0), 0));
    const pending = list.filter((r) => r.price == null);
    return { owed, paid, balance: round2(owed - paid), pending: pending.length, pendingAmount: pending.reduce((t, r) => t + r.amount, 0), count: list.length, rejected: all.length - list.length };
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
      mutate(st);
      if (!Object.keys(st.rejects).length) delete st.rejects;
      try {
        await Cloud.commit([{ path: `settle/${email}`, data: { data: JSON.stringify(st), updatedAt: new Date().toISOString() }, ...(doc ? { ifUpdateTime: doc.updateTime } : { ifMissing: true }) }]);
        Team.settle = { ...Team.settle, [email]: st };
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

  global.GCTTeam = Team;
})(window);
