/* 遊戲貨幣追蹤：介面 */
(function () {
  'use strict';

  const { Store, Calc, CSV, D, PALETTE, parseAmount, buildDemoState, normalizeState } = window.GCT;
  const Charts = window.GCTCharts;

  /* ================= 小工具 ================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
  // 顯示用：1 億（100,000,000）起改成 100M，10 億起改成 1B；輸入框一律用 fmtFull 顯示完整數字
  const fmtAbs = (a) => (a >= 1e9 ? `${+(a / 1e9).toFixed(2)}B` : a >= 1e8 ? `${+(a / 1e6).toFixed(2)}M` : nf.format(a));
  const fmt = (n) => { if (n == null) return '—'; const r = Math.round(n); return r < 0 ? '-' + fmtAbs(-r) : fmtAbs(r); };
  const fmtFull = (n) => (n == null ? '' : nf.format(Math.round(n)));
  const fmtSigned = (n) => {
    if (n == null) return '—';
    const r = Math.round(n);
    return r > 0 ? '+' + fmtAbs(r) : r < 0 ? '−' + fmtAbs(-r) : '0';
  };
  const deltaClass = (n) => (n == null ? 'muted' : Math.round(n) > 0 ? 'pos' : Math.round(n) < 0 ? 'neg' : 'zero');
  const delta = (n, suffix = '') => `<span class="delta ${deltaClass(n)}">${fmtSigned(n)}${n == null ? '' : suffix}</span>`;
  const cur = () => esc(Store.state.settings.currencyName || '貨幣');
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const fmtDate = (iso) => { const d = D.parseISO(iso); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
  const fmtDateWeek = (iso) => `${fmtDate(iso)}（週${WEEK[D.parseISO(iso).getDay()]}）`;
  const relDays = (iso) => {
    const n = D.daysBetween(iso, D.todayISO());
    return n === 0 ? '今天' : n === 1 ? '昨天' : n > 0 ? `${n} 天前` : `${-n} 天後`;
  };
  const initials = (name) => Array.from(String(name).trim()).slice(0, 2).join('').toUpperCase();
  const color = (a) => Store.color(a);

  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    entry: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    records: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
    accounts: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.5 14.5a6.5 6.5 0 0 1 3 5.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    upload: '<path d="M12 20V9"/><path d="m7 14 5-5 5 5"/><path d="M5 4h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.8h.01"/>',
    alert: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    coin: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V6.5"/><path d="M5 12v5.5c0 1.7 3.1 3 7 3s7-1.3 7-3V12"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    week: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M7 14h4M7 17h7"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5 3.5-5 3.5Z"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    rank: '<path d="M8 21V11M16 21V7M12 21V3"/>',
    analytics: '<path d="M4 20h16"/><rect x="5" y="11" width="3" height="6" rx="1"/><rect x="10.5" y="6" width="3" height="11" rx="1"/><rect x="16" y="9" width="3" height="8" rx="1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
    up: '<path d="m7 15 5-5 5 5"/>',
    downArrow: '<path d="m7 9 5 5 5-5"/>',
    trendUp: '<path d="m3 16 6-6 4 4 7-7"/><path d="M15 7h5v5"/>',
    trendDown: '<path d="m3 8 6 6 4-4 7 7"/><path d="M15 17h5v-5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    gain: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
    spend: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
    pie: '<path d="M21 12A9 9 0 1 1 12 3v9Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    cloud: '<path d="M7 18.5h10a4.5 4.5 0 0 0 .6-9 6 6 0 0 0-11.5 1.6A3.8 3.8 0 0 0 7 18.5Z"/>',
    cloudOff: '<path d="M7 18.5h10a4.5 4.5 0 0 0 .6-9 6 6 0 0 0-11.5 1.6A3.8 3.8 0 0 0 7 18.5Z"/><path d="M3 3l18 18"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    ship: '<path d="M2.5 6.5h11v9.5h-11z"/><path d="M13.5 9.5h4l3 3.2v3.3h-7"/><circle cx="6.5" cy="17.8" r="1.7"/><circle cx="17" cy="17.8" r="1.7"/>',
    share: '<path d="M12 15V3"/><path d="m8 7 4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>',
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  /* ================= 介面偏好（只存在本機，與資料分開） ================= */
  const UI_KEY = 'gct:ui:v1';
  const ui = Object.assign({
    range: '30', customStart: '', customEnd: '', dashAccounts: null, trendMode: 'daily', rankMetric: 'sales',
    acctFilter: 'all', acctSort: 'manual', acctView: 'grid', recSort: 'date', recDir: 'desc', lastAccountId: '',
    theme: null, railOpen: false,
    anRange: '30', anMetric: 'sales', anAccount: 'all', anBucket: 'day', anCompare: true,
  }, (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (_) { return {}; } })());
  const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (_) { /* ignore */ } };

  /* ================= 提示、對話框 ================= */
  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check')}<span>${esc(msg)}</span>`;
    $('#toastRoot').append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, type === 'error' ? 6000 : 3200);
  }

  function openModal({ title, body, footer = '', size = '', onClose }) {
    const root = $('#modalRoot');
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="關閉">${icon('close')}</button></header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`;
    const prevFocus = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === wrap) close(); };
    function close() {
      if (!wrap.isConnected || wrap.classList.contains('closing')) return;
      document.removeEventListener('keydown', onKey);
      wrap.classList.add('closing');
      setTimeout(() => {
        wrap.remove();
        if (!root.children.length) document.body.classList.remove('modal-open');
      }, reduceMotion() ? 0 : 200);
      if (onClose) onClose();
      if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus();
    }
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    root.append(wrap);
    document.body.classList.add('modal-open');
    setTimeout(() => {
      const first = wrap.querySelector('[data-autofocus]') || wrap.querySelector('.modal-body input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .modal-body select, .modal-body textarea') || wrap.querySelector('.modal-foot .btn-primary');
      if (first) first.focus();
    }, 30);
    return { el: wrap, close };
  }

  function confirmDialog({ title, message, confirmText = '確認', danger = false }) {
    return new Promise((resolve) => {
      let done = false;
      const m = openModal({
        title, size: 'modal-sm',
        body: `<p class="confirm-msg">${message}</p>`,
        footer: `<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok data-autofocus>${esc(confirmText)}</button>`,
        onClose: () => { if (!done) resolve(false); },
      });
      $('[data-ok]', m.el).addEventListener('click', () => { done = true; resolve(true); m.close(); });
    });
  }

  function setFieldErrors(form, errors) {
    $$('.field', form).forEach((f) => { f.classList.remove('has-error'); const e = $('.field-error', f); if (e) e.textContent = ''; });
    Object.keys(errors || {}).forEach((k) => {
      const input = form.querySelector(`[name="${k}"]`);
      const f = input && input.closest('.field');
      if (f) { f.classList.add('has-error'); const e = $('.field-error', f); if (e) e.textContent = errors[k]; }
    });
    const first = form.querySelector('.has-error input, .has-error select, .has-error textarea');
    if (first) first.focus();
  }

  // 數字欄位：離開時自動加上千分位（只在數值有效時，不改變數值本身）
  document.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input.num')) {
      const r = parseAmount(t.value);
      if (!r.error && r.value != null) t.value = fmtFull(r.value);
    }
  });
  // 點空白處關閉下拉
  document.addEventListener('click', () => $$('.popover').forEach((p) => { p.hidden = true; }));

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function pickFile(accept) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept;
      inp.addEventListener('change', () => resolve(inp.files[0] || null));
      inp.click();
    });
  }
  const readText = (file) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file, 'utf-8');
  });

  function safely(fn) {
    try { return fn(); } catch (e) {
      if (e && e.fieldErrors) throw e;
      toast(e && e.message ? e.message : '發生未預期的錯誤', 'error');
      console.error(e);
      return undefined;
    }
  }

  /* ================= 導覽與版面 ================= */
  const NAV = [
    { id: 'dashboard', label: '總覽', icon: 'dashboard', sub: 'Stock 庫存和 Sales 賺到的，一眼看完' },
    { id: 'analytics', label: 'Sales 分析', short: 'Sales', icon: 'analytics', sub: '看 Sales 趨勢、出貨、各帳號比較' },
    { id: 'entry', label: '每日錄入', short: '錄入', icon: 'entry', sub: '每天填各帳號的 CF Bal 和出貨' },
    { id: 'records', label: '記錄', icon: 'records', sub: '搜尋、排序、編輯每一筆每日記錄' },
    { id: 'accounts', label: '帳號', icon: 'accounts', sub: '新增、編輯、停用你的遊戲帳號' },
    { id: 'settings', label: '設定與備份', short: '設定', icon: 'settings', sub: '貨幣名稱、備份還原、匯入匯出' },
  ];

  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 主題 ---------- */
  const currentTheme = () => document.documentElement.getAttribute('data-theme') || 'light';
  // 手機狀態列顏色跟著主題
  function syncThemeColor() {
    const c = currentTheme() === 'dark' ? '#0f1412' : '#eef0ec';
    $$('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', c); m.removeAttribute('media'); });
  }

  /* ---------- 手機安裝（PWA） ---------- */
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const canInstall = () => /^https?:$/.test(location.protocol);
  // iPhone Safari 還沒加到主畫面時，提示一次怎麼安裝
  function installHint() {
    if (!isIOS || isStandalone() || !canInstall() || ui.installHintHidden) return '';
    return `<div class="notice notice-info install-hint">${icon('phone')}<div><b>把「貨幣帳本」加到主畫面</b>
      <p>點 Safari 下方的「分享」${icon('share', 'icon-inline')}→ 選「加入主畫面」，之後就能像 App 一樣從桌面打開、離線也能記帳。</p></div>
      <button type="button" class="icon-btn" data-action="hide-install" aria-label="不再顯示">${icon('close')}</button></div>`;
  }
  if ('serviceWorker' in navigator && canInstall()) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch((e) => console.warn('離線快取註冊失敗', e)); });
  }
  // 要求瀏覽器不要自動清掉本機資料（iPhone 主畫面 App 本身也不受 7 天清除限制）
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  function setTheme(theme, evt) {
    if (theme === currentTheme()) return;
    ui.theme = theme; saveUI();
    const apply = () => { document.documentElement.setAttribute('data-theme', theme); syncThemeColor(); renderChrome(route().name); };
    if (!document.startViewTransition || reduceMotion()) { apply(); return; }
    // 從點擊位置圓形擴散
    const x = evt && evt.clientX != null ? evt.clientX : innerWidth / 2;
    const y = evt && evt.clientY != null ? evt.clientY : innerHeight / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const st = document.documentElement.style;
    st.setProperty('--vt-x', x + 'px'); st.setProperty('--vt-y', y + 'px'); st.setProperty('--vt-r', r + 'px');
    // 分頁在背景時動畫可能被中止，但主題仍會套用，忽略即可
    const vt = document.startViewTransition(apply);
    [vt.ready, vt.finished, vt.updateCallbackDone].forEach((p) => p.catch(() => {}));
  }
  // 沒手動選過時跟著系統
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (ui.theme) return;
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      syncThemeColor();
      renderChrome(route().name);
    });
  }

  /* ---------- 動畫輔助 ---------- */
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const countMemory = new Map();
  // 數字從舊值（或 0）跑到新值
  function runCounts(root) {
    $$('.count[data-to]', root).forEach((el) => {
      const to = Number(el.dataset.to);
      const key = el.dataset.key;
      const from = key && countMemory.has(key) ? countMemory.get(key) : 0;
      if (key) countMemory.set(key, to);
      const signed = el.dataset.fmt === 'signed';
      const out = (v) => (signed ? fmtSigned(v) : fmt(v));
      if (reduceMotion() || from === to) { el.textContent = out(to); return; }
      const start = performance.now(); const dur = 900;
      const step = (now) => {
        const t = Math.min(1, (now - start) / dur);
        el.textContent = out(from + (to - from) * easeOut(t));
        if (t < 1 && el.isConnected) requestAnimationFrame(step);
      };
      el.textContent = out(from);
      requestAnimationFrame(step);
    });
  }
  const countSpan = (n, key, signed = false) => (n == null ? '—'
    : `<span class="count" data-to="${Math.round(n)}" data-key="${key}" data-fmt="${signed ? 'signed' : 'plain'}">${signed ? fmtSigned(n) : fmt(n)}</span>`);

  // 分段控制的滑動底色：記住上一次位置，從那裡滑到新位置
  const segMemory = new Map();
  function enhanceSegs(root) {
    $$('.seg[data-seg]', root).forEach((seg) => {
      const active = $('.seg-btn.active', seg);
      if (!active) return;
      seg.classList.add('has-pill');
      let pill = $('.seg-pill', seg);
      if (!pill) { pill = document.createElement('span'); pill.className = 'seg-pill'; seg.prepend(pill); }
      const key = seg.dataset.seg;
      const target = { x: active.offsetLeft, w: active.offsetWidth };
      const prev = segMemory.get(key);
      if (prev && !reduceMotion()) {
        pill.style.transition = 'none';
        pill.style.transform = `translateX(${prev.x}px)`; pill.style.width = prev.w + 'px';
        pill.getBoundingClientRect();
        pill.style.transition = '';
      }
      pill.style.transform = `translateX(${target.x}px)`; pill.style.width = target.w + 'px';
      segMemory.set(key, target);
    });
  }

  // 進場：依序浮現
  const GRIDS = '.kpi-grid, .dash-grid, .an-tiles, .an-bottom, .settings-grid';
  function stagger(view) {
    if (reduceMotion()) return;
    let i = 0;
    const tag = (el) => { el.classList.add('reveal'); el.style.setProperty('--i', i++); };
    Array.from(view.children).forEach((el) => {
      if (el.matches(GRIDS)) Array.from(el.children).forEach(tag); else tag(el);
    });
    $$('.acct-grid > *', view).slice(0, 16).forEach((el, k) => { el.classList.add('reveal'); el.style.setProperty('--i', Math.min(i, 4) + k); });
  }
  function enhance(root, { enter = false } = {}) {
    if (enter) stagger(root);
    enhanceSegs(root);
    runCounts(root);
  }
  // 視窗大小改變時重新對齊分段底色
  let segTimer = null;
  window.addEventListener('resize', () => { clearTimeout(segTimer); segTimer = setTimeout(() => enhanceSegs(document), 120); });

  function animateTitle(text) {
    const h1 = $('#pageTitle');
    if (reduceMotion()) { h1.textContent = text; return; }
    h1.setAttribute('aria-label', text);
    h1.innerHTML = Array.from(text).map((ch, i) => `<span class="ch" aria-hidden="true" style="--i:${i}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
  }

  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, q] = h.split('?');
    return { name: PAGES[name] ? name : 'dashboard', params: new URLSearchParams(q || '') };
  }

  // Sales 歸屬日：預設「前一天」——今天記的 CF Bal − 昨天的 CF Bal ＋ 今天記的出貨 = 昨天賺的
  const salesPrev = () => Store.state.settings.salesDay !== 'same';
  const salesDayLabel = () => (salesPrev() ? '昨日' : '今日');
  const salesDateFor = (recordDate) => (salesPrev() ? D.addDays(recordDate, -1) : recordDate);

  const unrecordedToday = () => {
    const today = D.todayISO();
    return Store.accounts().filter((a) => a.status === 'active' && !Store.recordFor(a.id, today));
  };

  /* ---------- 雲端同步狀態 ---------- */
  const Sync = window.GCTSync;
  const SYNC_TEXT = {
    idle: '準備同步', syncing: '同步中…', ok: '已同步', offline: '離線中，連線後自動同步',
    auth: '需要重新登入 Google 才能同步', error: '同步失敗', off: '未啟用雲端同步',
  };
  const syncAgo = () => {
    if (!Sync || !Sync.lastAt) return '尚未同步過';
    const m = Math.round((Date.now() - Sync.lastAt) / 60000);
    return m < 1 ? '剛剛同步' : m < 60 ? `${m} 分鐘前同步` : `${fmtDate(D.toISO(new Date(Sync.lastAt)))} 同步`;
  };
  function updateSyncIndicator() {
    const btn = $('#syncBtn');
    if (btn && Sync) {
      const st = Sync.status;
      btn.className = `round-btn sync-btn is-${st}`;
      btn.innerHTML = `${icon(st === 'offline' || st === 'auth' || st === 'error' ? 'cloudOff' : st === 'syncing' ? 'refresh' : 'cloud')}${st === 'auth' || st === 'error' ? '<span class="dot-badge is-dot"></span>' : ''}`;
      const tip = Sync.message && (st === 'error' || st === 'auth') ? Sync.message : `${SYNC_TEXT[st] || ''}（${syncAgo()}）`;
      btn.title = tip;
      btn.setAttribute('aria-label', tip);
    }
    const box = $('#syncStatusBox');
    if (box && Sync) {
      box.innerHTML = `<span class="sync-dot is-${Sync.status}"></span><b>${SYNC_TEXT[Sync.status] || ''}</b><small>${esc(Sync.status === 'error' || Sync.status === 'auth' ? Sync.message : syncAgo())}</small>`;
      const again = $('#syncAuthBtn');
      if (again) again.hidden = Sync.status !== 'auth';
    }
  }
  if (Sync) Sync.onStatus(updateSyncIndicator);

  const backupInfo = () => {
    const last = Store.state.settings.lastBackupAt;
    const days = last ? D.daysBetween(D.toISO(new Date(last)), D.todayISO()) : null;
    return { last, days, stale: Store.state.records.length > 0 && (days == null || days >= 7) };
  };

  // 頂部列、左側欄、手機底部列
  function renderChrome(active) {
    const today = D.todayISO();
    const activeAccts = Store.accounts().filter((a) => a.status === 'active');
    const done = activeAccts.filter((a) => Store.recordFor(a.id, today)).length;
    const pending = activeAccts.length - done;
    const theme = currentTheme();
    const bk = backupInfo();

    // 今日進度環
    const C = 2 * Math.PI * 10;
    const ratio = activeAccts.length ? done / activeAccts.length : 0;
    $('#topCenter').innerHTML = `<a class="status-chip" href="#/entry" title="前往每日錄入">
      <svg class="status-ring" viewBox="0 0 26 26" aria-hidden="true"><circle class="track" cx="13" cy="13" r="10"/><circle class="bar" cx="13" cy="13" r="10" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - ratio)).toFixed(2)}" transform="rotate(-90 13 13)"/></svg>
      <span>${fmtDateWeek(today)}</span><small>${activeAccts.length ? `已記錄 ${done}/${activeAccts.length}` : '尚無帳號'}</small></a>`;

    // 今天記錄的 CF Bal 算出來的 Sales（預設算在昨天）
    const todaySales = activeAccts.reduce((s, a) => { const r = Store.recordFor(a.id, today); const x = r && Calc.info(r.id); return x && x.sales != null ? s + x.sales : s; }, 0);
    const hour = new Date().getHours();
    const greet = hour < 5 ? '夜深了' : hour < 12 ? '早安' : hour < 18 ? '午安' : '晚安';
    $('#topActions').innerHTML = `
      <button type="button" class="search-pill" data-action="search" title="搜尋記錄（Ctrl+K）">${icon('search')}<span>搜尋記錄</span><kbd>Ctrl K</kbd></button>
      ${Sync && Sync.enabled ? '<button type="button" class="round-btn sync-btn" id="syncBtn" data-action="sync"></button>' : ''}
      <button type="button" class="round-btn" data-action="backup" title="${bk.stale ? (bk.days == null ? '還沒有備份過，建議下載備份' : `已 ${bk.days} 天沒有備份`) : '下載備份'}" aria-label="下載備份">${icon('download')}${bk.stale ? '<span class="dot-badge is-dot"></span>' : ''}</button>
      <button type="button" class="btn btn-primary" data-action="new-record">${icon('plus')}<span class="btn-label">新增記錄</span></button>
      <div class="me" title="今天記錄的 CF Bal 算出的 Sales（庫存變化 + 出貨）"><span class="me-avatar">${esc(Array.from(Store.state.settings.currencyName || '幣')[0])}</span><span><small>${greet}</small><b>${salesDayLabel()} Sales ${done ? fmtSigned(todaySales) : '—'}</b></span></div>`;

    $('#themeSwitch').innerHTML = `
      <button type="button" class="theme-sw-btn ${theme === 'light' ? 'active' : ''}" data-theme-set="light" data-label="淺色模式" aria-label="淺色模式" aria-pressed="${theme === 'light'}">${icon('sun')}<span class="nav-label">淺色</span></button>
      <button type="button" class="theme-sw-btn ${theme === 'dark' ? 'active' : ''}" data-theme-set="dark" data-label="深色模式" aria-label="深色模式" aria-pressed="${theme === 'dark'}">${icon('moon')}<span class="nav-label">深色</span></button>`;

    const item = (n, cls) => `<a href="#/${n.id}" class="${cls} ${n.id === active ? 'active' : ''}" ${n.id === active ? 'aria-current="page"' : ''} ${cls === 'nav-item' ? `data-label="${n.label}"` : ''} aria-label="${n.label}">
      ${icon(n.icon)}<span class="nav-label">${cls === 'tab' ? (n.short || n.label) : n.label}</span>
      ${n.id === 'entry' && pending ? `<span class="nav-badge" title="今天尚未記錄的帳號">${pending}</span>` : ''}</a>`;
    $('#nav').innerHTML = NAV.map((n) => item(n, 'nav-item')).join('');
    $('#tabbar').innerHTML = NAV.map((n) => item(n, 'tab')).join('');
    updateSyncIndicator();
    $('#railFoot').innerHTML = `<button type="button" class="rail-btn" data-action="toggle-rail" data-label="${ui.railOpen ? '收合選單' : '展開選單'}" aria-label="${ui.railOpen ? '收合選單' : '展開選單'}">${icon('sidebar')}<span class="nav-label">收合選單</span></button>`;
  }

  // 頁首：標題（只在換頁時重播動畫）
  let shownRoute = null;
  function renderPageHead(nav, force) {
    if (shownRoute === nav.id && !force) return;
    shownRoute = nav.id;
    $('#pageEyebrow').textContent = `今天 ${fmtDateWeek(D.todayISO())}`;
    animateTitle(nav.label);
    $('#pageSub').textContent = nav.sub;
    const ph = $('#pageHead');
    ph.querySelectorAll('.eyebrow, .page-sub, .page-actions').forEach((el) => { el.style.animation = 'none'; el.getBoundingClientRect(); el.style.animation = ''; });
  }

  function render(enter = false) {
    Charts.cleanup();
    const { name, params } = route();
    const nav = NAV.find((n) => n.id === name);
    document.title = `${nav.label} · 貨幣帳本`;
    renderChrome(name);
    renderPageHead(nav, enter);
    $('#pageActions').innerHTML = '';
    $('#globalBanner').innerHTML = Store.loadError
      ? `<div class="notice notice-error">${icon('alert')}<div><b>資料讀取問題</b><p>${esc(Store.loadError)}</p></div></div>` : '';
    const view = $('#view');
    try {
      PAGES[name](view, params);
      enhance(view, { enter });
      enhanceSegs($('#pageActions'));
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="card empty"><div class="empty-icon tone-neg">${icon('alert')}</div><h3>畫面載入失敗</h3><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">重新整理</button></div>`;
    }
  }

  /* ---------- 離開頁面前的未儲存提醒（每日錄入頁使用） ---------- */
  let leaveGuard = null;
  let lastHash = location.hash;
  window.addEventListener('hashchange', () => {
    if (leaveGuard && leaveGuard() && !window.confirm('有尚未儲存的輸入，確定要離開嗎？')) {
      history.replaceState(null, '', lastHash || '#/');
      return;
    }
    leaveGuard = null;
    const sameRoute = lastHash.split('?')[0] === location.hash.split('?')[0];
    lastHash = location.hash;
    render(!sameRoute);
    if (!sameRoute) window.scrollTo({ top: 0, behavior: 'instant' });
  });
  window.addEventListener('beforeunload', (e) => { if (leaveGuard && leaveGuard()) { e.preventDefault(); e.returnValue = ''; } });

  /* ================= 共用片段 ================= */
  function emptyState({ iconName = 'coin', title, text, actions = '' }) {
    return `<div class="card empty"><div class="empty-icon">${icon(iconName)}</div><h3>${title}</h3><p>${text}</p><div class="empty-actions">${actions}</div></div>`;
  }

  function noAccountsState() {
    return emptyState({
      title: '先建立你的第一個帳號',
      text: '新增遊戲帳號後，每天記錄 CF Bal 和出貨，就會自動算出每天的 Sales，並比較各帳號。想先看看效果，也可以載入範例資料（之後可在「設定與備份」清除）。',
      actions: `<button class="btn btn-primary" data-action="new-account">${icon('plus')}新增帳號</button><button class="btn" data-action="demo">載入範例資料</button>`,
    });
  }

  const avatar = (a, size = '') => `<span class="avatar ${size}" style="--c:${color(a)}">${esc(initials(a.name))}</span>`;
  const swatch = (a) => `<span class="swatch" style="background:${color(a)}"></span>`;
  const statusTag = (a) => (a.status === 'active' ? '<span class="tag tag-ok">啟用</span>' : '<span class="tag tag-muted">停用</span>');
  const hint = (text) => `<span class="hint" tabindex="0" role="note" aria-label="${esc(text)}" data-tip="${esc(text)}">${icon('info')}</span>`;

  function accountOptions(selectedId) {
    const accts = Store.accounts();
    const opt = (a) => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${esc(a.name)}${a.gameId ? `（${esc(a.gameId)}）` : ''}</option>`;
    const active = accts.filter((a) => a.status === 'active');
    const inactive = accts.filter((a) => a.status !== 'active');
    return active.map(opt).join('') + (inactive.length ? `<optgroup label="停用的帳號">${inactive.map(opt).join('')}</optgroup>` : '');
  }

  /* ================= 總覽 ================= */
  function selectedDashAccounts() {
    if (Array.isArray(ui.dashAccounts)) {
      const ids = ui.dashAccounts.filter((id) => Store.account(id));
      if (ids.length || !ui.dashAccounts.length) return ids;
    }
    return Store.accounts().filter((a) => a.status === 'active').map((a) => a.id);
  }

  function dashRange() {
    const today = D.todayISO();
    if (ui.range === 'custom' && D.isISODate(ui.customStart) && D.isISODate(ui.customEnd) && ui.customStart <= ui.customEnd) {
      return { start: ui.customStart, end: ui.customEnd, days: D.daysBetween(ui.customStart, ui.customEnd) + 1, label: `${fmtDate(ui.customStart)} – ${fmtDate(ui.customEnd)}` };
    }
    const n = Number(ui.range) || 30;
    return { start: D.addDays(today, -(n - 1)), end: today, days: n, label: `最近 ${n} 天（${fmtDate(D.addDays(today, -(n - 1)))} – ${fmtDate(today)}）` };
  }

  function renderAcctPicker(host, selectedIds, onChange, open) {
    const accounts = Store.accounts();
    const sel = new Set(selectedIds);
    const activeIds = accounts.filter((a) => a.status === 'active').map((a) => a.id);
    const sameAsActive = sel.size === activeIds.length && activeIds.every((id) => sel.has(id));
    const label = sel.size === 0 ? '未選擇帳號'
      : sel.size === accounts.length ? `全部帳號（${sel.size}）`
        : sameAsActive ? `全部啟用帳號（${sel.size}）`
          : sel.size === 1 ? Store.account(selectedIds[0]).name : `已選 ${sel.size} 個帳號`;
    host.innerHTML = `<button type="button" class="btn picker-btn" aria-haspopup="true" aria-expanded="${open ? 'true' : 'false'}">${icon('accounts')}<span>${esc(label)}</span>${icon('down', 'icon-sm')}</button>
      <div class="popover" ${open ? '' : 'hidden'}>
        <div class="popover-actions"><button type="button" data-pick="active">只看啟用</button><button type="button" data-pick="all">全選</button><button type="button" data-pick="none">清除</button></div>
        <div class="popover-list">${accounts.map((a) => `<label class="check-row"><input type="checkbox" value="${a.id}" ${sel.has(a.id) ? 'checked' : ''}>${swatch(a)}<span class="grow">${esc(a.name)}</span>${a.status !== 'active' ? '<span class="tag tag-muted">停用</span>' : ''}</label>`).join('')}</div>
      </div>`;
    const btn = $('.picker-btn', host); const pop = $('.popover', host);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = pop.hidden;
      $$('.popover').forEach((p) => { p.hidden = true; });
      pop.hidden = !willOpen;
      btn.setAttribute('aria-expanded', String(willOpen));
    });
    pop.addEventListener('click', (e) => e.stopPropagation());
    pop.addEventListener('change', () => onChange($$('input:checked', pop).map((i) => i.value)));
    $$('[data-pick]', pop).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.pick;
      onChange(k === 'all' ? accounts.map((a) => a.id) : k === 'active' ? activeIds : []);
    }));
  }

  // 多帳號合計（依 Sales 歸屬日）；avg 是各帳號每日平均 Sales 的加總（= 所選帳號合計每天大約賺多少）
  function sumWindow(ids, start, end) {
    let sales = 0; let has = false; let avg = 0; let hasAvg = false; let count = 0; let shipped = 0; let negatives = 0;
    ids.forEach((id) => {
      const st = Calc.windowStats(id, start, end);
      if (st.sales != null) { sales += st.sales; has = true; count += st.salesCount; }
      if (st.avg != null) { avg += st.avg; hasAvg = true; }
      shipped += st.shipped; negatives += st.negatives;
    });
    return { sales: has ? sales : null, avg: hasAvg ? avg : null, count, shipped, negatives };
  }

  // Sales 圖表用的日期範圍：預設模式下最新的 Sales 是昨天，所以「最近 N 天」往前挪一天
  function salesRange(range) {
    if (!salesPrev() || range.end !== D.todayISO()) return range;
    return { ...range, start: D.addDays(range.start, -1), end: D.addDays(range.end, -1) };
  }

  function kpiCard({ ic, tone, label, value, sub, tip, extra = '' }) {
    return `<article class="card kpi lift tone-${tone}">
      <div class="kpi-head"><span class="kpi-label">${label}</span>${tip ? hint(tip) : ''}<span class="kpi-icon">${icon(ic)}</span></div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-sub">${sub}</div>${extra}
    </article>`;
  }

  const tipHead = (iso) => `<div class="tip-head">${fmtDateWeek(iso)}</div>`;

  function renderDashboard(view) {
    if (!Store.accounts().length) { view.innerHTML = noAccountsState(); return; }
    const today = D.todayISO();
    $('#pageActions').innerHTML = `<a class="btn" href="#/analytics">${icon('analytics')}Sales 分析</a>
      <button type="button" class="btn btn-ship" data-action="ship">${icon('ship')}出貨</button>
      <button type="button" class="btn btn-primary" data-action="cf">${icon('coin')}CF Bal</button>`;
    view.innerHTML = `
      <section class="filterbar card-flat">
        <div class="seg" data-seg="dash-range" role="group" aria-label="日期範圍">
          ${[['7', '7 天'], ['30', '30 天'], ['90', '90 天'], ['custom', '自訂']].map(([v, l]) => `<button type="button" class="seg-btn ${ui.range === v ? 'active' : ''}" data-range="${v}" aria-pressed="${ui.range === v}">${l}</button>`).join('')}
        </div>
        <div class="custom-range" ${ui.range === 'custom' ? '' : 'hidden'}>
          <input type="date" class="input input-sm" data-custom="start" aria-label="開始日期" value="${esc(ui.customStart)}" max="${today}">
          <span>至</span>
          <input type="date" class="input input-sm" data-custom="end" aria-label="結束日期" value="${esc(ui.customEnd)}" max="${today}">
        </div>
        <div class="acct-picker" id="acctPicker"></div>
        <span class="filter-note" id="rangeNote"></span>
      </section>
      <div id="dashNotices"></div>
      <section class="kpi-grid" id="kpis"></section>
      <section class="dash-grid" id="dashBody"></section>`;

    $$('[data-range]', view).forEach((b) => b.addEventListener('click', () => {
      ui.range = b.dataset.range;
      if (ui.range === 'custom' && !(D.isISODate(ui.customStart) && D.isISODate(ui.customEnd))) {
        ui.customStart = D.addDays(today, -29); ui.customEnd = today;
      }
      saveUI(); render(false);
    }));
    $$('[data-custom]', view).forEach((inp) => inp.addEventListener('change', () => {
      const s = $('[data-custom="start"]', view).value; const e = $('[data-custom="end"]', view).value;
      if (!D.isISODate(s) || !D.isISODate(e)) return;
      if (s > e) { toast('開始日期不能晚於結束日期', 'error'); return; }
      if (D.daysBetween(s, e) > 3650) { toast('期間最多 10 年', 'error'); return; }
      ui.customStart = s; ui.customEnd = e; saveUI(); update(false, true);
    }));

    function update(pickerOpen, refresh) {
      Charts.cleanup();
      const ids = selectedDashAccounts();
      const range = dashRange();
      renderAcctPicker($('#acctPicker', view), ids, (next) => { ui.dashAccounts = next; saveUI(); update(true, true); }, pickerOpen);
      $('#rangeNote', view).textContent = range.label;

      // 提醒
      const notices = [installHint()].filter(Boolean);
      const pending = unrecordedToday();
      if (pending.length) {
        notices.push(`<div class="notice notice-info">${icon('calendar')}<div><b>今天還有 ${pending.length} 個帳號沒記 CF Bal</b><p>${pending.slice(0, 6).map((a) => esc(a.name)).join('、')}${pending.length > 6 ? ' 等' : ''}</p></div><button type="button" class="btn btn-sm" data-action="cf">${icon('coin')}記 CF Bal</button></div>`);
      }
      const last = Store.state.settings.lastBackupAt;
      const days = last ? D.daysBetween(D.toISO(new Date(last)), today) : null;
      if (Store.state.records.length && (days == null || days >= 7)) {
        notices.push(`<div class="notice notice-warn">${icon('shield')}<div><b>${days == null ? '還沒有下載過備份' : `已 ${days} 天沒有備份`}</b><p>資料只存在這個瀏覽器，清除瀏覽資料或換裝置就會看不到。建議每週下載一次備份檔。</p></div><button type="button" class="btn btn-sm" data-action="backup">下載備份</button></div>`);
      }
      $('#dashNotices', view).innerHTML = notices.join('');

      if (!ids.length) {
        $('#kpis', view).innerHTML = '';
        $('#dashBody', view).innerHTML = `<div class="span-3">${emptyState({ iconName: 'accounts', title: '請至少選擇一個帳號', text: '使用上方的帳號篩選來選擇要查看的帳號。' })}</div>`;
        return;
      }

      // ----- 摘要卡片 -----
      const latest = ids.map((id) => Calc.latestOnOrBefore(Calc.list(id), today)).filter(Boolean);
      const totalStock = latest.length ? latest.reduce((s, r) => s + r.balance, 0) : null;
      const lastDate = latest.reduce((m, r) => (r.date > m ? r.date : m), '');
      const noData = ids.length - latest.length;
      const lastSalesDay = salesDateFor(today);
      const dayW = sumWindow(ids, lastSalesDay, lastSalesDay);
      const recordedToday = ids.filter((id) => Store.recordFor(id, today)).length;
      const w7 = sumWindow(ids, D.addDays(lastSalesDay, -6), lastSalesDay);
      const w30 = sumWindow(ids, D.addDays(lastSalesDay, -29), lastSalesDay);
      const spark30 = Calc.totalStock(ids, D.eachDay(D.addDays(today, -29), today)).map((p) => p.value);
      const unit = `<small class="unit">${cur()}</small>`;
      const subText = (w) => `合計日均 ${fmtSigned(w.avg)} · 出貨 ${fmt(w.shipped)}`;
      const salesValue = (w, key) => (w.sales == null ? '<span class="muted">—</span>' : `<span class="${deltaClass(w.sales)}">${countSpan(w.sales, key, true)}</span> ${unit}`);

      $('#kpis', view).innerHTML = [
        kpiCard({
          ic: 'coin', tone: 'gold', label: 'Stock 庫存',
          value: `${countSpan(totalStock, 'k-stock')} ${totalStock == null ? '' : unit}`,
          sub: latest.length ? `${ids.length} 個帳號 · 最新 CF Bal ${relDays(lastDate)}${noData ? ` · ${noData} 個尚無記錄` : ''}` : '所選帳號尚無記錄',
          tip: '每個所選帳號最近一次的 CF Bal 加總。出貨會讓 Stock 變少。',
          extra: `<div class="kpi-spark">${Charts.sparkline(spark30, 'var(--primary)', 240, 34, true)}</div>`,
        }),
        kpiCard({
          ic: 'calendar', tone: 'blue', label: `${salesDayLabel()} Sales（${fmtDate(lastSalesDay).slice(5)}）`,
          value: salesValue(dayW, 'k-day'),
          sub: recordedToday ? `${recordedToday} / ${ids.length} 個帳號已記今天的 CF Bal · 出貨 ${fmt(dayW.shipped)}` : '今天還沒記 CF Bal · <a href="#/entry">前往錄入</a>',
          tip: `Sales = 今天 CF Bal − 上次 CF Bal ＋ 出貨，算在${salesPrev() ? '前一天' : '當天'}。出貨不會讓 Sales 變少；還沒記錄的帳號不計入。`,
        }),
        kpiCard({
          ic: 'week', tone: 'green', label: '近 7 日 Sales',
          value: salesValue(w7, 'k-w7'),
          sub: subText(w7),
          tip: '最近 7 天每天 Sales 的總和（Sales = CF Bal 變化 ＋ 出貨）。合計日均 = 各帳號（Sales ÷ 涵蓋天數）的加總。',
        }),
        kpiCard({
          ic: 'trend', tone: 'violet', label: '近 30 日 Sales',
          value: salesValue(w30, 'k-w30'),
          sub: subText(w30),
          tip: '最近 30 天每天 Sales 的總和，計算方式同近 7 日。',
        }),
      ].join('');

      // ----- 圖表與排行 -----
      const dates = D.eachDay(range.start, range.end);
      const sRange = salesRange(range);
      const sDates = D.eachDay(sRange.start, sRange.end);
      const stats = new Map(ids.map((id) => [id, Calc.windowStats(id, sRange.start, sRange.end)]));
      let earnIds = ids; let capNote = '';
      if (ids.length > 8) {
        earnIds = ids.slice().sort((a, b) => Math.abs(stats.get(b).sales || 0) - Math.abs(stats.get(a).sales || 0)).slice(0, 8);
        capNote = `<p class="card-note">${icon('info')}帳號較多，只顯示期間 Sales 最多的 8 個；其餘請用上方帳號篩選查看。</p>`;
      }

      $('#dashBody', view).innerHTML = `
        <article class="card span-2">
          <header class="card-head"><div><h3>每日 Stock 庫存</h3><p class="card-sub">所選 ${ids.length} 個帳號的 CF Bal 加總</p></div></header>
          <div id="stockChart"></div>
          <details class="calc-note"><summary>${icon('info')}計算方式</summary><p>每天把所選帳號「當天或之前最近一次」的 CF Bal 加總。某帳號當天沒記錄時沿用前一次的 CF Bal（游標提示會標示幾個帳號是沿用的）；還沒有任何記錄的帳號不計入，不會被當成 0。出貨會讓 Stock 下降，但不影響 Sales。</p></details>
        </article>
        <article class="card" id="rankCard"></article>
        <article class="card span-3">
          <header class="card-head">
            <div><h3>各帳號 Sales</h3><p class="card-sub">${ui.trendMode === 'daily' ? '每天賺多少（沒記錄的日子留白）' : '從期間第一天累計，方便比較誰賺得多'}</p></div>
            <div class="seg seg-sm" data-seg="dash-trend" role="group" aria-label="Sales 顯示方式">
              <button type="button" class="seg-btn ${ui.trendMode === 'daily' ? 'active' : ''}" data-trend="daily">每日 Sales</button>
              <button type="button" class="seg-btn ${ui.trendMode === 'cumulative' ? 'active' : ''}" data-trend="cumulative">累計 Sales</button>
            </div>
          </header>
          <div class="legend">${earnIds.map((id) => { const a = Store.account(id); return `<span class="legend-item">${swatch(a)}${esc(a.name)}</span>`; }).join('')}</div>
          <div id="earnChart"></div>
          ${capNote}
          <details class="calc-note"><summary>${icon('info')}計算方式</summary>
            <p><b>Sales</b> = 這次 CF Bal − 上次 CF Bal ＋ 這次記的出貨，算在${salesPrev() ? '記錄日的<b>前一天</b>（今天記的 = 昨天賺的）' : '記錄當天'}。出貨只會讓 Stock 變少，不會扣 Sales。</p>
            <p>沒有記錄的日子不畫點，不當成 0。如果和上次記錄相隔多天，那一點代表那幾天的合計，游標提示會標示「跨 N 天」。</p>
          </details>
        </article>
        <article class="card span-2" id="checkCard"></article>
        <article class="card" id="todayCard"></article>`;

      // 總庫存圖
      const stock = Calc.totalStock(ids, dates);
      Charts.lineChart($('#stockChart', view), {
        dates, height: 260, ariaLabel: '每日總庫存趨勢', smooth: true,
        series: [{ name: '總庫存', color: 'var(--primary)', values: stock.map((p) => p.value), area: true }],
        emptyText: '此期間所選帳號沒有任何記錄',
        tooltip: (i) => {
          const p = stock[i];
          if (p.value == null) return tipHead(dates[i]) + '<div class="tip-note">尚無記錄</div>';
          const notes = [`${p.exact} 個帳號當天有記錄`];
          if (p.carried) notes.push(`${p.carried} 個沿用上次 CF Bal`);
          if (ids.length - p.have) notes.push(`${ids.length - p.have} 個尚無資料（不計入）`);
          return `${tipHead(dates[i])}<div class="tip-row"><span>總庫存</span><b>${fmt(p.value)}</b></div><div class="tip-note">${notes.join('，')}</div>`;
        },
      });

      // 各帳號 Sales 圖（依 Sales 歸屬日）
      const isDaily = ui.trendMode === 'daily';
      const earnSeries = earnIds.map((id) => {
        const a = Store.account(id);
        if (isDaily) {
          const infos = Calc.dailySales(id, sDates);
          return { name: a.name, color: color(a), values: infos.map((x) => (x ? x.sales : null)), infos };
        }
        return { name: a.name, color: color(a), values: Calc.cumulativeSales(id, sDates) };
      });
      Charts.lineChart($('#earnChart', view), {
        dates: sDates, height: 280, includeZero: true, dots: isDaily, smooth: true, ariaLabel: '各帳號 Sales',
        series: earnSeries,
        emptyText: '此期間還算不出 Sales（每個帳號至少要記兩次 CF Bal）',
        tooltip: (i) => {
          const rows = earnSeries.filter((s) => s.values[i] != null).sort((a, b) => b.values[i] - a.values[i]);
          if (!rows.length) return tipHead(sDates[i]) + `<div class="tip-note">${isDaily ? '這天沒有 Sales 資料' : '尚無資料'}</div>`;
          return tipHead(sDates[i]) + rows.map((s) => {
            const x = s.infos && s.infos[i];
            const notes = [x && x.gap > 1 ? `跨 ${x.gap} 天` : '', x && x.shipped ? `出貨 ${fmt(x.shipped)}` : ''].filter(Boolean).map((t) => `<small>${t}</small>`).join('');
            return `<div class="tip-row"><span><i class="swatch" style="background:${s.color}"></i>${esc(s.name)}${notes}</span><b class="${deltaClass(s.values[i])}">${fmtSigned(s.values[i])}</b></div>`;
          }).join('');
        },
      });
      $$('[data-trend]', view).forEach((b) => b.addEventListener('click', () => { ui.trendMode = b.dataset.trend; saveUI(); update(false, true); }));

      renderRanking($('#rankCard', view), ids, stats, sRange, () => update(false, true));
      renderChecks($('#checkCard', view), ids, sRange);
      renderTodayCard($('#todayCard', view));

      // 篩選變更後：數字從舊值跑到新值、分段底色滑過去
      if (refresh) {
        $$('#kpis > *, #dashBody > *', view).forEach((el) => { el.classList.remove('soft-in'); el.getBoundingClientRect(); el.classList.add('soft-in'); });
        enhance(view);
      }
    }

    update();
  }

  /* ================= CF Bal／出貨 小視窗（總覽的兩個按鈕） ================= */
  function acctChips(accounts, selected, doneFn) {
    return `<fieldset class="acct-chips"><legend class="sr-only">帳號</legend>${accounts.map((a) => `
      <label class="acct-chip" style="--c:${color(a)}"><input type="radio" name="accountId" value="${a.id}" ${a.id === selected ? 'checked' : ''}>
        ${swatch(a)}<span>${esc(a.name)}</span>${doneFn && doneFn(a) ? `<span class="chip-done" title="這天已記錄">${icon('check', 'icon-xs')}</span>` : ''}</label>`).join('')}</fieldset>`;
  }
  const activeAccounts = () => Store.accounts().filter((a) => a.status === 'active');
  const sumShips = (list) => list.reduce((t, s) => t + s.amount, 0);

  // 只填 CF Bal：選帳號 → 打數字 → 儲存（出貨、備註維持原本的）
  function openCfModal({ accountId = '', date = '' } = {}) {
    const accts = activeAccounts();
    if (!accts.length) { toast('請先新增帳號', 'info'); location.hash = '#/accounts'; return; }
    const today = D.todayISO();
    const d0 = date || today;
    const pick = accountId || (accts.find((a) => !Store.recordFor(a.id, d0)) || accts[0]).id;
    const body = `<form class="form" id="cfForm" novalidate>
      <div id="cf-chips">${acctChips(accts, pick, (a) => Store.recordFor(a.id, d0))}</div>
      <div class="field"><label for="cf-bal">CF Bal</label>
        <input id="cf-bal" name="balance" class="input input-xl num" inputmode="numeric" autocomplete="off" enterkeyhint="done" data-autofocus>
        <span class="field-hint" id="cf-hint"></span><span class="field-error"></span></div>
      <div class="calc-box" id="cf-calc" aria-live="polite"></div>
      <div class="field field-inline"><label for="cf-date">日期</label><input type="date" id="cf-date" name="date" class="input input-sm" value="${d0}" max="${today}"><span class="field-error"></span></div>
    </form>`;
    const footer = `<button type="button" class="btn" data-save-next>儲存，下一個帳號</button><span class="grow"></span><button type="button" class="btn btn-primary" data-save>${icon('check')}儲存</button>`;
    const m = openModal({ title: '記 CF Bal', body, footer, size: 'modal-sm' });
    const form = $('#cfForm', m.el);
    const inp = form.balance;
    const aid = () => { const c = form.querySelector('[name="accountId"]:checked'); return c ? c.value : ''; };
    let loadedFor = '';

    function refresh() {
      const a = aid(); const date = D.normalizeDate(form.date.value);
      if (!a || !date) return;
      const existing = Store.recordFor(a, date);
      // 換帳號或日期時，帶入那天已記的 CF Bal
      if (loadedFor !== a + '|' + date) { loadedFor = a + '|' + date; inp.value = existing ? fmtFull(existing.balance) : ''; }
      const prev = Calc.latestBefore(Calc.list(a), date);
      inp.placeholder = prev ? fmtFull(prev.balance) : '例如 12,345';
      $('#cf-hint', m.el).innerHTML = existing ? `這天已記過 <b>${fmt(existing.balance)}</b>，儲存會更新` : prev ? `上次 ${fmt(prev.balance)}（${fmtDate(prev.date)}）` : '這個帳號的第一筆';
      const ships = Calc.shipmentsFor(a, date);
      const shipped = sumShips(ships) + (existing && existing.shipped ? existing.shipped : 0);
      const bal = parseAmount(inp.value);
      const f = inp.closest('.field');
      f.classList.toggle('has-error', !!bal.error); $('.field-error', f).textContent = bal.error || '';
      const calc = $('#cf-calc', m.el);
      if (!prev || bal.error || bal.value == null) { calc.innerHTML = ''; return; }
      const net = bal.value - prev.balance;
      const sales = net + shipped;
      calc.innerHTML = `<div class="calc-line"><span>Stock 變化</span><b>${delta(net)}</b></div>
        <div class="calc-line"><span>出貨</span><b>${fmt(shipped)}</b>${ships.length ? `<small>${ships.length} 筆出貨記錄</small>` : ''}</div>
        <div class="calc-line"><span>Sales</span><b class="sales-big">${delta(sales)}</b><small>算在 ${fmtDate(salesDateFor(date))}</small></div>
        ${sales < 0 ? `<div class="calc-status warn">${icon('alert')}<span>Sales 是負數：是不是出貨忘了記？可以照樣儲存，之後補記出貨會自動更正。</span></div>` : ''}`;
    }

    function save(next) {
      const a = aid(); const date = form.date.value;
      const existing = Store.recordFor(a, D.normalizeDate(date) || '');
      try {
        const res = Store.saveRecord({ date, accountId: a, balance: inp.value, shipped: existing ? existing.shipped : null, note: existing ? existing.note : '' });
        toast(`${res.mode === 'created' ? '已記錄' : '已更新'}：${Store.account(a).name} CF Bal ${fmt(res.record.balance)}`);
        if (!next) { m.close(); return; }
        const d = res.record.date;
        $('#cf-chips', m.el).innerHTML = acctChips(accts, a, (x) => Store.recordFor(x.id, d));
        const i = accts.findIndex((x) => x.id === a);
        const after = accts.slice(i + 1).concat(accts.slice(0, i + 1));
        const nextAcc = after.find((x) => !Store.recordFor(x.id, d));
        if (!nextAcc) { toast('這天所有帳號都記好了', 'info'); m.close(); return; }
        form.querySelector(`[name="accountId"][value="${nextAcc.id}"]`).checked = true;
        refresh(); inp.focus();
      } catch (e) {
        if (e.fieldErrors) setFieldErrors(form, e.fieldErrors); else toast(e.message, 'error');
      }
    }
    form.addEventListener('input', refresh);
    form.addEventListener('change', (e) => { refresh(); if (e.target.name === 'accountId') inp.focus(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(false); } });
    $('[data-save]', m.el).addEventListener('click', () => save(false));
    $('[data-save-next]', m.el).addEventListener('click', () => save(true));
    refresh();
  }

  // 只記出貨：選帳號 → 打數量 → 儲存。出貨會加回 Sales，不會算成少賺
  function openShipModal({ accountId = '', date = '' } = {}) {
    const accts = activeAccounts();
    if (!accts.length) { toast('請先新增帳號', 'info'); location.hash = '#/accounts'; return; }
    const today = D.todayISO();
    const pick = accountId || (Store.account(ui.lastShipAccount) && Store.account(ui.lastShipAccount).status === 'active' ? ui.lastShipAccount : accts[0].id);
    const body = `<form class="form" id="shipForm" novalidate>
      ${acctChips(accts, pick)}
      <div class="field"><label for="sh-amt">出貨數量</label>
        <input id="sh-amt" name="amount" class="input input-xl num" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="例如 30,000" data-autofocus>
        <span class="field-error"></span></div>
      <div class="form-row">
        <div class="field"><label for="sh-note">備註</label><input id="sh-note" name="note" class="input" maxlength="200" placeholder="選填，例如客人名字"><span class="field-error"></span></div>
        <div class="field"><label for="sh-date">日期</label><input type="date" id="sh-date" name="date" class="input" value="${date || today}" max="${today}"><span class="field-error"></span></div>
      </div>
      <p class="help" id="sh-help"></p>
      <div id="sh-list"></div>
    </form>`;
    const footer = `<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-primary" data-save>${icon('check')}儲存出貨</button>`;
    const m = openModal({ title: '記出貨', body, footer, size: 'modal-sm' });
    const form = $('#shipForm', m.el);
    const aid = () => { const c = form.querySelector('[name="accountId"]:checked'); return c ? c.value : ''; };

    function refresh() {
      const a = aid(); const date = D.normalizeDate(form.date.value);
      if (!a || !date) return;
      // 這筆出貨會算進哪一次 CF Bal（已經有就直接算，沒有就等下一次記 CF Bal）
      const recs = Calc.list(a);
      const target = salesPrev() ? recs.find((r) => r.date > date) : recs.find((r) => r.date >= date);
      $('#sh-help', m.el).innerHTML = `${icon('info')}<span>出貨只會讓 Stock 變少，<b>不扣 Sales</b>。${target
        ? `這筆會加回 <b>${fmtDate(salesDateFor(target.date))}</b> 的 Sales。`
        : `記下一次 CF Bal 時會自動加回 Sales（算在 <b>${fmtDate(date)}</b>）。`}</span>`;
      const pend = new Set(Calc.pendingShipments(a).map((s) => s.id));
      const list = Calc.shipments(a).slice().reverse();
      $('#sh-list', m.el).innerHTML = list.length ? `<div class="ship-list-head"><b>最近出貨</b><small>${esc(Store.account(a).name)} · 共 ${list.length} 筆</small></div>
        <ul class="ship-list">${list.slice(0, 8).map((s) => `<li>
          <span class="ship-date">${fmtDate(s.date)}</span>
          <span class="ship-amt">${fmt(s.amount)}</span>
          <span class="ship-note">${esc(s.note)}${pend.has(s.id) ? '<span class="tag tag-muted">待算進 Sales</span>' : ''}</span>
          <button type="button" class="icon-btn danger" data-del-ship="${s.id}" aria-label="刪除這筆出貨" title="刪除">${icon('trash')}</button></li>`).join('')}</ul>` : '';
      $$('[data-del-ship]', m.el).forEach((b) => b.addEventListener('click', async () => {
        const s = Store.state.shipments.find((x) => x.id === b.dataset.delShip);
        if (!s) return;
        const ok = await confirmDialog({ title: '刪除出貨', message: `確定刪除 ${esc(Store.account(s.accountId).name)} ${fmtDate(s.date)} 的出貨 <b>${fmt(s.amount)}</b>？`, confirmText: '刪除', danger: true });
        if (!ok) return;
        safely(() => { Store.deleteShipment(s.id); toast('已刪除出貨'); });
        refresh();
      }));
    }

    function save() {
      try {
        const s = Store.addShipment({ accountId: aid(), date: form.date.value, amount: form.amount.value, note: form.note.value });
        ui.lastShipAccount = s.accountId; saveUI();
        toast(`已記出貨：${Store.account(s.accountId).name} ${fmt(s.amount)}`);
        m.close();
      } catch (e) {
        if (e.fieldErrors) setFieldErrors(form, e.fieldErrors); else toast(e.message, 'error');
      }
    }
    form.addEventListener('change', (e) => { refresh(); if (e.target.name === 'accountId') form.amount.focus(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    form.amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    $('[data-save]', m.el).addEventListener('click', save);
    refresh();
  }

  const RANK_METRICS = {
    sales: { label: '總 Sales', desc: '期間內每天 Sales 的總和（Sales = CF Bal 變化 ＋ 出貨）。' },
    avg: { label: '每日平均', desc: '總 Sales ÷ 涵蓋天數。記錄天數不同的帳號，用這個比較較公平。' },
    shipped: { label: '出貨', desc: '期間內出貨的總和。出貨會讓 Stock 變少，但不影響 Sales。' },
  };

  function renderRanking(card, ids, stats, range, rerender) {
    const metric = RANK_METRICS[ui.rankMetric] ? ui.rankMetric : 'sales';
    const val = (st) => (metric === 'sales' ? st.sales : metric === 'avg' ? st.avg : (st.shippedCount ? st.shipped : null));
    const rows = ids.map((id) => ({ a: Store.account(id), st: stats.get(id) }));
    const ranked = rows.filter((r) => val(r.st) != null).sort((x, y) => val(y.st) - val(x.st));
    const missing = rows.filter((r) => val(r.st) == null);
    const maxAbs = Math.max(1, ...ranked.map((r) => Math.abs(val(r.st))));
    const hasNeg = ranked.some((r) => val(r.st) < 0);
    const bar = (v, c, k) => {
      const pct = (Math.abs(v) / maxAbs) * (hasNeg ? 50 : 100);
      const left = hasNeg ? (v >= 0 ? 50 : 50 - pct) : 0;
      const origin = hasNeg && v < 0 ? 'right' : 'left';
      return `<div class="rank-bar ${hasNeg ? 'has-mid' : ''}"><span style="left:${left}%;width:${Math.max(pct, 0.8)}%;background:${c};transform-origin:${origin};--i:${k}"></span></div>`;
    };
    card.innerHTML = `
      <header class="card-head"><div><h3>帳號 Sales 排行</h3><p class="card-sub">${fmtDate(range.start)} – ${fmtDate(range.end)}</p></div></header>
      <div class="seg seg-sm seg-block" data-seg="dash-rank" role="group" aria-label="排名指標">
        ${Object.keys(RANK_METRICS).map((k) => `<button type="button" class="seg-btn ${metric === k ? 'active' : ''}" data-metric="${k}">${RANK_METRICS[k].label}</button>`).join('')}
      </div>
      <p class="metric-desc">${icon('info')}<span>排名依據：<b>${RANK_METRICS[metric].label}</b>。${RANK_METRICS[metric].desc}</span></p>
      ${ranked.length ? `<ol class="rank-list">${ranked.map((r, k) => {
        const v = val(r.st);
        const badge = ranked.length > 1 && k === 0 ? '<span class="tag tag-top">最高</span>' : ranked.length > 1 && k === ranked.length - 1 ? '<span class="tag tag-low">最低</span>' : '';
        return `<li class="rank-row">
          <span class="rank-no">${k + 1}</span>
          <div class="rank-main">
            <div class="rank-top">${swatch(r.a)}<span class="rank-name">${esc(r.a.name)}</span>${badge}<span class="grow"></span>${metric === 'shipped' ? `<span class="delta">${fmt(v)}</span>` : delta(v, metric === 'avg' ? ' /日' : '')}</div>
            ${bar(v, color(r.a), k)}
            <div class="rank-sub">記錄 ${r.st.days} 天 · 涵蓋 ${r.st.covered} 天${metric !== 'shipped' && r.st.shipped ? ` · 出貨 ${fmt(r.st.shipped)}` : ''}${r.st.negatives ? ` · <span class="warn-text">${r.st.negatives} 筆 Sales 是負數</span>` : ''}</div>
          </div>
        </li>`;
      }).join('')}</ol>` : '<div class="mini-empty">此期間沒有可比較的資料</div>'}
      ${missing.length ? `<p class="rank-missing">資料不足（不列入排名）：${missing.map((r) => esc(r.a.name)).join('、')}</p>` : ''}`;
    $$('[data-metric]', card).forEach((b) => b.addEventListener('click', () => { ui.rankMetric = b.dataset.metric; saveUI(); rerender(); }));
  }

  function renderChecks(card, ids, range) {
    const d = Store.derived();
    const idSet = new Set(ids);
    const list = Store.state.records
      .map((r) => d.byId.get(r.id))
      .filter((x) => x && idSet.has(x.record.accountId) && x.salesDate >= range.start && x.salesDate <= range.end && x.negative)
      .sort((a, b) => (a.record.date < b.record.date ? 1 : -1));
    card.innerHTML = `
      <header class="card-head"><div><h3>需要檢查的記錄</h3><p class="card-sub">Sales 是負數：CF Bal 少掉的比出貨還多</p></div>
        ${list.length ? `<a class="btn btn-sm btn-ghost" href="#/records?negative=1">查看全部 ${list.length} 筆</a>` : ''}</header>
      ${list.length ? `<p class="metric-desc">${icon('info')}<span>常見原因：出貨忘了填、CF Bal 打錯，或在遊戲裡花掉了。點一下可以直接修改；系統不會自動改你的數字。</span></p>
        <ul class="check-list">${list.slice(0, 6).map((x) => {
          const a = Store.account(x.record.accountId);
          return `<li><button type="button" class="check-item" data-edit-record="${x.record.id}">
            <span class="check-icon is-warn">${icon('alert')}</span>
            <span class="check-main"><b>${esc(a.name)} · ${fmtDate(x.record.date)} 記錄</b>
              <small>CF Bal 變化 ${fmtSigned(x.net)}，出貨 ${fmt(x.shipped)}${x.gap > 1 ? `，跨 ${x.gap} 天` : ''}</small></span>
            <span class="check-diff neg">Sales ${fmtSigned(x.sales)}</span>
          </button></li>`;
        }).join('')}</ul>` : `<div class="mini-empty ok">${icon('check')}此期間沒有負數的 Sales</div>`}`;
  }

  function renderTodayCard(card) {
    const today = D.todayISO();
    const accts = Store.accounts().filter((a) => a.status === 'active');
    const done = accts.filter((a) => Store.recordFor(a.id, today)).length;
    card.innerHTML = `
      <header class="card-head"><div><h3>今日錄入狀態</h3><p class="card-sub">${done} / ${accts.length} 個啟用帳號已記錄</p></div></header>
      <div class="progress"><span style="width:${accts.length ? (done / accts.length) * 100 : 0}%"></span></div>
      <ul class="today-list">${accts.map((a) => {
        const r = Store.recordFor(a.id, today);
        const x = r && Calc.info(r.id);
        return `<li>${swatch(a)}<span class="grow">${esc(a.name)}</span>${r ? `<span class="today-val" title="CF Bal ${fmt(r.balance)}">${x && x.sales != null ? `Sales ${fmtSigned(x.sales)}` : `CF ${fmt(r.balance)}`}</span><span class="tag tag-ok">${icon('check', 'icon-xs')}已記錄</span>` : '<span class="tag tag-muted">未記錄</span>'}</li>`;
      }).join('') || '<li class="muted">沒有啟用中的帳號</li>'}</ul>
      <a class="btn btn-primary btn-block" href="#/entry">${icon('entry')}前往每日錄入</a>`;
  }

  /* ================= Sales 分析 ================= */
  const AN_METRICS = {
    sales: { label: '總 Sales', icon: 'trendUp', tone: '#23955a', signed: true, desc: 'Sales = CF Bal 變化 ＋ 出貨，期間內每天加總' },
    avg: { label: '每日平均 Sales', icon: 'week', tone: '#2f6fd0', signed: true, desc: '各帳號「Sales ÷ 涵蓋天數」的加總，約等於所有帳號每天一共賺多少' },
    shipped: { label: '總出貨', icon: 'upload', tone: '#1d8a7b', desc: '期間內出貨的總和（出貨讓 Stock 變少，但不扣 Sales）' },
    stock: { label: '期末 Stock', icon: 'coin', tone: '#d0921a', desc: '期間最後一天，各帳號最近一次 CF Bal 的加總' },
    stockChange: { label: 'Stock 變化', icon: 'trend', tone: '#d34b63', signed: true, desc: 'CF Bal 增減的總和（= Sales − 出貨）' },
    completion: { label: '記錄完成率', icon: 'check', tone: '#6a58d8', percent: true, desc: '實際記錄筆數 ÷（帳號數 × 天數）' },
  };

  function anRange() {
    const today = D.todayISO();
    let r;
    if (ui.anRange === 'ytd') r = { start: today.slice(0, 4) + '-01-01', end: today, label: '今年至今' };
    else {
      const n = Number(ui.anRange) || 30;
      r = { start: D.addDays(today, -(n - 1)), end: today, label: `最近 ${n} 天` };
    }
    // 預設模式下最新的 Sales 是昨天，整個區間往前挪一天
    return salesRange(r);
  }

  // 依日期彙整所選帳號的每日數值（沒有記錄的日子保持 null）
  //   sales／shipped／net 依 Sales 歸屬日；記錄筆數依記錄日；stock 依當天最近一次 CF Bal
  function anCollect(ids, start, end) {
    const dates = D.eachDay(start, end);
    const n = dates.length;
    const idx = new Map(dates.map((x, i) => [x, i]));
    const d = Store.derived();
    const sales = new Array(n).fill(null); const shipped = new Array(n).fill(null); const net = new Array(n).fill(null); const rec = new Array(n).fill(0);
    ids.forEach((id) => Calc.list(id).forEach((r) => {
      const x = d.byId.get(r.id);
      const si = idx.get(x.salesDate);
      if (si != null) {
        if (x.sales != null) sales[si] = (sales[si] || 0) + x.sales;
        if (x.net != null) net[si] = (net[si] || 0) + x.net;
        shipped[si] = (shipped[si] || 0) + x.shipped;
      }
      const ri = idx.get(r.date);
      if (ri != null) rec[ri]++;
    }));
    const stock = Calc.totalStock(ids, dates).map((p) => p.value);
    const sum = (arr) => { let s = 0; let has = false; arr.forEach((v) => { if (v != null) { s += v; has = true; } }); return has ? s : null; };
    const lastStock = stock.slice().reverse().find((v) => v != null);
    const recTotal = rec.reduce((a, b) => a + b, 0);
    return {
      dates, sales, shipped, net, stock, rec, ids,
      totals: {
        sales: sum(sales), shipped: sum(shipped), stockChange: sum(net),
        stock: lastStock == null ? null : lastStock,
        avg: sumWindow(ids, start, end).avg,
        completion: ids.length && n ? (recTotal / (ids.length * n)) * 100 : null,
      },
    };
  }
  const AN_SERIES = { sales: 'sales', shipped: 'shipped', stockChange: 'net' };

  function anBucketKey(iso, bucket) {
    if (bucket === 'month') return iso.slice(0, 7);
    if (bucket === 'week') { const dow = (D.parseISO(iso).getDay() + 6) % 7; return D.addDays(iso, -dow); }
    return iso;
  }

  function anBucketize(data, metric, bucket) {
    const keys = []; const groups = new Map();
    data.dates.forEach((iso, i) => {
      const k = anBucketKey(iso, bucket);
      if (!groups.has(k)) { groups.set(k, []); keys.push(k); }
      groups.get(k).push(i);
    });
    const values = keys.map((k) => {
      const ix = groups.get(k);
      const pick = (arr) => ix.map((i) => arr[i]).filter((v) => v != null);
      if (metric === 'stock') { const v = pick(data.stock); return v.length ? v[v.length - 1] : null; }
      if (metric === 'completion') return data.ids.length ? (ix.reduce((s, i) => s + data.rec[i], 0) / (data.ids.length * ix.length)) * 100 : null;
      if (metric === 'avg') { const v = pick(data.sales); return v.length ? v.reduce((a, b) => a + b, 0) / ix.length : null; }
      const v = pick(data[AN_SERIES[metric]]);
      return v.length ? v.reduce((a, b) => a + b, 0) : null;
    });
    return { keys, values, groups };
  }

  const anFmt = (metric, v) => {
    if (v == null) return '—';
    if (AN_METRICS[metric].percent) return `${Math.round(v)}%`;
    return AN_METRICS[metric].signed ? fmtSigned(v) : fmt(v);
  };

  function pctBadge(metric, cur, prev) {
    const m = AN_METRICS[metric];
    if (cur == null || prev == null) return '<span class="pct muted">— 前一期無資料</span>';
    let change; let text;
    if (m.percent) { change = cur - prev; text = `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(0)} 點`; }
    else { if (prev === 0) return '<span class="pct muted">— 前一期為 0</span>'; change = ((cur - prev) / Math.abs(prev)) * 100; text = `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}%`; }
    const good = m.lowerIsBetter ? change < 0 : change > 0;
    const cls = Math.abs(change) < 0.05 ? 'zero' : good ? 'pos' : 'neg';
    return `<span class="pct ${cls}">${icon(change >= 0 ? 'trendUp' : 'trendDown')}${text}</span>`;
  }

  function renderAnalytics(view) {
    if (!Store.accounts().length) { view.innerHTML = noAccountsState(); return; }
    const range = anRange();
    const metric = AN_METRICS[ui.anMetric] ? ui.anMetric : 'sales';
    const bucket = ['day', 'week', 'month'].includes(ui.anBucket) ? ui.anBucket : 'day';
    const active = Store.accounts().filter((a) => a.status === 'active');
    const chipAccounts = Store.accounts().filter((a) => a.status === 'active' || a.id === ui.anAccount);
    if (ui.anAccount !== 'all' && !Store.account(ui.anAccount)) ui.anAccount = 'all';
    const ids = ui.anAccount === 'all' ? active.map((a) => a.id) : [ui.anAccount];
    const days = D.daysBetween(range.start, range.end) + 1;
    const prevEnd = D.addDays(range.start, -1); const prevStart = D.addDays(prevEnd, -(days - 1));
    const cur = anCollect(ids, range.start, range.end);
    const prev = anCollect(ids, prevStart, prevEnd);

    // 頁首右側：期間與匯出
    $('#pageActions').innerHTML = `
      <div class="seg" data-seg="an-range" role="group" aria-label="期間">
        ${[['7', '7 天'], ['30', '30 天'], ['90', '90 天'], ['ytd', '今年']].map(([v, l]) => `<button type="button" class="seg-btn ${ui.anRange === v ? 'active' : ''}" data-an-range="${v}">${l}</button>`).join('')}
      </div>
      <button type="button" class="btn btn-outline-primary" id="anExport">${icon('download')}匯出 CSV</button>`;

    const tiles = Object.keys(AN_METRICS).map((k) => {
      const m = AN_METRICS[k];
      const v = cur.totals[k];
      const daily = anBucketize(cur, k, 'day').values;
      const valueHTML = v == null ? '—' : m.percent ? `${Math.round(v)}%` : countSpan(v, `an-${k}`, !!m.signed);
      return `<button type="button" class="an-tile ${k === metric ? 'active' : ''}" data-an-metric="${k}" style="--tone:${m.tone}" aria-pressed="${k === metric}" title="${esc(m.desc)}">
        <span class="an-tile-head"><span class="an-tile-icon">${icon(m.icon)}</span>${m.label}</span>
        <span class="an-tile-value ${m.signed ? deltaClass(v) : ''}">${valueHTML}</span>
        <span class="an-tile-foot">${pctBadge(k, v, prev.totals[k])}${Charts.sparkline(daily, m.tone, 64, 24)}</span>
      </button>`;
    }).join('');

    const curB = anBucketize(cur, metric, bucket);
    const prevB = anBucketize(prev, metric, bucket);
    const prevAligned = curB.keys.map((_, i) => (i < prevB.values.length ? prevB.values[i] : null));
    const m = AN_METRICS[metric];
    const bucketName = { day: '每日', week: '每週', month: '每月' }[bucket];
    const labelFmt = (k) => (bucket === 'month' ? `${+k.slice(5, 7)}月` : bucket === 'week' ? `${Charts.shortDate(k)}週` : Charts.shortDate(k));
    const tipLabel = (k) => (bucket === 'month' ? `${k.slice(0, 4)} 年 ${+k.slice(5, 7)} 月` : bucket === 'week' ? `${fmtDate(k)} 起一週` : fmtDateWeek(k));

    // 最佳／最高一天
    const dailyCur = anBucketize(cur, metric, 'day');
    let best = null;
    if (metric !== 'completion') {
      dailyCur.values.forEach((v, i) => { if (v != null && (!best || v > best.v)) best = { v, k: dailyCur.keys[i] }; });
    }
    const bestLabel = { sales: 'Sales 最高的一天', avg: 'Sales 最高的一天', shipped: '出貨最多的一天', stock: 'Stock 最高的一天', stockChange: 'Stock 增加最多的一天' }[metric];

    // 本月 Sales 目標
    const lastSalesDay = salesDateFor(D.todayISO());
    const monthStart = lastSalesDay.slice(0, 8) + '01';
    const monthNet = anCollect(ids, monthStart, lastSalesDay).totals.sales;
    const goal = Store.state.settings.monthlyGoal;
    const goalPct = goal && monthNet != null ? Math.max(0, Math.min(100, (monthNet / goal) * 100)) : 0;

    const chipHTML = `<button type="button" class="chip ${ui.anAccount === 'all' ? 'active' : ''}" data-an-acct="all">全部啟用帳號<span class="chip-count">${active.length}</span></button>`
      + chipAccounts.map((a) => `<button type="button" class="chip ${ui.anAccount === a.id ? 'active' : ''}" data-an-acct="${a.id}">${swatch(a)}${esc(a.name)}</button>`).join('');

    // Sales 來源（期間 Sales，依帳號）與 Stock 分布：一律看全部啟用帳號
    const shares = active.map((a) => { const st = Calc.windowStats(a.id, range.start, range.end); return { a, v: st.sales, ship: st.shipped }; }).sort((x, y) => (y.v || 0) - (x.v || 0));
    const positive = shares.filter((s) => s.v > 0);
    const posTotal = positive.reduce((s, x) => s + x.v, 0);
    const stocks = active.map((a) => { const r = Calc.latestOnOrBefore(Calc.list(a.id), D.todayISO()); return { a, v: r ? r.balance : null }; });
    const maxStock = Math.max(1, ...stocks.map((s) => s.v || 0));
    const stockTotal = stocks.reduce((s, x) => s + (x.v || 0), 0);
    const topStock = stocks.slice().sort((x, y) => (y.v || 0) - (x.v || 0))[0];

    view.innerHTML = `
      <section class="an-tiles" role="group" aria-label="選擇指標">${tiles}</section>
      <article class="card">
        <div class="an-main-head">
          <div><h3 class="card-title-lg">${m.label}</h3><p class="card-sub">${range.label}（${fmtDate(range.start)} – ${fmtDate(range.end)}）· ${bucketName} · ${esc(m.desc)}</p></div>
          <div class="an-controls">
            <div class="seg seg-sm" data-seg="an-bucket" role="group" aria-label="彙整單位">
              ${[['day', '日'], ['week', '週'], ['month', '月']].map(([v, l]) => `<button type="button" class="seg-btn ${bucket === v ? 'active' : ''}" data-an-bucket="${v}">${l}</button>`).join('')}
            </div>
            <label class="switch"><input type="checkbox" id="anCompare" ${ui.anCompare ? 'checked' : ''}><span class="switch-track"></span>比較前一期</label>
          </div>
        </div>
        <div class="an-chiprow">${chipHTML}<span class="grow"></span>
          <span class="legend"><span class="legend-item"><span class="swatch" style="background:var(--primary)"></span>${range.label}</span>${ui.anCompare ? '<span class="legend-item"><span class="legend-dash"></span>前一期</span>' : ''}</span>
        </div>
        <div id="anChart"></div>
        <div class="an-foot">
          <span>${range.label}${m.label} <b>${anFmt(metric, cur.totals[metric])}</b>，較前一期 ${pctBadge(metric, cur.totals[metric], prev.totals[metric])}</span>
          ${best ? `<span>${bestLabel}：<b>${fmtDate(best.k)}</b>（${anFmt(metric, best.v)}）</span>` : ''}
          <div class="goal">
            ${goal ? `<span>本月 Sales <b>${fmtSigned(monthNet)}</b> / 目標 <b>${fmt(goal)}</b></span><div class="goal-bar" role="progressbar" aria-valuenow="${Math.round(goalPct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${goalPct}%"></span></div>` : '<span class="muted">還沒有設定每月 Sales 目標</span>'}
            <button type="button" class="btn btn-sm" id="anGoal">${icon('target')}${goal ? '調整目標' : '設定目標'}</button>
          </div>
        </div>
      </article>
      <section class="an-bottom">
        <article class="card lift">
          <header class="card-head"><div><h3>Sales 來源</h3><p class="card-sub">${range.label}各帳號 Sales 占比（只計入有賺的帳號），旁邊附出貨量</p></div></header>
          ${positive.length ? `<div class="donut-wrap">
            <div class="donut-box">${Charts.donut(positive.map((s) => ({ value: s.v, color: color(s.a) })))}
              <div class="donut-center"><b>${countSpan(posTotal, 'an-donut', true)}</b><small>期間總 Sales</small></div></div>
            <ul class="share-list">${shares.map((s, k) => `<li style="--i:${k}" title="出貨 ${fmt(s.ship)}">${swatch(s.a)}<span class="name">${esc(s.a.name)}</span><span class="val ${deltaClass(s.v)}">${fmtSigned(s.v)}</span><span class="share">${s.v > 0 ? Math.round((s.v / posTotal) * 100) + '%' : '—'}</span></li>`).join('')}</ul>
          </div>` : '<div class="mini-empty">此期間還沒有 Sales 資料</div>'}
        </article>
        <article class="card lift">
          <header class="card-head"><div><h3>Stock 分布</h3><p class="card-sub">各帳號目前的 CF Bal</p></div></header>
          <div class="vbars">${stocks.map((s, k) => `<div class="vbar" title="${esc(s.a.name)}：${fmt(s.v)}">
            <span class="vbar-val">${s.v == null ? '—' : Charts.compact(s.v)}</span>
            <div class="vbar-track"><div class="vbar-fill" style="height:${s.v ? Math.max(3, (s.v / maxStock) * 100) : 0}%;background:${color(s.a)};--i:${k}"></div></div>
            <span class="vbar-name">${esc(s.a.name)}</span></div>`).join('')}</div>
          ${topStock && topStock.v ? `<p class="card-note"><b>${esc(topStock.a.name)}</b>&nbsp;持有最多：${fmt(topStock.v)}（占 ${Math.round((topStock.v / stockTotal) * 100)}%）</p>` : ''}
        </article>
      </section>`;

    Charts.lineChart($('#anChart', view), {
      labels: curB.keys, height: 320, smooth: true, includeZero: metric !== 'stock', dots: bucket !== 'day',
      labelFormat: labelFmt, ariaLabel: `${m.label}趨勢`,
      axisFormat: m.percent ? (v) => `${v}%` : undefined,
      series: [
        ...(ui.anCompare ? [{ name: '前一期', color: 'var(--muted)', values: prevAligned, dashed: true }] : []),
        { name: m.label, color: 'var(--primary)', values: curB.values, area: true },
      ],
      emptyText: '此期間沒有資料（Sales 需要至少記兩次 CF Bal 才算得出來）',
      tooltip: (i) => {
        const k = curB.keys[i];
        const recCount = curB.groups.get(k).reduce((s, j) => s + cur.rec[j], 0);
        return `<div class="tip-head">${tipLabel(k)}</div>
          <div class="tip-row"><span><i class="swatch" style="background:var(--primary)"></i>${m.label}</span><b class="${m.signed ? deltaClass(curB.values[i]) : ''}">${anFmt(metric, curB.values[i])}</b></div>
          ${ui.anCompare ? `<div class="tip-row"><span><i class="legend-dash"></i>前一期</span><b>${anFmt(metric, prevAligned[i])}</b></div>` : ''}
          <div class="tip-note">${recCount} 筆記錄${curB.values[i] == null && metric !== 'completion' ? '，沒有可計算的資料（不當成 0）' : ''}</div>`;
      },
    });

    // 互動
    $$('[data-an-range]').forEach((b) => b.addEventListener('click', () => { ui.anRange = b.dataset.anRange; saveUI(); render(false); }));
    $$('[data-an-metric]', view).forEach((b) => b.addEventListener('click', () => { ui.anMetric = b.dataset.anMetric; saveUI(); render(false); }));
    $$('[data-an-bucket]', view).forEach((b) => b.addEventListener('click', () => { ui.anBucket = b.dataset.anBucket; saveUI(); render(false); }));
    $$('[data-an-acct]', view).forEach((b) => b.addEventListener('click', () => { ui.anAccount = b.dataset.anAcct; saveUI(); render(false); }));
    $('#anCompare', view).addEventListener('change', (e) => { ui.anCompare = e.target.checked; saveUI(); render(false); });
    $('#anGoal', view).addEventListener('click', openGoalModal);
    $('#anExport').addEventListener('click', () => {
      const idSet = new Set(ids);
      const list = Store.state.records.filter((r) => idSet.has(r.accountId) && r.date >= range.start && r.date <= range.end);
      if (!list.length) { toast('此期間沒有可匯出的記錄', 'info'); return; }
      download(`game-currency-${range.start}_${range.end}.csv`, CSV.exportRecords(list), 'text/csv;charset=utf-8');
      toast(`已匯出 ${list.length} 筆記錄`);
    });
  }

  function openGoalModal() {
    const goal = Store.state.settings.monthlyGoal;
    const m = openModal({
      title: '每月 Sales 目標', size: 'modal-sm',
      body: `<form class="form" id="goalForm" novalidate>
        <div class="field"><label for="gf-goal">每月想賺多少${cur()}？</label>
          <input id="gf-goal" name="goal" class="input input-lg num" inputmode="numeric" autocomplete="off" placeholder="例如 50,000" value="${goal ? fmt(goal) : ''}">
          <span class="field-hint">以所選帳號本月的 Sales（CF Bal 變化 ＋ 出貨）計算進度。留空並儲存可取消目標。</span><span class="field-error"></span></div>
      </form>`,
      footer: '<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-primary" data-save>儲存</button>',
    });
    const form = $('#goalForm', m.el);
    const save = () => {
      const r = parseAmount(form.goal.value);
      if (r.error) { setFieldErrors(form, { goal: r.error }); return; }
      if (r.value === 0) { setFieldErrors(form, { goal: '目標需大於 0' }); return; }
      safely(() => { Store.updateSettings({ monthlyGoal: r.value }); toast(r.value ? `每月目標設為 ${fmt(r.value)}` : '已取消每月目標'); });
      m.close();
    };
    $('[data-save]', m.el).addEventListener('click', save);
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  }

  /* ================= 單筆記錄表單 ================= */
  function openRecordModal({ record = null, accountId = '', date = '' } = {}) {
    const accounts = Store.accounts();
    if (!accounts.length) { toast('請先新增帳號', 'info'); location.hash = '#/accounts'; return; }
    let editId = record ? record.id : null;
    // 預設帳號：該日期還沒記錄的第一個啟用帳號，避免一打開就撞到已有記錄
    const initDate = date || D.todayISO();
    const active = accounts.filter((a) => a.status === 'active');
    const defaultAcc = (active.find((a) => !Store.recordFor(a.id, initDate)) || active[0] || accounts[0]).id;
    const init = record || { date: initDate, accountId: accountId || defaultAcc, balance: null, shipped: null, note: '' };
    const val = (n) => (n == null ? '' : fmtFull(n));

    const body = `<form class="form" id="recForm" novalidate>
      <div class="form-row">
        <div class="field"><label for="rf-date">日期</label><input type="date" id="rf-date" name="date" class="input" value="${init.date}" required><span class="field-error"></span></div>
        <div class="field"><label for="rf-acc">帳號</label><select id="rf-acc" name="accountId" class="input">${accountOptions(init.accountId)}</select><span class="field-error"></span></div>
      </div>
      <div id="rf-clash"></div>
      <div class="form-row">
        <div class="field"><label for="rf-bal">CF Bal <em class="req">必填</em></label>
          <input id="rf-bal" name="balance" class="input input-lg num" inputmode="numeric" autocomplete="off" placeholder="例如 12,345" value="${val(init.balance)}" data-autofocus>
          <span class="field-hint">現在帳號裡的${cur()}（Stock）</span><span class="field-error"></span></div>
        <div class="field"><label for="rf-ship">補記出貨 <em class="opt">通常留空</em></label>
          <input id="rf-ship" name="shipped" class="input input-lg num" inputmode="numeric" autocomplete="off" placeholder="0" value="${val(init.shipped)}">
          <span class="field-hint" id="rf-ship-hint">平常用「出貨」按鈕記，會自動算進來</span><span class="field-error"></span></div>
      </div>
      <div class="calc-box" id="rf-calc" aria-live="polite"></div>
      <div class="field"><label for="rf-note">備註</label><input id="rf-note" name="note" class="input" maxlength="200" value="${esc(init.note)}" placeholder="例如：出貨給某某、活動加倍"><span class="field-error"></span></div>
    </form>`;
    const footer = `${record ? `<button type="button" class="btn btn-danger-ghost" data-del>${icon('trash')}刪除</button>` : ''}<span class="grow"></span>
      <button type="button" class="btn" data-close>取消</button>
      ${record ? '' : '<button type="button" class="btn" data-save-next title="儲存後保留日期，切換到下一個帳號">儲存並下一個帳號</button>'}
      <button type="button" class="btn btn-primary" data-save>儲存</button>`;
    const m = openModal({ title: record ? '編輯記錄' : '新增記錄', body, footer });
    const form = $('#recForm', m.el);
    const read = () => ({
      date: form.date.value, accountId: form.accountId.value, balance: form.balance.value,
      shipped: form.shipped.value, note: form.note.value,
    });
    const fill = (r) => {
      form.balance.value = val(r.balance); form.shipped.value = val(r.shipped); form.note.value = r.note || '';
    };

    function refresh() {
      const v = read();
      const date = D.normalizeDate(v.date);
      const clashBox = $('#rf-clash', m.el);
      const existing = date && v.accountId ? Store.recordFor(v.accountId, date) : null;
      clashBox.innerHTML = '';
      if (existing && existing.id !== editId) {
        if (editId) {
          clashBox.innerHTML = `<div class="notice notice-error compact">${icon('alert')}<div><p>這個帳號在 ${fmtDate(date)} 已經有另一筆記錄（CF Bal ${fmt(existing.balance)}），不能存成重複的記錄。</p></div><button type="button" class="btn btn-sm" data-switch>改為編輯那一筆</button></div>`;
        } else {
          clashBox.innerHTML = `<div class="notice notice-info compact">${icon('info')}<div><p>這天已有記錄（CF Bal ${fmt(existing.balance)}）。儲存會<b>更新</b>那一筆，不會產生重複。</p></div><button type="button" class="btn btn-sm" data-load>載入現有數值</button></div>`;
        }
        const sw = $('[data-switch]', clashBox); const ld = $('[data-load]', clashBox);
        if (sw) sw.addEventListener('click', () => { editId = existing.id; fill(existing); $('.modal-head h2', m.el).textContent = '編輯記錄'; refresh(); });
        if (ld) ld.addEventListener('click', () => { fill(existing); refresh(); });
      }

      const calc = $('#rf-calc', m.el);
      const bal = parseAmount(v.balance); const sh = parseAmount(v.shipped);
      if (!date || !v.accountId) { calc.innerHTML = ''; return; }
      const list = Calc.list(v.accountId);
      const prev = Calc.latestBefore(list, date);
      const next = Calc.firstAfter(list, date);
      const lines = [];
      if (prev) {
        const gap = D.daysBetween(prev.date, date);
        lines.push(`<div class="calc-line"><span>上次 CF Bal</span><b>${fmt(prev.balance)}</b><small>${fmtDate(prev.date)}${gap > 1 ? `，相隔 ${gap} 天` : ''}</small></div>`);
      } else {
        lines.push('<div class="calc-line"><span>上次 CF Bal</span><b class="muted">無（這是這個帳號第一筆，還算不出 Sales）</b></div>');
      }
      const net = prev && !bal.error && bal.value != null ? bal.value - prev.balance : null;
      const ships = Calc.shipmentsFor(v.accountId, date);
      $('#rf-ship-hint', m.el).textContent = ships.length ? `另有 ${ships.length} 筆出貨記錄共 ${fmt(sumShips(ships))}，已自動算進來` : '平常用「出貨」按鈕記，會自動算進來';
      const shipped = sh.error ? null : (sh.value || 0) + sumShips(ships);
      let status = '';
      if (prev) {
        if (net == null || shipped == null) {
          lines.push('<div class="calc-line"><span>Sales</span><b class="muted">輸入 CF Bal 後自動計算</b></div>');
        } else {
          const sales = net + shipped;
          const gap = D.daysBetween(prev.date, date);
          lines.push(`<div class="calc-line"><span>Stock 變化</span><b>${delta(net)}</b><small>= ${fmt(bal.value)} − ${fmt(prev.balance)}</small></div>`);
          lines.push(`<div class="calc-line"><span>Sales</span><b>${delta(sales)}</b><small>= Stock 變化 ${fmtSigned(net)} ＋ 出貨 ${fmt(shipped)}，算在 <b>${fmtDate(salesDateFor(date))}</b>${gap > 1 ? `（跨 ${gap} 天）` : ''}</small></div>`);
          if (sales < 0) status = `<div class="calc-status warn">${icon('alert')}<span>Sales 是負數：CF Bal 少掉的比出貨還多。是不是出貨忘了填，或 CF Bal 打錯？系統不會自動修改，仍可照樣儲存。</span></div>`;
          else if (shipped) status = `<div class="calc-status ok">${icon('check')}出貨 ${fmt(shipped)} 已加回 Sales，不會算成少賺</div>`;
        }
      }
      if (next && !bal.error && bal.value != null) {
        lines.push(`<div class="calc-line subtle"><span>影響</span><small>下一筆（${fmtDate(next.date)}）的 Sales 會變成 ${fmtSigned(next.balance - bal.value + ((Calc.info(next.id) || {}).shipped || 0))}</small></div>`);
      }
      calc.innerHTML = lines.join('') + status;
    }

    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    refresh();

    function save(keepOpen) {
      try {
        const v = read();
        const res = Store.saveRecord(v, editId);
        ui.lastAccountId = v.accountId; saveUI();
        const a = Store.account(v.accountId);
        toast(`${res.mode === 'created' ? '已新增' : '已更新'}：${a.name} · ${fmtDate(res.record.date)}`);
        if (!keepOpen) { m.close(); return; }
        // 換到下一個啟用帳號，保留日期
        const active = Store.accounts().filter((x) => x.status === 'active');
        const idx = active.findIndex((x) => x.id === v.accountId);
        const nextAcc = active[(idx + 1) % active.length];
        if (nextAcc) form.accountId.value = nextAcc.id;
        editId = null;
        fill({ balance: null, shipped: null, note: '' });
        setFieldErrors(form, {});
        refresh();
        form.balance.focus();
      } catch (e) {
        if (e.fieldErrors) setFieldErrors(form, e.fieldErrors); else toast(e.message, 'error');
      }
    }
    $('[data-save]', m.el).addEventListener('click', () => save(false));
    const sn = $('[data-save-next]', m.el);
    if (sn) sn.addEventListener('click', () => save(true));
    form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(false); } });
    const del = $('[data-del]', m.el);
    if (del) del.addEventListener('click', async () => {
      const r = Store.state.records.find((x) => x.id === editId);
      if (!r) return;
      if (await deleteRecordFlow(r)) m.close();
    });
  }

  async function deleteRecordFlow(r) {
    const a = Store.account(r.accountId);
    const ok = await confirmDialog({
      title: '刪除記錄',
      message: `確定刪除 <b>${esc(a ? a.name : '')}</b> 在 <b>${fmtDate(r.date)}</b> 的記錄（CF Bal ${fmt(r.balance)}）？<br><small>刪除後，下一筆記錄的 Sales 會改以更早的一筆計算。此動作無法復原。</small>`,
      confirmText: '刪除', danger: true,
    });
    if (!ok) return false;
    safely(() => { Store.deleteRecord(r.id); toast('已刪除記錄'); });
    return true;
  }

  /* ================= 每日錄入 ================= */
  function renderEntry(view, params) {
    if (!Store.accounts().length) { view.innerHTML = noAccountsState(); return; }
    const today = D.todayISO();
    const date = D.isISODate(params.get('date')) ? params.get('date') : today;
    const accounts = Store.accounts().filter((a) => a.status === 'active' || Store.recordFor(a.id, date));
    const recorded = accounts.filter((a) => Store.recordFor(a.id, date)).length;
    const val = (n) => (n == null ? '' : fmtFull(n));

    if (!accounts.length) {
      view.innerHTML = emptyState({ iconName: 'accounts', title: '沒有啟用中的帳號', text: '所有帳號都已停用。到「帳號」頁重新啟用或新增帳號後，就能在這裡錄入。', actions: '<a class="btn btn-primary" href="#/accounts">前往帳號</a>' });
      return;
    }

    view.innerHTML = `${installHint()}
      <section class="card entry-card">
        <div class="entry-toolbar">
          <div class="date-nav">
            <button type="button" class="icon-btn" data-day="-1" aria-label="前一天">${icon('left')}</button>
            <input type="date" class="input" id="entryDate" value="${date}" aria-label="錄入日期">
            <button type="button" class="icon-btn" data-day="1" aria-label="後一天">${icon('right')}</button>
            ${date !== today ? '<button type="button" class="btn btn-sm" data-day="today">回到今天</button>' : '<span class="tag tag-ok">今天</span>'}
          </div>
          <div class="entry-progress"><span>${fmtDateWeek(date)}</span><b>${recorded} / ${accounts.length}</b> 個帳號已記錄</div>
        </div>
        <p class="help">${icon('info')}<span>每天填各帳號的 <b>CF Bal</b>；出貨用「＋出貨」另外記，會自動算進來。<b>Sales = CF Bal 變化 ＋ 出貨</b>，會自動算出，算在 <b>${fmtDate(salesDateFor(date))}</b>${salesPrev() ? '（前一天）' : ''}。出貨不會扣 Sales。${isIOS ? '用鍵盤上方的 ⌄ 箭頭切換到下一格。' : '在 CF Bal 欄按 <kbd>Enter</kbd> 會跳到下一個帳號。'}</span></p>
        <div class="entry-table">
          <div class="entry-head"><span>帳號</span><span>上次 CF Bal</span><span>今天 CF Bal</span><span>出貨</span><span>Sales（${fmtDate(salesDateFor(date)).slice(5)}）</span><span>備註</span></div>
          ${accounts.map((a) => {
            const r = Store.recordFor(a.id, date);
            const prev = Calc.latestBefore(Calc.list(a.id), date);
            return `<div class="entry-row ${r ? 'is-saved' : ''}" data-aid="${a.id}">
              <div class="er-account">${avatar(a, 'sm')}<div class="er-name"><b>${esc(a.name)}</b><small>${esc(a.gameId || '—')}</small></div>${r ? `<span class="tag tag-ok">${icon('check', 'icon-xs')}已記錄</span>` : ''}</div>
              <div class="er-prev"><span class="er-label">上次 CF Bal</span>${prev ? `<b>${fmt(prev.balance)}</b><small>${fmtDate(prev.date)}${D.daysBetween(prev.date, date) > 1 ? `（${D.daysBetween(prev.date, date)} 天前）` : ''}</small>` : '<small class="muted">無（第一筆）</small>'}</div>
              <div class="field er-bal"><label class="er-label" for="b-${a.id}">CF Bal</label>
                <div class="input-group"><input id="b-${a.id}" class="input num" name="balance" inputmode="numeric" autocomplete="off" placeholder="${prev ? fmt(prev.balance) : '例如 12,345'}" value="${val(r && r.balance)}">
                <button type="button" class="btn btn-sm btn-ghost" data-copyprev ${prev ? '' : 'disabled'} title="填入上次的 CF Bal（沒有變化時使用）">沿用</button></div>
                <span class="field-error"></span></div>
              <div class="er-ship"><span class="er-label">出貨</span><div class="er-ship-view"><b data-shipsum></b><button type="button" class="btn btn-sm btn-ghost" data-addship title="記一筆出貨">${icon('plus', 'icon-xs')}出貨</button></div></div>
              <div class="er-calc" data-calc></div>
              <div class="field er-note"><label class="er-label" for="n-${a.id}">備註</label><input id="n-${a.id}" class="input" name="note" maxlength="200" placeholder="選填" value="${esc(r ? r.note : '')}"><span class="field-error"></span></div>
            </div>`;
          }).join('')}
        </div>
        <div class="entry-foot"><span id="dirtyNote" class="muted">尚未修改</span><span class="grow"></span><button type="button" class="btn" id="resetAll" disabled>還原</button><button type="button" class="btn btn-primary" id="saveAll" disabled>${icon('check')}儲存變更</button></div>
      </section>`;

    const rows = $$('.entry-row', view);
    const snapshot = (row) => ['balance', 'note'].map((k) => {
      const v = row.querySelector(`[name="${k}"]`).value.trim();
      if (k === 'note') return v;
      const p = parseAmount(v);
      return p.error ? 'ERR:' + v : String(p.value);
    }).join('|');
    const original = new Map(rows.map((row) => [row, snapshot(row)]));
    const isDirty = (row) => snapshot(row) !== original.get(row);

    function updateRow(row) {
      const aid = row.dataset.aid;
      const get = (k) => row.querySelector(`[name="${k}"]`).value;
      const prev = Calc.latestBefore(Calc.list(aid), date);
      const bal = parseAmount(get('balance'));
      // 出貨：這筆 CF Bal 會算進的出貨記錄（＋記錄上補記的）
      const existing = Store.recordFor(aid, date);
      const shipTotal = sumShips(Calc.shipmentsFor(aid, date)) + (existing && existing.shipped ? existing.shipped : 0);
      $('[data-shipsum]', row).innerHTML = shipTotal ? fmt(shipTotal) : '<span class="muted">0</span>';
      // 即時欄位錯誤
      const f = row.querySelector('[name="balance"]').closest('.field');
      f.classList.toggle('has-error', !!bal.error);
      $('.field-error', f).textContent = bal.error || '';
      const net = prev && !bal.error && bal.value != null ? bal.value - prev.balance : null;
      const parts = [];
      if (bal.value == null || bal.error) parts.push('<span class="muted">—</span>');
      else if (!prev) parts.push('<small class="muted">第一筆，還算不出 Sales</small>');
      else {
        const sales = net + shipTotal;
        const gap = D.daysBetween(prev.date, date);
        parts.push(`<span class="calc-k">Sales</span><b class="sales-val">${delta(sales)}</b>`);
        parts.push(`<small class="muted">Stock ${fmtSigned(net)}${shipTotal ? ` ＋ 出貨 ${fmt(shipTotal)}` : ''}${gap > 1 ? `，跨 ${gap} 天` : ''}</small>`);
        if (sales < 0) parts.push(`<span class="mini-warn" title="CF Bal 少掉的比出貨還多，是不是出貨忘了填？">${icon('alert', 'icon-xs')}負數</span>`);
      }
      $('[data-calc]', row).innerHTML = parts.join(' ');
      row.classList.toggle('is-dirty', isDirty(row));
    }

    function updateFooter() {
      const dirty = rows.filter(isDirty);
      $('#dirtyNote', view).textContent = dirty.length ? `${dirty.length} 個帳號有未儲存的變更` : '尚未修改';
      $('#dirtyNote', view).className = dirty.length ? 'warn-text' : 'muted';
      $('#saveAll', view).disabled = !dirty.length;
      $('#resetAll', view).disabled = !dirty.length;
    }

    rows.forEach((row) => {
      updateRow(row);
      row.addEventListener('input', () => { updateRow(row); updateFooter(); });
      $('[data-copyprev]', row).addEventListener('click', () => {
        const prev = Calc.latestBefore(Calc.list(row.dataset.aid), date);
        if (!prev) return;
        row.querySelector('[name="balance"]').value = fmtFull(prev.balance);
        updateRow(row); updateFooter();
      });
      // 記出貨會重畫這頁，有沒存的 CF Bal 時先提醒
      $('[data-addship]', row).addEventListener('click', () => {
        if (rows.some(isDirty)) { toast('請先儲存 CF Bal，再記出貨', 'info'); return; }
        openShipModal({ accountId: row.dataset.aid, date: date < today ? salesDateFor(date) : today });
      });
      row.querySelector('[name="balance"]').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const i = rows.indexOf(row);
        if (rows[i + 1]) rows[i + 1].querySelector('[name="balance"]').focus();
        else $('#saveAll', view).focus();
      });
    });
    updateFooter();
    leaveGuard = () => rows.some(isDirty);

    const goDate = (d) => {
      if (!D.isISODate(d)) return;
      if (rows.some(isDirty) && !window.confirm('有尚未儲存的輸入，確定要切換日期嗎？')) { $('#entryDate', view).value = date; return; }
      leaveGuard = null;
      location.hash = `#/entry?date=${d}`;
    };
    $$('[data-day]', view).forEach((b) => b.addEventListener('click', () => goDate(b.dataset.day === 'today' ? today : D.addDays(date, Number(b.dataset.day)))));
    $('#entryDate', view).addEventListener('change', (e) => goDate(e.target.value));

    $('#resetAll', view).addEventListener('click', () => { leaveGuard = null; render(); });

    $('#saveAll', view).addEventListener('click', () => {
      const values = []; let firstBad = null;
      rows.filter(isDirty).forEach((row) => {
        const aid = row.dataset.aid;
        const get = (k) => row.querySelector(`[name="${k}"]`).value;
        const existing = Store.recordFor(aid, date);
        const allEmpty = ['balance', 'note'].every((k) => !get(k).trim());
        if (allEmpty && !existing) return;
        const { errors, value } = Store.validateRecord({ date, accountId: aid, balance: get('balance'), shipped: existing ? existing.shipped : null, note: get('note') });
        if (!get('balance').trim()) errors.balance = existing ? '已有記錄不可清空（要刪除請到「記錄」頁）' : '有填備註時，CF Bal 必填';
        Object.keys(errors).forEach((k) => {
          const inp = row.querySelector(`[name="${k}"]`);
          if (!inp) return;
          const f = inp.closest('.field');
          f.classList.add('has-error'); $('.field-error', f).textContent = errors[k];
          if (!firstBad) firstBad = inp;
        });
        if (!Object.keys(errors).length) values.push(value);
      });
      if (firstBad) { firstBad.focus(); toast('有欄位需要修正，尚未儲存任何資料', 'error'); return; }
      if (!values.length) { toast('沒有需要儲存的內容', 'info'); return; }
      leaveGuard = null;
      safely(() => {
        const res = Store.saveMany(values);
        toast(`已儲存 ${values.length} 個帳號（新增 ${res.created}、更新 ${res.updated}）`);
      });
    });
  }

  /* ================= 記錄列表 ================= */
  const recState = { q: '', account: '', from: '', to: '', negative: false, page: 1 };
  const PAGE_SIZE = 50;

  function renderRecords(view, params) {
    if (!Store.accounts().length) { view.innerHTML = noAccountsState(); return; }
    if (params.has('account')) recState.account = params.get('account');
    if (params.get('negative') === '1') recState.negative = true;
    if (recState.account && !Store.account(recState.account)) recState.account = '';

    if (!Store.state.records.length) {
      view.innerHTML = emptyState({
        iconName: 'records', title: '還沒有任何記錄',
        text: '每天記下各帳號的 CF Bal 和出貨，這裡就會列出所有記錄和算出的 Sales，可以搜尋、排序、編輯與匯出。',
        actions: `<a class="btn btn-primary" href="#/entry">${icon('entry')}前往每日錄入</a><button class="btn" data-action="new-record">${icon('plus')}新增單筆</button><button class="btn" data-action="import-csv">${icon('upload')}匯入 CSV</button>`,
      });
      return;
    }

    view.innerHTML = `
      <section class="card">
        <div class="table-toolbar">
          <label class="search">${icon('search')}<input class="input" id="recQ" type="search" placeholder="搜尋帳號、遊戲 ID、備註、日期…" value="${esc(recState.q)}"></label>
          <select class="input" id="recAcc" aria-label="帳號篩選"><option value="">全部帳號</option>${accountOptions(recState.account)}</select>
          <div class="date-filter"><input type="date" class="input" id="recFrom" aria-label="起始日期" value="${recState.from}"><span>–</span><input type="date" class="input" id="recTo" aria-label="結束日期" value="${recState.to}"></div>
          <label class="chip-toggle"><input type="checkbox" id="recMis" ${recState.negative ? 'checked' : ''}><span>${icon('alert', 'icon-xs')}只看 Sales 負數</span></label>
          <button type="button" class="btn btn-ghost btn-sm" id="recClear">清除篩選</button>
          <span class="grow"></span>
          <button type="button" class="btn btn-sm" data-action="import-csv">${icon('upload')}匯入 CSV</button>
          <button type="button" class="btn btn-sm" id="recExport">${icon('download')}匯出 CSV</button>
        </div>
        <p class="formula">${icon('info')}<span><b>CF Bal</b> = Stock 庫存　<b>Stock 變化</b> = 這次 CF Bal − 上次 CF Bal　<b>Sales</b> = Stock 變化 ＋ 出貨，算在${salesPrev() ? '記錄日的前一天' : '記錄當天'}。出貨不扣 Sales。「跨 N 天」表示和上次記錄相隔多天。</span></p>
        <div class="table-wrap"><table class="table" id="recTable">
          <thead><tr>
            ${[['date', '記錄日'], ['account', '帳號'], ['balance', 'CF Bal', 'num'], ['net', 'Stock 變化', 'num'], ['shipped', '出貨', 'num'], ['sales', 'Sales', 'num'], ['salesDate', 'Sales 日'], ['note', '備註']].map(([k, l, cls]) => `<th class="${cls || ''}" ${k === 'note' ? '' : `aria-sort="${ui.recSort === k ? (ui.recDir === 'asc' ? 'ascending' : 'descending') : 'none'}"`}>${k === 'note' ? l : `<button type="button" class="sort-btn" data-sort="${k}">${l}<span class="sort-ind">${ui.recSort === k ? (ui.recDir === 'asc' ? '▲' : '▼') : ''}</span></button>`}</th>`).join('')}
            <th class="actions-col"><span class="sr-only">操作</span></th>
          </tr></thead>
          <tbody></tbody>
        </table></div>
        <div class="table-foot" id="recFoot"></div>
      </section>`;

    const d = Store.derived();

    function filtered() {
      const q = recState.q.trim().toLowerCase();
      return Store.state.records.filter((r) => {
        if (recState.account && r.accountId !== recState.account) return false;
        if (recState.from && r.date < recState.from) return false;
        if (recState.to && r.date > recState.to) return false;
        const x = d.byId.get(r.id);
        if (recState.negative && !(x && x.negative)) return false;
        if (q) {
          const a = Store.account(r.accountId);
          const hay = `${a ? a.name : ''} ${a ? a.gameId : ''} ${r.note} ${r.date} ${fmtDate(r.date)}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    }

    function sorted(list) {
      const key = ui.recSort; const dir = ui.recDir === 'asc' ? 1 : -1;
      const get = (r) => {
        const x = d.byId.get(r.id) || {};
        switch (key) {
          case 'account': { const a = Store.account(r.accountId); return a ? a.name : ''; }
          case 'balance': return r.balance;
          case 'net': return x.net;
          case 'shipped': return x.shipped || null;
          case 'sales': return x.sales;
          case 'salesDate': return x.salesDate;
          default: return r.date;
        }
      };
      return list.slice().sort((a, b) => {
        const va = get(a); const vb = get(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1; // 空值永遠排最後
        if (vb == null) return -1;
        const c = typeof va === 'string' ? va.localeCompare(vb, 'zh-Hant') : va - vb;
        return c !== 0 ? c * dir : (a.date < b.date ? 1 : -1);
      });
    }

    function draw() {
      const list = sorted(filtered());
      const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      recState.page = Math.min(recState.page, pages);
      const slice = list.slice((recState.page - 1) * PAGE_SIZE, recState.page * PAGE_SIZE);
      const tbody = $('#recTable tbody', view);
      tbody.innerHTML = slice.length ? slice.map((r, k) => {
        const a = Store.account(r.accountId);
        const x = d.byId.get(r.id) || {};
        const salesCell = x.sales == null ? '<small class="muted">第一筆</small>'
          : x.negative ? `<span class="mini-warn" title="CF Bal 少掉的比出貨還多，可能漏記出貨">${icon('alert', 'icon-xs')}${fmtSigned(x.sales)}</span>`
            : `<b>${delta(x.sales)}</b>`;
        return `<tr class="${x.negative ? 'row-warn' : ''} ${k < 24 ? 'reveal-row' : ''}" style="--i:${k}">
          <td class="nowrap">${fmtDate(r.date)}<small>週${WEEK[D.parseISO(r.date).getDay()]}</small></td>
          <td><span class="cell-acct">${swatch(a)}<span>${esc(a ? a.name : '（已刪除）')}<small>${esc(a && a.gameId ? a.gameId : '')}</small></span></span></td>
          <td class="num">${fmt(r.balance)}</td>
          <td class="num">${x.net == null ? '<span class="muted">—</span>' : delta(x.net)}</td>
          <td class="num">${x.shipped ? `${fmt(x.shipped)}${x.shipList && x.shipList.length > 1 ? `<small>${x.shipList.length} 筆</small>` : ''}` : '<span class="muted">—</span>'}</td>
          <td class="num">${salesCell}${x.gap > 1 ? `<small class="gap" title="和上次記錄相隔 ${x.gap} 天，這是 ${x.gap} 天的合計">跨 ${x.gap} 天</small>` : ''}</td>
          <td class="nowrap">${x.salesDate ? fmtDate(x.salesDate) : '—'}</td>
          <td class="note-cell" title="${esc(r.note)}">${esc(r.note) || '<span class="muted">—</span>'}</td>
          <td class="actions-col"><div class="row-actions">
            <button type="button" class="icon-btn" data-edit-record="${r.id}" aria-label="編輯" title="編輯">${icon('edit')}</button>
            <button type="button" class="icon-btn danger" data-del="${r.id}" aria-label="刪除" title="刪除">${icon('trash')}</button>
          </div></td>
        </tr>`;
      }).join('') : `<tr><td colspan="9"><div class="mini-empty">${icon('search')}沒有符合條件的記錄</div></td></tr>`;

      const from = list.length ? (recState.page - 1) * PAGE_SIZE + 1 : 0;
      $('#recFoot', view).innerHTML = `<span>第 ${from}–${Math.min(recState.page * PAGE_SIZE, list.length)} 筆，共 ${fmt(list.length)} 筆${list.length !== Store.state.records.length ? `（全部 ${fmt(Store.state.records.length)} 筆）` : ''}</span>
        <span class="grow"></span>
        <div class="pager"><button type="button" class="icon-btn" data-page="-1" ${recState.page <= 1 ? 'disabled' : ''} aria-label="上一頁">${icon('left')}</button><span>${recState.page} / ${pages}</span><button type="button" class="icon-btn" data-page="1" ${recState.page >= pages ? 'disabled' : ''} aria-label="下一頁">${icon('right')}</button></div>`;
      $$('[data-page]', view).forEach((b) => b.addEventListener('click', () => { recState.page += Number(b.dataset.page); draw(); }));
      $$('[data-del]', tbody).forEach((b) => b.addEventListener('click', () => {
        const r = Store.state.records.find((x) => x.id === b.dataset.del);
        if (r) deleteRecordFlow(r);
      }));
    }

    const onFilter = () => { recState.page = 1; draw(); };
    $('#recQ', view).addEventListener('input', (e) => { recState.q = e.target.value; onFilter(); });
    $('#recAcc', view).addEventListener('change', (e) => { recState.account = e.target.value; onFilter(); });
    $('#recFrom', view).addEventListener('change', (e) => { recState.from = e.target.value; onFilter(); });
    $('#recTo', view).addEventListener('change', (e) => { recState.to = e.target.value; onFilter(); });
    $('#recMis', view).addEventListener('change', (e) => { recState.negative = e.target.checked; onFilter(); });
    $('#recClear', view).addEventListener('click', () => {
      Object.assign(recState, { q: '', account: '', from: '', to: '', negative: false, page: 1 });
      if (location.hash !== '#/records') location.hash = '#/records'; else render();
    });
    $$('[data-sort]', view).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      if (ui.recSort === k) ui.recDir = ui.recDir === 'asc' ? 'desc' : 'asc';
      else { ui.recSort = k; ui.recDir = k === 'account' ? 'asc' : 'desc'; }
      saveUI(); render();
    }));
    $('#recExport', view).addEventListener('click', () => {
      const list = filtered();
      if (!list.length) { toast('沒有可匯出的記錄', 'info'); return; }
      download(`game-currency-records-${D.todayISO()}.csv`, CSV.exportRecords(list), 'text/csv;charset=utf-8');
      toast(`已匯出 ${list.length} 筆記錄`);
    });
    draw();
  }

  /* ================= 帳號 ================= */
  function renderAccounts(view) {
    const accounts = Store.accounts();
    if (!accounts.length) { view.innerHTML = noAccountsState(); return; }
    const counts = { all: accounts.length, active: accounts.filter((a) => a.status === 'active').length };
    counts.inactive = counts.all - counts.active;
    let q = '';
    view.innerHTML = `
      <section class="card">
        <div class="table-toolbar">
          <div class="chips" role="group" aria-label="狀態篩選">
            ${[['all', '全部'], ['active', '啟用'], ['inactive', '停用']].map(([k, l]) => `<button type="button" class="chip ${ui.acctFilter === k ? 'active' : ''}" data-filter="${k}">${l}<span class="chip-count">${counts[k]}</span></button>`).join('')}
          </div>
          <span class="grow"></span>
          <label class="search">${icon('search')}<input class="input" id="acctQ" type="search" placeholder="名稱、遊戲 ID、備註…"></label>
          <select class="input" id="acctSort" aria-label="排序">
            ${[['manual', '建立順序'], ['name', '名稱'], ['balance', 'Stock（高→低）'], ['earn30', '近 30 日 Sales（高→低）'], ['recent', '最近記錄']].map(([k, l]) => `<option value="${k}" ${ui.acctSort === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <div class="view-toggle" role="group" aria-label="檢視方式">
            <button type="button" class="icon-btn ${ui.acctView === 'grid' ? 'active' : ''}" data-view="grid" aria-label="卡片檢視" title="卡片檢視">${icon('dashboard')}</button>
            <button type="button" class="icon-btn ${ui.acctView === 'list' ? 'active' : ''}" data-view="list" aria-label="列表檢視" title="列表檢視">${icon('list')}</button>
          </div>
          <button type="button" class="btn btn-primary btn-sm" data-action="new-account">${icon('plus')}新增帳號</button>
        </div>
        <div id="acctList"></div>
      </section>`;

    const today = D.todayISO();
    const info = new Map(accounts.map((a) => {
      const list = Calc.list(a.id);
      const latest = list[list.length - 1] || null;
      const st30 = Calc.windowStats(a.id, D.addDays(today, -29), today);
      const spark = list.filter((r) => r.date >= D.addDays(today, -29)).map((r) => r.balance);
      return [a.id, { latest, st30, spark, count: list.length }];
    }));

    function draw() {
      const ql = q.trim().toLowerCase();
      let list = accounts.filter((a) => (ui.acctFilter === 'all' || a.status === ui.acctFilter)
        && (!ql || `${a.name} ${a.gameId} ${a.note}`.toLowerCase().includes(ql)));
      const nullLast = (va, vb) => (va == null && vb == null ? 0 : va == null ? 1 : vb == null ? -1 : vb - va);
      if (ui.acctSort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
      if (ui.acctSort === 'balance') list = list.slice().sort((a, b) => nullLast(info.get(a.id).latest && info.get(a.id).latest.balance, info.get(b.id).latest && info.get(b.id).latest.balance));
      if (ui.acctSort === 'earn30') list = list.slice().sort((a, b) => nullLast(info.get(a.id).st30.sales, info.get(b.id).st30.sales));
      if (ui.acctSort === 'recent') list = list.slice().sort((a, b) => ((info.get(b.id).latest || {}).date || '').localeCompare((info.get(a.id).latest || {}).date || ''));

      const host = $('#acctList', view);
      if (!list.length) { host.innerHTML = `<div class="mini-empty">${icon('search')}沒有符合條件的帳號</div>`; return; }
      const actions = (a) => `<div class="row-actions">
        <a class="icon-btn" href="#/records?account=${a.id}" aria-label="查看記錄" title="查看記錄">${icon('records')}</a>
        <button type="button" class="icon-btn" data-edit-account="${a.id}" aria-label="編輯" title="編輯">${icon('edit')}</button>
        <button type="button" class="icon-btn" data-toggle="${a.id}" aria-label="${a.status === 'active' ? '停用' : '啟用'}" title="${a.status === 'active' ? '停用' : '重新啟用'}">${icon(a.status === 'active' ? 'pause' : 'play')}</button>
        <button type="button" class="icon-btn danger" data-del-account="${a.id}" aria-label="刪除" title="刪除">${icon('trash')}</button></div>`;

      if (ui.acctView === 'list') {
        host.innerHTML = `<div class="table-wrap"><table class="table">
          <thead><tr><th>帳號</th><th>遊戲內 ID</th><th>狀態</th><th class="num">Stock</th><th class="num">近 30 日 Sales</th><th>最近記錄</th><th>備註</th><th class="actions-col"><span class="sr-only">操作</span></th></tr></thead>
          <tbody>${list.map((a) => {
            const x = info.get(a.id);
            return `<tr class="${a.status !== 'active' ? 'is-inactive' : ''}"><td><span class="cell-acct">${avatar(a, 'xs')}<span>${esc(a.name)}</span></span></td><td>${esc(a.gameId) || '<span class="muted">—</span>'}</td><td>${statusTag(a)}</td>
              <td class="num">${fmt(x.latest && x.latest.balance)}</td><td class="num">${delta(x.st30.sales)}</td><td class="nowrap">${x.latest ? relDays(x.latest.date) : '<span class="muted">—</span>'}</td>
              <td class="note-cell">${esc(a.note) || '<span class="muted">—</span>'}</td><td class="actions-col">${actions(a)}</td></tr>`;
          }).join('')}</tbody></table></div>`;
      } else {
        host.innerHTML = `<div class="acct-grid">${list.map((a) => {
          const x = info.get(a.id);
          return `<article class="acct-card ${a.status !== 'active' ? 'is-inactive' : ''}">
            <header class="acct-head">${avatar(a)}<div class="grow"><h3>${esc(a.name)}</h3><p>${a.gameId ? `ID：${esc(a.gameId)}` : '未填遊戲內 ID'}</p></div>${statusTag(a)}</header>
            <p class="acct-note">${esc(a.note) || '<span class="muted">沒有備註</span>'}</p>
            <div class="acct-stats">
              <div><span>Stock（CF Bal）</span><b>${fmt(x.latest && x.latest.balance)}</b></div>
              <div><span>最近記錄</span><b>${x.latest ? relDays(x.latest.date) : '—'}</b></div>
            </div>
            <div class="acct-spark">${Charts.sparkline(x.spark, color(a), 260, 40)}</div>
            <footer class="acct-foot"><span class="acct-earn">近 30 日 Sales ${delta(x.st30.sales)}</span><span class="grow"></span>${actions(a)}</footer>
          </article>`;
        }).join('')}</div>`;
      }
      $$('[data-toggle]', host).forEach((b) => b.addEventListener('click', () => {
        const a = Store.account(b.dataset.toggle);
        safely(() => { Store.updateAccount(a.id, { status: a.status === 'active' ? 'inactive' : 'active' }); toast(`${a.name} 已${a.status === 'active' ? '重新啟用' : '停用'}`); });
      }));
      $$('[data-del-account]', host).forEach((b) => b.addEventListener('click', () => deleteAccountFlow(Store.account(b.dataset.delAccount))));
    }

    $$('[data-filter]', view).forEach((b) => b.addEventListener('click', () => {
      ui.acctFilter = b.dataset.filter; saveUI();
      $$('[data-filter]', view).forEach((x) => x.classList.toggle('active', x === b));
      draw();
    }));
    $$('[data-view]', view).forEach((b) => b.addEventListener('click', () => {
      ui.acctView = b.dataset.view; saveUI();
      $$('[data-view]', view).forEach((x) => x.classList.toggle('active', x === b));
      draw();
    }));
    $('#acctQ', view).addEventListener('input', (e) => { q = e.target.value; draw(); });
    $('#acctSort', view).addEventListener('change', (e) => { ui.acctSort = e.target.value; saveUI(); draw(); });
    draw();
  }

  function openAccountModal(account) {
    const a = account || { name: '', gameId: '', note: '', status: 'active' };
    const m = openModal({
      title: account ? '編輯帳號' : '新增帳號',
      body: `<form class="form" id="accForm" novalidate>
        <div class="field"><label for="af-name">帳號名稱 <em class="req">必填</em></label><input id="af-name" name="name" class="input" maxlength="40" value="${esc(a.name)}" placeholder="例如：主帳號、小號 A"><span class="field-error"></span></div>
        <div class="field"><label for="af-gid">遊戲內 ID</label><input id="af-gid" name="gameId" class="input" maxlength="60" value="${esc(a.gameId)}" placeholder="例如：TW-100231"><span class="field-hint">匯入 CSV 時可用來對應帳號。</span><span class="field-error"></span></div>
        <div class="field"><label for="af-note">備註</label><textarea id="af-note" name="note" class="input" rows="3" maxlength="300" placeholder="伺服器、角色、用途…">${esc(a.note)}</textarea><span class="field-error"></span></div>
        <fieldset class="field"><legend>狀態</legend>
          <div class="radio-row">
            <label class="radio"><input type="radio" name="status" value="active" ${a.status === 'active' ? 'checked' : ''}><span><b>啟用</b><small>出現在每日錄入與預設統計中</small></span></label>
            <label class="radio"><input type="radio" name="status" value="inactive" ${a.status !== 'active' ? 'checked' : ''}><span><b>停用</b><small>保留歷史記錄，但不再提醒錄入</small></span></label>
          </div></fieldset>
      </form>`,
      footer: `<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-primary" data-save>${account ? '儲存' : '新增帳號'}</button>`,
    });
    const form = $('#accForm', m.el);
    const save = () => {
      const input = { name: form.name.value, gameId: form.gameId.value, note: form.note.value, status: form.status.value };
      try {
        if (account) { Store.updateAccount(account.id, input); toast('已更新帳號'); } else { const acc = Store.addAccount(input); toast(`已新增帳號「${acc.name}」`); }
        m.close();
      } catch (e) {
        if (e.fieldErrors) setFieldErrors(form, e.fieldErrors); else toast(e.message, 'error');
      }
    };
    $('[data-save]', m.el).addEventListener('click', save);
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'radio') { e.preventDefault(); save(); } });
  }

  function deleteAccountFlow(a) {
    if (!a) return;
    const n = Store.recordCount(a.id);
    const m = openModal({
      title: '刪除帳號', size: 'modal-sm',
      body: `<p class="confirm-msg">確定刪除 <b>${esc(a.name)}</b>？${n ? `這個帳號有 <b>${fmt(n)} 筆記錄</b>，會一併刪除，且無法復原（除非你有備份）。` : '這個帳號沒有任何記錄。'}</p>
        ${n && a.status === 'active' ? '<p class="confirm-msg muted">如果只是不再使用，建議改為「停用」，可以保留歷史記錄。</p>' : ''}`,
      footer: `<span class="grow"></span><button type="button" class="btn" data-close>取消</button>
        ${n && a.status === 'active' ? '<button type="button" class="btn" data-deactivate>改為停用</button>' : ''}
        <button type="button" class="btn btn-danger" data-ok>${n ? `刪除帳號與 ${fmt(n)} 筆記錄` : '刪除帳號'}</button>`,
    });
    const dz = $('[data-deactivate]', m.el);
    if (dz) dz.addEventListener('click', () => { safely(() => { Store.updateAccount(a.id, { status: 'inactive' }); toast(`${a.name} 已停用`); }); m.close(); });
    $('[data-ok]', m.el).addEventListener('click', () => {
      safely(() => {
        Store.deleteAccount(a.id);
        if (Array.isArray(ui.dashAccounts)) { ui.dashAccounts = ui.dashAccounts.filter((id) => id !== a.id); saveUI(); }
        toast(`已刪除帳號「${a.name}」`);
      });
      m.close();
    });
  }

  /* ================= 設定與備份 ================= */
  function renderSettings(view) {
    const s = Store.state.settings;
    const last = s.lastBackupAt;
    const prev = Store.previousSnapshot();
    const kb = (Store.sizeBytes() / 1024).toFixed(1);
    view.innerHTML = `
      <div class="settings-grid">
        <section class="card">
          <header class="card-head"><div><h3>一般設定</h3><p class="card-sub">貨幣名稱與 Sales 的計算日</p></div></header>
          <form class="form" id="setForm" novalidate>
            <div class="field"><label for="sf-cur">貨幣名稱</label>
              <div class="input-group"><input id="sf-cur" name="currencyName" class="input" maxlength="12" value="${esc(s.currencyName)}" placeholder="例如：金幣、鑽石、水晶"><button type="submit" class="btn btn-primary">儲存</button></div>
              <span class="field-error"></span></div>
            <fieldset class="field"><legend>Sales 算在哪一天</legend>
              <div class="radio-row">
                <label class="radio"><input type="radio" name="salesDay" value="prev" ${s.salesDay !== 'same' ? 'checked' : ''}><span><b>前一天</b><small>今天記的 CF Bal − 昨天的 ＋ 出貨 = 昨天賺的</small></span></label>
                <label class="radio"><input type="radio" name="salesDay" value="same" ${s.salesDay === 'same' ? 'checked' : ''}><span><b>記錄當天</b><small>適合晚上收工才記 CF Bal</small></span></label>
              </div></fieldset>
          </form>
        </section>

        ${window.GCTAuth && window.GCTAuth.enabled ? (() => {
          const s = window.GCTAuth.session();
          return `<section class="card">
            <header class="card-head"><div><h3>Google 帳號與雲端同步</h3><p class="card-sub">資料存在你的 Google 雲端硬碟（App 專用隱藏資料夾），手機和電腦登入同一個帳號就會看到同一份</p></div></header>
            <div class="sync-status" id="syncStatusBox"></div>
            <div class="action-list">
              <div class="action-item"><div><b>立即同步</b><small>平常存檔後會自動同步；打開 App、回到畫面、重新連上網路時也會同步。</small></div>
                <div class="btn-pair"><button type="button" class="btn btn-sm btn-primary" id="syncAuthBtn" hidden>重新登入 Google</button><button type="button" class="btn btn-sm" data-action="sync">${icon('refresh')}同步</button></div></div>
              <div class="action-item"><div><b>${esc(s ? s.email : '—')}</b><small>${s ? `登入有效到 ${fmtDate(D.toISO(new Date(s.exp)))}，到期後需再登入一次` : ''}</small></div>
                <button type="button" class="btn btn-sm" id="logoutBtn">登出</button></div>
            </div>
          </section>`;
        })() : ''}

        <section class="card">
          <header class="card-head"><div><h3>安裝到手機</h3><p class="card-sub">${isStandalone() ? '目前是從主畫面以 App 模式開啟 ✓' : '目前是在瀏覽器中開啟'}</p></div></header>
          ${canInstall() && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
            ? `<div class="url-box"><span class="grow">${esc(location.origin + location.pathname)}</span><button type="button" class="btn btn-sm" id="copyUrl">複製網址</button></div>`
            : '<div class="notice notice-info compact">' + icon('info') + '<div><p>要先把這個資料夾放到網路上（例如 GitHub Pages），手機才能打開並安裝。步驟見 README。</p></div></div>'}
          <ol class="steps">
            <li>用 iPhone 的 <b>Safari</b> 打開上面的網址</li>
            <li>點下方的「分享」${icon('share', 'icon-inline')}，選 <b>加入主畫面</b></li>
            <li>之後從桌面的「貨幣帳本」圖示打開，會直接進入每日錄入，沒網路也能用</li>
          </ol>
          <p class="card-note">${icon('info')}${Sync && Sync.enabled ? '手機和電腦用同一個 Gmail 登入，就會看到同一份資料。' : '手機和電腦的資料各自分開。要搬資料：在一邊「下載完整備份」，用 AirDrop 或通訊軟體傳過去，再到另一邊「從備份還原」。'}</p>
        </section>

        <section class="card">
          <header class="card-head"><div><h3>備份與還原</h3><p class="card-sub">上次備份：${last ? `${fmtDate(D.toISO(new Date(last)))}（${relDays(D.toISO(new Date(last)))}）` : '<b class="warn-text">從未備份</b>'}</p></div></header>
          <div class="notice notice-info compact">${icon('shield')}<div><p>${Sync && Sync.enabled ? `資料會同步到你的 Google 雲端硬碟，這台裝置也留有一份（約 ${kb} KB）。偶爾下載一份備份檔，多一層保險。` : `資料只存在<b>這個瀏覽器</b>（localStorage，約 ${kb} KB）。清除瀏覽資料、換瀏覽器或換電腦都會看不到。請定期下載備份檔，並存到雲端硬碟等安全的地方。`}</p></div></div>
          <div class="action-list">
            <div class="action-item"><div><b>下載完整備份</b><small>JSON 檔，包含帳號、記錄與設定，可完整還原。</small></div><button type="button" class="btn btn-primary btn-sm" data-action="backup">${icon('download')}下載</button></div>
            <div class="action-item"><div><b>從備份還原</b><small>會以備份檔取代目前所有資料（還原前會先暫存目前資料）。</small></div><button type="button" class="btn btn-sm" id="restoreBtn">${icon('upload')}選擇檔案</button></div>
            <div class="action-item"><div><b>匯出記錄 CSV</b><small>可用 Excel / Google 試算表開啟，含 CF Bal、出貨、Stock 變化和 Sales。</small></div><button type="button" class="btn btn-sm" id="exportCsvBtn">${icon('download')}匯出</button></div>
            <div class="action-item"><div><b>匯入記錄 CSV</b><small>匯入前會檢查欄位、格式與重複資料，確認後才寫入。</small></div><div class="btn-pair"><button type="button" class="btn btn-ghost btn-sm" id="templateBtn">範本</button><button type="button" class="btn btn-sm" data-action="import-csv">${icon('upload')}匯入</button></div></div>
          </div>
        </section>

        <section class="card">
          <header class="card-head"><div><h3>資料</h3><p class="card-sub">${fmt(Store.accounts().length)} 個帳號 · ${fmt(Store.state.records.length)} 筆記錄</p></div></header>
          <div class="action-list">
            ${prev ? `<div class="action-item"><div><b>復原上一次取代前的資料</b><small>暫存於 ${esc(fmtDate(D.toISO(new Date(prev.savedAt))))}，包含 ${fmt((prev.data.accounts || []).length)} 個帳號、${fmt((prev.data.records || []).length)} 筆記錄。</small></div><button type="button" class="btn btn-sm" id="undoBtn">${icon('undo')}復原</button></div>` : ''}
            ${!Store.accounts().length ? `<div class="action-item"><div><b>載入範例資料</b><small>建立 5 個範例帳號與 90 天記錄，方便試用。</small></div><button type="button" class="btn btn-sm" data-action="demo">載入</button></div>` : ''}
            <div class="action-item"><div><b>清除所有資料</b><small>刪除全部帳號與記錄。建議先下載備份。</small></div><button type="button" class="btn btn-danger-ghost btn-sm" id="clearBtn" ${Store.accounts().length ? '' : 'disabled'}>${icon('trash')}清除</button></div>
          </div>
        </section>

        <section class="card">
          <header class="card-head"><div><h3>計算規則</h3><p class="card-sub">所有數字都依下列方式計算</p></div></header>
          <dl class="rules">
            <dt>Stock</dt><dd>CF Bal，也就是帳號裡現在有多少。總 Stock = 各帳號最近一次 CF Bal 的加總。</dd>
            <dt>出貨</dt><dd>上次記錄後出了多少貨。出貨會讓 Stock 變少，但<b>不會扣 Sales</b>。</dd>
            <dt>Stock 變化</dt><dd>這次 CF Bal − 上次 CF Bal。帳號的第一筆記錄沒有 Stock 變化。</dd>
            <dt>Sales</dt><dd>Stock 變化 ＋ 出貨，也就是真正賺到的。${s.salesDay === 'same' ? '算在記錄當天。' : '算在記錄日的<b>前一天</b>：今天記的 = 昨天賺的。'}</dd>
            <dt>跨 N 天</dt><dd>和上次記錄相隔多天時，Sales 是這幾天的合計；不會平均分攤，也不會把沒記錄的日子當成 0。</dd>
            <dt>Sales 負數</dt><dd>CF Bal 少掉的比出貨還多，通常是出貨忘了填或 CF Bal 打錯，會標示讓你檢查。</dd>
            <dt>每日平均</dt><dd>期間 Sales ÷ 涵蓋天數，適合比較記錄天數不同的帳號。</dd>
          </dl>
        </section>
      </div>`;

    $('#setForm', view).addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const v = form.currencyName.value.trim();
      if (!v) { setFieldErrors(form, { currencyName: '請輸入貨幣名稱' }); return; }
      safely(() => { Store.updateSettings({ currencyName: v }); toast(`貨幣名稱已改為「${v}」`); });
    });
    $$('input[name="salesDay"]', view).forEach((inp) => inp.addEventListener('change', () => {
      safely(() => {
        Store.updateSettings({ salesDay: inp.value === 'same' ? 'same' : 'prev' });
        toast(inp.value === 'same' ? 'Sales 改為算在記錄當天' : 'Sales 改為算在前一天');
      });
    }));
    $('#restoreBtn', view).addEventListener('click', restoreFlow);
    const logoutBtn = $('#logoutBtn', view);
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      if (await confirmDialog({ title: '登出', message: '登出後要再用 Google 登入才能使用。這台裝置和雲端的資料都不會被刪除。', confirmText: '登出' })) window.GCTAuth.logout();
    });
    const syncAuthBtn = $('#syncAuthBtn', view);
    if (syncAuthBtn) syncAuthBtn.addEventListener('click', () => window.GCTAuth.reconnect());
    updateSyncIndicator();
    const copyUrl = $('#copyUrl', view);
    if (copyUrl) copyUrl.addEventListener('click', () => {
      const url = location.origin + location.pathname;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
        .then(() => toast('已複製網址'))
        .catch(() => toast('無法自動複製，請手動選取網址', 'info'));
    });
    $('#exportCsvBtn', view).addEventListener('click', () => {
      if (!Store.state.records.length) { toast('目前沒有記錄可匯出', 'info'); return; }
      download(`game-currency-records-${D.todayISO()}.csv`, CSV.exportRecords(Store.state.records), 'text/csv;charset=utf-8');
      toast(`已匯出 ${Store.state.records.length} 筆記錄`);
    });
    $('#templateBtn', view).addEventListener('click', () => download('game-currency-template.csv', CSV.template(), 'text/csv;charset=utf-8'));
    const undo = $('#undoBtn', view);
    if (undo) undo.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: '復原資料', message: '要以暫存的資料取代目前所有資料嗎？', confirmText: '復原' }))) return;
      safely(() => { Store.restorePrevious(); toast('已復原先前的資料'); });
    });
    $('#clearBtn', view).addEventListener('click', clearFlow);
  }

  function backupNow() {
    const payload = { app: 'game-currency-tracker', exportedAt: new Date().toISOString(), ...Store.state };
    download(`game-currency-backup-${D.todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    safely(() => Store.markBackup());
    toast('已下載備份檔');
  }

  async function restoreFlow() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    let data;
    try { data = normalizeState(JSON.parse(await readText(file))); } catch (e) {
      toast(`無法還原：${e instanceof SyntaxError ? '檔案不是有效的 JSON' : e.message}`, 'error');
      return;
    }
    const ok = await confirmDialog({
      title: '從備份還原',
      message: `備份檔「${esc(file.name)}」包含 <b>${fmt(data.accounts.length)} 個帳號、${fmt(data.records.length)} 筆記錄</b>。<br>還原會<b>取代</b>目前的 ${fmt(Store.accounts().length)} 個帳號、${fmt(Store.state.records.length)} 筆記錄（目前資料會先暫存，可在此頁復原）。`,
      confirmText: '還原', danger: true,
    });
    if (!ok) return;
    safely(() => { Store.replaceState(data); toast('已從備份還原'); });
  }

  function clearFlow() {
    const m = openModal({
      title: '清除所有資料', size: 'modal-sm',
      body: `<p class="confirm-msg">將刪除 <b>${fmt(Store.accounts().length)} 個帳號</b> 與 <b>${fmt(Store.state.records.length)} 筆記錄</b>。清除前會暫存一份，可在「設定與備份」復原一次；但仍建議先下載備份。</p>
        <div class="field"><label for="clr">請輸入「清除」以確認</label><input id="clr" class="input" autocomplete="off"></div>`,
      footer: '<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-danger" data-ok disabled>清除所有資料</button>',
    });
    const inp = $('#clr', m.el); const ok = $('[data-ok]', m.el);
    inp.addEventListener('input', () => { ok.disabled = inp.value.trim() !== '清除'; });
    ok.addEventListener('click', () => {
      safely(() => {
        const next = { version: 1, settings: { ...Store.state.settings }, accounts: [], records: [] };
        Store.replaceState(next);
        ui.dashAccounts = null; saveUI();
        toast('已清除所有資料');
      });
      m.close();
    });
  }

  /* ---------- CSV 匯入 ---------- */
  async function importCsvFlow() {
    const file = await pickFile('.csv,text/csv,.txt');
    if (!file) return;
    const m = openModal({ title: '匯入 CSV', body: `<div class="loading">${'<span class="spinner"></span>'}讀取並檢查「${esc(file.name)}」中…</div>`, size: 'modal-lg' });
    let text;
    try { text = await readText(file); } catch (_) { m.close(); toast('讀取檔案失敗', 'error'); return; }
    if (text.includes('�')) {
      m.close();
      toast('檔案編碼不是 UTF-8。請在 Excel 選「另存新檔 → CSV UTF-8」後再匯入。', 'error');
      return;
    }
    const an = CSV.analyze(text);
    m.close();
    showImportPreview(an, file.name);
  }

  function showImportPreview(an, fileName) {
    if (an.fatal) {
      const m = openModal({
        title: '無法匯入', size: 'modal-sm',
        body: `<div class="notice notice-error compact">${icon('alert')}<div><p>${esc(an.fatal)}</p></div></div>
          <p class="confirm-msg">CSV 第一列需為欄位名稱，支援：<code>${CSV.COLUMNS.join(', ')}</code>（也接受「日期、帳號、餘額、庫存、出貨、備註」等中文名稱）。其中 date、cf_bal 必填，account 與 game_id 至少一個。</p>
          ${an.header ? `<p class="confirm-msg muted">讀到的欄位：${an.header.map(esc).join('、')}</p>` : ''}`,
        footer: '<span class="grow"></span><button type="button" class="btn" data-template>下載範本</button><button type="button" class="btn btn-primary" data-close>知道了</button>',
      });
      $('[data-template]', m.el).addEventListener('click', () => download('game-currency-template.csv', CSV.template(), 'text/csv;charset=utf-8'));
      return;
    }
    const c = an.counts;
    const errors = an.items.filter((it) => it.status === 'error');
    const dups = an.items.filter((it) => it.status === 'duplicate');
    const newAccts = Array.from(an.newAccounts.values());
    const m = openModal({
      title: `匯入預覽：${fileName}`, size: 'modal-lg',
      body: `
        <div class="import-stats">
          <div><span>資料列</span><b>${fmt(c.total)}</b></div>
          <div class="ok"><span>可新增</span><b>${fmt(c.fresh)}</b></div>
          <div class="info"><span>與現有記錄重複</span><b>${fmt(c.duplicate)}</b></div>
          <div class="bad"><span>有錯誤（不匯入）</span><b>${fmt(c.error)}</b></div>
        </div>
        ${an.ignored.length ? `<p class="metric-desc">${icon('info')}<span>以下欄位無法辨識，將忽略：${an.ignored.map(esc).join('、')}</span></p>` : ''}
        ${newAccts.length ? `<div class="import-block"><h4>找不到的帳號（${newAccts.length}）</h4>
          <p class="muted">${newAccts.map((a) => esc(a.name) + (a.gameId ? `（${esc(a.gameId)}）` : '')).join('、')}</p>
          <label class="check-row"><input type="checkbox" id="impCreate" checked><span>自動建立這些帳號（否則略過它們的 ${fmt(c.freshNewAccount)} 列）</span></label></div>` : ''}
        ${dups.length ? `<div class="import-block"><h4>同帳號同日期已有記錄（${dups.length}）</h4>
          <div class="radio-row compact">
            <label class="radio"><input type="radio" name="impDup" value="skip" checked><span><b>略過</b><small>保留現有記錄</small></span></label>
            <label class="radio"><input type="radio" name="impDup" value="overwrite"><span><b>以檔案覆蓋</b><small>用 CSV 的數值取代</small></span></label>
          </div>
          <div class="table-wrap"><table class="table table-sm"><thead><tr><th>列</th><th>日期</th><th>帳號</th><th class="num">現有 CF Bal</th><th class="num">檔案 CF Bal</th></tr></thead>
          <tbody>${dups.slice(0, 8).map((it) => `<tr><td>${it.line}</td><td>${fmtDate(it.value.date)}</td><td>${esc(it.accountName)}</td><td class="num">${fmt(it.existing.balance)}</td><td class="num ${it.existing.balance !== it.value.balance ? 'warn-text' : ''}">${fmt(it.value.balance)}</td></tr>`).join('')}</tbody></table></div>
          ${dups.length > 8 ? `<p class="muted">…另有 ${dups.length - 8} 筆</p>` : ''}</div>` : ''}
        ${errors.length ? `<div class="import-block"><h4 class="warn-text">錯誤（${errors.length}）</h4>
          <ul class="error-list">${errors.slice(0, 30).map((it) => `<li><b>第 ${it.line} 列</b>：${it.errors.map(esc).join('；')}</li>`).join('')}</ul>
          ${errors.length > 30 ? `<p class="muted">…另有 ${errors.length - 30} 列錯誤</p>` : ''}</div>` : ''}`,
      footer: '<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-primary" data-ok></button>',
    });
    const okBtn = $('[data-ok]', m.el);
    const opts = () => ({
      createMissing: $('#impCreate', m.el) ? $('#impCreate', m.el).checked : true,
      overwrite: ($('input[name="impDup"]:checked', m.el) || {}).value === 'overwrite',
    });
    const updateBtn = () => {
      const o = opts();
      const n = c.fresh - (o.createMissing ? 0 : c.freshNewAccount) + (o.overwrite ? c.duplicate : 0);
      okBtn.textContent = n ? `匯入 ${fmt(n)} 筆` : '沒有可匯入的資料';
      okBtn.disabled = !n;
    };
    m.el.addEventListener('change', updateBtn);
    updateBtn();
    okBtn.addEventListener('click', () => {
      safely(() => {
        const res = Store.applyImport(an, opts());
        toast(`匯入完成：新增 ${res.created}、更新 ${res.updated}、略過 ${res.skipped}${res.accountsCreated ? `，建立 ${res.accountsCreated} 個帳號` : ''}`);
      });
      m.close();
    });
  }

  function loadDemo() {
    if (Store.accounts().length) { toast('已有資料時無法載入範例', 'info'); return; }
    ui.dashAccounts = null; saveUI();
    nextRenderEnter = true;
    safely(() => { Store.replaceState(buildDemoState()); toast('已載入範例資料'); });
  }

  /* ================= 啟動 ================= */
  const PAGES = { dashboard: renderDashboard, analytics: renderAnalytics, entry: renderEntry, records: renderRecords, accounts: renderAccounts, settings: renderSettings };
  let nextRenderEnter = false;

  function focusRecordSearch() {
    const go = () => { const q = $('#recQ'); if (q) { q.focus(); q.select(); } };
    if (route().name === 'records') go(); else { location.hash = '#/records'; setTimeout(go, 80); }
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focusRecordSearch(); }
  });

  // 全域按鈕（事件委派）
  document.addEventListener('click', (e) => {
    const th = e.target.closest('[data-theme-set]');
    if (th) { setTheme(th.dataset.themeSet, e); return; }
    const t = e.target.closest('[data-action], [data-edit-record], [data-edit-account]');
    if (!t) return;
    if (t.dataset.editRecord) {
      const r = Store.state.records.find((x) => x.id === t.dataset.editRecord);
      if (r) openRecordModal({ record: r });
      return;
    }
    if (t.dataset.editAccount) { openAccountModal(Store.account(t.dataset.editAccount)); return; }
    switch (t.dataset.action) {
      case 'new-record': openRecordModal(); break;
      case 'cf': openCfModal({ accountId: t.dataset.account || '', date: t.dataset.date || '' }); break;
      case 'ship': openShipModal({ accountId: t.dataset.account || '', date: t.dataset.date || '' }); break;
      case 'new-account': openAccountModal(null); break;
      case 'backup': backupNow(); break;
      case 'import-csv': importCsvFlow(); break;
      case 'demo': loadDemo(); break;
      case 'search': focusRecordSearch(); break;
      case 'sync':
        if (!Sync) break;
        if (Sync.status === 'auth') { window.GCTAuth.reconnect(); break; }
        if (!navigator.onLine) { toast('目前沒有網路，連線後會自動同步', 'info'); break; }
        Sync.syncNow().then(() => {
          if (Sync.status === 'ok') toast('已和雲端同步');
          else if (Sync.status === 'auth') toast('需要重新登入 Google 才能同步', 'info');
          else if (Sync.status === 'error') toast(`同步失敗：${Sync.message}`, 'error');
        });
        break;
      case 'hide-install':
        ui.installHintHidden = true; saveUI();
        $$('.install-hint').forEach((el) => el.remove());
        break;
      case 'toggle-rail':
        ui.railOpen = !ui.railOpen; saveUI();
        document.documentElement.classList.toggle('rail-open', ui.railOpen);
        renderChrome(route().name);
        setTimeout(() => enhanceSegs(document), 460);
        break;
      default: break;
    }
  });

  Store.onChange((source) => {
    // 同步帶進新資料時，如果每日錄入頁還有沒存的輸入，先不重畫，免得輸入被清掉
    if (source === 'sync' && leaveGuard && leaveGuard()) { toast('雲端有新資料，儲存後就會一起顯示', 'info'); return; }
    leaveGuard = null;
    const enter = nextRenderEnter; nextRenderEnter = false;
    render(enter);
  });
  // 同時開多個分頁時，其他分頁存檔後這裡跟著更新，避免舊資料把新資料蓋掉
  window.addEventListener('storage', (e) => {
    if (e.key !== 'gct:data:v1') return;
    Store.load();
    if (leaveGuard && leaveGuard()) { toast('資料已在其他分頁更新；這頁尚未儲存的輸入請重新確認', 'info'); return; }
    render(false);
    toast('資料已在其他分頁更新', 'info');
  });
  // 有設定 Google 登入時，登入完成才載入資料與畫面
  syncThemeColor();
  (window.GCTAuth ? window.GCTAuth.ready : Promise.resolve(null)).then(() => {
    Store.load();
    render(true);
    if (Sync) Sync.start();
  });
})();
