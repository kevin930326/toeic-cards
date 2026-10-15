// 直條圖（SVG，不用任何圖表套件）
//
// 依照 dataviz 規範：
//   - 柱子最寬 24px、頂端 4px 圓角、從同一條基線長出來；堆疊的各段之間留 2px 空隙
//   - 格線是 1px 實線、顏色很淡；Y 軸刻度是整數
//   - 只在最高的那根柱子標數字（不是每根都標）；2 個以上系列一定有圖例
//   - 滑鼠移上去或鍵盤聚焦會顯示提示框；每張圖都附「查看表格」，數字不會只藏在提示框裡
//   - 文字一律用文字顏色，系列顏色只用在柱子和圖例的色塊
import { niceScale } from './stats.js?v=stats-progress-1';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PLOT_H = 180;
const TOP = 20;       // 柱頂數字的空間
const X_BAND = 26;    // X 軸文字的空間（算在容器高度裡，避免被裁掉）
const LEFT = 34;
const RIGHT = 8;

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// 頂端圓角、底部直角的長方形
function topRoundedRect(x, yTop, w, yBottom, r) {
  const rr = Math.max(0, Math.min(r, w / 2, yBottom - yTop));
  return `M${x},${yBottom}V${yTop + rr}Q${x},${yTop} ${x + rr},${yTop}H${x + w - rr}Q${x + w},${yTop} ${x + w},${yTop + rr}V${yBottom}Z`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// series：[{ key, name, color }]（color 是 CSS 變數，例如 'var(--series-1)'）
// rows：[{ label, title, values: { key: 數字 } }]
// labelMode：'max' 只標最高的那根；'all' 每根都標（只適合很少根的時候）
export function columnChart(container, { series, rows, ariaLabel, labelMode = 'max', unit = '' }) {
  container.replaceChildren();
  const root = el('div', 'chart');

  // 圖例（2 個以上系列）
  if (series.length > 1) {
    const legend = el('ul', 'chart-legend');
    for (const s of series) {
      const li = el('li');
      const sw = el('span', 'legend-swatch');
      sw.style.background = s.color;
      li.append(sw, document.createTextNode(s.name));
      legend.append(li);
    }
    root.append(legend);
  }

  const plot = el('div', 'chart-plot');
  const tip = el('div', 'chart-tip');
  tip.hidden = true;
  tip.setAttribute('role', 'status');
  plot.append(tip);
  root.append(plot);

  // 表格（無障礙、也讓數字不只存在於提示框）
  const details = el('details', 'chart-table');
  details.append(el('summary', '', '查看表格'));
  const table = el('table');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', '', '日期'));
  for (const s of series) hr.append(el('th', '', s.name));
  if (series.length > 1) hr.append(el('th', '', '合計'));
  thead.append(hr);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    tr.append(el('td', '', r.title || r.label));
    let sum = 0;
    for (const s of series) { const v = r.values[s.key] || 0; sum += v; tr.append(el('td', 'num', String(v))); }
    if (series.length > 1) tr.append(el('td', 'num', String(sum)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  details.append(table);
  root.append(details);
  container.append(root);

  const totalsArr = rows.map((r) => series.reduce((a, s) => a + (r.values[s.key] || 0), 0));
  const maxTotal = Math.max(0, ...totalsArr);
  const maxIdx = totalsArr.indexOf(maxTotal);

  function draw() {
    plot.querySelector('svg')?.remove();
    const width = Math.max(240, Math.round(plot.clientWidth || 320));
    const height = TOP + PLOT_H + X_BAND;
    const plotW = width - LEFT - RIGHT;
    const { max, ticks } = niceScale(maxTotal);
    const y = (v) => TOP + PLOT_H - (v / max) * PLOT_H;
    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel });

    // 格線與 Y 軸刻度
    for (const t of ticks) {
      const yy = Math.round(y(t)) + 0.5;
      svg.append(svgEl('line', { x1: LEFT, x2: width - RIGHT, y1: yy, y2: yy, class: t === 0 ? 'chart-axis' : 'chart-grid' }));
      const txt = svgEl('text', { x: LEFT - 6, y: yy + 4, class: 'chart-tick', 'text-anchor': 'end' });
      txt.textContent = String(t);
      svg.append(txt);
    }

    const band = plotW / rows.length;
    const barW = Math.max(2, Math.min(24, band * 0.62));
    const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(plotW / 36))));
    const focusable = rows.length <= 14;

    rows.forEach((r, i) => {
      const cx = LEFT + band * (i + 0.5);
      const x = cx - barW / 2;
      const g = svgEl('g', { class: 'chart-col', 'data-i': i });
      // 由下往上疊；各段之間留 2px 空隙
      let base = TOP + PLOT_H;
      const segs = series.map((s) => ({ s, v: r.values[s.key] || 0 })).filter((d) => d.v > 0);
      segs.forEach((d, j) => {
        const h = (d.v / max) * PLOT_H;
        const top = base - h;
        const bottom = j === 0 ? base : base - 2;
        if (bottom - top > 0.5) {
          const isTop = j === segs.length - 1;
          const path = isTop
            ? topRoundedRect(x, top, barW, bottom, 4)
            : `M${x},${bottom}V${top}H${x + barW}V${bottom}Z`;
          g.append(svgEl('path', { d: path, fill: d.s.color }));
        }
        base = top;
      });
      // 柱頂數字（只標最高的，或很少根時全部標）
      const total = totalsArr[i];
      if (total > 0 && (labelMode === 'all' || i === maxIdx)) {
        const t = svgEl('text', { x: cx, y: y(total) - 6, class: 'chart-value', 'text-anchor': 'middle' });
        t.textContent = String(total);
        g.append(t);
      }
      // X 軸文字（從最後一天往回每隔幾天標一次，避免擠在一起）
      if ((rows.length - 1 - i) % labelEvery === 0) {
        const t = svgEl('text', { x: cx, y: TOP + PLOT_H + 18, class: 'chart-tick', 'text-anchor': 'middle' });
        t.textContent = r.label;
        svg.append(t);
      }
      // 感應區：整個欄位的寬和高，比柱子大很多，比較好指到
      const hit = svgEl('rect', { x: LEFT + band * i, y: TOP, width: band, height: PLOT_H, class: 'chart-hit' });
      if (focusable) {
        hit.setAttribute('tabindex', '0');
        hit.setAttribute('aria-label', `${r.title || r.label}：${series.map((s) => `${s.name} ${r.values[s.key] || 0}${unit}`).join('，')}`);
      }
      g.append(hit);
      svg.append(g);
    });

    // 提示框
    function show(i) {
      const r = rows[i];
      svg.querySelectorAll('.chart-col.is-hover').forEach((c) => c.classList.remove('is-hover'));
      svg.querySelector(`.chart-col[data-i="${i}"]`)?.classList.add('is-hover');
      tip.replaceChildren(el('p', 'tip-title', r.title || r.label));
      for (const s of [...series].reverse()) {   // 和柱子由上到下的順序一致
        const row = el('p', 'tip-row');
        const key = el('span', 'tip-key');
        key.style.background = s.color;
        row.append(key, el('strong', '', `${r.values[s.key] || 0}${unit}`), el('span', 'tip-name', s.name));
        tip.append(row);
      }
      tip.hidden = false;
      const cx = LEFT + band * (i + 0.5);
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(width - tw, cx - tw / 2))}px`;
      tip.style.top = '0px';
    }
    function hide() {
      tip.hidden = true;
      svg.querySelectorAll('.chart-col.is-hover').forEach((c) => c.classList.remove('is-hover'));
    }
    svg.addEventListener('pointermove', (e) => {
      const g = e.target.closest?.('.chart-col');
      if (g) show(Number(g.dataset.i));
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focusin', (e) => {
      const g = e.target.closest?.('.chart-col');
      if (g) show(Number(g.dataset.i));
    });
    svg.addEventListener('focusout', hide);
    plot.prepend(svg);
  }

  draw();
  // 容器寬度改變（旋轉手機、縮放視窗）時重畫
  let lastW = plot.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(plot.clientWidth - lastW) > 1) { lastW = plot.clientWidth; draw(); }
  });
  ro.observe(plot);
  return () => ro.disconnect();
}
