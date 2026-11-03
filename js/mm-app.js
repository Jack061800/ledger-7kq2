/* Maple M：畫面（帳號 → 角色、每天掛機時間和領取警示、紅／黃 Mesos 庫存、Drive 同步）
 * 共用 app.js 的按鈕、卡片、對話框、圖表（window.GCTUI），資料只讀寫 Maple M 自己的 Store。 */
(function () {
  'use strict';

  const { Store, template, parseTime, fmtRemain } = window.GCTMapleM;
  const Drive = window.GCTMMDrive;
  const MMSync = window.GCTMMSync;
  const { D, CSV } = window.GCT;
  const Charts = window.GCTCharts;
  const U = () => window.GCTUI;

  const RED = 'var(--mm-red)';
  const YELLOW = 'var(--mm-yellow)';
  const NAV = [
    { id: 'dashboard', label: '總覽', icon: 'dashboard', sub: 'Maple M：各角色還能掛機多久、有沒有警示，和紅／黃 Mesos 庫存' },
    { id: 'idle', label: '掛機時間', short: '掛機', icon: 'clock', sub: '每個角色還剩多少分鐘可以掛機，距離 240／360 分鐘還差多少' },
    { id: 'mesos', label: 'Mesos 庫存', short: '庫存', icon: 'coin', sub: '各帳號、角色的紅色和黃色 Mesos 餘額與歷史變化' },
    { id: 'sync', label: 'Drive 同步', short: '同步', icon: 'refresh', sub: '從 Google Drive 自動讀 Mesos 資料，或手動匯入、檢查差異' },
    { id: 'chars', label: '帳號與角色', short: '角色', icon: 'accounts', sub: 'Maple M 的帳號，以及每個帳號底下的角色' },
    { id: 'settings', label: 'Maple M 設定', short: '設定', icon: 'settings', sub: '掛機警示規則、備份與還原（只影響 Maple M，不會動到 M Sea）' },
  ];
  const SOURCE_LABEL = { manual: '手動', drive: 'Drive', csv: 'CSV 連結', file: 'CSV 檔', paste: '貼上' };
  const RESULT = {
    added: { label: '新增', cls: 'tag-ok' }, updated: { label: '更新', cls: 'tag-info-s' }, unchanged: { label: '沒變', cls: 'tag-muted' },
    kept: { label: '保留手動', cls: 'tag-warn' }, merged: { label: '較早讀數', cls: 'tag-muted' }, error: { label: '錯誤', cls: 'tag-low' },
  };
  const RESULT_KEYS = ['added', 'updated', 'unchanged', 'kept', 'merged', 'error'];
  // 舊紀錄可能有 skipped
  const resultOf = (k) => RESULT[k] || { label: '跳過', cls: 'tag-muted' };
  const remainText2 = (r) => (r ? `${fmtRemain(r.remain)}` : '—');
  let idleDate = null;

  /* ================= 小工具 ================= */
  const nfm = new Intl.NumberFormat('en-US');
  const fmtMin = (m) => `${nfm.format(Math.round(m))} 分`;
  const fmtMinH = (m) => { const x = Math.round(m); return x >= 60 ? `${fmtMin(x)}（${U().fmtHours(x)}）` : fmtMin(x); };
  const fmtMesos = (n) => (n == null ? '—' : U().fmt(n));
  // 剩餘：355 分 28 秒
  const fmtLeft = (r) => { if (!r) return '—'; const s = r.remain % 60; return `${nfm.format(Math.floor(r.remain / 60))} 分${s ? ` ${s} 秒` : ''}`; };
  const readingWhen = (r) => { if (!r) return '還沒有讀數'; return `讀數：${r.date === D.todayISO() ? '今天' : U().fmtDate(r.date)}${r.time ? ` ${r.time}` : ''}`; };
  const ago = (iso) => {
    if (!iso) return '從未';
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 1 ? '剛剛' : m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : U().fmtDateTime(iso);
  };
  const charAvatar = (c, size = 'xs') => {
    const name = c ? c.name : '?';
    return `<span class="avatar ${size}" style="--c:${c ? Store.color(c.accountId) : '#888'}">${U().esc(Array.from(String(name).trim()).slice(0, 2).join('').toUpperCase())}</span>`;
  };
  const acctAvatar = (a, size = 'sm') => `<span class="avatar ${size}" style="--c:${Store.color(a.id)}">${U().esc(Array.from(String(a.name).trim()).slice(0, 2).join('').toUpperCase())}</span>`;
  const statusTag = (x) => (x.status === 'active' ? '' : '<span class="tag tag-muted">停用</span>');

  function idleMeta(key) {
    const r = Store.rules;
    return {
      none: { label: '沒有讀數', cls: 'none' },
      ok: { label: '正常', cls: 'ok' },
      warn: { label: `超過 ${r.warnAfter} 分`, cls: 'warn' },
      strong: { label: `接近 ${r.cap} 分`, cls: 'strong' },
      over: { label: `超過 ${r.cap} 分・超限`, cls: 'over' },
    }[key];
  }
  const idleBadge = (st) => { const m = idleMeta(st.key); return `<span class="idle-badge ib-${m.cls}">${m.label}</span>`; };
  function idleBar(minutes) {
    const r = Store.rules;
    const left = minutes || 0;
    const scale = Math.max(r.cap * 1.08, left);
    const p = (v) => `${Math.min(100, (v / scale) * 100).toFixed(2)}%`;
    const st = Store.idleStatus(minutes);
    return `<div class="idle-bar ib-${idleMeta(st.key).cls}" role="img" aria-label="${minutes == null ? '沒有讀數' : `還剩 ${minutes} 分`}，每日免費 ${r.dailyFree}、警示 ${r.warnAfter}、上限 ${r.cap}">
      <span class="ib-fill" style="width:${p(left)}"></span>
      <i class="ib-mark" style="left:${p(r.dailyFree)}" title="每日免費 ${r.dailyFree} 分"><b>${r.dailyFree}</b></i>
      <i class="ib-mark is-warn" style="left:${p(r.warnAfter)}" title="超過 ${r.warnAfter} 分開始警示"><b>${r.warnAfter}</b></i>
      <i class="ib-mark is-cap" style="left:${p(r.cap)}" title="累計上限 ${r.cap} 分"><b>${r.cap}</b></i></div>`;
  }
  function remainText(st) {
    const r = Store.rules;
    if (st.key === 'none') return '<span class="muted">還沒有自動戰鬥剩餘的讀數，同步檔案或按「記 Mesos」填入</span>';
    const a = st.toWarn >= 0 ? `距 ${r.warnAfter} 分還差 <b>${fmtMin(st.toWarn)}</b>` : `已超過 ${r.warnAfter} 分 <b class="neg">${fmtMin(-st.toWarn)}</b>`;
    const b = st.toCap >= 0 ? `距 ${r.cap} 分還差 <b>${fmtMin(st.toCap)}</b>` : `超限 <b class="neg">${fmtMin(-st.toCap)}</b>`;
    return `<span>${a}</span><span>${b}</span>`;
  }
  const SEVERITY = { over: 4, strong: 3, warn: 2, ok: 1, none: 0 };

  function emptyMM() {
    const { emptyState, icon } = U();
    return emptyState({
      iconName: 'accounts', title: '先建立 Maple M 的帳號和角色',
      text: 'Maple M 的資料和 M Sea 完全分開。一個帳號底下可以有很多角色：之後會顯示每個角色還能掛機多久，剩餘超過 240／360 分鐘會提醒你；Mesos 庫存可以手動記，或從 Google Drive 自動同步（同步時也會自動建立沒見過的帳號和角色）。',
      actions: `<button class="btn btn-primary" data-mm-action="new-account">${icon('plus')}新增帳號</button><a class="btn" href="#/mm/sync">${icon('refresh')}從 Drive／檔案匯入</a>`,
    });
  }

  /* ---------- 篩選：日期範圍、帳號 ---------- */
  function mmRange() {
    const { ui, fmtDate } = U();
    const today = D.todayISO();
    if (ui.mmRange === 'custom' && D.isISODate(ui.mmStart) && D.isISODate(ui.mmEnd) && ui.mmStart <= ui.mmEnd) return { start: ui.mmStart, end: ui.mmEnd, label: `${fmtDate(ui.mmStart)} – ${fmtDate(ui.mmEnd)}` };
    const n = Number(ui.mmRange) || 30;
    const start = D.addDays(today, -(n - 1));
    return { start, end: today, label: `最近 ${n} 天（${fmtDate(start)} – ${fmtDate(today)}）` };
  }
  function selAccounts() {
    const { ui } = U();
    if (Array.isArray(ui.mmAccounts)) {
      const ids = ui.mmAccounts.filter((id) => Store.account(id));
      if (ids.length || !ui.mmAccounts.length) return ids;
    }
    return Store.accounts().filter((a) => a.status === 'active').map((a) => a.id);
  }
  const selChars = (accIds, activeOnly = true) => Store.characters().filter((c) => accIds.includes(c.accountId) && (!activeOnly || c.status === 'active'));

  function acctPicker(host, selectedIds, onChange, open) {
    const { $, $$, esc, icon } = U();
    const accounts = Store.accounts();
    const sel = new Set(selectedIds);
    const activeIds = accounts.filter((a) => a.status === 'active').map((a) => a.id);
    const label = sel.size === 0 ? '未選擇帳號' : sel.size === accounts.length ? `全部帳號（${sel.size}）` : sel.size === 1 ? Store.account(selectedIds[0]).name : `已選 ${sel.size} 個帳號`;
    host.innerHTML = `<button type="button" class="btn picker-btn" aria-haspopup="true" aria-expanded="${open ? 'true' : 'false'}">${icon('accounts')}<span>${esc(label)}</span>${icon('down', 'icon-sm')}</button>
      <div class="popover" ${open ? '' : 'hidden'}>
        <div class="popover-actions"><button type="button" data-pick="active">只看啟用</button><button type="button" data-pick="all">全選</button><button type="button" data-pick="none">清除</button></div>
        <div class="popover-list">${accounts.map((a) => `<label class="check-row"><input type="checkbox" value="${a.id}" ${sel.has(a.id) ? 'checked' : ''}><span class="swatch" style="background:${Store.color(a.id)}"></span><span class="grow">${esc(a.name)}</span>${a.status !== 'active' ? '<span class="tag tag-muted">停用</span>' : ''}</label>`).join('')}</div>
      </div>`;
    const btn = $('.picker-btn', host); const pop = $('.popover', host);
    btn.addEventListener('click', (e) => { e.stopPropagation(); const willOpen = pop.hidden; $$('.popover').forEach((p) => { p.hidden = true; }); pop.hidden = !willOpen; btn.setAttribute('aria-expanded', String(willOpen)); });
    pop.addEventListener('click', (e) => e.stopPropagation());
    pop.addEventListener('change', () => onChange($$('input:checked', pop).map((i) => i.value)));
    $$('[data-pick]', pop).forEach((b) => b.addEventListener('click', () => { const k = b.dataset.pick; onChange(k === 'all' ? accounts.map((a) => a.id) : k === 'active' ? activeIds : []); }));
  }
  function filterbar({ range = true } = {}) {
    const { ui, esc } = U();
    const today = D.todayISO();
    return `<section class="filterbar card-flat">
      ${range ? `<div class="seg" role="group" aria-label="日期範圍">${[['7', '7 天'], ['30', '30 天'], ['90', '90 天'], ['custom', '自訂']].map(([v, l]) => `<button type="button" class="seg-btn ${ui.mmRange === v ? 'active' : ''}" data-mmrange="${v}" aria-pressed="${ui.mmRange === v}">${l}</button>`).join('')}</div>
      <div class="custom-range" ${ui.mmRange === 'custom' ? '' : 'hidden'}>
        <input type="date" class="input input-sm" data-mmcustom="start" aria-label="開始日期" value="${esc(ui.mmStart)}" max="${today}"><span>至</span>
        <input type="date" class="input input-sm" data-mmcustom="end" aria-label="結束日期" value="${esc(ui.mmEnd)}" max="${today}"></div>` : ''}
      <div class="acct-picker" id="mmPicker"></div>
      <span class="filter-note" id="mmNote"></span></section>`;
  }
  function bindFilterbar(view, update) {
    const { $$, $, ui, saveUI, toast, rerender } = U();
    const today = D.todayISO();
    $$('[data-mmrange]', view).forEach((b) => b.addEventListener('click', () => {
      ui.mmRange = b.dataset.mmrange;
      if (ui.mmRange === 'custom' && !(D.isISODate(ui.mmStart) && D.isISODate(ui.mmEnd))) { ui.mmStart = D.addDays(today, -13); ui.mmEnd = today; }
      saveUI(); rerender();
    }));
    $$('[data-mmcustom]', view).forEach((inp) => inp.addEventListener('change', () => {
      const s = $('[data-mmcustom="start"]', view).value; const e = $('[data-mmcustom="end"]', view).value;
      if (!D.isISODate(s) || !D.isISODate(e)) return;
      if (s > e) { toast('開始日期不能晚於結束日期', 'error'); return; }
      if (D.daysBetween(s, e) > 366) { toast('期間最多一年', 'error'); return; }
      ui.mmStart = s; ui.mmEnd = e; saveUI(); update(false);
    }));
  }
  function pickerUpdate(view, update, open) {
    const { $, ui, saveUI } = U();
    acctPicker($('#mmPicker', view), selAccounts(), (next) => { ui.mmAccounts = next; saveUI(); update(true); }, open);
  }

  function rulesNotice() {
    const r = Store.rules;
    const { icon } = U();
    return `<div class="notice notice-info compact mm-rules">${icon('info')}<div><b>掛機領取規則（只套用在 Maple M）</b>
      <p>每個角色每天免費領取 <b>${r.dailyFree} 分</b>；自動戰鬥剩餘累計上限 <b>${r.cap} 分</b>。剩餘 <b>${r.warnAfter + 1} 分</b>起警示（超過 ${r.warnAfter} 分可能領不到），<b>${r.strongFrom} 分</b>起提醒快到上限，超過 ${r.cap} 分標為超限。</p></div>
      <a class="btn btn-sm btn-ghost" href="#/mm/settings">${icon('settings')}調整</a></div>`;
  }

  // 期間變化：最後的數字減「期間內第一個有數字的那天」（之前沒有記錄的不算成從 0 增加）
  function periodChange(series, k) {
    const has = series.filter((p) => p[k] != null);
    return has.length ? has[has.length - 1][k] - has[0][k] : null;
  }

  // 今天（或某天）所有角色的剩餘和自己記的掛機段落
  function dayRows(chars, date) {
    return chars.map((c) => ({ c, d: Store.dayRemain(c.id, date), idle: Store.dayIdle(c.id, date) }));
  }

  /* ================= 總覽 ================= */
  function renderDashboard(view) {
    const { $, $$, icon, esc, kpiCard, fmtDate, fmtDateWeek, tipHead, fmtSigned, deltaClass } = U();
    if (!Store.accounts().length) { view.innerHTML = emptyMM(); return; }
    view.innerHTML = `${filterbar()}${rulesNotice()}
      <section class="kpi-grid" id="mmKpis"></section>
      <section class="mm-grid">
        <article class="card" id="mmToday"></article>
        <article class="card"><header class="card-head"><div><h3>Mesos 趨勢</h3><p class="card-sub">所選帳號的紅色、黃色合計（沒更新的日子沿用前一次的數字）</p></div><a class="btn btn-sm" href="#/mm/mesos">${icon('coin')}庫存明細</a></header><div id="mmTrend"></div><div class="legend"><span><i style="background:${RED}"></i>紅色 Mesos</span><span><i style="background:${YELLOW}"></i>黃色 Mesos</span></div></article>
      </section>
      <section class="card" id="mmAccts"></section>
      <section id="mmSyncLine"></section>`;
    bindFilterbar(view, update);

    function update(open) {
      Charts.cleanup();
      pickerUpdate(view, update, open);
      const range = mmRange();
      $('#mmNote', view).textContent = range.label;
      const today = D.todayISO();
      const ids = selAccounts();
      const chars = selChars(ids);
      const rows = dayRows(chars, today);
      const total = rows.reduce((t, r) => t + (r.d.minutes || 0), 0);
      const active = rows.filter((r) => r.d.reading);
      const by = (k) => rows.filter((r) => r.d.status.key === k).length;
      const warns = by('warn') + by('strong') + by('over');
      const series = Store.series(chars.map((c) => c.id), range.start, range.end);
      const last = series[series.length - 1] || {};
      const chg = (k) => periodChange(series, k);
      const unit = (t) => `<small class="unit">${t}</small>`;
      $('#mmKpis', view).innerHTML = [
        kpiCard({ ic: 'clock', tone: 'blue', label: '剩餘可掛機合計', value: total ? `${+(total / 60).toFixed(1)}${unit('小時')}` : '<span class="muted">0</span>', sub: chars.length ? `${active.length} / ${chars.length} 個角色有讀數` : '所選帳號沒有角色', tip: '所選帳號底下所有啟用角色，最近一次自動戰鬥剩餘的加總。' }),
        kpiCard({ ic: 'alert', tone: warns ? 'rose' : 'green', label: '警示角色', value: `${warns}${unit('個')}`, sub: warns ? `超限 ${by('over')} · 快到上限 ${by('strong')} · 超過 ${Store.rules.warnAfter} 分 ${by('warn')}` : `沒有角色的剩餘超過 ${Store.rules.warnAfter} 分`, tip: `自動戰鬥剩餘超過 ${Store.rules.warnAfter} 分可能無法領取；${Store.rules.strongFrom} 分起接近上限；超過 ${Store.rules.cap} 分為超限。` }),
        kpiCard({ ic: 'coin', tone: 'rose', label: '紅色 Mesos', value: fmtMesos(last.red), sub: last.red == null ? '還沒有庫存記錄' : `期間 <span class="${deltaClass(chg('red'))}">${fmtSigned(chg('red'))}</span>`, tip: '每個角色最近一次記錄的紅色 Mesos 加總。' }),
        kpiCard({ ic: 'coin', tone: 'gold', label: '黃色 Mesos', value: fmtMesos(last.yellow), sub: last.yellow == null ? '還沒有庫存記錄' : `期間 <span class="${deltaClass(chg('yellow'))}">${fmtSigned(chg('yellow'))}</span>`, tip: '每個角色最近一次記錄的黃色 Mesos 加總。' }),
      ].join('');

      // 今天各角色（嚴重的排前面）
      const sorted = rows.slice().sort((a, b) => SEVERITY[b.d.status.key] - SEVERITY[a.d.status.key] || (b.d.minutes || 0) - (a.d.minutes || 0));
      const shown = sorted.slice(0, 10);
      $('#mmToday', view).innerHTML = `<header class="card-head"><div><h3>各角色還能掛機多久 · ${fmtDateWeek(today)}</h3><p class="card-sub">最近一次的自動戰鬥剩餘；點角色看明細</p></div><a class="btn btn-sm" href="#/mm/idle">${icon('clock')}全部角色</a></header>
        ${!chars.length ? `<div class="mini-empty">${icon('accounts')}所選帳號還沒有角色，<a href="#/mm/chars">去新增</a></div>`
          : `<div class="idle-mini">${shown.map(({ c, d }) => `<button type="button" class="im-row" data-day="${c.id}">
            <span class="cell-acct">${charAvatar(c)}<span><b>${esc(c.name)}</b><small>${esc(readingWhen(d.reading))}</small></span></span>
            <span class="im-total"><b>${fmtLeft(d.reading)}</b>${idleBadge(d.status)}</span>
            ${idleBar(d.minutes)}</button>`).join('')}</div>
            ${sorted.length > shown.length ? `<p class="card-note">還有 ${sorted.length - shown.length} 個角色，<a href="#/mm/idle">看全部</a></p>` : ''}`}`;
      $$('[data-day]', view).forEach((b) => b.addEventListener('click', () => openDayDetail(b.dataset.day, today)));

      // 趨勢
      const host = $('#mmTrend', view);
      if (!series.some((p) => p.red != null || p.yellow != null)) {
        host.innerHTML = `<div class="chart-empty" style="height:200px">${icon('coin')} 這段期間還沒有 Mesos 庫存記錄。<a href="#/mm/sync">從 Drive 同步</a>或按「記 Mesos」。</div>`;
      } else {
        Charts.lineChart(host, {
          labels: series.map((p) => p.date), height: 230, dots: series.length <= 31, smooth: true, ariaLabel: '紅色與黃色 Mesos 趨勢',
          series: [
            { name: '紅色', color: RED, values: series.map((p) => p.red), connect: true },
            { name: '黃色', color: YELLOW, values: series.map((p) => p.yellow), connect: true },
          ],
          tooltip: (i) => `${tipHead(series[i].date)}<div class="tip-row"><span class="swatch" style="background:${RED}"></span>紅色 <b>${fmtMesos(series[i].red)}</b></div><div class="tip-row"><span class="swatch" style="background:${YELLOW}"></span>黃色 <b>${fmtMesos(series[i].yellow)}</b></div><div class="tip-note">${series[i].updates ? `這天有 ${series[i].updates} 筆更新` : '這天沒有更新，沿用之前的數字'}</div>`,
        });
      }

      // 各帳號
      const accRows = ids.map((id) => Store.account(id)).filter(Boolean).map((a) => {
        const cs = Store.characters(a.id).filter((c) => c.status === 'active');
        const s = Store.series(cs.map((c) => c.id), range.start, range.end);
        const l = s[s.length - 1] || {};
        const idle = cs.reduce((t, c) => t + (Store.dayRemain(c.id, today).minutes || 0), 0);
        const warn = cs.filter((c) => SEVERITY[Store.dayRemain(c.id, today).status.key] >= 2).length;
        return { a, cs, l, dr: periodChange(s, 'red'), dy: periodChange(s, 'yellow'), idle, warn };
      });
      const dcell = (n) => (n == null ? '—' : `<span class="delta ${deltaClass(n)}">${fmtSigned(n)}</span>`);
      $('#mmAccts', view).innerHTML = `<header class="card-head"><div><h3>各帳號</h3><p class="card-sub">剩餘可掛機、警示和 Mesos 庫存（期間 = 這段期間的變化）</p></div><a class="btn btn-sm" href="#/mm/chars">${icon('accounts')}帳號與角色</a></header>
        ${accRows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>帳號</th><th class="num">角色</th><th class="num">剩餘合計</th><th>警示</th><th class="num">紅色</th><th class="num">期間</th><th class="num">黃色</th><th class="num">期間</th></tr></thead>
          <tbody>${accRows.map(({ a, cs, l, dr, dy, idle, warn }) => `<tr><td><span class="cell-acct">${acctAvatar(a, 'xs')}<span>${esc(a.name)}</span></span></td><td class="num">${cs.length}</td><td class="num">${idle ? fmtMin(idle) : '<span class="muted">—</span>'}</td>
            <td>${warn ? `<span class="idle-badge ib-warn">${warn} 個角色</span>` : '<span class="muted">—</span>'}</td>
            <td class="num">${fmtMesos(l.red)}</td><td class="num">${dcell(dr)}</td>
            <td class="num">${fmtMesos(l.yellow)}</td><td class="num">${dcell(dy)}</td></tr>`).join('')}</tbody></table></div>`
          : `<div class="mini-empty">${icon('accounts')}沒有選擇帳號</div>`}`;
      $('#mmSyncLine', view).innerHTML = syncLine();
    }
    update(false);
  }

  function syncLine() {
    const { icon, esc } = U();
    const d = Store.drive; const st = Store.driveStatus();
    if (!d.type) return `<p class="card-note">${icon('refresh')}還沒設定 Drive 自動同步。<a href="#/mm/sync">設定</a></p>`;
    const bad = st.lastStatus === 'error' || st.lastStatus === 'auth';
    return `<p class="card-note ${bad ? 'neg' : ''}">${icon(bad ? 'alert' : 'refresh')}Drive 同步：${bad ? esc(st.lastError) : `最後檢查 ${ago(st.lastCheckAt)}${st.lastSyncAt ? `，${st.lastStatus === 'ok' ? '有更新' : '沒有變化'}` : ''}`}　<a href="#/mm/sync">查看</a></p>`;
  }

  /* ================= 掛機時間 ================= */
  function renderIdle(view, params) {
    const { $, $$, icon, esc, fmtDate, fmtDateWeek, ui, saveUI, rerender } = U();
    if (!Store.accounts().length) { view.innerHTML = emptyMM(); return; }
    const today = D.todayISO();
    if (params.get('date') && D.isISODate(params.get('date'))) idleDate = params.get('date');
    if (!idleDate || idleDate > today) idleDate = today;
    const date = idleDate;
    $('#pageActions').innerHTML = `<button type="button" class="btn btn-primary" data-mm-action="session" data-date="${date}">${icon('plus')}記一段掛機</button>`;
    view.innerHTML = `<section class="filterbar card-flat">
        <div class="date-nav"><button type="button" class="icon-btn" data-dnav="-1" aria-label="前一天">${icon('left')}</button>
          <input type="date" class="input" id="mmDate" value="${date}" max="${today}" aria-label="日期">
          <button type="button" class="icon-btn" data-dnav="1" aria-label="後一天" ${date >= today ? 'disabled' : ''}>${icon('right')}</button></div>
        ${date !== today ? `<button type="button" class="btn btn-sm" data-dnav="today">回到今天</button>` : ''}
        <div class="acct-picker" id="mmPicker"></div>
        <span class="filter-note">${fmtDateWeek(date)}${date === today ? '（今天）' : ''}</span></section>
      ${rulesNotice()}
      <div id="mmIdleList" class="mm-stack"></div>
      <section class="card" id="mmPeriod"></section>`;
    const go = (d) => { idleDate = d; rerender(); };
    $$('[data-dnav]', view).forEach((b) => b.addEventListener('click', () => { const v = b.dataset.dnav; go(v === 'today' ? today : D.addDays(date, Number(v)) > today ? today : D.addDays(date, Number(v))); }));
    $('#mmDate', view).addEventListener('change', (e) => { if (D.isISODate(e.target.value)) go(e.target.value > today ? today : e.target.value); });

    function update(open) {
      pickerUpdate(view, update, open);
      const ids = selAccounts();
      const list = $('#mmIdleList', view);
      if (!ids.length) { list.innerHTML = `<div class="mini-empty">${icon('accounts')}沒有選擇帳號</div>`; $('#mmPeriod', view).innerHTML = ''; return; }
      list.innerHTML = ids.map((id) => Store.account(id)).filter(Boolean).map((a) => {
        // 停用的角色：那天有記錄才顯示
        const cs = Store.characters(a.id).filter((c) => c.status === 'active' || Store.sessionsFor(c.id, date).length);
        const rows = dayRows(cs, date);
        const sum = rows.reduce((t, r) => t + (r.d.minutes || 0), 0);
        const warn = rows.filter((r) => SEVERITY[r.d.status.key] >= 2).length;
        return `<article class="card mm-acct"><header class="card-head"><div class="cell-acct">${acctAvatar(a)}<span><h3>${esc(a.name)} ${statusTag(a)}</h3><p class="card-sub">${cs.length} 個角色 · 剩餘合計 ${fmtMinH(sum)}${warn ? ` · <span class="neg">${warn} 個警示</span>` : ''}</p></span></div>
          <button type="button" class="btn btn-sm" data-mm-action="new-char" data-account="${a.id}">${icon('plus')}新增角色</button></header>
          ${rows.length ? `<div class="idle-list">${rows.map(({ c, d, idle }) => `<div class="idle-row ${d.status.key !== 'none' ? `is-${idleMeta(d.status.key).cls}` : ''}">
              <button type="button" class="ir-who" data-day="${c.id}"><span class="cell-acct">${charAvatar(c, 'sm')}<span><b>${esc(c.name)}</b><small>${esc(c.job || '')}${c.status !== 'active' ? ' · 停用' : ''}</small></span></span></button>
              <div class="ir-total"><b>${fmtLeft(d.reading)}</b>${idleBadge(d.status)}</div>
              <div class="ir-bar">${idleBar(d.minutes)}<div class="ir-meta">${remainText(d.status)}</div></div>
              <div class="ir-info"><span>${esc(readingWhen(d.reading))}</span>${idle.sessions.length ? `<span>自己記 ${idle.sessions.length} 段，${fmtMin(idle.total)}</span>` : ''}${idle.conflicts.size ? `<span class="mm-conflict" title="有時段重疊，重疊的 ${idle.overlap} 分只算一次">${icon('alert', 'icon-xs')}重疊 ${idle.overlap} 分</span>` : ''}</div>
              <div class="row-actions"><button type="button" class="icon-btn" data-mm-action="session" data-char="${c.id}" data-date="${date}" title="加一段掛機" aria-label="為 ${esc(c.name)} 加一段掛機">${icon('plus')}</button>
                <button type="button" class="icon-btn" data-day="${c.id}" title="看明細" aria-label="${esc(c.name)} 的明細">${icon('list')}</button></div>
            </div>`).join('')}</div>` : `<div class="mini-empty">${icon('accounts')}這個帳號還沒有角色</div>`}
        </article>`;
      }).join('');
      $$('[data-day]', list).forEach((b) => b.addEventListener('click', () => openDayDetail(b.dataset.day, date)));
      renderPeriod($('#mmPeriod', view), ids);
    }
    update(false);
  }

  // 期間統計：每個角色在一段期間內的自動戰鬥剩餘（只算那天有讀數的日子）
  function renderPeriod(card, ids) {
    const { $$, icon, esc, ui, saveUI, rerender } = U();
    const range = mmRange();
    const days = D.eachDay(range.start, range.end);
    const r = Store.rules;
    const chars = selChars(ids, false);
    const stats = chars.map((c) => {
      const on = days.map((d) => Store.remainOn(c.id, d)).filter((m) => m != null);
      return {
        c, days: on.length, avg: on.length ? on.reduce((t, m) => t + m, 0) / on.length : null, max: on.length ? Math.max(...on) : null,
        warn: on.filter((m) => m > r.warnAfter).length, over: on.filter((m) => m > r.cap).length,
      };
    }).filter((s) => s.days || s.c.status === 'active');
    card.innerHTML = `<header class="card-head"><div><h3>期間統計</h3><p class="card-sub">${esc(range.label)}：每個角色有讀數的天數、平均剩餘、最多一天，剩餘超過 ${r.warnAfter}／${r.cap} 分的天數。點一列看每天的數字。</p></div>
      <div class="seg seg-sm" role="group" aria-label="期間">${[['7', '7 天'], ['30', '30 天'], ['90', '90 天']].map(([v, l]) => `<button type="button" class="seg-btn ${ui.mmRange === v ? 'active' : ''}" data-prange="${v}">${l}</button>`).join('')}</div></header>
      ${stats.some((s) => s.days) ? `<div class="table-wrap"><table class="table"><thead><tr><th>角色</th><th>帳號</th><th class="num">有讀數</th><th class="num">平均剩餘</th><th class="num">最多一天</th><th class="num">超過 ${r.warnAfter}</th><th class="num">超限</th></tr></thead>
        <tbody>${stats.map((s) => `<tr class="is-click" data-hist="${s.c.id}" tabindex="0"><td><span class="cell-acct">${charAvatar(s.c)}<span>${esc(s.c.name)}</span></span></td><td>${esc(Store.account(s.c.accountId).name)}</td>
          <td class="num">${s.days} 天</td><td class="num">${s.avg == null ? '—' : fmtMin(s.avg)}</td><td class="num">${s.max == null ? '—' : fmtMin(s.max)}</td>
          <td class="num">${s.warn ? `<span class="idle-badge ib-warn">${s.warn} 天</span>` : '0'}</td><td class="num">${s.over ? `<span class="idle-badge ib-over">${s.over} 天</span>` : '0'}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="mini-empty">${icon('clock')}這段期間還沒有自動戰鬥剩餘的讀數</div>`}`;
    $$('[data-prange]', card).forEach((b) => b.addEventListener('click', () => { ui.mmRange = b.dataset.prange; saveUI(); rerender(); }));
    $$('[data-hist]', card).forEach((tr) => {
      const open = () => openIdleHistory(tr.dataset.hist, range);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  }

  function openIdleHistory(charId, range) {
    const { openModal, $, $$, esc, icon, fmtDateWeek } = U();
    const c = Store.character(charId);
    const days = D.eachDay(range.start, range.end).reverse();
    const m = openModal({ title: `${c.name} · 每天剩餘`, size: 'modal-lg', body: '<div id="ihBody"></div>' });
    const draw = () => {
      const rows = days.map((d) => ({ d, left: Store.remainOn(charId, d), x: Store.dayIdle(charId, d) }));
      $('#ihBody', m.el).innerHTML = `<p class="muted">${esc(Store.account(c.accountId).name)} · ${esc(range.label)}。每天最後一次的讀數，點一天看明細。</p>
        <ul class="md-list">${rows.map(({ d, left, x }) => `<li class="md-item ih-item" data-d="${d}" tabindex="0"><div class="md-when"><b>${fmtDateWeek(d)}</b><small>${x.sessions.length ? `自己記 ${x.sessions.length} 段` : ''}</small></div>
          <div class="ih-bar">${idleBar(left)}</div><div class="md-what"><b>${left == null ? '—' : fmtMin(left)}</b>${idleBadge(Store.idleStatus(left))}${x.conflicts.size ? `<span class="mm-conflict">${icon('alert', 'icon-xs')}重疊</span>` : ''}</div></li>`).join('')}</ul>`;
      $$('[data-d]', m.el).forEach((li) => {
        const open = () => openDayDetail(charId, li.dataset.d, draw);
        li.addEventListener('click', open);
        li.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      });
    };
    draw();
  }

  // 某角色某天的每一段掛機記錄
  function openDayDetail(charId, date, onChanged) {
    const { openModal, $, $$, esc, icon, fmtDateWeek, fmtStamp, confirmDialog, toast, safely } = U();
    const c = Store.character(charId);
    if (!c) return;
    const m = openModal({ title: `${c.name} · ${fmtDateWeek(date)}`, size: 'modal-lg', body: '<div id="ddBody"></div>' });
    const draw = () => {
      if (!Store.character(charId)) { m.close(); return; }
      const d = Store.dayIdle(charId, date);
      const left = Store.dayRemain(charId, date);
      const r = Store.rules;
      $('#ddBody', m.el).innerHTML = `
        <div class="dd-sum ib-${idleMeta(left.status.key).cls}"><div class="dd-total"><small>還能掛機</small><b>${fmtLeft(left.reading)}</b>${idleBadge(left.status)}<small>${esc(readingWhen(left.reading))}</small></div>
          <div class="grow">${idleBar(left.minutes)}<div class="ir-meta">${remainText(left.status)}</div></div></div>
        ${left.status.key === 'over' ? `<div class="notice notice-error compact">${icon('alert')}<div><b>超過累計上限 ${r.cap} 分</b><p>剩餘比上限多 ${left.minutes - r.cap} 分。</p></div></div>`
          : left.status.key === 'strong' ? `<div class="notice notice-error compact">${icon('alert')}<div><b>快到上限：再 ${r.cap - left.minutes} 分就到 ${r.cap} 分</b><p>剩餘已經超過 ${r.warnAfter} 分，可能領不到每日 ${r.dailyFree} 分。</p></div></div>`
            : left.status.key === 'warn' ? `<div class="notice notice-warn compact">${icon('alert')}<div><b>剩餘已超過 ${r.warnAfter} 分</b><p>可能領不到每日 ${r.dailyFree} 分。</p></div></div>` : ''}
        ${d.conflicts.size ? `<div class="notice notice-warn compact">${icon('alert')}<div><b>有 ${d.conflicts.size} 段時間重疊</b><p>重疊的 ${d.overlap} 分只算一次，累計時間沒有重複計算。標記「重疊」的記錄可能記錯了，請檢查或刪除。</p></div></div>` : ''}
        ${d.untimed && d.sessions.some((x) => x.start) ? `<p class="field-hint">只填時長的記錄（${d.untimed} 分）沒有起訖時間，無法檢查是否重疊，直接加總。</p>` : ''}
        <div class="dd-head"><b>${d.sessions.length ? `自己記的掛機：${d.sessions.length} 段，合計 ${fmtMinH(d.total)}` : '自己記的掛機：還沒有記錄'}</b><span class="grow"></span><button type="button" class="btn btn-sm btn-primary" data-add>${icon('plus')}加一段</button></div>
        ${d.sessions.length ? `<ul class="md-list">${d.sessions.map((x) => `<li class="md-item ss-item ${d.conflicts.has(x.id) ? 'is-conflict' : ''}">
          <div class="md-when"><b>${x.start ? `${x.start} – ${x.end}` : '只填時長'}</b><small>${x.start && parseTime(x.end) <= parseTime(x.start) ? '跨過午夜' : ''}</small></div>
          <div class="md-what"><b>${fmtMin(x.minutes)}</b>${d.conflicts.has(x.id) ? `<span class="mm-conflict">${icon('alert', 'icon-xs')}重疊</span>` : ''}<span>${esc(x.note)}</span>
            <small class="muted">記錄於 ${fmtStamp(x.createdAt)}${x.updatedAt.slice(0, 16) !== x.createdAt.slice(0, 16) ? ` · 修改於 ${fmtStamp(x.updatedAt)}` : ''}</small></div>
          <div class="row-actions"><button type="button" class="icon-btn" data-edit="${x.id}" aria-label="修改" title="修改">${icon('edit')}</button><button type="button" class="icon-btn danger" data-del="${x.id}" aria-label="刪除" title="刪除">${icon('trash')}</button></div></li>`).join('')}</ul>`
          : `<div class="mini-empty">${icon('clock')}這天沒有自己記的掛機。上面的剩餘是檔案裡的讀數，不用另外記。</div>`}`;
      const changed = () => { draw(); if (onChanged) onChanged(); };
      $('[data-add]', m.el).addEventListener('click', () => openSessionModal({ charId, date, onSaved: changed }));
      $$('[data-edit]', m.el).forEach((b) => b.addEventListener('click', () => openSessionModal({ session: Store.state.sessions.find((x) => x.id === b.dataset.edit), onSaved: changed })));
      $$('[data-del]', m.el).forEach((b) => b.addEventListener('click', async () => {
        const x = Store.state.sessions.find((y) => y.id === b.dataset.del);
        if (!x) return;
        const ok = await confirmDialog({ title: '刪除這段掛機', message: `刪除 <b>${esc(c.name)}</b> ${x.start ? `${x.start}–${x.end}` : ''}（${x.minutes} 分）這段記錄？累計時間會馬上重算。`, confirmText: '刪除', danger: true });
        if (!ok) return;
        safely(() => { Store.deleteSession(x.id); toast('已刪除，累計時間已更新'); changed(); });
      }));
    };
    draw();
  }

  function charOptions(selected, includeInactive) {
    const { esc } = U();
    return Store.accounts().map((a) => {
      const cs = Store.characters(a.id).filter((c) => includeInactive || c.status === 'active' || c.id === selected);
      return cs.length ? `<optgroup label="${esc(a.name)}">${cs.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}${c.job ? `（${esc(c.job)}）` : ''}</option>`).join('')}</optgroup>` : '';
    }).join('');
  }

  // 新增／修改一段掛機
  function openSessionModal({ session = null, charId = '', date = '', onSaved } = {}) {
    const { openModal, $, $$, esc, icon, toast, setFieldErrors, confirmDialog, ui, saveUI } = U();
    if (!Store.characters().length) { toast('請先新增角色', 'info'); location.hash = '#/mm/chars'; return; }
    const s = session || { charId: charId || ui.mmLastChar || '', date: date || D.todayISO(), start: '', end: '', minutes: '', note: '' };
    if (!Store.character(s.charId)) s.charId = Store.characters().find((c) => c.status === 'active') ? Store.characters().find((c) => c.status === 'active').id : Store.characters()[0].id;
    let mode = session ? (session.start ? 'time' : 'dur') : (ui.mmSessMode || 'time');
    const m = openModal({
      title: session ? '修改掛機記錄' : '記一段掛機',
      body: `<form class="form" id="ssForm" novalidate>
        <div class="form-row"><div class="field"><label for="ss-char">角色 <em class="req">必填</em></label><select id="ss-char" name="charId" class="input">${charOptions(s.charId, !!session)}</select><span class="field-error"></span></div>
          <div class="field"><label for="ss-date">日期</label><input id="ss-date" name="date" type="date" class="input" value="${s.date}" max="${D.todayISO()}"><span class="field-error"></span></div></div>
        <div class="seg seg-sm seg-block" role="group" aria-label="記錄方式"><button type="button" class="seg-btn" data-mode="time">開始／結束時間</button><button type="button" class="seg-btn" data-mode="dur">只填時長</button></div>
        <div class="form-row" data-for="time"><div class="field"><label for="ss-start">開始</label><input id="ss-start" name="start" type="time" class="input" value="${esc(s.start)}"><span class="field-error"></span></div>
          <div class="field"><label for="ss-end">結束</label><input id="ss-end" name="end" type="time" class="input" value="${esc(s.end)}"><span class="field-hint">結束比開始早 = 跨過午夜（整段算在開始那天）</span><span class="field-error"></span></div></div>
        <div class="field" data-for="dur"><label for="ss-min">時長（分鐘）</label><div class="input-group"><input id="ss-min" name="minutes" class="input num" inputmode="numeric" value="${s.start ? '' : esc(s.minutes)}" placeholder="例如 120" style="max-width:140px"><span class="input-suffix">分</span></div>
          <div class="chips ss-quick">${[30, 60, 120, 180, 240].map((n) => `<button type="button" class="chip" data-min="${n}">${n}</button>`).join('')}</div>
          <span class="field-hint">只填時長無法檢查是否和其他時段重疊；知道起訖時間的話，用「開始／結束時間」比較準。</span><span class="field-error"></span></div>
        <div class="field"><label for="ss-note">備註</label><input id="ss-note" name="note" class="input" maxlength="200" value="${esc(s.note)}" placeholder="選填，例如：地圖、用了什麼加成"></div>
        <div class="ss-preview" id="ssPreview" aria-live="polite"></div>
      </form>`,
      footer: `<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-primary" data-save>${session ? '儲存' : '新增'}</button>`,
    });
    const form = $('#ssForm', m.el);
    const input = () => ({ charId: form.charId.value, date: form.date.value, start: mode === 'time' ? form.start.value : '', end: mode === 'time' ? form.end.value : '', minutes: mode === 'dur' ? form.minutes.value.replace(/,/g, '') : '', note: form.note.value });
    const setMode = (k) => {
      mode = k;
      $$('[data-mode]', m.el).forEach((b) => { b.classList.toggle('active', b.dataset.mode === k); b.setAttribute('aria-pressed', String(b.dataset.mode === k)); });
      $$('[data-for]', m.el).forEach((el) => { el.hidden = el.dataset.for !== k; });
      preview();
    };
    function preview() {
      const box = $('#ssPreview', m.el);
      let chk;
      try { chk = Store.checkSession(input(), session && session.id); } catch (e) { box.innerHTML = ''; return; }
      if (chk.duplicate) { box.innerHTML = `<div class="notice notice-error compact">${icon('alert')}<div><b>重複的記錄</b><p>這個角色這天已經有一模一樣的時段，不能再存一次。</p></div></div>`; return; }
      const a = chk.after;
      box.innerHTML = `<div class="ss-sum"><span>這段 <b>${fmtMin(chk.v.minutes)}</b>${chk.v.start ? `（${chk.v.start}–${chk.v.end}）` : ''}</span><span>存了之後這天合計 <b>${fmtMin(a.total)}</b></span></div>
        <span class="field-hint">這只是你自己的記錄，不會改變「還能掛機」的剩餘；剩餘以檔案裡最新的讀數為準。</span>
        ${chk.overlaps.length ? `<div class="notice notice-warn compact">${icon('alert')}<div><b>和其他時段重疊</b><p>${chk.overlaps.map((o) => `${o.session.start}–${o.session.end}（重疊 ${o.minutes} 分）`).join('、')}。重疊的時間只算一次。</p></div></div>` : ''}
        ${chk.maybeDuplicate ? `<div class="notice notice-warn compact">${icon('alert')}<div><b>可能重複</b><p>這天已經有一筆一樣時長、一樣備註的記錄。</p></div></div>` : ''}`;
    }
    form.addEventListener('input', preview);
    form.addEventListener('change', preview);
    $$('[data-mode]', m.el).forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode); if (!session) { ui.mmSessMode = b.dataset.mode; saveUI(); } }));
    $$('[data-min]', m.el).forEach((b) => b.addEventListener('click', () => { form.minutes.value = b.dataset.min; preview(); }));
    setMode(mode);
    const save = async () => {
      let chk;
      try { chk = Store.checkSession(input(), session && session.id); } catch (e) { if (e.fieldErrors) setFieldErrors(form, e.fieldErrors); else toast(e.message, 'error'); return; }
      if (chk.duplicate) { setFieldErrors(form, { start: '這個角色這天已經有一模一樣的時段' }); return; }
      if (chk.overlaps.length && !(await confirmDialog({ title: '時段重疊', message: `這段和 ${chk.overlaps.map((o) => `<b>${o.session.start}–${o.session.end}</b>`).join('、')} 重疊。重疊的時間只算一次，不會重複計算。<br>仍要儲存嗎？`, confirmText: '仍要儲存' }))) return;
      if (chk.maybeDuplicate && !(await confirmDialog({ title: '可能重複', message: '這天已經有一筆一樣時長、一樣備註的記錄，確定不是重複記嗎？', confirmText: '仍要儲存' }))) return;
      try {
        const res = Store.saveSession(input(), session && session.id);
        ui.mmLastChar = res.session.charId; saveUI();
        const d = Store.dayIdle(res.session.charId, res.session.date);
        const name = Store.character(res.session.charId).name;
        toast(`已記錄：${name} 這天合計 ${d.total} 分`);
        m.close();
        if (onSaved) onSaved();
      } catch (e) { if (e.fieldErrors) setFieldErrors(form, e.fieldErrors); else toast(e.message, 'error'); }
    };
    $('[data-save]', m.el).addEventListener('click', save);
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } });
  }

  /* ================= Mesos 庫存 ================= */
  function renderMesos(view) {
    const { $, $$, icon, esc, kpiCard, fmtDate, tipHead, fmtSigned, deltaClass, fmtDateTime } = U();
    if (!Store.accounts().length) { view.innerHTML = emptyMM(); return; }
    $('#pageActions').innerHTML = `<a class="btn" href="#/mm/sync">${icon('refresh')}Drive 同步／匯入</a>`;
    view.innerHTML = `${filterbar()}
      <section class="kpi-grid" id="mzKpis"></section>
      <section class="card"><header class="card-head"><div><h3>紅色／黃色 Mesos 趨勢</h3><p class="card-sub">所選帳號每天的合計；沒更新的日子沿用前一次的數字</p></div>
        <div class="seg seg-sm" role="group" aria-label="顯示">${[['both', '紅＋黃'], ['red', '只看紅色'], ['yellow', '只看黃色']].map(([k, l]) => `<button type="button" class="seg-btn ${(U().ui.mmSeries || 'both') === k ? 'active' : ''}" data-ser="${k}">${l}</button>`).join('')}</div></header>
        <div id="mzTrend"></div></section>
      <section class="card" id="mzBal"></section>
      <section class="card" id="mzHist"></section>`;
    bindFilterbar(view, update);
    $$('[data-ser]', view).forEach((b) => b.addEventListener('click', () => { U().ui.mmSeries = b.dataset.ser; U().saveUI(); $$('[data-ser]', view).forEach((x) => x.classList.toggle('active', x === b)); update(false); }));

    function update(open) {
      Charts.cleanup();
      pickerUpdate(view, update, open);
      const range = mmRange();
      $('#mmNote', view).textContent = range.label;
      const ids = selAccounts();
      const chars = selChars(ids, false);
      const series = Store.series(chars.map((c) => c.id), range.start, range.end);
      const last = series[series.length - 1] || {};
      const chg = (k) => periodChange(series, k);
      const updates = Store.state.mesos.filter((x) => x.date >= range.start && x.date <= range.end && chars.some((c) => c.id === x.charId));
      $('#mzKpis', view).innerHTML = [
        kpiCard({ ic: 'coin', tone: 'rose', label: '紅色 Mesos 合計', value: fmtMesos(last.red), sub: last.red == null ? '還沒有記錄' : `${chars.filter((c) => Store.balanceAt(c.id, range.end).red != null).length} 個角色有數字`, tip: '每個角色最近一次的紅色數字加總。' }),
        kpiCard({ ic: 'coin', tone: 'gold', label: '黃色 Mesos 合計', value: fmtMesos(last.yellow), sub: last.yellow == null ? '還沒有記錄' : `${chars.filter((c) => Store.balanceAt(c.id, range.end).yellow != null).length} 個角色有數字`, tip: '每個角色最近一次的黃色數字加總。' }),
        kpiCard({ ic: 'trend', tone: 'blue', label: '期間變化', value: `<span class="${deltaClass(chg('red'))}">${fmtSigned(chg('red'))}</span>`, sub: `黃色 <span class="${deltaClass(chg('yellow'))}">${fmtSigned(chg('yellow'))}</span>`, tip: '期間最後一天的合計減第一天（第一個數字是紅色）。' }),
        kpiCard({ ic: 'refresh', tone: 'green', label: '期間更新', value: `${updates.length}<small class="unit">筆</small>`, sub: updates.length ? `手動 ${updates.filter((x) => x.source === 'manual').length} · 同步／匯入 ${updates.filter((x) => x.source !== 'manual').length}` : '這段期間沒有更新', tip: '這段期間內新增或更新過的庫存記錄數。' }),
      ].join('');

      const host = $('#mzTrend', view);
      const mode = U().ui.mmSeries || 'both';
      if (!series.some((p) => p.red != null || p.yellow != null)) {
        host.innerHTML = `<div class="chart-empty" style="height:220px">${icon('coin')} 這段期間還沒有 Mesos 庫存記錄</div>`;
      } else {
        const ser = [];
        if (mode !== 'yellow') ser.push({ name: '紅色', color: RED, values: series.map((p) => p.red), connect: true, area: mode === 'red' });
        if (mode !== 'red') ser.push({ name: '黃色', color: YELLOW, values: series.map((p) => p.yellow), connect: true, area: mode === 'yellow' });
        Charts.lineChart(host, {
          labels: series.map((p) => p.date), height: 250, dots: series.length <= 31, smooth: true, ariaLabel: 'Mesos 趨勢', series: ser,
          tooltip: (i) => `${tipHead(series[i].date)}${mode !== 'yellow' ? `<div class="tip-row"><span class="swatch" style="background:${RED}"></span>紅色 <b>${fmtMesos(series[i].red)}</b></div>` : ''}${mode !== 'red' ? `<div class="tip-row"><span class="swatch" style="background:${YELLOW}"></span>黃色 <b>${fmtMesos(series[i].yellow)}</b></div>` : ''}<div class="tip-note">${series[i].updates ? `這天有 ${series[i].updates} 筆更新` : '沿用之前的數字'}</div>`,
        });
      }

      // 餘額：帳號 → 角色
      const accs = ids.map((id) => Store.account(id)).filter(Boolean);
      const balRows = accs.map((a) => {
        const cs = Store.characters(a.id).filter((c) => c.status === 'active' || Store.mesosFor(c.id).length);
        const items = cs.map((c) => {
          const b = Store.balanceAt(c.id, range.end);
          const s = Store.series([c.id], range.start, range.end);
          const latest = Store.mesosFor(c.id).filter((x) => x.date <= range.end).pop() || null;
          return { c, b, dr: periodChange(s, 'red'), dy: periodChange(s, 'yellow'), latest };
        });
        const sum = (k) => (items.some((i) => i.b[k] != null) ? items.reduce((t, i) => t + (i.b[k] || 0), 0) : null);
        const sumD = (k) => (items.some((i) => i[k] != null) ? items.reduce((t, i) => t + (i[k] || 0), 0) : null);
        return { a, items, red: sum('red'), yellow: sum('yellow'), dr: sumD('dr'), dy: sumD('dy') };
      });
      const dv = (n) => (n == null ? '<span class="muted">—</span>' : `<span class="delta ${deltaClass(n)}">${fmtSigned(n)}</span>`);
      $('#mzBal', view).innerHTML = `<header class="card-head"><div><h3>各帳號、角色餘額</h3><p class="card-sub">截至 ${fmtDate(range.end)}；期間 = 這段期間的變化（從期間內第一個數字算起）。點角色看歷史、修改或刪除。</p></div></header>
        ${balRows.length ? `<div class="table-wrap"><table class="table mz-table"><thead><tr><th>帳號／角色</th><th class="num">紅色</th><th class="num">期間</th><th class="num">黃色</th><th class="num">期間</th><th class="num">自動戰鬥剩餘</th><th>最後更新</th><th>來源</th></tr></thead><tbody>
          ${balRows.map((r) => `<tr class="mz-acct"><td><span class="cell-acct">${acctAvatar(r.a, 'xs')}<b>${esc(r.a.name)}</b></span></td><td class="num"><b>${fmtMesos(r.red)}</b></td><td class="num">${dv(r.dr)}</td><td class="num"><b>${fmtMesos(r.yellow)}</b></td><td class="num">${dv(r.dy)}</td><td></td><td></td><td></td></tr>
            ${r.items.length ? r.items.map((i) => `<tr class="is-click mz-char" data-mhist="${i.c.id}" tabindex="0"><td><span class="cell-acct">${charAvatar(i.c)}<span>${esc(i.c.name)}${i.c.status !== 'active' ? ' <span class="tag tag-muted">停用</span>' : ''}</span></span></td>
              <td class="num">${fmtMesos(i.b.red)}</td><td class="num">${dv(i.dr)}</td><td class="num">${fmtMesos(i.b.yellow)}</td><td class="num">${dv(i.dy)}</td><td class="num">${remainText2(Store.latestRemain(i.c.id, range.end))}</td>
              <td class="nowrap">${i.latest ? `${fmtDate(i.latest.date)}${i.latest.time ? ` ${i.latest.time}` : ''}` : '<span class="muted">沒有記錄</span>'}</td><td>${i.latest ? `<span class="tag ${i.latest.source === 'manual' ? 'tag-gold' : 'tag-muted'}">${SOURCE_LABEL[i.latest.source] || i.latest.source}</span>` : ''}</td></tr>`).join('')
              : '<tr><td colspan="8" class="muted">這個帳號還沒有角色</td></tr>'}`).join('')}
        </tbody></table></div>` : `<div class="mini-empty">${icon('accounts')}沒有選擇帳號</div>`}`;
      $$('[data-mhist]', view).forEach((tr) => {
        const open = () => openMesosHistory(tr.dataset.mhist);
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      });

      // 期間內的每一筆
      const hist = updates.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.updatedAt.localeCompare(a.updatedAt))).slice(0, 200);
      $('#mzHist', view).innerHTML = `<header class="card-head"><div><h3>期間內的記錄</h3><p class="card-sub">最新的在上面（最多顯示 200 筆）。手動修正過的記錄，之後 Drive 同步預設不會覆蓋。</p></div></header>
        ${hist.length ? `<div class="table-wrap"><table class="table table-sm"><thead><tr><th>日期</th><th>角色</th><th>帳號</th><th class="num">紅色</th><th class="num">黃色</th><th class="num">自動戰鬥剩餘</th><th>來源</th><th>更新時間</th><th class="actions-col"><span class="sr-only">操作</span></th></tr></thead><tbody>
          ${hist.map((x) => { const c = Store.character(x.charId); return `<tr><td class="nowrap">${fmtDate(x.date)}${x.time ? ` ${x.time}` : ''}</td><td>${esc(c.name)}</td><td>${esc(Store.account(c.accountId).name)}</td><td class="num">${fmtMesos(x.red)}</td><td class="num">${fmtMesos(x.yellow)}</td><td class="num">${fmtRemain(x.remain)}</td>
            <td><span class="tag ${x.source === 'manual' ? 'tag-gold' : 'tag-muted'}">${SOURCE_LABEL[x.source] || x.source}</span></td><td class="nowrap muted">${fmtDateTime(x.updatedAt)}</td>
            <td class="actions-col"><div class="row-actions"><button type="button" class="icon-btn" data-mz-edit="${x.id}" aria-label="修改" title="修改">${icon('edit')}</button></div></td></tr>`; }).join('')}
        </tbody></table></div>` : `<div class="mini-empty">${icon('coin')}這段期間沒有記錄。可以<a href="#/mm/sync">從 Drive 同步</a>或按「記 Mesos」。</div>`}`;
      $$('[data-mz-edit]', view).forEach((b) => b.addEventListener('click', () => { const x = Store.state.mesos.find((y) => y.id === b.dataset.mzEdit); if (x) openMesosModal({ snap: x }); }));
    }
    update(false);
  }

  function openMesosHistory(charId) {
    const { openModal, $, $$, esc, icon, fmtDate, fmtDateTime, fmtSigned, deltaClass, confirmDialog, toast, safely } = U();
    const c = Store.character(charId);
    const m = openModal({ title: `${c.name} · Mesos 歷史`, size: 'modal-lg', body: '<div id="mhBody"></div>' });
    const draw = () => {
      const list = Store.mesosFor(charId);
      const rows = list.map((x, i) => {
        // 和前一次有數字的比
        let pr = null; let py = null;
        for (let k = i - 1; k >= 0 && (pr == null || py == null); k--) { if (pr == null && list[k].red != null) pr = list[k].red; if (py == null && list[k].yellow != null) py = list[k].yellow; }
        return { x, dr: x.red != null && pr != null ? x.red - pr : null, dy: x.yellow != null && py != null ? x.yellow - py : null };
      }).reverse();
      const imp = (id) => Store.state.imports.find((b) => b.id === id);
      $('#mhBody', m.el).innerHTML = `<div class="dd-head"><span class="muted">${esc(Store.account(c.accountId).name)} · 共 ${list.length} 筆</span><span class="grow"></span><button type="button" class="btn btn-sm btn-primary" data-add>${icon('plus')}記一筆</button></div>
        ${rows.length ? `<div class="table-wrap"><table class="table table-sm"><thead><tr><th>日期</th><th class="num">紅色</th><th class="num">變化</th><th class="num">黃色</th><th class="num">變化</th><th class="num">剩餘</th><th>來源</th><th class="actions-col"></th></tr></thead><tbody>
          ${rows.map(({ x, dr, dy }) => { const b = x.batchId ? imp(x.batchId) : null; return `<tr><td class="nowrap">${fmtDate(x.date)}${x.time ? ` ${x.time}` : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}</td><td class="num">${fmtMesos(x.red)}</td><td class="num">${dr == null ? '' : `<span class="delta ${deltaClass(dr)}">${fmtSigned(dr)}</span>`}</td>
            <td class="num">${fmtMesos(x.yellow)}</td><td class="num">${dy == null ? '' : `<span class="delta ${deltaClass(dy)}">${fmtSigned(dy)}</span>`}</td><td class="num">${fmtRemain(x.remain)}</td>
            <td><span class="tag ${x.source === 'manual' ? 'tag-gold' : 'tag-muted'}">${SOURCE_LABEL[x.source] || x.source}</span><small>${b ? `${fmtDateTime(b.at)} 匯入` : fmtDateTime(x.updatedAt)}</small></td>
            <td class="actions-col"><div class="row-actions"><button type="button" class="icon-btn" data-edit="${x.id}" aria-label="修改">${icon('edit')}</button><button type="button" class="icon-btn danger" data-del="${x.id}" aria-label="刪除">${icon('trash')}</button></div></td></tr>`; }).join('')}
        </tbody></table></div>` : `<div class="mini-empty">${icon('coin')}還沒有記錄</div>`}`;
      $('[data-add]', m.el).addEventListener('click', () => openMesosModal({ charId, onSaved: draw }));
      $$('[data-edit]', m.el).forEach((b) => b.addEventListener('click', () => openMesosModal({ snap: Store.state.mesos.find((y) => y.id === b.dataset.edit), onSaved: draw })));
      $$('[data-del]', m.el).forEach((b) => b.addEventListener('click', async () => {
        const x = Store.state.mesos.find((y) => y.id === b.dataset.del);
        if (!x) return;
        const ok = await confirmDialog({ title: '刪除庫存記錄', message: `刪除 <b>${esc(c.name)}</b> ${fmtDate(x.date)} 的記錄（紅 ${fmtMesos(x.red)}、黃 ${fmtMesos(x.yellow)}）？${x.source !== 'manual' ? '<br><small>這筆是同步／匯入的，如果 Drive 上還有這筆資料，下次資料有變動時可能會再匯入。</small>' : ''}`, confirmText: '刪除', danger: true });
        if (!ok) return;
        safely(() => { Store.deleteMesos(x.id); toast('已刪除'); draw(); });
      }));
    };
    draw();
  }

  function openMesosModal({ snap = null, charId = '', date = '', onSaved } = {}) {
    const { openModal, $, esc, icon, toast, setFieldErrors, fmtFull, fmtDate, ui, saveUI } = U();
    if (!Store.characters().length) { toast('請先新增角色', 'info'); location.hash = '#/mm/chars'; return; }
    const s = snap || { charId: charId || ui.mmLastChar || '', date: date || D.todayISO(), red: null, yellow: null, remain: null, note: '' };
    if (!Store.character(s.charId)) s.charId = (Store.characters().find((c) => c.status === 'active') || Store.characters()[0]).id;
    const m = openModal({
      title: snap ? '修改 Mesos 記錄' : '記 Mesos 庫存',
      body: `<form class="form" id="mzForm" novalidate>
        <div class="form-row"><div class="field"><label for="mz-char">角色 <em class="req">必填</em></label><select id="mz-char" name="charId" class="input">${charOptions(s.charId, !!snap)}</select><span class="field-error"></span></div>
          <div class="field"><label for="mz-date">日期</label><input id="mz-date" name="date" type="date" class="input" value="${s.date}" max="${D.todayISO()}"><span class="field-error"></span></div></div>
        <div class="form-row"><div class="field mz-red"><label for="mz-red"><span class="swatch" style="background:${RED}"></span> 紅色 Mesos</label><input id="mz-red" name="red" class="input num input-lg" inputmode="numeric" value="${fmtFull(s.red)}" placeholder="例如 12,000,000 或 12m"><span class="field-error"></span></div>
          <div class="field mz-yellow"><label for="mz-yellow"><span class="swatch" style="background:${YELLOW}"></span> 黃色 Mesos</label><input id="mz-yellow" name="yellow" class="input num input-lg" inputmode="numeric" value="${fmtFull(s.yellow)}" placeholder="例如 3.5m"><span class="field-error"></span></div></div>
        <p class="field-hint">可以只填一種，另一種沿用之前的數字。支援 k／m／b 簡寫（1.5b = 1,500,000,000）。</p>
        <div class="field"><label for="mz-remain">自動戰鬥剩餘</label><input id="mz-remain" name="remain" class="input" inputmode="numeric" value="${s.remain == null ? '' : fmtRemain(s.remain)}" placeholder="選填，例如 260:46（分:秒）"><span class="field-error"></span></div>
        <div class="field"><label for="mz-note">備註</label><input id="mz-note" name="note" class="input" maxlength="200" value="${esc(s.note)}" placeholder="選填"></div>
        <div id="mzInfo" class="mz-info"></div>
      </form>`,
      footer: `<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-primary" data-save>儲存</button>`,
    });
    const form = $('#mzForm', m.el);
    const info = () => {
      const c = form.charId.value; const d = form.date.value;
      if (!c || !D.isISODate(d)) { $('#mzInfo', m.el).innerHTML = ''; return; }
      const ex = Store.snapshot(c, d);
      const prev = Store.balanceAt(c, D.addDays(d, -1));
      $('#mzInfo', m.el).innerHTML = `${ex && (!snap || ex.id !== snap.id) ? `<div class="notice notice-info compact">${icon('info')}<div><b>${fmtDate(d)} 已經有記錄</b><p>紅 ${fmtMesos(ex.red)}、黃 ${fmtMesos(ex.yellow)}（${SOURCE_LABEL[ex.source]}）。儲存會更新這筆，並標成「手動」，之後同步預設不會蓋掉。</p></div></div>` : ''}
        <p class="muted">前一次：紅 ${fmtMesos(prev.red)}${prev.redDate ? `（${fmtDate(prev.redDate)}）` : ''}、黃 ${fmtMesos(prev.yellow)}${prev.yellowDate ? `（${fmtDate(prev.yellowDate)}）` : ''}</p>`;
    };
    form.addEventListener('change', info);
    info();
    const save = () => {
      try {
        const x = Store.saveMesos({ charId: form.charId.value, date: form.date.value, red: form.red.value, yellow: form.yellow.value, remain: form.remain.value, note: form.note.value }, snap && snap.id);
        ui.mmLastChar = x.charId; saveUI();
        toast(`已記錄 ${Store.character(x.charId).name} ${fmtDate(x.date)} 的 Mesos`);
        m.close();
        if (onSaved) onSaved();
      } catch (e) { if (e.fieldErrors) setFieldErrors(form, e.fieldErrors); else toast(e.message, 'error'); }
    };
    $('[data-save]', m.el).addEventListener('click', save);
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } });
  }

  /* ================= Drive 同步 ================= */
  const DRIVE_API_URL = 'https://console.cloud.google.com/apis/library/drive.googleapis.com?project=coin-ledger-512414';
  const DATA_ACCESS_URL = 'https://console.cloud.google.com/auth/scopes?project=coin-ledger-512414';
  function renderSync(view) {
    const { $, $$, icon, esc, toast, fmtDateTime, setFieldErrors, safely, rerender, download, pickFile, readText } = U();
    const d = Store.drive; const st = Store.driveStatus();
    const tokenExp = Drive.tokenExp();
    const conn = d.type !== 'sheet' ? '' : !Drive.canAuthorize
      ? `<div class="notice notice-warn compact">${icon('info')}<div><b>這裡不能連接 Google</b><p>Google 只允許在正式網址（jack061800.github.io）授權。正式網址上按「連接 Google」即可；本機測試可以先用「公開 CSV 連結」或匯入檔案。</p></div></div>`
      : tokenExp ? `<div class="notice notice-info compact">${icon('check')}<div><b>已連接 Google Drive（唯讀）</b><p>這台裝置的授權到 ${fmtDateTime(new Date(tokenExp).toISOString())} 有效，之後按「重新連接」即可（不用重新登入）。</p></div><button type="button" class="btn btn-sm" data-disconnect>中斷連接</button></div>`
        : `<div class="notice notice-warn compact">${icon('alert')}<div><b>還沒連接，或授權已過期</b><p>按「連接 Google」會跳到 Google 請你允許。Google 顯示的權限是「查看及下載所有 Drive 檔案」（唯讀，不能修改或刪除）；App 只會下載你在這裡指定的檔案。</p></div><button type="button" class="btn btn-sm btn-primary" data-connect>${icon('refresh')}連接 Google</button></div>`;
    const bad = st.lastStatus === 'error' || st.lastStatus === 'auth';
    $('#pageActions').innerHTML = `<button type="button" class="btn btn-primary" data-sync-now ${d.type ? '' : 'disabled'}>${icon('refresh')}立即同步</button>`;
    view.innerHTML = `
      <section class="card"><header class="card-head"><div><h3>${icon('refresh', 'icon-sm')} 自動同步來源</h3><p class="card-sub">設定好之後，打開 App 時和每 15 分鐘會自動檢查一次；資料沒變就不會重複匯入</p></div></header>
        <div class="sync-status ${bad ? 'is-bad' : st.lastStatus ? 'is-ok' : ''}"><span class="sync-dot is-${bad ? 'error' : st.lastStatus ? 'ok' : 'idle'}"></span>
          <div><b>${!d.type ? '沒有設定自動同步' : bad ? '上次同步失敗' : st.lastCheckAt ? (st.lastStatus === 'ok' ? '上次同步有更新' : '上次同步：沒有變化') : '還沒同步過'}</b>
          <small>${bad ? esc(st.lastError) : `最後檢查（這台裝置）：${ago(st.lastCheckAt)}${Store.state.imports[0] ? ` · 最近一次匯入：${fmtDateTime(Store.state.imports[0].at)}` : ''}`}</small></div></div>
        <form class="form" id="drvForm" novalidate>
          <fieldset class="field"><legend>資料來源</legend><div class="radio-row radio-3">
            <label class="radio"><input type="radio" name="type" value="sheet" ${d.type === 'sheet' ? 'checked' : ''}><span><b>Google Drive 檔案（授權）</b><small>推薦：.xlsx 或 Google 試算表，檔案不用公開，App 用你的 Google 帳號唯讀讀取</small></span></label>
            <label class="radio"><input type="radio" name="type" value="csv" ${d.type === 'csv' ? 'checked' : ''}><span><b>公開 CSV 連結</b><small>不用授權，但有連結的人都看得到資料</small></span></label>
            <label class="radio"><input type="radio" name="type" value="" ${!d.type ? 'checked' : ''}><span><b>不自動同步</b><small>只用下面的手動匯入</small></span></label></div></fieldset>
          <div data-type="sheet" class="form"><div class="form-row">
            <div class="field"><label for="dv-sheet">檔案連結</label><input id="dv-sheet" name="sheet" class="input" value="${esc(d.sheet)}" placeholder="https://drive.google.com/file/d/…"><span class="field-hint">在 Drive 打開檔案，把網址整個複製貼上</span><span class="field-error"></span></div>
            <div class="field"><label for="dv-tab">分頁名稱</label><input id="dv-tab" name="tab" class="input" value="${esc(d.tab)}" placeholder="不填 = 第一個有日期欄的分頁"><span class="field-error"></span></div></div>${conn}</div>
          <div data-type="csv" class="field"><label for="dv-csv">CSV 連結</label><input id="dv-csv" name="csvUrl" class="input" value="${esc(d.csvUrl)}" placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv">
            <span class="field-hint">Google 試算表：檔案 → 共用 → 發布到網路 → 選分頁和「逗號分隔值 (.csv)」→ 發布，複製連結</span><span class="field-error"></span></div>
          <div data-type="any" class="form"><div class="form-row">
            <div class="field"><label for="dv-order">日期寫法（沒寫年份或用斜線時）</label><select id="dv-order" name="dateOrder" class="input"><option value="mdy" ${d.dateOrder !== 'dmy' ? 'selected' : ''}>月/日（11/1 = 11 月 1 日）</option><option value="dmy" ${d.dateOrder === 'dmy' ? 'selected' : ''}>日/月（1/11 = 11 月 1 日）</option></select></div>
            <div class="field"><span class="field-label">選項</span><label class="check-row"><input type="checkbox" name="auto" ${d.auto ? 'checked' : ''}><span><b>自動同步</b><small>打開 App 時和每 15 分鐘檢查一次</small></span></label>
              <label class="check-row"><input type="checkbox" name="overwriteManual" ${d.overwriteManual ? 'checked' : ''}><span><b>覆蓋手動修正</b><small>預設不勾：你手動改過的數字，同步時保留不蓋掉</small></span></label></div></div>
            ${d.mapping ? `<p class="field-hint">目前的欄位對應：${Object.entries(d.mapping).map(([k, v]) => `${Store.FIELD_LABEL[k]} ← 「${esc(v)}」`).join('、')}。欄位順序改了沒關係，標題改名的話按「預覽並匯入」重新對應。</p>` : ''}</div>
          <div class="btn-row"><button type="submit" class="btn btn-primary">${icon('check')}儲存設定</button><button type="button" class="btn" data-preview>${icon('eye')}預覽並匯入</button></div>
        </form></section>
      <section class="card"><header class="card-head"><div><h3>${icon('info', 'icon-sm')} 自動同步需要你提供／授權什麼</h3><p class="card-sub">App 只會下載你指定的那一個檔案，不會看 Drive 裡的其他檔案</p></div></header>
        <ol class="mm-steps">
          <li><b>一個檔案</b>（.xlsx 或 Google 試算表）：第一列是標題，至少要有「角色」和「紅色」或「黃色」；每列 = 一個角色一次的讀數。認得的標題：日期、時間、帳號、角色、自動戰鬥剩餘、金幣（黃）、紅色金幣、合計、核對、備註（英文 <code>date / time / account / character / remain / yellow / red / total / check / note</code> 也可以）。沒有帳號欄的話，新角色會先放在「未分帳號」，到「帳號與角色」改到正確的帳號即可。<button type="button" class="link-btn" data-template>下載範本</button></li>
          <li><b>檔案連結</b>貼到上面，選「Google Drive 檔案（授權）」並儲存。要一直更新同一個檔案（重新上傳成新檔案的話連結會變）。</li>
          <li><b>一次性設定（Google Cloud 專案 coin-ledger-512414）</b>：<a href="${DRIVE_API_URL}" target="_blank" rel="noopener">啟用 Google Drive API</a>。若授權時 Google 說 App 未驗證，到 <a href="${DATA_ACCESS_URL}" target="_blank" rel="noopener">資料存取</a> 加上 <code>drive.readonly</code> 範圍。</li>
          <li><b>授權</b>：在正式網址按「連接 Google」並允許（唯讀）。授權只存在這台裝置、約 1 小時有效；過期後自動同步會暫停，按「重新連接」即可。</li>
          <li>不想授權的話，可以用 Google 試算表把分頁「發布到網路」成 CSV，選「公開 CSV 連結」（注意：有連結的人都看得到）；.xlsx 也可以手動匯入。</li>
        </ol></section>
      <section class="card"><header class="card-head"><div><h3>${icon('upload', 'icon-sm')} 手動匯入</h3><p class="card-sub">自動同步不能用時，用 .xlsx／CSV 檔或直接從試算表複製貼上；會先預覽，確認後才寫入</p></div></header>
        <div class="btn-row"><button type="button" class="btn" data-file>${icon('upload')}選擇 .xlsx／CSV 檔</button><button type="button" class="btn" data-paste>${icon('edit')}貼上表格</button><button type="button" class="btn btn-ghost" data-template>${icon('download')}下載範本</button></div></section>
      <section class="card" id="impLog"></section>`;

    const form = $('#drvForm', view);
    const showType = () => {
      const t = form.querySelector('[name="type"]:checked').value;
      $$('[data-type]', form).forEach((el) => { el.hidden = el.dataset.type === 'any' ? !t : el.dataset.type !== t; });
      $('[data-preview]', form).hidden = !t;
    };
    $$('[name="type"]', form).forEach((r) => r.addEventListener('change', showType));
    showType();
    const readForm = () => ({
      type: form.querySelector('[name="type"]:checked').value, sheet: form.sheet.value.trim(), tab: form.tab.value.trim(), csvUrl: form.csvUrl.value.trim(),
      dateOrder: form.dateOrder.value, auto: form.auto.checked, overwriteManual: form.overwriteManual.checked,
    });
    const saveForm = () => {
      const v = readForm();
      const errs = {};
      if (v.type === 'sheet' && !Drive.parseSheet(v.sheet)) errs.sheet = '請貼上 Drive 檔案的完整網址';
      if (v.type === 'csv' && !/^https:\/\//.test(v.csvUrl)) errs.csvUrl = '請貼上 https:// 開頭的 CSV 連結';
      setFieldErrors(form, errs);
      if (Object.keys(errs).length) return false;
      const changedSource = v.type !== d.type || v.sheet !== d.sheet || v.tab !== d.tab || v.csvUrl !== d.csvUrl;
      safely(() => Store.updateDrive({ ...v, ...(changedSource ? { mapping: null } : {}) }));
      return true;
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); if (saveForm()) toast('已儲存同步設定'); });
    $('[data-preview]', form).addEventListener('click', async () => {
      if (!saveForm()) return;
      const b = $('[data-preview]', form); b.disabled = true;
      try {
        const t = await Drive.fetchTable();
        const dd = Store.drive;
        openImportPreview(t.rows, { source: t.source, label: t.label, ref: t.ref, sheets: t.sheets, tab: t.tab, mapping: dd.mapping, dateOrder: dd.dateOrder, overwriteManual: dd.overwriteManual, defaultAccount: dd.defaultAccount, fromDrive: true });
      } catch (e) {
        toast(e.message, 'error');
        Store.setDriveStatus({ lastCheckAt: new Date().toISOString(), lastStatus: e.kind === 'auth' ? 'auth' : 'error', lastError: e.message });
      } finally { b.disabled = false; }
    });
    const conBtn = $('[data-connect]', view);
    if (conBtn) conBtn.addEventListener('click', () => { if (saveForm()) { try { Drive.connect(); } catch (e) { toast(e.message, 'error'); } } });
    const disBtn = $('[data-disconnect]', view);
    if (disBtn) disBtn.addEventListener('click', () => { Drive.disconnect(); toast('已中斷這台裝置的 Google 試算表連接'); rerender(); });
    $('[data-sync-now]').addEventListener('click', () => runSync(false));
    $$('[data-template]', view).forEach((b) => b.addEventListener('click', () => download('maple-m-mesos-範本.csv', template(), 'text/csv;charset=utf-8')));
    $('[data-file]', view).addEventListener('click', async () => {
      const f = await pickFile('.xlsx,.csv,.tsv,.txt,text/csv');
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('檔案太大（超過 5MB）', 'error'); return; }
      try {
        const base = { source: 'file', dateOrder: Store.drive.dateOrder, defaultAccount: Store.drive.defaultAccount };
        if (/\.xlsx$/i.test(f.name)) {
          const sheets = await Drive.readXlsx(await f.arrayBuffer());
          const pick = Drive.pickTab(sheets, '');
          openImportPreview(pick.rows, { ...base, label: `${f.name} · ${pick.name}`, ref: `file:${f.name}:${pick.name}`, sheets, tab: pick.name });
        } else openImportPreview(CSV.parse(await readText(f)), { ...base, label: f.name, ref: `file:${f.name}` });
      } catch (e) { toast(`讀不到檔案：${e.message}`, 'error'); }
    });
    $('[data-paste]', view).addEventListener('click', () => openPasteModal());
    renderImportLog($('#impLog', view));
  }

  async function runSync(auto) {
    const { toast } = U();
    const d = Store.drive;
    if (!d.type) { toast('還沒設定同步來源', 'info'); location.hash = '#/mm/sync'; return; }
    if (d.type === 'sheet' && !Drive.token()) {
      if (!Drive.canAuthorize) { toast('這裡不能連接 Google（只在正式網址可以），可以先匯入檔案', 'info'); return; }
      toast('Google 授權已過期，正在重新連接…', 'info');
      setTimeout(() => { try { Drive.connect({ silent: true }); } catch (e) { toast(e.message, 'error'); } }, 600);
      return;
    }
    toast('正在讀取 Drive 資料…', 'info');
    const r = await Drive.syncNow({ auto });
    reportSync(r, false);
  }
  function reportSync(r, quiet) {
    const { toast } = U();
    if (!r) return;
    const c = r.counts || {};
    if (r.status === 'ok') toast(`Maple M 同步完成：新增 ${c.added || 0}、更新 ${c.updated || 0}${c.kept ? `、保留手動 ${c.kept}` : ''}${c.error ? `、${c.error} 列有錯（看同步紀錄）` : ''}${c.newChars ? `，新角色 ${c.newChars} 個` : ''}`);
    else if (r.status === 'same') { if (!quiet) toast(`Maple M：${r.message}`, 'info'); } else if (r.status === 'auth') { if (!quiet) toast(r.message, 'info'); } else if (r.status === 'needs-mapping' || r.status === 'error') toast(`Maple M 同步失敗：${r.message}`, 'error');
  }

  function openPasteModal() {
    const { openModal, $, toast } = U();
    const m = openModal({
      title: '貼上表格', size: 'modal-lg',
      body: `<p class="muted">在 Google 試算表選取要匯入的範圍（包含標題列）→ 複製 → 貼到下面。</p><textarea class="input mm-paste" id="pasteBox" rows="12" placeholder="日期	帳號	角色	紅色	黃色"></textarea>`,
      footer: `<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-primary" data-go>下一步：預覽</button>`,
    });
    $('[data-go]', m.el).addEventListener('click', () => {
      const text = $('#pasteBox', m.el).value;
      if (!text.trim()) { toast('還沒有貼上內容', 'error'); return; }
      m.close();
      openImportPreview(CSV.parse(text), { source: 'paste', label: '貼上的表格', ref: '', dateOrder: Store.drive.dateOrder });
    });
  }

  // 匯入預覽：可以手動對應欄位、選日期寫法；確認後才寫入
  function openImportPreview(table, meta) {
    const { openModal, $, $$, esc, icon, toast, fmtDate, fmtDateTime } = U();
    let opts = { mapping: meta.mapping || null, dateOrder: meta.dateOrder || 'mdy', overwriteManual: !!meta.overwriteManual, fallbackDate: D.todayISO(), defaultAccount: meta.defaultAccount || '' };
    const m = openModal({ title: `匯入預覽：${meta.label || ''}`, size: 'modal-lg', body: '<div id="ipBody"></div>', footer: `<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-primary" data-go>匯入</button>` });
    let an = null;
    const draw = () => {
      an = Store.analyze(table, opts);
      const seen = an.hash ? Store.seenBatch(an.hash, meta.ref || null) : null;
      const heads = an.headers.length ? an.headers : (table[0] || []).map(String);
      const colOpts = (f) => `<option value="">（沒有）</option>${heads.map((h, i) => `<option value="${esc(h && h.trim() ? h : `#${i}`)}" ${an.cols && an.cols[f] === i ? 'selected' : ''}>${esc(h && h.trim() ? h : `第 ${i + 1} 欄`)}</option>`).join('')}`;
      const c = an.counts || {};
      const changes = (c.added || 0) + (c.updated || 0);
      $('#ipBody', m.el).innerHTML = `
        ${seen ? `<div class="notice notice-info compact">${icon('info')}<div><b>這批資料在 ${fmtDateTime(seen.at)} 已經匯入過</b><p>內容一模一樣，再匯入也不會有變化。</p></div></div>` : ''}
        ${an.errors.length ? `<div class="notice notice-error compact">${icon('alert')}<div><b>需要處理</b><p>${an.errors.map(esc).join('<br>')}</p></div></div>` : ''}
        <div class="ip-map">${meta.sheets && meta.sheets.length > 1 ? `<label class="field"><span class="field-label">分頁</span><select class="input input-sm" data-tab>${meta.sheets.map((x) => `<option value="${esc(x.name)}" ${x.name === meta.tab ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}${Store.FIELDS.map((f) => `<label class="field"><span class="field-label">${Store.FIELD_LABEL[f]}${f === 'character' ? ' <em class="req">必填</em>' : ''}</span><select class="input input-sm" data-map="${f}">${colOpts(f)}</select></label>`).join('')}
          <label class="field"><span class="field-label">日期寫法</span><select class="input input-sm" data-opt="dateOrder"><option value="mdy" ${opts.dateOrder !== 'dmy' ? 'selected' : ''}>月/日</option><option value="dmy" ${opts.dateOrder === 'dmy' ? 'selected' : ''}>日/月</option></select></label>
          ${an.cols && an.cols.date == null ? `<label class="field"><span class="field-label">沒有日期欄：全部算在</span><input type="date" class="input input-sm" data-opt="fallbackDate" value="${opts.fallbackDate}" max="${D.todayISO()}"></label>` : ''}
          ${an.cols && an.cols.account == null ? `<label class="field"><span class="field-label">沒有帳號欄：新角色放在</span><select class="input input-sm" data-opt="defaultAccount"><option value="">未分帳號</option>${Store.accounts().filter((a) => a.name !== '未分帳號').map((a) => `<option value="${esc(a.name)}" ${opts.defaultAccount === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
          <label class="check-row"><input type="checkbox" data-opt="overwriteManual" ${opts.overwriteManual ? 'checked' : ''}><span><b>覆蓋手動修正</b><small>不勾 = 手動改過的保留</small></span></label></div>
        ${an.headerRow >= 0 ? `<div class="ip-counts">${RESULT_KEYS.map((k) => `<span class="tag ${RESULT[k].cls}">${RESULT[k].label} ${c[k] || 0}</span>`).join('')}<span class="muted">共 ${an.total} 列</span></div>
          ${an.newAccounts.length || an.newChars.length ? `<p class="field-hint">會自動建立：${an.newAccounts.length ? `帳號 ${an.newAccounts.map(esc).join('、')}；` : ''}${an.newChars.length ? `角色 ${an.newChars.slice(0, 12).map((x) => `${esc(x.character)}（${esc(x.account)}）`).join('、')}${an.newChars.length > 12 ? ` 等 ${an.newChars.length} 個` : ''}` : ''}</p>` : ''}
          ${an.missing.includes('red') || an.missing.includes('yellow') ? `<p class="field-hint">沒有${an.missing.includes('red') ? '紅色' : '黃色'}欄：這種顏色的數字不會改動（沿用之前的）。</p>` : ''}
          <div class="table-wrap ip-table"><table class="table table-sm"><thead><tr><th>列</th><th>結果</th><th>日期</th><th>帳號</th><th>角色</th><th class="num">紅色</th><th class="num">黃色</th><th class="num">剩餘</th><th>說明</th></tr></thead><tbody>
            ${an.items.slice().sort((a, b) => (a.result === 'unchanged') - (b.result === 'unchanged') || a.n - b.n).slice(0, 80).map((it) => `<tr><td class="muted">${it.n}</td><td><span class="tag ${RESULT[it.result].cls}">${RESULT[it.result].label}</span></td><td class="nowrap">${it.date ? fmtDate(it.date) : '—'}${it.time ? ` ${it.time}` : ''}</td><td>${esc(it.account) || '—'}</td><td>${esc(it.character) || '—'}</td>
              <td class="num">${fmtMesos(it.red)}</td><td class="num">${fmtMesos(it.yellow)}</td><td class="num">${fmtRemain(it.remain)}</td><td class="ip-msg">${esc(it.error || (it.existing ? `原本：紅 ${fmtMesos(it.existing.red)}、黃 ${fmtMesos(it.existing.yellow)}（${SOURCE_LABEL[it.existing.source] || ''}）` : ''))}</td></tr>`).join('')}
          </tbody></table></div>${an.items.length > 80 ? `<p class="card-note">只顯示前 80 列（有變動的排前面）</p>` : ''}` : ''}`;
      const go = $('[data-go]', m.el);
      go.disabled = an.headerRow < 0 || an.errors.length > 0 || !changes;
      go.textContent = changes ? `匯入（新增 ${c.added || 0}、更新 ${c.updated || 0}）` : '沒有要匯入的變動';
      $$('[data-map]', m.el).forEach((s) => s.addEventListener('change', () => {
        const map = {};
        $$('[data-map]', m.el).forEach((x) => { if (x.value) map[x.dataset.map] = x.value; });
        opts = { ...opts, mapping: map }; draw();
      }));
      $$('[data-opt]', m.el).forEach((x) => x.addEventListener('change', () => { opts = { ...opts, [x.dataset.opt]: x.type === 'checkbox' ? x.checked : x.value }; draw(); }));
      const tabSel = $('[data-tab]', m.el);
      if (tabSel) tabSel.addEventListener('change', () => {
        const sheet = meta.sheets.find((x) => x.name === tabSel.value);
        if (!sheet) return;
        table = sheet.rows; meta.label = meta.label.replace(/ · [^·]*$/, ` · ${sheet.name}`); meta.ref = meta.ref.replace(/:[^:]*$/, `:${sheet.name}`); meta.tab = sheet.name;
        opts = { ...opts, mapping: null };
        draw();
      });
    };
    draw();
    $('[data-go]', m.el).addEventListener('click', () => {
      if (!an || $('[data-go]', m.el).disabled) return;
      try {
        const r = Store.apply(an, { source: meta.source, label: meta.label, ref: meta.ref });
        if (meta.fromDrive) {
          const at = new Date().toISOString();
          Store.updateDrive({ mapping: an.mapping, dateOrder: opts.dateOrder, overwriteManual: opts.overwriteManual, defaultAccount: opts.defaultAccount, tab: meta.tab || Store.drive.tab });
          Store.setDriveStatus({ lastCheckAt: at, lastSyncAt: at, lastStatus: 'ok', lastError: '' });
        }
        toast(`已匯入：新增 ${r.counts.added || 0}、更新 ${r.counts.updated || 0}${r.counts.newChars ? `，建立 ${r.counts.newChars} 個角色` : ''}`);
        m.close();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  function renderImportLog(card) {
    const { $$, icon, esc, fmtDateTime } = U();
    const list = Store.state.imports;
    card.innerHTML = `<header class="card-head"><div><h3>${icon('records', 'icon-sm')} 同步／匯入紀錄</h3><p class="card-sub">每次有寫入資料的同步或匯入都留一筆：來源、時間、結果，以及有變動或有錯的原始資料（最近 40 次）</p></div></header>
      ${list.length ? `<ul class="imp-list">${list.map((b) => `<li><button type="button" class="imp-row" data-imp="${b.id}">
        <span class="imp-when"><b>${fmtDateTime(b.at)}</b><small>${SOURCE_LABEL[b.source] || esc(b.source)}${b.label ? ` · ${esc(b.label)}` : ''}</small></span>
        <span class="ip-counts">${['added', 'updated', 'kept', 'error'].filter((k) => b.counts[k]).map((k) => `<span class="tag ${RESULT[k].cls}">${RESULT[k].label} ${b.counts[k]}</span>`).join('') || '<span class="tag tag-muted">沒有變動</span>'}${b.counts.newChars ? `<span class="tag tag-info-s">新角色 ${b.counts.newChars}</span>` : ''}</span>
        ${icon('right', 'icon-sm')}</button></li>`).join('')}</ul>`
        : `<div class="mini-empty">${icon('records')}還沒有同步或匯入過</div>`}`;
    $$('[data-imp]', card).forEach((b) => b.addEventListener('click', () => openImportDetail(b.dataset.imp)));
  }

  function openImportDetail(id) {
    const { openModal, $, esc, icon, fmtDate, fmtDateTime, confirmDialog, toast, safely } = U();
    const b = Store.state.imports.find((x) => x.id === id);
    if (!b) return;
    const c = b.counts || {};
    const m = openModal({
      title: `同步紀錄 · ${fmtDateTime(b.at)}`, size: 'modal-lg',
      body: `<dl class="rules imp-meta"><dt>來源</dt><dd>${SOURCE_LABEL[b.source] || esc(b.source)}${b.label ? ` · ${esc(b.label)}` : ''}</dd>
          ${b.ref ? `<dt>位置</dt><dd class="imp-ref">${esc(b.ref.replace(/^(sheet|csv|file):/, ''))}</dd>` : ''}
          <dt>時間</dt><dd>${fmtDateTime(b.at)}</dd><dt>資料列數</dt><dd>${b.total} 列（${b.headers.length} 欄）</dd>
          <dt>結果</dt><dd class="ip-counts">${RESULT_KEYS.map((k) => `<span class="tag ${RESULT[k].cls}">${RESULT[k].label} ${c[k] || 0}</span>`).join('')}${c.newAccounts ? `<span class="tag tag-info-s">新帳號 ${c.newAccounts}</span>` : ''}${c.newChars ? `<span class="tag tag-info-s">新角色 ${c.newChars}</span>` : ''}</dd>
          <dt>欄位對應</dt><dd>${b.mapping ? Object.entries(b.mapping).map(([k, v]) => `${Store.FIELD_LABEL[k] || k} ← 「${esc(v)}」`).join('、') : '—'}</dd>
          <dt>原始標題列</dt><dd class="imp-ref">${b.headers.map(esc).join(' | ') || '—'}</dd></dl>
        <h4 class="imp-h">有變動、被保留或有錯的列（原始資料）</h4>
        ${b.rows.length ? `<div class="table-wrap ip-table"><table class="table table-sm"><thead><tr><th>列</th><th>結果</th><th>日期</th><th>角色</th><th class="num">紅色</th><th class="num">黃色</th><th>差異／原因</th><th>原始內容</th></tr></thead><tbody>
          ${b.rows.map((r) => `<tr><td class="muted">${r.n}</td><td><span class="tag ${resultOf(r.result).cls}">${resultOf(r.result).label}</span></td><td class="nowrap">${r.date ? fmtDate(r.date) : '—'}</td><td>${esc(r.character || '')}<small>${esc(r.account || '')}</small></td>
            <td class="num">${fmtMesos(r.red)}</td><td class="num">${fmtMesos(r.yellow)}</td><td class="ip-msg">${esc(r.msg || '')}</td><td class="imp-raw">${esc((r.cells || []).join(' | '))}</td></tr>`).join('')}</tbody></table></div>`
          : `<div class="mini-empty">${icon('check')}沒有需要列出的列</div>`}`,
      footer: `<button type="button" class="btn btn-danger-ghost" data-del>${icon('trash')}刪除這筆紀錄</button><span class="grow"></span><button type="button" class="btn btn-primary" data-close>關閉</button>`,
    });
    $('[data-del]', m.el).addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '刪除同步紀錄', message: '只刪除這筆紀錄（含原始資料），已經匯入的庫存數字不會被刪除。刪除後同一批資料如果再同步，會被當成新的一批再檢查一次（沒變動的不會重複寫入）。', confirmText: '刪除', danger: true });
      if (!ok) return;
      safely(() => { Store.deleteImport(id); toast('已刪除紀錄'); m.close(); });
    });
  }

  /* ================= 帳號與角色 ================= */
  function renderChars(view) {
    const { $, $$, icon, esc, confirmDialog, toast, safely } = U();
    $('#pageActions').innerHTML = `<button type="button" class="btn" data-mm-action="new-account">${icon('plus')}新增帳號</button>${Store.accounts().length ? `<button type="button" class="btn btn-primary" data-mm-action="new-char">${icon('plus')}新增角色</button>` : ''}`;
    if (!Store.accounts().length) { view.innerHTML = emptyMM(); return; }
    const today = D.todayISO();
    view.innerHTML = `<div class="mm-stack">${Store.accounts().map((a) => {
      const cs = Store.characters(a.id);
      return `<article class="card mm-acct ${a.status !== 'active' ? 'is-inactive' : ''}"><header class="card-head"><div class="cell-acct">${acctAvatar(a)}<span><h3>${esc(a.name)} ${statusTag(a)}</h3><p class="card-sub">${cs.length} 個角色${a.note ? ` · ${esc(a.note)}` : ''}</p></span></div>
        <div class="row-actions"><button type="button" class="btn btn-sm" data-mm-action="new-char" data-account="${a.id}">${icon('plus')}新增角色</button>
          <button type="button" class="icon-btn" data-edit-acc="${a.id}" aria-label="編輯帳號" title="編輯帳號">${icon('edit')}</button>
          <button type="button" class="icon-btn danger" data-del-acc="${a.id}" aria-label="刪除帳號" title="刪除帳號">${icon('trash')}</button></div></header>
        ${cs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>角色</th><th>職業</th><th>狀態</th><th class="num">還能掛機</th><th class="num">紅色</th><th class="num">黃色</th><th>備註</th><th class="actions-col"><span class="sr-only">操作</span></th></tr></thead><tbody>
          ${cs.map((c) => { const d = Store.dayRemain(c.id, today); const b = Store.balanceAt(c.id, today); return `<tr class="${c.status !== 'active' ? 'is-inactive' : ''}"><td><span class="cell-acct">${charAvatar(c)}<span>${esc(c.name)}</span></span></td><td>${esc(c.job) || '<span class="muted">—</span>'}</td>
            <td>${c.status === 'active' ? '<span class="tag tag-ok">啟用</span>' : '<span class="tag tag-muted">停用</span>'}</td><td class="num">${fmtLeft(d.reading)} ${d.status.key !== 'none' && d.status.key !== 'ok' ? idleBadge(d.status) : ''}</td>
            <td class="num">${fmtMesos(b.red)}</td><td class="num">${fmtMesos(b.yellow)}</td><td class="note-cell">${esc(c.note) || '<span class="muted">—</span>'}</td>
            <td class="actions-col"><div class="row-actions"><button type="button" class="icon-btn" data-edit-char="${c.id}" aria-label="編輯角色" title="編輯">${icon('edit')}</button><button type="button" class="icon-btn danger" data-del-char="${c.id}" aria-label="刪除角色" title="刪除">${icon('trash')}</button></div></td></tr>`; }).join('')}
        </tbody></table></div>` : `<div class="mini-empty">${icon('accounts')}還沒有角色。<button type="button" class="link-btn" data-mm-action="new-char" data-account="${a.id}">新增第一個角色</button></div>`}</article>`;
    }).join('')}</div>`;
    $$('[data-edit-acc]', view).forEach((b) => b.addEventListener('click', () => openAccountModal(Store.account(b.dataset.editAcc))));
    $$('[data-edit-char]', view).forEach((b) => b.addEventListener('click', () => openCharModal(Store.character(b.dataset.editChar))));
    $$('[data-del-acc]', view).forEach((b) => b.addEventListener('click', async () => {
      const a = Store.account(b.dataset.delAcc);
      const cs = Store.characters(a.id); const n = Store.counts(cs.map((c) => c.id));
      const ok = await confirmDialog({ title: '刪除帳號', message: `刪除 Maple M 帳號 <b>${esc(a.name)}</b>？<br>會一起刪除 ${cs.length} 個角色、${n.sessions} 筆掛機記錄、${n.mesos} 筆 Mesos 庫存，無法復原（M Sea 的資料不受影響）。不想刪資料可以改成「停用」。`, confirmText: '刪除', danger: true });
      if (ok) safely(() => { Store.deleteAccount(a.id); toast(`已刪除帳號「${a.name}」`); });
    }));
    $$('[data-del-char]', view).forEach((b) => b.addEventListener('click', async () => {
      const c = Store.character(b.dataset.delChar); const n = Store.counts([c.id]);
      const ok = await confirmDialog({ title: '刪除角色', message: `刪除角色 <b>${esc(c.name)}</b>？會一起刪除 ${n.sessions} 筆掛機記錄、${n.mesos} 筆 Mesos 庫存，無法復原。不想刪資料可以改成「停用」。`, confirmText: '刪除', danger: true });
      if (ok) safely(() => { Store.deleteCharacter(c.id); toast(`已刪除角色「${c.name}」`); });
    }));
  }

  function openAccountModal(account) {
    const { openModal, $, esc, toast, setFieldErrors } = U();
    const a = account || { name: '', note: '', status: 'active' };
    const m = openModal({
      title: account ? '編輯 Maple M 帳號' : '新增 Maple M 帳號',
      body: `<form class="form" id="mmAccForm" novalidate>
        <div class="field"><label for="ma-name">帳號名稱 <em class="req">必填</em></label><input id="ma-name" name="name" class="input" maxlength="40" value="${esc(a.name)}" placeholder="例如：主帳號、小號 A"><span class="field-error"></span></div>
        <div class="field"><label for="ma-note">備註</label><textarea id="ma-note" name="note" class="input" rows="2" maxlength="300" placeholder="伺服器、登入方式…">${esc(a.note)}</textarea></div>
        <fieldset class="field"><legend>狀態</legend><div class="radio-row">
          <label class="radio"><input type="radio" name="status" value="active" ${a.status === 'active' ? 'checked' : ''}><span><b>啟用</b><small>出現在統計和預設篩選</small></span></label>
          <label class="radio"><input type="radio" name="status" value="inactive" ${a.status !== 'active' ? 'checked' : ''}><span><b>停用</b><small>保留歷史資料</small></span></label></div></fieldset>
        ${account ? '' : '<p class="field-hint">建立帳號後，接著新增這個帳號底下的角色。</p>'}
      </form>`,
      footer: `<span class="grow"></span><button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-primary" data-save>${account ? '儲存' : '新增帳號'}</button>`,
    });
    const form = $('#mmAccForm', m.el);
    const save = () => {
      const input = { name: form.name.value, note: form.note.value, status: form.status.value };
      try {
        if (account) { Store.updateAccount(account.id, input); toast('已更新帳號'); m.close(); } else {
          const x = Store.addAccount(input); toast(`已新增帳號「${x.name}」`); m.close();
          setTimeout(() => openCharModal(null, x.id), 260);
        }
      } catch (e) { if (e.fieldErrors) setFieldErrors(form, e.fieldErrors); else toast(e.message, 'error'); }
    };
    $('[data-save]', m.el).addEventListener('click', save);
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'radio') { e.preventDefault(); save(); } });
  }

  function openCharModal(ch, accountId) {
    const { openModal, $, esc, toast, setFieldErrors } = U();
    if (!Store.accounts().length) { openAccountModal(null); return; }
    const c = ch || { accountId: accountId || Store.accounts()[0].id, name: '', job: '', note: '', status: 'active' };
    const m = openModal({
      title: ch ? '編輯角色' : '新增角色',
      body: `<form class="form" id="mmCharForm" novalidate>
        <div class="field"><label for="mc-acc">帳號 <em class="req">必填</em></label><select id="mc-acc" name="accountId" class="input">${Store.accounts().map((a) => `<option value="${a.id}" ${a.id === c.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select><span class="field-error"></span></div>
        <div class="form-row"><div class="field"><label for="mc-name">角色名稱 <em class="req">必填</em></label><input id="mc-name" name="name" class="input" maxlength="40" value="${esc(c.name)}" placeholder="遊戲裡的角色名"><span class="field-hint">要和 Drive 資料裡的角色名稱一樣，同步時才對得上</span><span class="field-error"></span></div>
          <div class="field"><label for="mc-job">職業</label><input id="mc-job" name="job" class="input" maxlength="40" value="${esc(c.job)}" placeholder="選填，例如：Bishop" list="mmJobs"><datalist id="mmJobs">${['Hero', 'Paladin', 'Dark Knight', 'Arch Mage (F/P)', 'Arch Mage (I/L)', 'Bishop', 'Bowmaster', 'Marksman', 'Night Lord', 'Shadower', 'Dual Blade', 'Buccaneer', 'Corsair', 'Aran', 'Evan', 'Mercedes', 'Phantom', 'Luminous', 'Shade', 'Dawn Warrior', 'Blaze Wizard', 'Wind Archer', 'Night Walker', 'Thunder Breaker', 'Mihile', 'Kaiser', 'Angelic Buster', 'Cadena', 'Illium', 'Kinesis', 'Zero'].map((j) => `<option value="${j}">`).join('')}</datalist></div></div>
        <div class="field"><label for="mc-note">備註</label><input id="mc-note" name="note" class="input" maxlength="300" value="${esc(c.note)}" placeholder="選填"></div>
        <fieldset class="field"><legend>狀態</legend><div class="radio-row">
          <label class="radio"><input type="radio" name="status" value="active" ${c.status === 'active' ? 'checked' : ''}><span><b>啟用</b><small>每天掛機、庫存都會列出</small></span></label>
          <label class="radio"><input type="radio" name="status" value="inactive" ${c.status !== 'active' ? 'checked' : ''}><span><b>停用</b><small>保留歷史資料</small></span></label></div></fieldset>
      </form>`,
      footer: `<span class="grow"></span>${ch ? '' : '<button type="button" class="btn" data-more>新增並繼續</button>'}<button type="button" class="btn" data-close>取消</button><button type="button" class="btn btn-primary" data-save>${ch ? '儲存' : '新增角色'}</button>`,
    });
    const form = $('#mmCharForm', m.el);
    const save = (more) => {
      const input = { accountId: form.accountId.value, name: form.name.value, job: form.job.value, note: form.note.value, status: form.status.value };
      try {
        if (ch) { Store.updateCharacter(ch.id, input); toast('已更新角色'); m.close(); return; }
        const x = Store.addCharacter(input);
        toast(`已新增角色「${x.name}」`);
        if (more) { form.name.value = ''; form.job.value = ''; form.note.value = ''; setFieldErrors(form, {}); form.name.focus(); } else m.close();
      } catch (e) { if (e.fieldErrors) setFieldErrors(form, e.fieldErrors); else toast(e.message, 'error'); }
    };
    $('[data-save]', m.el).addEventListener('click', () => save(false));
    const more = $('[data-more]', m.el);
    if (more) more.addEventListener('click', () => save(true));
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'radio') { e.preventDefault(); save(false); } });
  }

  /* ================= 設定 ================= */
  function renderSettings(view) {
    const { $, $$, icon, esc, toast, setFieldErrors, confirmDialog, download, pickFile, readText, fmtDateTime, safely, rerender } = U();
    const r = Store.rules;
    const st = Store.state;
    view.innerHTML = `<div class="settings-grid">
      <section class="card"><header class="card-head"><div><h3>${icon('clock', 'icon-sm')} 掛機警示規則</h3><p class="card-sub">只套用在 Maple M；M Sea 的準時監控不受影響</p></div></header>
        <form class="form" id="ruleForm" novalidate>
          <div class="form-row"><div class="field"><label for="rl-free">每日免費領取</label><div class="input-group"><input id="rl-free" name="dailyFree" class="input num" inputmode="numeric" value="${r.dailyFree}"><span class="input-suffix">分</span></div><span class="field-hint">每個角色每天送的免費時間</span><span class="field-error"></span></div>
            <div class="field"><label for="rl-cap">剩餘累計上限</label><div class="input-group"><input id="rl-cap" name="cap" class="input num" inputmode="numeric" value="${r.cap}"><span class="input-suffix">分</span></div><span class="field-hint">自動戰鬥剩餘最多能累積到多少；超過標為超限</span><span class="field-error"></span></div></div>
          <div class="form-row"><div class="field"><label for="rl-warn">剩餘超過幾分開始警示</label><div class="input-group"><input id="rl-warn" name="warnAfter" class="input num" inputmode="numeric" value="${r.warnAfter}"><span class="input-suffix">分</span></div><span class="field-hint">填 240 = 剩餘 241 分起警示（超過 240 分可能無法領取）</span><span class="field-error"></span></div>
            <div class="field"><label for="rl-strong">接近上限（強烈警示）</label><div class="input-group"><input id="rl-strong" name="strongFrom" class="input num" inputmode="numeric" value="${r.strongFrom}"><span class="input-suffix">分起</span></div><span class="field-hint">預設 330：離上限 30 分內</span><span class="field-error"></span></div></div>
          <div class="rule-demo">${[0, r.dailyFree, r.warnAfter + 1, r.strongFrom, r.cap + 1].map((v) => { const s = Store.idleStatus(v); return `<div><b>${v} 分</b>${idleBadge(s)}</div>`; }).join('')}</div>
          <div class="btn-row"><button type="submit" class="btn btn-primary">${icon('check')}儲存規則</button><button type="button" class="btn btn-ghost" data-reset>恢復預設（120／240／330／360）</button></div>
        </form></section>
      <section class="card"><header class="card-head"><div><h3>${icon('download', 'icon-sm')} 備份與還原（只有 Maple M）</h3><p class="card-sub">${st.accounts.length} 個帳號、${st.characters.length} 個角色、${st.sessions.length} 筆掛機、${st.mesos.length} 筆庫存、${st.imports.length} 筆同步紀錄</p></div></header>
        <p class="muted">Maple M 的資料存在這台裝置，登入後也會同步到你的雲端帳本裡獨立的位置；M Sea 的備份、還原、清除都不會動到這裡，這裡的也不會動到 M Sea。</p>
        <div class="btn-row"><button type="button" class="btn" data-backup>${icon('download')}下載 Maple M 備份</button><button type="button" class="btn" data-restore>${icon('upload')}從備份還原</button><button type="button" class="btn btn-danger-ghost" data-clear>${icon('trash')}清除 Maple M 資料</button></div>
        ${MMSync && MMSync.enabled ? `<p class="card-note">${icon('cloud')}雲端同步：${esc({ idle: '準備同步', syncing: '同步中…', ok: '已同步', offline: '離線中', auth: '需要重新登入', denied: '沒有權限', error: `失敗（${MMSync.message}）`, off: '未啟用' }[MMSync.status] || '')}${MMSync.lastAt ? ` · ${fmtDateTime(new Date(MMSync.lastAt).toISOString())}` : ''}</p>` : `<p class="card-note">${icon('cloudOff')}這裡沒有登入（本機測試），資料只存在這台裝置。</p>`}
      </section></div>`;
    const form = $('#ruleForm', view);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      try { Store.updateRules({ dailyFree: form.dailyFree.value, warnAfter: form.warnAfter.value, strongFrom: form.strongFrom.value, cap: form.cap.value }); toast('已更新掛機規則，所有日子都會用新規則重新判斷'); } catch (err) { if (err.fieldErrors) setFieldErrors(form, err.fieldErrors); else toast(err.message, 'error'); }
    });
    $('[data-reset]', view).addEventListener('click', () => safely(() => { Store.updateRules(Store.RULES_DEFAULT); toast('已恢復預設規則'); }));
    $('[data-backup]', view).addEventListener('click', () => {
      download(`maple-m-備份-${D.todayISO()}.json`, JSON.stringify({ app: 'gct', game: 'maplem', exportedAt: new Date().toISOString(), data: Store.state }, null, 1), 'application/json');
      toast('已下載 Maple M 備份');
    });
    $('[data-restore]', view).addEventListener('click', async () => {
      const f = await pickFile('.json,application/json');
      if (!f) return;
      let data;
      try { const j = JSON.parse(await readText(f)); if (j.game !== 'maplem' || !j.data) throw new Error('這不是 Maple M 的備份檔（M Sea 的備份請到 M Sea 的「設定與備份」還原）'); data = j.data; } catch (e) { toast(e.message, 'error'); return; }
      const n = window.GCTMapleM.normalizeState(data);
      const ok = await confirmDialog({ title: '從備份還原 Maple M', message: `備份裡有 ${n.accounts.length} 個帳號、${n.characters.length} 個角色、${n.sessions.length} 筆掛機、${n.mesos.length} 筆庫存。<br>會取代目前 Maple M 的所有資料（M Sea 不受影響）。`, confirmText: '還原', danger: true });
      if (ok) safely(() => { Store.replaceState(n); toast('已還原 Maple M 資料'); });
    });
    $('[data-clear]', view).addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '清除 Maple M 資料', message: '刪除 Maple M 的所有帳號、角色、掛機記錄、庫存和同步紀錄，無法復原。建議先下載備份。<br><b>M Sea 的資料不受影響。</b>', confirmText: '全部清除', danger: true });
      if (!ok) return;
      safely(() => {
        const at = new Date().toISOString();
        const s = Store.state;
        const del = [...s.accounts, ...s.characters, ...s.imports].map((x) => ({ k: x.id, at }));
        Store.replaceState({ settings: s.settings, deleted: [...s.deleted, ...del] });
        toast('已清除 Maple M 資料');
      });
    });
  }

  /* ================= 遊戲登記 ================= */
  const PAGES = { dashboard: renderDashboard, idle: renderIdle, mesos: renderMesos, sync: renderSync, chars: renderChars, settings: renderSettings };
  function route(hash) {
    const h = String(hash || '').replace(/^#\/?mm\/?/, '');
    const [page, q] = h.split('?');
    return { page: PAGES[page] ? page : 'dashboard', params: new URLSearchParams(q || '') };
  }
  function todayWarns() {
    const today = D.todayISO();
    return Store.characters().filter((c) => c.status === 'active').filter((c) => SEVERITY[Store.dayRemain(c.id, today).status.key] >= 2).length;
  }
  const MMSYNC_TEXT = { idle: '準備同步', syncing: '同步中…', ok: '已同步', offline: '離線中，連線後自動同步', auth: '需要重新登入 Google 才能同步', denied: '沒有使用權限', error: '同步失敗', off: '未啟用雲端同步' };

  window.GCTGames.register({
    id: 'maplem', name: 'Maple M', short: 'Maple M', prefix: 'mm', home: '#/mm/dashboard', desc: 'MapleStory M · 掛機時間／紅黃 Mesos',
    nav: NAV, route,
    render(view, page) { PAGES[page](view, route(location.hash).params); },
    badge(id) {
      if (id === 'idle') return todayWarns();
      if (id === 'sync') { const s = Store.driveStatus().lastStatus; return s === 'error' || s === 'auth' ? '!' : 0; }
      return 0;
    },
    banner() {
      const { icon, esc } = U();
      return Store.loadError ? `<div class="notice notice-error">${icon('alert')}<div><b>Maple M 資料讀取問題</b><p>${esc(Store.loadError)}</p></div></div>` : '';
    },
    chrome() {
      const { icon, fmtDateWeek } = U();
      const chars = Store.characters().filter((c) => c.status === 'active');
      const today = D.todayISO();
      const on = chars.filter((c) => Store.dayRemain(c.id, today).reading).length;
      const warn = todayWarns();
      const C = 2 * Math.PI * 10; const ratio = chars.length ? on / chars.length : 0;
      const sync = MMSync && MMSync.enabled;
      const bad = sync && ['error', 'auth', 'denied'].includes(MMSync.status);
      return {
        center: `<a class="status-chip ${warn ? 'is-warn' : ''}" href="#/mm/idle" title="前往掛機時間">
          <svg class="status-ring" viewBox="0 0 26 26" aria-hidden="true"><circle class="track" cx="13" cy="13" r="10"/><circle class="bar" cx="13" cy="13" r="10" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - ratio)).toFixed(2)}" transform="rotate(-90 13 13)"/></svg>
          <span>${fmtDateWeek(today)}</span><small>${chars.length ? `有讀數 ${on}/${chars.length} 角色${warn ? ` · ${warn} 個警示` : ''}` : '尚無角色'}</small></a>`,
        actions: `${sync ? `<button type="button" class="round-btn sync-btn is-${MMSync.status}" data-mm-action="cloud-sync" title="Maple M 雲端：${MMSYNC_TEXT[MMSync.status] || ''}" aria-label="Maple M 雲端同步">${icon(bad || MMSync.status === 'offline' ? 'cloudOff' : MMSync.status === 'syncing' ? 'refresh' : 'cloud')}${bad ? '<span class="dot-badge is-dot"></span>' : ''}</button>` : ''}
          <button type="button" class="round-btn" data-mm-action="drive-sync" title="從 Drive 同步 Mesos" aria-label="從 Drive 同步 Mesos">${icon('refresh')}${['error', 'auth'].includes(Store.driveStatus().lastStatus) ? '<span class="dot-badge is-dot"></span>' : ''}</button>
          <button type="button" class="btn" data-mm-action="mesos" title="記 Mesos">${icon('coin')}<span class="btn-label">記 Mesos</span></button>
          <button type="button" class="btn btn-primary" data-mm-action="session">${icon('clock')}<span class="btn-label">記掛機</span></button>`,
      };
    },
    start(session) {
      const owner = session && session.email ? session.email : 'local';
      try { if (localStorage.getItem('gct:mm:owner') !== owner) { if (MMSync) MMSync.reset(); localStorage.setItem('gct:mm:owner', owner); } } catch (_) { /* ignore */ }
      Store.load(owner);
      Store.onChange((source) => {
        if (!/^#\/mm(\/|$)/.test(location.hash)) { if (source === 'sync-drive' || source === 'drive-status') U().refreshChrome(); return; }
        // 正在輸入時，背景同步帶來的更新先不重畫（離開輸入框後再更新）
        const ae = document.activeElement;
        if (source !== 'user' && ae && document.getElementById('view').contains(ae) && ae.matches('input, textarea, select')) {
          ae.addEventListener('blur', () => setTimeout(() => U().rerender(), 200), { once: true });
          return;
        }
        U().rerender();
      });
      if (MMSync) {
        MMSync.onStatus(() => { if (/^#\/mm(\/|$)/.test(location.hash)) U().refreshChrome(); });
        MMSync.start();
      }
      if (Drive.redirectError) setTimeout(() => U().toast(Drive.redirectError, 'error'), 400);
      if (Drive.justConnected) {
        setTimeout(() => { U().toast('已連接 Google 試算表，正在同步…', 'info'); Drive.syncNow().then((r) => reportSync(r, false)); }, 500);
      }
      Drive.startAuto((r) => reportSync(r, true));
    },
  });

  // 頂部和頁面上的按鈕
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-mm-action]');
    if (!t) return;
    switch (t.dataset.mmAction) {
      case 'session': openSessionModal({ charId: t.dataset.char || '', date: t.dataset.date || '' }); break;
      case 'mesos': openMesosModal({ charId: t.dataset.char || '' }); break;
      case 'new-account': openAccountModal(null); break;
      case 'new-char': openCharModal(null, t.dataset.account || ''); break;
      case 'drive-sync': runSync(false); break;
      case 'cloud-sync':
        if (!MMSync) break;
        if (MMSync.status === 'auth') { window.GCTAuth.reconnect(); break; }
        MMSync.syncNow().then(() => { if (MMSync.status === 'ok') U().toast('Maple M 已和雲端同步'); else if (MMSync.status === 'error') U().toast(`同步失敗：${MMSync.message}`, 'error'); });
        break;
      default: break;
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key !== Store.key()) return;
    Store.load(Store.owner);
    if (/^#\/mm(\/|$)/.test(location.hash)) U().rerender();
  });
})();
