/* 輕量 SVG 圖表（不依賴外部套件，離線也能用）
 * 顏色一律用 style（可吃 CSS 變數），所以切換深色模式時不需要重畫 */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const observers = new Set();
  // 軸上的數字：1 億起用 M／B（100M、1.5B），以下維持「萬」
  const zhCompact = new Intl.NumberFormat('zh-TW', { notation: 'compact', maximumFractionDigits: 1 });
  const compact = {
    format(v) {
      const a = Math.abs(v); const sign = v < 0 ? '-' : '';
      if (a >= 1e9) return `${sign}${+(a / 1e9).toFixed(1)}B`;
      if (a >= 1e8) return `${sign}${+(a / 1e6).toFixed(0)}M`;
      return zhCompact.format(v);
    },
  };
  const reduceMotion = () => global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let gid = 0;

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
    return el;
  }

  // 粗估文字寬度（11px 字）：中日韓字較寬
  const textWidth = (s) => Array.from(String(s)).reduce((w, ch) => w + (/[　-鿿]/.test(ch) ? 11 : 6.6), 0);
  const shortDate = (iso) => { const [, m, d] = iso.split('-'); return `${+m}/${+d}`; };

  function niceTicks(min, max, count) {
    if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
    const raw = (max - min) / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    if (step < 1) step = 1;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const out = [];
    for (let k = 0; lo + k * step <= hi + step / 2; k++) out.push(Math.round(lo + k * step));
    return out;
  }

  // 單調三次曲線（不會超出資料點的範圍，平滑但不誤導）
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    if (pts.length === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
    const n = pts.length; const dx = []; const dy = []; const m = []; const t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = pts[i + 1][1] - pts[i][1]; m[i] = dy[i] / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
    }
    return d;
  }
  const straightPath = (pts) => pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

  /* 折線／面積圖
   * opts: { labels, series: [{ name, color, values, dashed, area }], height, includeZero, dots, smooth,
   *         tooltip(i) => html, emptyText, ariaLabel, labelFormat(label) }
   * values 中的 null 代表沒有資料：線段會斷開，不會被畫成 0
   */
  function lineChart(container, opts) {
    container.classList.add('chart');
    let lastWidth = 0; let first = true;
    const render = () => {
      const width = Math.floor(container.clientWidth);
      if (!width || width === lastWidth) return;
      lastWidth = width;
      draw(container, opts, width, first && !reduceMotion());
      first = false;
    };
    const ro = new ResizeObserver(render);
    ro.observe(container);
    observers.add(ro);
    render();
  }

  function draw(root, o, W, animate) {
    const H = o.height || 240;
    const labels = o.labels || o.dates;
    const { series } = o;
    const all = [];
    series.forEach((s) => s.values.forEach((v) => { if (v != null) all.push(v); }));
    root.innerHTML = '';
    if (!all.length) {
      root.innerHTML = `<div class="chart-empty" style="height:${H}px">${o.emptyText || '此期間沒有資料'}</div>`;
      return;
    }
    let min = Math.min(...all); let max = Math.max(...all);
    if (o.includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
    const T = niceTicks(min, max, H < 200 ? 3 : 4);
    const y0 = T[0]; const y1 = T[T.length - 1];
    const tickLabels = T.map((v) => (o.axisFormat ? o.axisFormat(v) : compact.format(v)));
    const m = { t: 14, r: 18, b: 28, l: Math.ceil(Math.max(...tickLabels.map(textWidth))) + 14 };
    const iw = Math.max(10, W - m.l - m.r); const ih = H - m.t - m.b;
    const n = labels.length;
    const x = (i) => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
    const baseY = y(Math.min(Math.max(0, y0), y1));
    const fmtLabel = o.labelFormat || shortDate;

    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': o.ariaLabel || '' });
    const defs = svgEl('defs', {});
    svg.append(defs);

    T.forEach((v, k) => {
      svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: o.includeZero && v === 0 ? 'axis-zero' : 'grid' }));
      const t = svgEl('text', { x: m.l - 10, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' });
      t.textContent = tickLabels[k];
      svg.append(t);
    });

    // X 軸標籤：從最後一個往回取，確保最新的一定顯示
    const maxLabels = Math.max(2, Math.floor(iw / 62));
    const step = Math.max(1, Math.ceil(n / maxLabels));
    for (let i = n - 1; i >= 0; i -= step) {
      const t = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'tick' });
      t.textContent = fmtLabel(labels[i]);
      svg.append(t);
    }

    const plot = svgEl('g', { class: animate ? 'plot is-animating' : 'plot' });
    svg.append(plot);
    series.forEach((s, si) => {
      // s.gradient：線條由左到右漸層（例如 ['#67e8f9', '#3b82f6', '#7c6cff']），面積用 s.color 由上往下淡出
      let stroke = s.color;
      // s.connect：沒資料的日子直接連過去，不斷線
      let first = -1; let last = -1;
      s.values.forEach((v, i) => { if (v != null) { if (first < 0) first = i; last = i; } });
      if (s.gradient) {
        const id = `g${++gid}`;
        const gx1 = first < last ? x(first) : m.l; const gx2 = first < last ? x(last) : W - m.r;
        const lg = svgEl('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: gx1, x2: gx2, y1: 0, y2: 0 });
        s.gradient.forEach((c, k) => lg.append(svgEl('stop', { offset: `${(k / (s.gradient.length - 1)) * 100}%`, style: `stop-color:${c}` })));
        defs.append(lg);
        stroke = `url(#${id})`;
      }
      let seg = [];
      const flush = () => {
        const pts = seg.map((i) => [x(i), y(s.values[i])]);
        if (seg.length >= 2) {
          const d = (o.smooth ? smoothPath : straightPath)(pts);
          if (s.area) {
            const id = `g${++gid}`;
            const lg = svgEl('linearGradient', { id, x1: 0, x2: 0, y1: 0, y2: 1 });
            lg.append(svgEl('stop', { offset: '0%', style: `stop-color:${s.color};stop-opacity:${s.gradient ? .5 : .34}` }));
            if (s.gradient) lg.append(svgEl('stop', { offset: '60%', style: `stop-color:${s.gradient[s.gradient.length - 1]};stop-opacity:.18` }));
            lg.append(svgEl('stop', { offset: '100%', style: `stop-color:${s.color};stop-opacity:0` }));
            defs.append(lg);
            const area = svgEl('path', { d: `${d}L${pts[pts.length - 1][0].toFixed(1)},${baseY}L${pts[0][0].toFixed(1)},${baseY}Z`, class: 'area', fill: `url(#${id})` });
            plot.append(area);
          }
          const line = svgEl('path', { d, class: `line${s.dashed ? ' dashed' : ''}${s.gradient ? ' glow' : ''}`, style: `stroke:${stroke};--d:${si * 120}ms` });
          plot.append(line);
        }
        if (seg.length === 1 || (o.dots && !s.dashed)) {
          seg.forEach((i) => plot.append(svgEl('circle', { cx: x(i), cy: y(s.values[i]), r: seg.length === 1 ? 3.2 : 2.4, class: 'pt', style: `fill:${s.color}` })));
        }
        if (s.gradient && seg.length && seg[seg.length - 1] === last) {
          // 最新一點：發光圓點
          const [cx, cy] = pts[pts.length - 1];
          plot.append(svgEl('circle', { cx, cy, r: 10, class: 'pt-halo', style: `fill:${s.color}` }));
          plot.append(svgEl('circle', { cx, cy, r: 4.5, class: 'pt-end', style: `fill:${s.color}` }));
        }
        seg = [];
      };
      s.values.forEach((v, i) => { if (v == null) { if (!s.connect) flush(); } else seg.push(i); });
      flush();
    });

    // 線條「畫出來」的動畫：用實際長度設定虛線偏移
    if (animate) {
      requestAnimationFrame(() => {
        plot.querySelectorAll('path.line:not(.dashed)').forEach((p) => {
          const len = Math.ceil(p.getTotalLength());
          p.style.strokeDasharray = `${len}`;
          p.style.strokeDashoffset = `${len}`;
          p.getBoundingClientRect();
          p.classList.add('draw');
        });
      });
    }

    const guide = svgEl('line', { y1: m.t, y2: m.t + ih, class: 'guide', visibility: 'hidden' });
    const hoverDots = svgEl('g', {});
    const hit = svgEl('rect', { x: m.l - 6, y: 0, width: iw + 12, height: H, fill: 'transparent', class: 'hit' });
    svg.append(guide, hoverDots, hit);
    root.append(svg);

    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    root.append(tip);

    const show = (evt) => {
      const rect = svg.getBoundingClientRect();
      const px = evt.clientX - rect.left;
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i));
      guide.setAttribute('visibility', 'visible');
      hoverDots.innerHTML = '';
      series.forEach((s) => {
        const v = s.values[i];
        if (v != null) hoverDots.append(svgEl('circle', { cx: x(i), cy: y(v), r: s.dashed ? 3.5 : 5, class: 'hover-dot', style: `fill:${s.color}` }));
      });
      tip.innerHTML = o.tooltip ? o.tooltip(i) : '';
      tip.hidden = false;
      const tw = tip.offsetWidth;
      let left = x(i) + 16;
      if (left + tw > W) left = x(i) - 16 - tw;
      tip.style.left = Math.max(0, left) + 'px';
      tip.style.top = m.t + 'px';
    };
    const hide = () => { guide.setAttribute('visibility', 'hidden'); hoverDots.innerHTML = ''; tip.hidden = true; };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
  }

  // 迷你走勢線（只畫實際記錄點，平滑）
  function sparkline(values, color, w = 140, h = 34, area = false) {
    const vals = values.filter((v) => v != null);
    if (vals.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${h - 2}" y2="${h - 2}" class="spark-empty"/></svg>`;
    const min = Math.min(...vals); const max = Math.max(...vals);
    const pts = vals.map((v, i) => [
      (i / (vals.length - 1)) * (w - 4) + 2,
      max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6),
    ]);
    const d = smoothPath(pts);
    let fill = '';
    if (area) {
      const id = `sg${++gid}`;
      fill = `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:.28"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs><path d="${d}L${pts[pts.length - 1][0]},${h}L${pts[0][0]},${h}Z" fill="url(#${id})"/>`;
    }
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${fill}<path d="${d}" fill="none" style="stroke:${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" pathLength="1" class="spark-line"/></svg>`;
  }

  // 圓環圖：parts = [{ value, color }]，value 需 >= 0
  function donut(parts, size = 168, stroke = 22) {
    const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
    const total = parts.reduce((s, p) => s + p.value, 0);
    let acc = 0;
    const gap = parts.filter((p) => p.value > 0).length > 1 ? 3 : 0;
    const arcs = parts.map((p, k) => {
      if (!total || p.value <= 0) return '';
      const len = (p.value / total) * c;
      const seg = Math.max(0, len - gap);
      const out = `<circle class="donut-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round"
        style="stroke:${p.color};--len:${seg.toFixed(2)};--c:${c.toFixed(2)};--d:${k * 90}ms" stroke-dasharray="${seg.toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
      acc += len;
      return out;
    }).join('');
    return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" class="donut-track"/>${arcs}</svg>`;
  }

  function cleanup() {
    observers.forEach((ro) => ro.disconnect());
    observers.clear();
  }

  global.GCTCharts = { lineChart, sparkline, donut, cleanup, shortDate, compact: (v) => compact.format(v) };
})(window);
