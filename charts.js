/* ==========================================================================
   TornDash — charts.js
   Zero-dependency SVG chart helpers (sparkline, donut, line chart, ranked
   bars). Colours follow the dataviz method: single-series charts use one
   accent hue; the donut uses a CVD-validated categorical palette with a
   neutral "Other" catch-all. All helpers return HTML strings.

   Depends (at call time only) on escapeHtml() / fmt() from app.js.
   ========================================================================== */

'use strict';

/* CVD-safe categorical palette — validated on this app's dark surface
   (#0f1728) with the dataviz validator: worst adjacent CVD ΔE 8.4. Assigned
   in fixed order, never cycled; segments past the list fold into OTHER_COLOR. */
const CAT_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHER_COLOR = '#5a6b86'; // neutral gray — signals "catch-all", not a category

/* --------------------------------------------------------------------------
   sparkline — tiny single-series trend (stat-tile companion, no axes)
   -------------------------------------------------------------------------- */
function sparkline(values, opts = {}) {
  const vals = (values || []).map(Number).filter(Number.isFinite);
  const w = opts.w ?? 130;
  const h = opts.h ?? 34;
  const pad = 3;
  const color = opts.color ?? 'var(--accent)';

  if (vals.length < 2) {
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const dx = (w - pad * 2) / (vals.length - 1);
  const pts = vals.map((v, i) => [
    pad + i * dx,
    h - pad - ((v - min) / range) * (h - pad * 2),
  ]);

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h - pad} L${pts[0][0].toFixed(1)} ${h - pad} Z`;
  const last = pts[pts.length - 1];

  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="trend">
      <path d="${area}" fill="${color}" opacity="0.12"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" fill="${color}"/>
    </svg>`;
}

/* --------------------------------------------------------------------------
   donutChart — categorical part-to-whole. Segments already sorted desc and
   folded to top-N + "Other" by the caller. 2px surface gaps between arcs.
   segments: [{ label, value, color }]
   -------------------------------------------------------------------------- */
function donutChart(segments, opts = {}) {
  const size = opts.size ?? 168;
  const thickness = opts.thickness ?? 22;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const gap = 2; // px surface gap (secondary encoding for CVD safety)
  const surface = opts.surface ?? 'rgba(6,10,19,0.7)';

  const list = (segments || []).filter((s) => Number(s.value) > 0);
  const total = list.reduce((s, seg) => s + Number(seg.value), 0) || 1;

  let offset = 0;
  const arcs = list.map((seg) => {
    const frac = Number(seg.value) / total;
    const len = Math.max(0, frac * C - gap);
    const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}"
        stroke-width="${thickness}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += frac * C;
    return el;
  }).join('');

  const c1 = opts.centerTop ? `<text x="${cx}" y="${cy - 1}" text-anchor="middle" class="donut__c1">${escapeHtml(opts.centerTop)}</text>` : '';
  const c2 = opts.centerSub ? `<text x="${cx}" y="${cy + 17}" text-anchor="middle" class="donut__c2">${escapeHtml(opts.centerSub)}</text>` : '';

  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(opts.aria || 'breakdown')}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${surface}" stroke-width="${thickness}"/>
      ${arcs}
      ${c1}${c2}
    </svg>`;
}

/* --------------------------------------------------------------------------
   rankedBars — sorted horizontal magnitude list (part-to-whole companion or
   standalone ranking). rows: [{ label, value, display, color }]
   -------------------------------------------------------------------------- */
function rankedBars(rows, opts = {}) {
  const list = (rows || []).slice();
  const max = opts.max ?? Math.max(1, ...list.map((r) => Number(r.value) || 0));
  return `<div class="rbars">` + list.map((row) => {
    const pct = max ? Math.max(1.5, (Number(row.value) / max) * 100) : 0;
    const color = row.color || 'var(--accent)';
    return `<div class="rbar">
        <div class="rbar__top">
          <span class="rbar__label"><span class="rbar__dot" style="background:${color}"></span>${escapeHtml(row.label)}</span>
          <span class="rbar__val">${row.display ?? fmt(row.value)}</span>
        </div>
        <div class="rbar__track"><div class="rbar__fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      </div>`;
  }).join('') + `</div>`;
}

/* --------------------------------------------------------------------------
   lineChart — single-series time series with recessive grid, y-ticks, an
   end-dot value label, and a crosshair+tooltip wired by app.js (wireCharts()).
   points: [{ t:<ms>, v:<number> }]  (ascending time)
   -------------------------------------------------------------------------- */
function lineChart(points, opts = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(p.v));
  const w = opts.w ?? 640;
  const h = opts.h ?? 220;
  const padL = opts.padL ?? 52;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const color = opts.color ?? 'var(--accent)';
  const fmtV = opts.fmtV || ((v) => fmt(v));

  if (pts.length < 2) {
    return `<div class="linechart linechart--empty"><i class="fa-solid fa-chart-line"></i> Not enough history yet — keep the dashboard open (or refresh) to build a trend.</div>`;
  }

  const xs = pts.map((p) => p.t);
  const ys = pts.map((p) => p.v);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs) || minX + 1;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeY = maxY - minY || Math.abs(maxY) || 1;
  // pad the y-range a touch so the line doesn't kiss the frame
  const loY = minY - rangeY * 0.08;
  const hiY = maxY + rangeY * 0.08;

  const sx = (t) => padL + ((t - minX) / (maxX - minX)) * (w - padL - padR);
  const sy = (v) => padT + (1 - (v - loY) / (hiY - loY)) * (h - padT - padB);

  const screen = pts.map((p) => ({ x: sx(p.t), y: sy(p.v), t: p.t, v: p.v }));
  const line = screen.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${screen[screen.length - 1].x.toFixed(1)} ${(h - padB).toFixed(1)} L${screen[0].x.toFixed(1)} ${(h - padB).toFixed(1)} Z`;

  // 4 horizontal gridlines + y ticks (clean-ish values)
  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = loY + (i / ticks) * (hiY - loY);
    const y = sy(v);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" class="lc-grid"/>`;
    grid += `<text x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="lc-ytick">${escapeHtml(opts.fmtTick ? opts.fmtTick(v) : compact(v))}</text>`;
  }

  const end = screen[screen.length - 1];
  const payload = screen.map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), t: p.t, v: p.v }));

  return `<div class="linechart" data-min="${padL}" data-max="${w - padR}">
      <svg width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(opts.aria || 'history')}">
        ${grid}
        <path d="${area}" fill="${color}" opacity="0.10"/>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        <circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="3.5" fill="${color}"/>
        <g class="lc-cross" style="opacity:0">
          <line class="lc-crossline" x1="0" y1="${padT}" x2="0" y2="${h - padB}"/>
          <circle class="lc-crossdot" r="4" cx="0" cy="0" fill="${color}"/>
        </g>
        <rect class="lc-hit" x="${padL}" y="${padT}" width="${(w - padL - padR).toFixed(1)}" height="${(h - padT - padB).toFixed(1)}" fill="transparent"/>
      </svg>
      <div class="lc-tip" hidden></div>
      <script type="application/json" class="lc-data">${JSON.stringify(payload)}</script>
    </div>`;
}
