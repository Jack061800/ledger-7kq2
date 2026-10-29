/* 多人：使用者名單、朋友出貨的定價、付款與欠款
 *   allow/{email}   允許登入的名單（只有管理員能改）
 *   settle/{email}  某位朋友的結算：{ prices: { 出貨id: { p: 每 1B 的 RM 單價, at } }, payments: [{ id, date, amount, note, at }] }
 * 朋友用「出貨」按鈕記的每一筆，管理員填單價後算出金額，就是管理員欠朋友的錢；付款後扣掉。 */
(function (global) {
  'use strict';

  const Auth = global.GCTAuth;
  const Cloud = global.GCTCloud;
  const Sync = global.GCTSync;
  const CACHE_KEY = 'gct:team:v1';
  const UNIT = 1e9; // 單價以每 1B 計

  const listeners = [];
  const cache = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (_) { return {}; } })();

  const emptySettle = () => ({ prices: {}, payments: [] });
  const readSettle = (doc) => {
    if (!doc) return emptySettle();
    try { const x = JSON.parse(doc.data.data || '{}'); return { prices: x.prices || {}, payments: x.payments || [] }; } catch (_) { return emptySettle(); }
  };
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

  /* ---------- 計算 ---------- */
  // 某人的出貨列表（含單價、金額）。source 是 { accounts, shipments }：管理員用快取的朋友資料，朋友用自己的帳本
  Team.rows = function rows(email, source) {
    const st = Team.settle[email] || emptySettle();
    const names = new Map((source.accounts || []).map((a) => [a.id, a]));
    return (source.shipments || []).map((s) => {
      const pr = st.prices[s.id];
      const price = pr && typeof pr.p === 'number' ? pr.p : null;
      return { ...s, account: names.get(s.accountId) || null, price, money: price == null ? null : round2((s.amount / UNIT) * price) };
    }).sort((a, b) => (a.date === b.date ? ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1) : a.date < b.date ? 1 : -1));
  };
  Team.summary = function summary(email, source) {
    const list = Team.rows(email, source);
    const st = Team.settle[email] || emptySettle();
    const owed = round2(list.reduce((t, r) => t + (r.money || 0), 0));
    const paid = round2(st.payments.reduce((t, p) => t + (Number(p.amount) || 0), 0));
    const pending = list.filter((r) => r.price == null);
    return { owed, paid, balance: round2(owed - paid), pending: pending.length, pendingAmount: pending.reduce((t, r) => t + r.amount, 0), count: list.length };
  };
  Team.sourceFor = (email) => Team.ledgers[email] || { accounts: [], shipments: [] };
  // 管理員：所有朋友待定價的筆數（側欄徽章）
  Team.pendingTotal = () => (Team.isAdmin() ? Team.users.reduce((t, u) => t + Team.summary(u.email, Team.sourceFor(u.email)).pending, 0) : 0);
  Team.isPriced = (email, shipId) => { const st = Team.settle[email]; return !!(st && st.prices[shipId]); };

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
