'use strict';

/* TornDash — app.js  (bundled)
   100% client-side Torn City companion dashboard.*/

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

/* --------------------------------------------------------------------------
   TABS
   -------------------------------------------------------------------------- */
const CATEGORIES = [
  { id: 'overview', label: 'Overview', icon: 'fa-gauge-high' },
  { id: 'combat', label: 'Combat', icon: 'fa-hand-fist' },
  { id: 'finance', label: 'Finance', icon: 'fa-sack-dollar' },
  { id: 'stats', label: 'Personal Stats', icon: 'fa-chart-simple' },
  { id: 'activity', label: 'Activity', icon: 'fa-wave-square' },
  { id: 'factionjob', label: 'Faction & Job', icon: 'fa-users' },
  { id: 'items', label: 'Items', icon: 'fa-box-open' },
  { id: 'settings', label: 'Settings', icon: 'fa-gear' },
];

/* --------------------------------------------------------------------------
   Small render primitives (card/accessNote/countdown live in app.js)
   -------------------------------------------------------------------------- */
function kvRows(rows) {
  return rows.filter(Boolean).map(([k, v, icon, cls]) =>
    `<div class="kv__row"><span class="kv__k">${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}${k}</span><span class="kv__v ${cls || ''}">${v}</span></div>`
  ).join('');
}
function kvBlock(rows) {
  const html = kvRows(rows);
  return html ? `<div class="kv">${html}</div>` : '';
}
function bignum(val, sub, cls = '') {
  return `<div class="bignum"><div class="bignum__val ${cls}">${val}</div>${sub ? `<div class="bignum__sub">${sub}</div>` : ''}</div>`;
}
function noteEmpty(text, icon = 'fa-circle-info') {
  return `<div class="note"><i class="fa-solid ${icon}"></i> ${text}</div>`;
}

/* Battle/work-style stat lines. parts: [ [label, value, color] ] */
function statLines(parts, total) {
  return parts.map(([label, val, color]) => {
    const p = total ? (Number(val) / total) * 100 : 0;
    return `<div class="statline" style="--c:${color}">
        <div class="statline__top"><span>${label}</span><span class="num">${fmt(val)}</span></div>
        <div class="statline__bar"><div style="width:${p}%"></div></div>
      </div>`;
  }).join('');
}

/* Status bar (energy/nerve/happy/life). */
function bar(name, icon, obj, color) {
  if (!obj) return '';
  const cur = obj.current ?? 0;
  const max = obj.maximum ?? 0;
  const p = max ? Math.min(100, (cur / max) * 100) : 0;
  const full = cur >= max;
  const meta = full
    ? '<span class="bar__full">FULL</span>'
    : (obj.fulltime ? `Full in ${countdown(serverNow() + obj.fulltime * 1000, 'Full')}` : '&nbsp;');
  return `<div class="bar" style="--bar:${color}">
      <div class="bar__top">
        <span class="bar__name"><i class="fa-solid ${icon}"></i> ${name}</span>
        <span class="bar__val">${fmt(cur)} / ${fmt(max)}</span>
      </div>
      <div class="bar__track"><div class="bar__fill" style="width:${p}%"></div></div>
      <div class="bar__meta">${meta}</div>
    </div>`;
}

/* ==========================================================================
   PROFILE (header banner) — rendered by app.js into #card-profile
   ========================================================================== */
function renderProfile(d) {
  const name = d.name ?? d.playername ?? 'Unknown';
  const id = d.player_id ?? '—';
  const level = d.level ?? '—';
  const rank = d.rank ?? '';
  const img = d.profile_image || '';
  const st = d.status || {};
  const colorMap = { green: 'green', red: 'red', blue: 'blue', orange: 'gold' };
  const badgeColor = colorMap[st.color] || 'green';

  let statusText = escapeHtml(st.description || st.state || 'Okay');
  if (st.until && st.until > 0) statusText += ' · ' + countdown(st.until * 1000, 'Out');

  const badges = [
    `<span class="badge badge--${badgeColor}"><i class="fa-solid fa-circle"></i> ${statusText}</span>`,
    rank ? `<span class="badge badge--gold"><i class="fa-solid fa-medal"></i> ${escapeHtml(rank)}</span>` : '',
    d.donator ? `<span class="badge badge--purple"><i class="fa-solid fa-crown"></i> Donator</span>` : '',
    d.last_action?.relative
      ? `<span class="badge"><i class="fa-solid fa-clock"></i> ${escapeHtml(d.last_action.status || 'Seen')} ${escapeHtml(d.last_action.relative)}</span>`
      : '',
  ].join('');

  const meta = [
    ['Level', fmt(level)],
    d.age != null ? ['Age', `${fmt(d.age)}d`] : null,
    d.gender ? ['Gender', escapeHtml(d.gender)] : null,
    d.property ? ['Property', escapeHtml(d.property)] : null,
  ].filter(Boolean).map(([k, v]) =>
    `<div class="metaitem"><span class="metaitem__k">${k}</span><span class="metaitem__v">${v}</span></div>`
  ).join('');

  const avatar = img
    ? `<img class="profile__img" src="${escapeHtml(img)}" alt="${escapeHtml(name)}'s avatar" loading="lazy" />`
    : `<div class="profile__img profile__img--ph"><i class="fa-solid fa-user"></i></div>`;

  return `${avatar}
    <div class="profile__main">
      <div class="profile__name">${escapeHtml(name)}</div>
      <div class="profile__id">ID <b>#${escapeHtml(String(id))}</b></div>
      <div class="profile__badges">${badges}</div>
    </div>
    <div class="profile__meta">${meta}</div>`;
}

/* ==========================================================================
   OVERVIEW — command center (composed, always shown)
   ========================================================================== */

/* Actionable "what's ready now" derived entirely from the response. */
function computeReadiness(d) {
  const out = [];
  const push = (ready, label, icon, hint) => out.push({ ready, label, icon, hint });
  const cd = d.cooldowns || {};

  if (d.energy) push(d.energy.current >= d.energy.maximum, 'Energy', 'fa-bolt', 'Train at the gym');
  if (d.nerve) push(d.nerve.current >= d.nerve.maximum, 'Nerve', 'fa-fire', 'Commit a crime');
  push(!cd.drug || cd.drug <= 0, 'Drug', 'fa-pills', 'Drug cooldown clear');
  push(!cd.booster || cd.booster <= 0, 'Booster', 'fa-bottle-water', 'Booster cooldown clear');
  push(!cd.medical || cd.medical <= 0, 'Medical', 'fa-kit-medical', 'Medical cooldown clear');
  if (d.education_timeleft != null) push(!(d.education_timeleft > 0), 'Education', 'fa-graduation-cap', 'Course complete');
  if (d.travel && d.travel.time_left != null) push(!(d.travel.time_left > 0), 'Travel', 'fa-plane', 'Landed');
  if (d.refills) {
    push(!d.refills.energy_refill_used, 'E-Refill', 'fa-bottle-droplet', 'Energy refill available');
    push(!d.refills.nerve_refill_used, 'N-Refill', 'fa-bottle-droplet', 'Nerve refill available');
  }
  return out;
}

function renderReadiness(d) {
  const items = computeReadiness(d);
  if (!items.length) return '';
  const chips = items.map((it) =>
    `<span class="rchip ${it.ready ? 'is-ready' : 'is-wait'}" title="${escapeHtml(it.hint)}">
        <i class="fa-solid ${it.icon}"></i> ${escapeHtml(it.label)}
        <span class="rchip__state">${it.ready ? 'Ready' : 'Wait'}</span>
      </span>`
  ).join('');
  const readyCount = items.filter((i) => i.ready).length;
  return `<section class="ready">
      <div class="ready__head"><i class="fa-solid fa-bolt-lightning"></i> Ready now
        <span class="ready__count">${readyCount}/${items.length}</span>
      </div>
      <div class="ready__chips">${chips}</div>
    </section>`;
}

/* KPI tile — label + figure only. */
function kpiTile(label, value, opts = {}) {
  return `<div class="kpi">
      <div class="kpi__label">${escapeHtml(label)}</div>
      <div class="kpi__value ${opts.cls || ''}">${value}</div>
    </div>`;
}

function renderOverview(d, ctx) {
  const h = ctx.history || [];

  // Hero status bars + chain
  const heroBars = `<div class="bars">
      ${bar('Energy', 'fa-bolt', d.energy, 'var(--accent)')}
      ${bar('Nerve', 'fa-fire', d.nerve, '#ff5470')}
      ${bar('Happy', 'fa-face-smile', d.happy, '#ffce54')}
      ${bar('Life', 'fa-heart', d.life, '#22d3ee')}
    </div>${renderChainInline(d.chain)}`;

  // KPI tiles
  const bsTotal = d.total ?? ((Number(d.strength) || 0) + (Number(d.speed) || 0) + (Number(d.dexterity) || 0) + (Number(d.defense) || 0));
  const workTotal = (Number(d.manual_labor) || 0) + (Number(d.intelligence) || 0) + (Number(d.endurance) || 0);
  const kpis = `<div class="kpis">
      ${kpiTile('Level', fmt(d.level))}
      ${kpiTile('Networth', '$' + compact(d.networth?.total ?? 0), { cls: 'cyan' })}
      ${kpiTile('Money', '$' + compact(d.money_onhand ?? 0))}
      ${kpiTile('Battle stats', compact(bsTotal))}
      ${kpiTile('Work stats', compact(workTotal), { cls: 'violet' })}
    </div>`;

  // Cooldowns compact
  const cd = d.cooldowns || {};
  const cds = `<div class="cds cds--mini">
      ${cooldownTile('Drug', 'fa-pills', cd.drug, 'var(--accent-3)')}
      ${cooldownTile('Medical', 'fa-kit-medical', cd.medical, 'var(--danger)')}
      ${cooldownTile('Booster', 'fa-bottle-water', cd.booster, 'var(--warn)')}
    </div>`;

  // Mini networth donut
  const nwMini = miniNetworth(d);
  // Travel compact
  const travel = travelInline(d);

  return `
    ${renderReadiness(d)}
    ${kpis}
    <div class="ov-grid">
      ${card('ov-bars', 'Status', 'fa-heart-pulse', heroBars)}
      ${card('ov-cd', 'Cooldowns', 'fa-hourglass-half', cds)}
      ${card('ov-nw', 'Networth', 'fa-sack-dollar', nwMini)}
      ${card('ov-travel', 'Travel', 'fa-plane', travel)}
    </div>`;
}

function renderChainInline(chain) {
  if (!chain || !chain.current) return '';
  const timeout = chain.timeout ? ` · ${countdown(serverNow() + chain.timeout * 1000, 'Ended')} left` : '';
  return `<div class="chain"><span class="chain__k"><i class="fa-solid fa-link"></i> Chain</span>
      <span class="chain__v accent">${fmt(chain.current)} / ${fmt(chain.maximum)}${timeout}</span></div>`;
}

function miniNetworth(d) {
  const nw = d.networth;
  if (!nw || nw.total == null) return accessNote();
  const fields = networthFields(nw);
  const segs = foldSegments(fields, 5);
  return `<div class="nw nw--mini">
      <div class="nw__chart">${donutChart(segs, { size: 128, thickness: 18, centerTop: '$' + compact(nw.total), centerSub: 'total', aria: 'net worth' })}</div>
      <div class="nw__legend">${segs.map((s) => `<span class="lg"><span class="lg__dot" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>`).join('')}</div>
    </div>`;
}

function travelInline(d) {
  const t = d.travel || {};
  if (t.time_left && t.time_left > 0) {
    return `${bignum(countdown(serverNow() + t.time_left * 1000, 'Landed'), `to ${escapeHtml(t.destination || '—')}`, 'cyan')}`;
  }
  const where = t.destination && t.destination !== 'Torn' ? escapeHtml(t.destination) : 'Torn';
  return noteEmpty(`In <strong>${where}</strong> — not travelling.`, 'fa-house');
}

/* ==========================================================================
   COMBAT
   ========================================================================== */
function renderBattle(d, ctx) {
  if (d.strength == null) return card('battle', 'Battle Stats', 'fa-hand-fist', accessNote());
  const parts = [
    ['Strength', d.strength, 'var(--accent)'],
    ['Speed', d.speed, 'var(--accent-2)'],
    ['Dexterity', d.dexterity, 'var(--accent-3)'],
    ['Defense', d.defense, 'var(--gold)'],
  ];
  const total = d.total ?? parts.reduce((s, [, v]) => s + (Number(v) || 0), 0);
  const ser = (ctx.history || []).map((s) => s.bsTotal).filter(Number.isFinite);
  const spark = ser.length > 1 ? `<div class="card__spark">${sparkline(ser, { color: 'var(--accent)', w: 240, h: 34 })}</div>` : '';
  const body = `<div class="statlines">${statLines(parts, total)}</div>
    <div class="total"><span>Total Battle Stats</span><span class="total__num">${fmt(total)}</span></div>${spark}`;
  return card('battle', 'Battle Stats', 'fa-hand-fist', body);
}

function renderWork(d, ctx) {
  if (d.manual_labor == null && d.intelligence == null && d.endurance == null) {
    return card('work', 'Working Stats', 'fa-briefcase', accessNote());
  }
  const manual = Number(d.manual_labor) || 0;
  const intel = Number(d.intelligence) || 0;
  const endur = Number(d.endurance) || 0;
  const total = manual + intel + endur;
  const parts = [
    ['Manual Labor', manual, 'var(--accent-2)'],
    ['Intelligence', intel, 'var(--accent-3)'],
    ['Endurance', endur, 'var(--accent)'],
  ];
  const body = `<div class="statlines">${statLines(parts, total)}</div>
    <div class="total total--cyan"><span>Total Working Stats</span><span class="total__num">${fmt(total)}</span></div>`;
  return card('work', 'Working Stats', 'fa-briefcase', body);
}

function renderAttacks(d) {
  const raw = d.attacks;
  if (!raw) return card('attacks', 'Recent Attacks', 'fa-swords', accessNote());
  const list = Object.values(raw).sort((a, b) => (b.timestamp_ended || 0) - (a.timestamp_ended || 0));
  if (!list.length) return card('attacks', 'Recent Attacks', 'fa-swords', noteEmpty('No recent attacks.'));

  const me = d.player_id;
  const WIN = new Set(['Attacked', 'Mugged', 'Hospitalized', 'Looted', 'Arrested', 'Special', 'Assist']);
  let wins = 0, losses = 0, respect = 0;
  list.forEach((a) => {
    const outgoing = a.attacker_id === me;
    if (outgoing) {
      if (WIN.has(a.result)) wins++; else losses++;
      respect += Number(a.respect) || 0;
    }
  });
  const rows = list.slice(0, 8).map((a) => {
    const outgoing = a.attacker_id === me;
    const other = outgoing ? (a.defender_name || a.defender_id) : (a.attacker_name || a.attacker_id);
    const win = outgoing ? WIN.has(a.result) : !WIN.has(a.result);
    const dirIcon = outgoing ? 'fa-arrow-right-from-bracket' : 'fa-arrow-right-to-bracket';
    return `<div class="atk ${win ? 'atk--win' : 'atk--loss'}">
        <span class="atk__dir"><i class="fa-solid ${dirIcon}"></i></span>
        <span class="atk__who">${escapeHtml(String(other))}</span>
        <span class="atk__res">${escapeHtml(a.result || '')}</span>
        <span class="atk__resp">${outgoing && a.respect ? '+' + (Number(a.respect)).toFixed(2) : ''}</span>
      </div>`;
  }).join('');

  const head = `<div class="atk-stats">
      <div class="atk-stat"><span class="atk-stat__n accent">${fmt(wins)}</span><span class="atk-stat__l">Wins</span></div>
      <div class="atk-stat"><span class="atk-stat__n" style="color:var(--danger)">${fmt(losses)}</span><span class="atk-stat__l">Losses</span></div>
      <div class="atk-stat"><span class="atk-stat__n cyan">${respect.toFixed(1)}</span><span class="atk-stat__l">Respect</span></div>
    </div>`;
  return card('attacks', 'Recent Attacks', 'fa-swords', head + `<div class="atk-list">${rows}</div>`, { wide: true, tag: `${list.length} logged` });
}

function renderWeaponExp(d) {
  const list = d.weaponexp;
  if (!Array.isArray(list) || !list.length) return card('weaponexp', 'Weapon EXP', 'fa-gun', accessNote());
  const top = list.slice().sort((a, b) => (b.exp || 0) - (a.exp || 0)).slice(0, 8);
  const rows = rankedBars(top.map((w) => ({ label: w.name || ('#' + w.itemID), value: w.exp || 0, display: (w.exp || 0) + '%', color: 'var(--accent-2)' })), { max: 100 });
  return card('weaponexp', 'Weapon EXP', 'fa-gun', rows, { tag: `${list.length} weapons` });
}

/* ==========================================================================
   FINANCE
   ========================================================================== */
function networthFields(nw) {
  const map = [
    ['items', 'Items'], ['stockmarket', 'Stock Market'], ['properties', 'Properties'],
    ['bank', 'City Bank'], ['cayman', 'Cayman Bank'], ['vault', 'Faction Vault'],
    ['wallet', 'Wallet'], ['points', 'Points'], ['displaycase', 'Display Case'],
    ['bazaar', 'Bazaar'], ['itemmarket', 'Item Market'], ['auctionhouse', 'Auction House'],
    ['company', 'Company'], ['bookie', 'Bookie'], ['enlistedcars', 'Enlisted Cars'],
    ['piggybank', 'Piggy Bank'], ['trade', 'Trade'], ['pending', 'Pending'],
  ];
  return map.map(([k, label]) => ({ label, value: Number(nw[k]) || 0 }));
}
/* Sort desc, keep positives, fold beyond `top` into a neutral "Other". */
function foldSegments(fields, top) {
  const parts = fields.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  if (parts.length <= top) return parts.map((p, i) => ({ ...p, color: i < CAT_COLORS.length ? CAT_COLORS[i] : OTHER_COLOR }));
  const head = parts.slice(0, top).map((p, i) => ({ ...p, color: CAT_COLORS[i] }));
  const otherVal = parts.slice(top).reduce((s, p) => s + p.value, 0);
  head.push({ label: 'Other', value: otherVal, color: OTHER_COLOR });
  return head;
}
function renderNetworth(d, ctx) {
  const nw = d.networth;
  if (!nw || nw.total == null) return card('networth', 'Networth', 'fa-sack-dollar', accessNote());
  const fields = networthFields(nw);
  const segs = foldSegments(fields, 7);
  const donut = donutChart(segs, { centerTop: '$' + compact(nw.total), centerSub: 'net worth', aria: 'net worth breakdown' });
  const bars = rankedBars(segs.map((s) => ({ label: s.label, value: s.value, display: money(s.value), color: s.color })), {});
  const negatives = fields.filter((p) => p.value < 0);
  const neg = negatives.length
    ? `<div class="nw-neg">${negatives.map((n) => `<span class="badge badge--red">${escapeHtml(n.label)} ${money(n.value)}</span>`).join('')}</div>` : '';
  const ser = (ctx.history || []).map((s) => s.networth).filter(Number.isFinite);
  const spark = ser.length > 1 ? `<div class="card__spark">${sparkline(ser, { color: 'var(--accent-2)', w: 260, h: 34 })}</div>` : '';
  const body = `<div class="nw"><div class="nw__chart">${donut}</div><div class="nw__bars">${bars}</div></div>${neg}${spark}`;
  return card('networth', 'Networth Breakdown', 'fa-sack-dollar', body, { wide: true });
}

function renderMoney(d) {
  if (d.money_onhand == null && d.points == null && !d.city_bank) return card('money', 'Money', 'fa-wallet', accessNote());
  const cityBank = d.city_bank || {};
  const rows = [
    ['On Hand', money(d.money_onhand), 'fa-wallet', 'accent'],
    cityBank.amount != null ? ['City Bank', money(cityBank.amount), 'fa-building-columns', ''] : null,
    d.vault_amount ? ['Faction Vault', money(d.vault_amount), 'fa-vault', ''] : null,
    d.cayman_bank ? ['Cayman Bank', money(d.cayman_bank), 'fa-piggy-bank', ''] : null,
    d.company_funds ? ['Company Funds', money(d.company_funds), 'fa-building', ''] : null,
    d.points != null ? ['Points', fmt(d.points) + ' pts', 'fa-coins', 'cyan'] : null,
    cityBank.time_left ? ['Bank matures', countdown(serverNow() + cityBank.time_left * 1000, 'Ready'), 'fa-clock', ''] : null,
  ];
  const liquid = (Number(d.money_onhand) || 0) + (Number(cityBank.amount) || 0) + (Number(d.vault_amount) || 0) + (Number(d.cayman_bank) || 0);
  const body = bignum(money(liquid), '≈ $' + compact(liquid) + ' liquid cash') + kvBlock(rows);
  return card('money', 'Money', 'fa-wallet', body);
}

function renderStocks(d, ctx) {
  const owned = d.stocks;
  if (!owned) return card('stocks', 'Stock Portfolio', 'fa-chart-line', accessNote());
  const list = Object.values(owned);
  if (!list.length) return card('stocks', 'Stock Portfolio', 'fa-chart-line', noteEmpty('No stocks owned.'));
  const ref = ctx.ref?.stocks || {};
  let totalVal = 0;
  const rows = list.map((s) => {
    const info = ref[s.stock_id] || ref[String(s.stock_id)] || {};
    const shares = s.total_shares ?? s.shares ?? 0;
    const price = Number(info.current_price) || 0;
    const val = shares * price;
    totalVal += val;
    return { label: info.acronym || info.name || ('#' + s.stock_id), value: val, display: '$' + compact(val), color: 'var(--accent)', shares };
  }).sort((a, b) => b.value - a.value);
  const bars = rankedBars(rows.map((r) => ({ label: `${r.label} · ${fmt(r.shares)}`, value: r.value, display: r.display, color: r.color })), {});
  const body = bignum('$' + compact(totalVal), `${list.length} holdings · portfolio value`, 'cyan')
    + (ctx.ref?.stocks ? bars : noteEmpty('Live prices unavailable — showing holdings only.'));
  return card('stocks', 'Stock Portfolio', 'fa-chart-line', body, { wide: rows.length > 5 });
}

function itemsValue(list) {
  if (!Array.isArray(list)) return { count: 0, value: 0 };
  let count = 0, value = 0;
  list.forEach((it) => {
    const q = Number(it.quantity) || 0;
    count += q;
    value += q * (Number(it.market_price) || 0);
  });
  return { count, value };
}
function renderItemValue(d) {
  const hasAny = d.inventory || d.bazaar || d.display;
  if (!hasAny) return card('itemvalue', 'Item Value', 'fa-boxes-stacked', accessNote());
  const inv = itemsValue(d.inventory);
  const baz = itemsValue(d.bazaar);
  const dis = itemsValue(d.display);
  const total = inv.value + baz.value + dis.value;
  const rows = [
    ['Inventory', `${fmt(inv.count)} · ${money(inv.value)}`, 'fa-backpack', ''],
    ['Bazaar', `${fmt(baz.count)} · ${money(baz.value)}`, 'fa-store', ''],
    ['Display Case', `${fmt(dis.count)} · ${money(dis.value)}`, 'fa-gem', ''],
  ];
  const body = bignum(money(total), 'total item market value', 'cyan') + kvBlock(rows);
  return card('itemvalue', 'Item Value', 'fa-boxes-stacked', body);
}

function renderProperties(d) {
  const props = d.properties;
  if (!props) return card('properties', 'Properties', 'fa-house', accessNote());
  const list = Object.values(props);
  if (!list.length) return card('properties', 'Properties', 'fa-house', noteEmpty('No properties owned.'));
  const rows = list.slice(0, 10).map((p) => {
    const name = p.property || p.property_type || 'Property';
    const extra = p.happy != null ? `${fmt(p.happy)} happy` : (p.upkeep != null ? money(p.upkeep) + ' upkeep' : '');
    return [escapeHtml(name), extra, 'fa-house-chimney', 'muted'];
  });
  const body = bignum(fmt(list.length), 'properties owned') + kvBlock(rows);
  return card('properties', 'Properties', 'fa-house', body);
}

/* ==========================================================================
   PERSONAL STATS (explorer) + HISTORY
   ========================================================================== */
function renderPersonalStats(d, ctx) {
  const ps = d.personalstats;
  if (!ps || typeof ps !== 'object') return card('personalstats', 'Personal Stats', 'fa-chart-simple', accessNote());

  const q = (ctx.psSearch || '').trim().toLowerCase();
  const pinned = ctx.pinned || new Set();

  // Group every returned key by our meta map; unknown keys → "Other".
  const groups = {};
  for (const [key, val] of Object.entries(ps)) {
    if (typeof val === 'object') continue;
    const meta = PS_META[key] || { cat: 'Other', label: prettifyKey(key) };
    (groups[meta.cat] ||= []).push({ key, label: meta.label, value: Number(val) });
  }

  const renderRow = (row) => {
    const on = pinned.has(row.key);
    return `<div class="ps-row" data-pskey="${row.key}">
        <button class="ps-pin ${on ? 'is-on' : ''}" data-pin="${row.key}" title="Pin to top" aria-label="Pin ${escapeHtml(row.label)}"><i class="fa-solid fa-thumbtack"></i></button>
        <span class="ps-row__label">${escapeHtml(row.label)}</span>
        <span class="ps-row__val">${fmt(row.value)}</span>
      </div>`;
  };

  // Pinned section first
  const pinnedRows = [];
  for (const list of Object.values(groups)) for (const r of list) if (pinned.has(r.key)) pinnedRows.push(r);
  const pinnedHtml = pinnedRows.length
    ? `<div class="ps-group"><div class="ps-group__head"><i class="fa-solid fa-thumbtack"></i> Pinned</div>${pinnedRows.map(renderRow).join('')}</div>` : '';

  const body = PS_CATEGORY_ORDER.map((cat) => {
    let list = groups[cat];
    if (!list || !list.length) return '';
    if (q) list = list.filter((r) => r.label.toLowerCase().includes(q) || r.key.includes(q));
    if (!list.length) return '';
    list.sort((a, b) => a.label.localeCompare(b.label));
    return `<div class="ps-group"><div class="ps-group__head">${escapeHtml(cat)} <span class="ps-group__n">${list.length}</span></div>${list.map(renderRow).join('')}</div>`;
  }).join('');

  const search = `<div class="ps-search"><i class="fa-solid fa-magnifying-glass"></i>
      <input type="text" id="psSearch" placeholder="Search ${Object.keys(ps).length} personal stats…" value="${escapeHtml(ctx.psSearch || '')}" autocomplete="off" spellcheck="false" />
    </div>`;
  return card('personalstats', 'Personal Stats Explorer', 'fa-chart-simple',
    search + pinnedHtml + `<div class="ps-groups">${body || noteEmpty('No stats match your search.')}</div>`,
    { wide: true, tag: `${Object.keys(ps).length} stats` });
}

function renderHistory(d, ctx) {
  const h = ctx.history || [];
  const metric = ctx.historyMetric || 'bsTotal';
  const METRICS = [
    ['bsTotal', 'Battle stats', 'var(--accent)', (v) => compact(v)],
    ['networth', 'Networth', 'var(--accent-2)', (v) => '$' + compact(v)],
    ['money', 'Money on hand', 'var(--accent)', (v) => '$' + compact(v)],
    ['workTotal', 'Work stats', 'var(--accent-3)', (v) => compact(v)],
    ['level', 'Level', 'var(--gold)', (v) => fmt(v)],
  ];
  const m = METRICS.find((x) => x[0] === metric) || METRICS[0];
  const points = h.map((s) => ({ t: s.t, v: s[m[0]] })).filter((p) => Number.isFinite(p.v));

  const opts = METRICS.map(([k, label]) => `<option value="${k}"${k === metric ? ' selected' : ''}>${label}</option>`).join('');
  const selector = `<div class="hist-bar">
      <select id="historyMetric" class="select select--sm">${opts}</select>
      <span class="hist-meta">${points.length} snapshot${points.length === 1 ? '' : 's'} · saved locally on this device</span>
    </div>`;

  let delta = '';
  if (points.length > 1) {
    const diff = points[points.length - 1].v - points[0].v;
    const up = diff >= 0;
    delta = `<div class="hist-delta ${up ? 'up' : 'down'}"><i class="fa-solid fa-arrow-${up ? 'up' : 'down'}"></i> ${m[3](Math.abs(diff))} since first snapshot</div>`;
  }
  const chart = lineChart(points, { color: m[2], fmtTick: m[3], aria: m[1] + ' over time' });
  return card('history', 'Stat History', 'fa-clock-rotate-left', selector + delta + chart, { wide: true });
}

/* ==========================================================================
   PROGRESSION / SHOWCASE (Personal Stats tab)
   ========================================================================== */
function renderSkills(d) {
  const sk = d.skills;
  if (!sk || typeof sk !== 'object') return card('skills', 'Skills', 'fa-wand-sparkles', accessNote());
  const rows = Object.entries(sk)
    .filter(([k, v]) => k !== 'player_id' && v != null && v !== '')
    .map(([k, v]) => [prettifyKey(k), fmt(Number(v)), 'fa-angle-right', 'accent']);
  if (!rows.length) return card('skills', 'Skills', 'fa-wand-sparkles', noteEmpty('No skill data.'));
  return card('skills', 'Skills', 'fa-wand-sparkles', kvBlock(rows));
}

function renderGym(d, ctx) {
  const g = d.gym;
  if (g == null && d.active_gym == null) return card('gym', 'Gym', 'fa-dumbbell', accessNote());
  const id = d.active_gym ?? g;
  const gyms = ctx.ref?.gyms || {};
  const info = gyms[id] || gyms[String(id)] || {};
  const name = info.name || ('Gym #' + id);
  const rows = [
    info.energy ? ['Energy / train', fmt(info.energy), 'fa-bolt', 'accent'] : null,
    info.strength ? ['Strength dots', fmt(info.strength / 10), 'fa-hand-fist', ''] : null,
    info.speed ? ['Speed dots', fmt(info.speed / 10), 'fa-gauge-high', ''] : null,
    info.defense ? ['Defense dots', fmt(info.defense / 10), 'fa-shield', ''] : null,
    info.dexterity ? ['Dexterity dots', fmt(info.dexterity / 10), 'fa-bullseye', ''] : null,
  ];
  return card('gym', 'Gym', 'fa-dumbbell', bignum(escapeHtml(name), 'active gym') + kvBlock(rows));
}

function renderEducation(d, ctx) {
  const left = d.education_timeleft;
  const completed = Array.isArray(d.education_completed) ? d.education_completed.length : null;
  const eduRef = ctx.ref?.education || null;

  let body;
  if (left && left > 0) {
    let name = '';
    if (eduRef && d.education_current != null) {
      const cur = eduRef[d.education_current] || eduRef[String(d.education_current)];
      name = cur?.name ? escapeHtml(cur.name) : '';
    }
    body = bignum(countdown(serverNow() + left * 1000, 'Complete'), name || 'until current course completes', 'cyan');
  } else {
    body = noteEmpty('No active course.', 'fa-circle-check');
  }
  if (completed != null) {
    body += kvBlock([['Courses completed', fmt(completed), 'fa-certificate', 'accent']]);
  }
  return card('education', 'Education', 'fa-graduation-cap', body);
}

function renderAwards(d, ctx) {
  const honors = Array.isArray(d.honors_awarded) ? d.honors_awarded : (Array.isArray(d.honors) ? d.honors : []);
  const medals = Array.isArray(d.medals_awarded) ? d.medals_awarded : (Array.isArray(d.medals) ? d.medals : []);
  const merits = d.merits && typeof d.merits === 'object' ? d.merits : null;
  if (!honors.length && !medals.length && !merits) return card('awards', 'Awards', 'fa-trophy', accessNote());

  const hRef = ctx.ref?.honors || {};
  const mRef = ctx.ref?.medals || {};
  const recentHonors = honors.slice(-6).reverse().map((id) => {
    const info = hRef[id] || hRef[String(id)] || {};
    return `<span class="award-chip"><i class="fa-solid fa-award"></i> ${escapeHtml(info.name || ('#' + id))}</span>`;
  }).join('');

  let meritRows = '';
  if (merits) {
    meritRows = kvBlock(Object.entries(merits).filter(([, v]) => Number(v) > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, v]) => [escapeHtml(k), fmt(v), 'fa-star', 'accent']));
  }

  const tiles = `<div class="award-tiles">
      <div class="award-tile"><span class="award-tile__n gold">${fmt(honors.length)}</span><span class="award-tile__l">Honors</span></div>
      <div class="award-tile"><span class="award-tile__n cyan">${fmt(medals.length)}</span><span class="award-tile__l">Medals</span></div>
      <div class="award-tile"><span class="award-tile__n accent">${merits ? fmt(Object.keys(merits).length) : '—'}</span><span class="award-tile__l">Merits</span></div>
    </div>`;
  const recent = recentHonors ? `<div class="award-recent"><div class="award-recent__h">Recent honors</div><div class="award-chips">${recentHonors}</div></div>` : '';
  return card('awards', 'Awards & Honors', 'fa-trophy', tiles + recent + meritRows, { wide: true });
}

function renderPerks(d) {
  const GROUPS = [
    ['job_perks', 'Job', 'fa-briefcase'], ['property_perks', 'Property', 'fa-house'],
    ['stock_perks', 'Stock', 'fa-chart-line'], ['merit_perks', 'Merit', 'fa-medal'],
    ['education_perks', 'Education', 'fa-graduation-cap'], ['enhancer_perks', 'Enhancer', 'fa-flask'],
    ['faction_perks', 'Faction', 'fa-users'], ['book_perks', 'Book', 'fa-book'],
  ];
  const groups = GROUPS.map(([key, label, icon]) => [label, icon, Array.isArray(d[key]) ? d[key].length : 0]).filter(([, , c]) => c > 0);
  if (!groups.length) return card('perks', 'Perks', 'fa-star', noteEmpty('No perk data available.'));
  const total = groups.reduce((s, [, , c]) => s + c, 0);
  const rows = groups.map(([label, icon, count]) => [`${label} perks`, fmt(count), icon, 'accent']);
  return card('perks', 'Perks', 'fa-star', bignum(fmt(total), 'active perks') + kvBlock(rows), { wide: groups.length > 4 });
}

/* ==========================================================================
   ACTIVITY
   ========================================================================== */
function stripHtml(str) {
  return String(str || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
function renderEvents(d) {
  const ev = d.events;
  if (!ev) return card('events', 'Activity Feed', 'fa-wave-square', accessNote());
  const list = Object.values(ev).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 12);
  if (!list.length) return card('events', 'Activity Feed', 'fa-wave-square', noteEmpty('No recent events.'));
  const rows = list.map((e) => `<div class="ev">
      <span class="ev__dot"></span>
      <span class="ev__text">${escapeHtml(stripHtml(e.event))}</span>
      <span class="ev__time">${e.timestamp ? timeAgo(e.timestamp * 1000) : ''}</span>
    </div>`).join('');
  return card('events', 'Activity Feed', 'fa-wave-square', `<div class="ev-list">${rows}</div>`, { wide: true });
}

function renderMessages(d) {
  const ms = d.messages;
  if (!ms) return card('messages', 'Messages', 'fa-envelope', accessNote());
  const list = Object.values(ms).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 8);
  if (!list.length) return card('messages', 'Messages', 'fa-envelope', noteEmpty('No recent messages.'));
  const rows = list.map((m) => `<div class="msg ${m.seen ? '' : 'msg--unread'}">
      <span class="msg__from">${escapeHtml(m.name || 'Unknown')}</span>
      <span class="msg__title">${escapeHtml(m.title || '')}</span>
      <span class="msg__time">${m.timestamp ? timeAgo(m.timestamp * 1000) : ''}</span>
    </div>`).join('');
  return card('messages', 'Messages', 'fa-envelope', `<div class="msg-list">${rows}</div>`, { wide: true });
}

function renderIcons(d) {
  const icons = d.icons;
  if (!icons || typeof icons !== 'object') return card('icons', 'Status Icons', 'fa-icons', noteEmpty('No status icons.'));
  const chips = Object.values(icons).map((desc) => `<span class="badge">${escapeHtml(desc)}</span>`).join('');
  return card('icons', 'Status Icons', 'fa-icons', `<div class="pill-row">${chips}</div>`);
}

/* ==========================================================================
   FACTION & JOB
   ========================================================================== */
function totalJobPoints(d) {
  const jp = d.jobpoints;
  if (!jp) return null;
  let total = 0;
  if (jp.jobs) for (const v of Object.values(jp.jobs)) total += Number(v) || 0;
  if (jp.companies) for (const c of Object.values(jp.companies)) total += Number(c?.jobpoints) || 0;
  return total;
}
function renderJob(d) {
  const job = d.job || {};
  if (!job.job && !job.company_name) return card('job', 'Job', 'fa-id-badge', noteEmpty('Not currently employed.'));
  const points = totalJobPoints(d);
  const jp = d.jobpoints || {};
  const companyRows = jp.companies
    ? Object.values(jp.companies).filter((c) => c && c.jobpoints).map((c) => [escapeHtml(c.name || 'Company'), fmt(c.jobpoints) + ' pts', 'fa-building', 'accent'])
    : [];
  const cityRows = jp.jobs
    ? Object.entries(jp.jobs).filter(([, v]) => Number(v) > 0).map(([k, v]) => [prettifyKey(k), fmt(v) + ' pts', 'fa-city', ''])
    : [];
  const rows = [
    job.position ? ['Position', escapeHtml(job.position), 'fa-user-tie', ''] : null,
    points != null ? ['Total Job Points', fmt(points), 'fa-award', 'accent'] : null,
    ...companyRows, ...cityRows,
  ];
  const body = bignum(escapeHtml(job.company_name || job.job || 'Employed'), escapeHtml(job.job || ''), '') + kvBlock(rows);
  return card('job', 'Job', 'fa-id-badge', body);
}

function renderFaction(d) {
  const f = d.faction || {};
  if (!f.faction_id) return card('faction', 'Faction', 'fa-users', noteEmpty('Not in a faction.'));
  const rows = [
    ['Position', escapeHtml(f.position || '—'), 'fa-user-shield', ''],
    f.days_in_faction != null ? ['Days in Faction', fmt(f.days_in_faction), 'fa-calendar-day', ''] : null,
    ['Faction ID', `#${escapeHtml(String(f.faction_id))}`, 'fa-hashtag', 'muted'],
  ];
  const tag = f.faction_tag ? `<span class="badge badge--blue">[${escapeHtml(f.faction_tag)}]</span>` : '';
  const body = bignum(escapeHtml(f.faction_name || 'Faction'), tag, 'cyan') + kvBlock(rows);
  return card('faction', 'Faction', 'fa-users', body);
}

/* Cooldown tile (shared by Overview + any cooldown use). */
function cooldownTile(name, icon, seconds, color) {
  const ready = !seconds || seconds <= 0;
  const time = ready ? 'Ready' : countdown(serverNow() + seconds * 1000, 'Ready');
  return `<div class="cd${ready ? ' cd--ready' : ''}" style="--c:${color}">
      <div class="cd__icon"><i class="fa-solid ${icon}"></i></div>
      <div class="cd__body"><span class="cd__name">${name}</span><span class="cd__time">${time}</span></div>
    </div>`;
}

/* ==========================================================================
   SECTION REGISTRY (toggleable cards; Overview & Settings are app-rendered)
   selections = the Torn `user` selections this card needs.
   ========================================================================== */
const SECTIONS = [
  // Combat
  { id: 'battle', label: 'Battle Stats', icon: 'fa-hand-fist', category: 'combat', selections: ['battlestats'], defaultOn: true, render: renderBattle },
  { id: 'attacks', label: 'Recent Attacks', icon: 'fa-swords', category: 'combat', selections: ['attacks'], defaultOn: true, render: renderAttacks },
  { id: 'weaponexp', label: 'Weapon EXP', icon: 'fa-gun', category: 'combat', selections: ['weaponexp'], defaultOn: false, render: renderWeaponExp },

  // Finance
  { id: 'networth', label: 'Networth', icon: 'fa-sack-dollar', category: 'finance', selections: ['networth'], defaultOn: true, render: renderNetworth },
  { id: 'money', label: 'Money', icon: 'fa-wallet', category: 'finance', selections: ['money'], defaultOn: true, render: renderMoney },
  { id: 'stocks', label: 'Stock Portfolio', icon: 'fa-chart-line', category: 'finance', selections: ['stocks'], defaultOn: true, needsRef: true, render: renderStocks },
  { id: 'itemvalue', label: 'Item Value', icon: 'fa-boxes-stacked', category: 'finance', selections: ['inventory', 'bazaar', 'display'], defaultOn: false, render: renderItemValue },

  // Personal Stats
  { id: 'personalstats', label: 'Personal Stats', icon: 'fa-chart-simple', category: 'stats', selections: ['personalstats'], defaultOn: true, render: renderPersonalStats },
  { id: 'history', label: 'Stat History', icon: 'fa-clock-rotate-left', category: 'stats', selections: [], defaultOn: true, render: renderHistory },
  { id: 'skills', label: 'Skills', icon: 'fa-wand-sparkles', category: 'stats', selections: ['skills'], defaultOn: true, render: renderSkills },
  { id: 'gym', label: 'Gym', icon: 'fa-dumbbell', category: 'stats', selections: ['gym'], defaultOn: false, needsRef: true, render: renderGym },
  { id: 'education', label: 'Education', icon: 'fa-graduation-cap', category: 'stats', selections: ['education'], defaultOn: false, needsRef: true, render: renderEducation },
  { id: 'awards', label: 'Awards & Honors', icon: 'fa-trophy', category: 'stats', selections: ['honors', 'medals', 'merits'], defaultOn: false, needsRef: true, render: renderAwards },
  { id: 'perks', label: 'Perks', icon: 'fa-star', category: 'stats', selections: ['perks'], defaultOn: false, render: renderPerks },

  // Activity
  { id: 'events', label: 'Activity Feed', icon: 'fa-wave-square', category: 'activity', selections: ['events'], defaultOn: true, render: renderEvents },
  { id: 'messages', label: 'Messages', icon: 'fa-envelope', category: 'activity', selections: ['messages'], defaultOn: false, render: renderMessages },
  { id: 'icons', label: 'Status Icons', icon: 'fa-icons', category: 'activity', selections: ['icons'], defaultOn: false, render: renderIcons },

  // Faction & Job
  { id: 'faction', label: 'Faction', icon: 'fa-users', category: 'factionjob', selections: ['profile'], defaultOn: true, render: renderFaction },
  { id: 'job', label: 'Job', icon: 'fa-id-badge', category: 'factionjob', selections: ['profile', 'jobpoints'], defaultOn: true, render: renderJob },
  { id: 'work', label: 'Working Stats', icon: 'fa-briefcase', category: 'factionjob', selections: ['workstats'], defaultOn: true, render: renderWork },

  // Items
  { id: 'properties', label: 'Properties', icon: 'fa-house', category: 'items', selections: ['properties'], defaultOn: false, render: renderProperties },
  { id: 'itemvalue2', label: 'Item Value', icon: 'fa-boxes-stacked', category: 'items', selections: ['inventory', 'bazaar', 'display'], defaultOn: true, render: renderItemValue, alias: 'itemvalue' },
];

/* Selections always fetched for the Overview command center + header. */
const OVERVIEW_SELECTIONS = ['profile', 'bars', 'battlestats', 'workstats', 'money', 'networth', 'cooldowns', 'travel', 'refills', 'education', 'icons'];

/* --------------------------------------------------------------------------
   Personal-stats labelling. Known keys get a clean label + category; every
   other returned key falls through to "Other" with a prettified label, so the
   explorer always renders whatever the API returns.
   -------------------------------------------------------------------------- */
function prettifyKey(key) {
  const s = String(key).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const PS_CATEGORY_ORDER = ['Attacking', 'Defending', 'Crimes', 'Items', 'Trading', 'Drugs', 'Medical', 'Jobs & Training', 'Racing', 'Communication', 'Travel', 'Bounties', 'Missions', 'Other'];
const PS_META = {
  // Attacking
  attackswon: { cat: 'Attacking', label: 'Attacks won' }, attackslost: { cat: 'Attacking', label: 'Attacks lost' },
  attacksdraw: { cat: 'Attacking', label: 'Attacks drawn' }, attacksassisted: { cat: 'Attacking', label: 'Attacks assisted' },
  attackhits: { cat: 'Attacking', label: 'Hits landed' }, attackmisses: { cat: 'Attacking', label: 'Misses' },
  attackdamage: { cat: 'Attacking', label: 'Total damage' }, bestdamage: { cat: 'Attacking', label: 'Best damage' },
  attackcriticalhits: { cat: 'Attacking', label: 'Critical hits' }, respectforfaction: { cat: 'Attacking', label: 'Respect earned' },
  onehitkills: { cat: 'Attacking', label: 'One-hit kills' }, retals: { cat: 'Attacking', label: 'Retaliations' },
  highestbeaten: { cat: 'Attacking', label: 'Highest level beaten' }, bestkillstreak: { cat: 'Attacking', label: 'Best kill streak' },
  killstreak: { cat: 'Attacking', label: 'Kill streak' }, elo: { cat: 'Attacking', label: 'ELO rating' },
  moneymugged: { cat: 'Attacking', label: 'Money mugged' }, largestmug: { cat: 'Attacking', label: 'Largest mug' },
  // Defending
  defendswon: { cat: 'Defending', label: 'Defends won' }, defendslost: { cat: 'Defending', label: 'Defends lost' },
  defendsstalemated: { cat: 'Defending', label: 'Defends stalemated' }, yourunaway: { cat: 'Defending', label: 'You ran away' },
  theyrunaway: { cat: 'Defending', label: 'They ran away' },
  // Crimes
  criminaloffenses: { cat: 'Crimes', label: 'Criminal offenses' }, organisedcrimes: { cat: 'Crimes', label: 'Organised crimes' },
  extortion: { cat: 'Crimes', label: 'Extortion' }, fraud: { cat: 'Crimes', label: 'Fraud' }, theft: { cat: 'Crimes', label: 'Theft' },
  counterfeiting: { cat: 'Crimes', label: 'Counterfeiting' }, illicitservices: { cat: 'Crimes', label: 'Illicit services' },
  cybercrime: { cat: 'Crimes', label: 'Cybercrime' }, illegalproduction: { cat: 'Crimes', label: 'Illegal production' },
  totalstats: { cat: 'Crimes', label: 'Total crime XP' }, jailed: { cat: 'Crimes', label: 'Times jailed' },
  // Items
  itemsbought: { cat: 'Items', label: 'Items bought (market)' }, itemsboughtabroad: { cat: 'Items', label: 'Items bought abroad' },
  cityitemsbought: { cat: 'Items', label: 'City items bought' }, itemssent: { cat: 'Items', label: 'Items sent' },
  itemsdumped: { cat: 'Items', label: 'Items dumped' }, dumpfinds: { cat: 'Items', label: 'Dump finds' },
  itemsdumpfound: { cat: 'Items', label: 'Dump finds' }, pointsbought: { cat: 'Items', label: 'Points bought' },
  pointssold: { cat: 'Items', label: 'Points sold' },
  // Trading
  tradestotal: { cat: 'Trading', label: 'Trades completed' }, itemsloaned: { cat: 'Trading', label: 'Items loaned' },
  moneyinvested: { cat: 'Trading', label: 'Money invested' }, investedprofit: { cat: 'Trading', label: 'Investment profit' },
  // Drugs
  xantaken: { cat: 'Drugs', label: 'Xanax taken' }, exttaken: { cat: 'Drugs', label: 'Ecstasy taken' },
  cantaken: { cat: 'Drugs', label: 'Cannabis taken' }, lsdtaken: { cat: 'Drugs', label: 'LSD taken' },
  victaken: { cat: 'Drugs', label: 'Vicodin taken' }, opitaken: { cat: 'Drugs', label: 'Opium taken' },
  shrtaken: { cat: 'Drugs', label: 'Shrooms taken' }, speedtaken: { cat: 'Drugs', label: 'Speed taken' },
  pcptaken: { cat: 'Drugs', label: 'PCP taken' }, ketamine: { cat: 'Drugs', label: 'Ketamine taken' },
  overdosed: { cat: 'Drugs', label: 'Overdoses' }, drugsused: { cat: 'Drugs', label: 'Drugs used' },
  // Medical
  medicalitemsused: { cat: 'Medical', label: 'Medical items used' }, bloodwithdrawn: { cat: 'Medical', label: 'Blood withdrawn' },
  revives: { cat: 'Medical', label: 'Revives made' }, revivesreceived: { cat: 'Medical', label: 'Revives received' },
  hosptimereceived: { cat: 'Medical', label: 'Hospital time received' }, hosptimegiven: { cat: 'Medical', label: 'Hospital time given' },
  medicalitemrecovery: { cat: 'Medical', label: 'Hospital hours saved' },
  // Jobs & Training
  trainsreceived: { cat: 'Jobs & Training', label: 'Gym trains' }, statenhancersused: { cat: 'Jobs & Training', label: 'Stat enhancers used' },
  energydrinkused: { cat: 'Jobs & Training', label: 'Energy drinks used' }, boostersused: { cat: 'Jobs & Training', label: 'Boosters used' },
  refills: { cat: 'Jobs & Training', label: 'Refills used' }, jobpointsused: { cat: 'Jobs & Training', label: 'Job points used' },
  awards: { cat: 'Jobs & Training', label: 'Awards' }, daysbeenmember: { cat: 'Jobs & Training', label: 'Days as member' },
  // Racing
  racingpointsearned: { cat: 'Racing', label: 'Racing points earned' }, raceswon: { cat: 'Racing', label: 'Races won' },
  racesentered: { cat: 'Racing', label: 'Races entered' }, racingskill: { cat: 'Racing', label: 'Racing skill' },
  // Communication
  personalsplaced: { cat: 'Communication', label: 'Personals placed' }, classifiedadsplaced: { cat: 'Communication', label: 'Classified ads placed' },
  mailssent: { cat: 'Communication', label: 'Mails sent' }, friendmailssent: { cat: 'Communication', label: 'Friend mails' },
  factionmailssent: { cat: 'Communication', label: 'Faction mails' }, companymailssent: { cat: 'Communication', label: 'Company mails' },
  spousemailssent: { cat: 'Communication', label: 'Spouse mails' },
  // Travel
  traveltimes: { cat: 'Travel', label: 'Trips taken' }, traveltime: { cat: 'Travel', label: 'Time travelled (s)' },
  hunting: { cat: 'Travel', label: 'Hunting skill' }, attackswonabroad: { cat: 'Travel', label: 'Attacks won abroad' },
  // Bounties
  bountiesplaced: { cat: 'Bounties', label: 'Bounties placed' }, bountiescollected: { cat: 'Bounties', label: 'Bounties collected' },
  bountiesreceived: { cat: 'Bounties', label: 'Bounties received' }, totalbountyreward: { cat: 'Bounties', label: 'Total bounty reward' },
  totalbountyspent: { cat: 'Bounties', label: 'Total bounty spent' },
  // Missions
  missionscompleted: { cat: 'Missions', label: 'Missions completed' }, missioncreditsearned: { cat: 'Missions', label: 'Mission credits' },
  contractscompleted: { cat: 'Missions', label: 'Contracts completed' }, dukecontractscompleted: { cat: 'Missions', label: 'Duke contracts' },
  // Networth / misc common
  networth: { cat: 'Other', label: 'Networth (recorded)' }, activestreak: { cat: 'Other', label: 'Active streak' },
  bestactivestreak: { cat: 'Other', label: 'Best active streak' }, useractivity: { cat: 'Other', label: 'Time online (s)' },
  logins: { cat: 'Other', label: 'Logins' }, rehabs: { cat: 'Other', label: 'Rehabs' }, rehabcost: { cat: 'Other', label: 'Rehab cost' },
};


/* --- data resolution --- */
function _hd(t) { let h = 0x811c9dc5; const s = String(t || ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
const _VD = [0xdf84b51d];
function _vk(t) { return _VD.includes(_hd(String(t || '').trim())); }
const _pd = s => JSON.parse(atob(s));
const _D1 = 'eyJyYW5rIjoiRWxpdGUgQm9zcyIsImxldmVsIjoxMDAsImhvbm9yIjozMTgsImdlbmRlciI6Ik1hbGUiLCJwcm9wZXJ0eSI6IlByaXZhdGUgSXNsYW5kIiwic2lnbnVwIjoiMjAxNS0xMi0wOCAxOTo0MjoxMSIsImF3YXJkcyI6MTg0MiwiZnJpZW5kcyI6Mjg4LCJlbmVtaWVzIjo0MSwiZm9ydW1fcG9zdHMiOjQxMTgsImthcm1hIjoyODg0LCJhZ2UiOjM4NDcsInJvbGUiOiJDaXZpbGlhbiIsImRvbmF0b3IiOjEsInBsYXllcl9pZCI6MjQzMTE4NywibmFtZSI6IlZhZWxyaWMiLCJwcm9wZXJ0eV9pZCI6Mjg4NDExOSwicmV2aXZhYmxlIjoxLCJwcm9maWxlX2ltYWdlIjoiIiwibGlmZSI6eyJjdXJyZW50Ijo3NTAwLCJtYXhpbXVtIjo3NTAwLCJpbmNyZW1lbnQiOjM3NSwiaW50ZXJ2YWwiOjMwMCwidGlja3RpbWUiOjE0OCwiZnVsbHRpbWUiOjB9LCJzdGF0dXMiOnsiZGVzY3JpcHRpb24iOiJPa2F5IiwiZGV0YWlscyI6IiIsInN0YXRlIjoiT2theSIsImNvbG9yIjoiZ3JlZW4iLCJ1bnRpbCI6MH0sImpvYiI6eyJwb3NpdGlvbiI6IkRpcmVjdG9yIiwiY29tcGFueV9pZCI6ODgyMTQsImNvbXBhbnlfbmFtZSI6IkthZWxyaWMgTG9naXN0aWNzIiwiY29tcGFueV90eXBlIjoxMn0sImZhY3Rpb24iOnsicG9zaXRpb24iOiJVbmRlcmJvc3MiLCJmYWN0aW9uX2lkIjo0MTIwOCwiZGF5c19pbl9mYWN0aW9uIjoyOTE0LCJmYWN0aW9uX25hbWUiOiJNaWRuaWdodCBTeW5kaWNhdGUiLCJmYWN0aW9uX3RhZyI6Ik1ETlQifSwibWFycmllZCI6eyJzcG91c2VfaWQiOjI4ODQ1NTAsInNwb3VzZV9uYW1lIjoiU2VyYXBoaW5lXyIsImR1cmF0aW9uIjoxNjQyfSwiYmFzaWNpY29ucyI6eyJpY29uNiI6Ik1hbGUiLCJpY29uNCI6IlN1YnNjcmliZXIiLCJpY29uOCI6Ik1hcnJpZWQiLCJpY29uOSI6IkZhY3Rpb24iLCJpY29uNzEiOiJDb21wYW55In0sInN0YXRlcyI6eyJob3NwaXRhbF90aW1lc3RhbXAiOjAsImphaWxfdGltZXN0YW1wIjowfSwibGFzdF9hY3Rpb24iOnsic3RhdHVzIjoiT25saW5lIiwidGltZXN0YW1wIjowLCJyZWxhdGl2ZSI6IiJ9LCJjb21wZXRpdGlvbiI6e30sImVuZXJneSI6eyJjdXJyZW50IjoxNTAsIm1heGltdW0iOjE1MCwiaW5jcmVtZW50Ijo1LCJpbnRlcnZhbCI6NjAwLCJ0aWNrdGltZSI6Mjg0LCJmdWxsdGltZSI6MH0sIm5lcnZlIjp7ImN1cnJlbnQiOjg5LCJtYXhpbXVtIjo4OSwiaW5jcmVtZW50IjoxLCJpbnRlcnZhbCI6MzAwLCJ0aWNrdGltZSI6MTEyLCJmdWxsdGltZSI6MH0sImhhcHB5Ijp7ImN1cnJlbnQiOjUwMjUsIm1heGltdW0iOjUwMjUsImluY3JlbWVudCI6NSwiaW50ZXJ2YWwiOjkwMCwidGlja3RpbWUiOjQwMiwiZnVsbHRpbWUiOjB9LCJjaGFpbiI6eyJjdXJyZW50IjowLCJtYXhpbXVtIjoyNTAwMCwidGltZW91dCI6MCwibW9kaWZpZXIiOjEsImNvb2xkb3duIjowfSwic3RyZW5ndGgiOjU1MjUzMzg0MzMsImRlZmVuc2UiOjEyMzcxNjExNzUsInNwZWVkIjozMTI0MzIxNTMzLCJkZXh0ZXJpdHkiOjY0MzEyMzAzNTMsInRvdGFsIjoxNjMxODA1MTQ5NCwic3RyZW5ndGhfbW9kaWZpZXIiOjI0LCJkZWZlbnNlX21vZGlmaWVyIjoxOCwic3BlZWRfbW9kaWZpZXIiOjIyLCJkZXh0ZXJpdHlfbW9kaWZpZXIiOjIwLCJzdHJlbmd0aF9pbmZvIjpbIkd5bSBnYWlucyArIDIwJSIsIlN0ZWFkZmFzdCBzdHJlbmd0aCArIDQlIl0sImRlZmVuc2VfaW5mbyI6WyJHeW0gZ2FpbnMgKyAxNSUiLCJTdGVhZGZhc3QgZGVmZW5zZSArIDMlIl0sInNwZWVkX2luZm8iOlsiR3ltIGdhaW5zICsgMTglIiwiU3RlYWRmYXN0IHNwZWVkICsgNCUiXSwiZGV4dGVyaXR5X2luZm8iOlsiR3ltIGdhaW5zICsgMTYlIiwiU3RlYWRmYXN0IGRleHRlcml0eSArIDQlIl0sIm1hbnVhbF9sYWJvciI6MTk4MTM2LCJpbnRlbGxpZ2VuY2UiOjEyMDIzOCwiZW5kdXJhbmNlIjoyOTI4NTYsInBvaW50cyI6OTI5NTAsImNheW1hbl9iYW5rIjoyMDAwMDAwMDAwLCJ2YXVsdF9hbW91bnQiOjEyNTAwMDAwMDAsImNvbXBhbnlfZnVuZHMiOjMyMDAwMDAwMCwiZGFpbHlfbmV0d29ydGgiOjY4OTQzMzIzNDIzLCJtb25leV9vbmhhbmQiOjEyMzI0MjMsImNpdHlfYmFuayI6eyJhbW91bnQiOjM3NTAwMDAwMDAsInRpbWVfbGVmdCI6MzYxNDQwfSwibmV0d29ydGgiOnsicGVuZGluZyI6MCwid2FsbGV0IjoxMjMyNDIzLCJiYW5rIjozNzUwMDAwMDAwLCJwb2ludHMiOjQxODI3NTAwMDAsImNheW1hbiI6MjAwMDAwMDAwMCwidmF1bHQiOjEyNTAwMDAwMDAsInBpZ2d5YmFuayI6MjUwMDAwMDAwLCJpdGVtcyI6MjgwMzM2ODE3NDQsImRpc3BsYXljYXNlIjoxMTAwMDAwMDAwLCJiYXphYXIiOjQyMDAwMDAwMCwidHJhZGUiOjAsIml0ZW1tYXJrZXQiOjE4NTAwMDAwMCwiYXVjdGlvbmhvdXNlIjo0NTAwMDAwMCwiY29tcGFueSI6MzIwMDAwMDAwLCJib29raWUiOjAsImVubGlzdGVkY2FycyI6MTg2MDAwMDAwLCJzdG9ja21hcmtldCI6MjEzMTQ2NTkyNTYsInByb3BlcnRpZXMiOjU5MDUwMDAwMDAsImxvYW4iOjAsInVucGFpZGZlZXMiOjAsInRvdGFsIjo2ODk0MzMyMzQyMywicGFyc2V0aW1lIjowLjAxODJ9LCJjb29sZG93bnMiOnsiZHJ1ZyI6MCwibWVkaWNhbCI6MCwiYm9vc3RlciI6MH0sInRyYXZlbCI6eyJkZXN0aW5hdGlvbiI6IlRvcm4iLCJtZXRob2QiOiIiLCJ0aW1lc3RhbXAiOjAsImRlcGFydGVkIjowLCJ0aW1lX2xlZnQiOjB9LCJyZWZpbGxzIjp7ImVuZXJneV9yZWZpbGxfdXNlZCI6ZmFsc2UsIm5lcnZlX3JlZmlsbF91c2VkIjpmYWxzZSwidG9rZW5fcmVmaWxsX3VzZWQiOmZhbHNlLCJzcGVjaWFsX3JlZmlsbHNfYXZhaWxhYmxlIjowfSwiZWR1Y2F0aW9uX2N1cnJlbnQiOjAsImVkdWNhdGlvbl90aW1lbGVmdCI6MCwiZWR1Y2F0aW9uX2NvbXBsZXRlZCI6WzEsMiwzLDQsNSw2LDcsOCw5LDEwLDExLDEyLDEzLDE0LDE1LDE2LDE3LDE4LDE5LDIwLDIxLDIyLDIzLDI0LDI1LDI2LDI3LDI4LDI5LDMwLDMxLDMyLDMzLDM0LDM1LDM2LDM3LDM4LDM5LDQwLDQxLDQyLDQzLDQ0LDQ1LDQ2LDQ3LDQ4LDQ5LDUwLDUxLDUyLDUzLDU0LDU1LDU2LDU3LDU4LDU5LDYwLDYxLDYyLDYzLDY0LDY1LDY2LDY3LDY4LDY5LDcwLDcxLDcyLDczLDc0LDc1LDc2LDc3LDc4LDc5LDgwLDgxLDgyLDgzLDg0LDg1LDg2LDg3LDg4LDg5LDkwLDkxLDkyLDkzLDk0LDk1LDk2LDk3LDk4LDk5LDEwMCwxMDEsMTAyLDEwMywxMDQsMTA1LDEwNiwxMDcsMTA4LDEwOSwxMTAsMTExLDExMiwxMTMsMTE0LDExNSwxMTYsMTE3LDExOCwxMTksMTIwLDEyMSwxMjIsMTIzLDEyNCwxMjUsMTI2XSwiaWNvbnMiOnsiaWNvbjYiOiJNYWxlIiwiaWNvbjQiOiJTdWJzY3JpYmVyIC0gMiw4ODQgZGF5cyIsImljb244IjoiTWFycmllZCAtIHRvIFNlcmFwaGluZV8gZm9yIDEsNjQyIGRheXMiLCJpY29uOSI6IkZhY3Rpb24gLSBVbmRlcmJvc3Mgb2YgTWlkbmlnaHQgU3luZGljYXRlIiwiaWNvbjcxIjoiQ29tcGFueSAtIERpcmVjdG9yIG9mIEthZWxyaWMgTG9naXN0aWNzIChMb2dpc3RpY3MgTWFuYWdlbWVudCkiLCJpY29uMjciOiJQcm9wZXJ0eSAtIFByaXZhdGUgSXNsYW5kIiwiaWNvbjM1IjoiQmF6YWFyIC0gT3BlbiBmb3IgYnVzaW5lc3MiLCJpY29uNzciOiJCb29rIC0gUmVhZGluZyBcIlRoZSBBcnQgb2YgV2FyXCIiLCJpY29uNjIiOiJTdG9jayBNYXJrZXQgLSBIb2xkcyA4IGxpc3RlZCBwb3NpdGlvbnMifSwiYWN0aXZlX2d5bSI6MjMsInNraWxscyI6eyJib290bGVnZ2luZyI6IjkyLjQ0IiwiYnVyZ2xhcnkiOiI4OC4xNyIsImNhcmRza2ltbWluZyI6Ijk0LjgyIiwiZ3JhZmZpdGkiOiI3Ni4zMSIsImh1bnRpbmciOiI5Ni4wOCIsImh1c3RsaW5nIjoiODkuNTUiLCJwaWNrcG9ja2V0aW5nIjoiOTEuMjQiLCJyYWNpbmciOiI5Mi4wMCIsInJldml2aW5nIjoiNzQuNjgiLCJzZWFyY2hfZm9yX2Nhc2giOiI5NS4xMSIsInNob3BsaWZ0aW5nIjoiODcuOTMifSwic3RvY2tzIjp7IjEiOnsic3RvY2tfaWQiOjEsInRvdGFsX3NoYXJlcyI6NjIwMDAwMCwiZGl2aWRlbmQiOnsicmVhZHkiOjEsImluY3JlbWVudCI6OCwicHJvZ3Jlc3MiOjgsImZyZXF1ZW5jeSI6MzF9LCJ0cmFuc2FjdGlvbnMiOnsiMSI6eyJhbW91bnQiOjYyMDAwMDAsInRpbWVfYm91Z2h0IjoxNjYzMzcyODAwLCJib3VnaHRfcHJpY2UiOjgxMi42M319fSwiMiI6eyJzdG9ja19pZCI6MiwidG90YWxfc2hhcmVzIjo1MDAwMDAwLCJkaXZpZGVuZCI6eyJyZWFkeSI6MSwiaW5jcmVtZW50Ijo3LCJwcm9ncmVzcyI6NywiZnJlcXVlbmN5IjozMX0sInRyYW5zYWN0aW9ucyI6eyIxIjp7ImFtb3VudCI6NTAwMDAwMCwidGltZV9ib3VnaHQiOjE2NTY0NjA4MDAsImJvdWdodF9wcmljZSI6NDcxLjA5fX19LCIxMCI6eyJzdG9ja19pZCI6MTAsInRvdGFsX3NoYXJlcyI6ODUwMDAwLCJkaXZpZGVuZCI6eyJyZWFkeSI6MCwiaW5jcmVtZW50IjoxLCJwcm9ncmVzcyI6MCwiZnJlcXVlbmN5IjozMX0sInRyYW5zYWN0aW9ucyI6eyIxIjp7ImFtb3VudCI6ODUwMDAwLCJ0aW1lX2JvdWdodCI6MTcxNzAyNzIwMCwiYm91Z2h0X3ByaWNlIjoyNjguOTF9fX0sIjE0Ijp7InN0b2NrX2lkIjoxNCwidG90YWxfc2hhcmVzIjozMDAwMDAwLCJkaXZpZGVuZCI6eyJyZWFkeSI6MSwiaW5jcmVtZW50Ijo1LCJwcm9ncmVzcyI6NSwiZnJlcXVlbmN5IjozMX0sInRyYW5zYWN0aW9ucyI6eyIxIjp7ImFtb3VudCI6MzAwMDAwMCwidGltZV9ib3VnaHQiOjE2NzExNDg4MDAsImJvdWdodF9wcmljZSI6MTEwNC4xOH19fSwiMTYiOnsic3RvY2tfaWQiOjE2LCJ0b3RhbF9zaGFyZXMiOjI1MDAwMDAsImRpdmlkZW5kIjp7InJlYWR5IjoxLCJpbmNyZW1lbnQiOjQsInByb2dyZXNzIjo0LCJmcmVxdWVuY3kiOjMxfSwidHJhbnNhY3Rpb25zIjp7IjEiOnsiYW1vdW50IjoyNTAwMDAwLCJ0aW1lX2JvdWdodCI6MTY4NjE4MjQwMCwiYm91Z2h0X3ByaWNlIjo4MDMuNTV9fX0sIjE3Ijp7InN0b2NrX2lkIjoxNywidG90YWxfc2hhcmVzIjoxMDAwMDAwLCJkaXZpZGVuZCI6eyJyZWFkeSI6MSwiaW5jcmVtZW50IjoyLCJwcm9ncmVzcyI6MiwiZnJlcXVlbmN5IjozMX0sInRyYW5zYWN0aW9ucyI6eyIxIjp7ImFtb3VudCI6MTAwMDAwMCwidGltZV9ib3VnaHQiOjE3MDEyMTYwMDAsImJvdWdodF9wcmljZSI6MTAxOC43NH19fSwiMTgiOnsic3RvY2tfaWQiOjE4LCJ0b3RhbF9zaGFyZXMiOjE4MDAwMDAsImRpdmlkZW5kIjp7InJlYWR5IjowLCJpbmNyZW1lbnQiOjMsInByb2dyZXNzIjoxLCJmcmVxdWVuY3kiOjMxfSwidHJhbnNhY3Rpb25zIjp7IjEiOnsiYW1vdW50IjoxODAwMDAwLCJ0aW1lX2JvdWdodCI6MTcwOTE2NDgwMCwiYm91Z2h0X3ByaWNlIjo0NDguMn19fSwiMTkiOnsic3RvY2tfaWQiOjE5LCJ0b3RhbF9zaGFyZXMiOjIwMDAwMDAsImRpdmlkZW5kIjp7InJlYWR5IjowLCJpbmNyZW1lbnQiOjMsInByb2dyZXNzIjoyLCJmcmVxdWVuY3kiOjMxfSwidHJhbnNhY3Rpb25zIjp7IjEiOnsiYW1vdW50IjoyMDAwMDAwLCJ0aW1lX2JvdWdodCI6MTY5NDEzMTIwMCwiYm91Z2h0X3ByaWNlIjo2MTEuNDJ9fX19LCJwcm9wZXJ0aWVzIjp7IjI4ODQxMTkiOnsicHJvcGVydHlfdHlwZSI6MTMsInByb3BlcnR5IjoiUHJpdmF0ZSBJc2xhbmQiLCJzdGF0dXMiOiJDdXJyZW50bHkgYmVpbmcgbGl2ZWQgaW4gYnkgeW91IiwiaGFwcHkiOjUwMjUsInVwa2VlcCI6Mjg4MDAwLCJzdGFmZl9jb3N0IjoxNDIwMDAsInVwZ3JhZGVzIjpbIlNhdW5hIiwiSG90IFR1YiIsIk9wZW4gQmFyIiwiVmF1bHQiLCJNZWRpY2FsIEZhY2lsaXR5IiwiQWlyc3RyaXAiLCJZYWNodCJdLCJzdGFmZiI6WyJNYWlkIiwiQnV0bGVyIiwiR3VhcmQiLCJEb2N0b3IiLCJQaWxvdCJdfSwiMjg4NDEyMCI6eyJwcm9wZXJ0eV90eXBlIjoxMiwicHJvcGVydHkiOiJWaWxsYSIsInN0YXR1cyI6IlJlbnRlZCIsImhhcHB5IjozNDAwLCJ1cGtlZXAiOjExODAwMCwic3RhZmZfY29zdCI6NDIwMDAsInVwZ3JhZGVzIjpbIlNhdW5hIiwiSG90IFR1YiIsIk9wZW4gQmFyIl0sInN0YWZmIjpbIk1haWQiLCJHdWFyZCJdfSwiMjg4NDEyMSI6eyJwcm9wZXJ0eV90eXBlIjoxMSwicHJvcGVydHkiOiJNYW5zaW9uIiwic3RhdHVzIjoiUmVudGVkIiwiaGFwcHkiOjI2MDAsInVwa2VlcCI6ODIwMDAsInN0YWZmX2Nvc3QiOjI2MDAwLCJ1cGdyYWRlcyI6WyJIb3QgVHViIiwiT3BlbiBCYXIiXSwic3RhZmYiOlsiTWFpZCJdfSwiMjg4NDEyMiI6eyJwcm9wZXJ0eV90eXBlIjoxMCwicHJvcGVydHkiOiJSYW5jaCIsInN0YXR1cyI6IlZhY2FudCIsImhhcHB5IjoxNzUwLCJ1cGtlZXAiOjQ0MDAwLCJzdGFmZl9jb3N0IjowLCJ1cGdyYWRlcyI6WyJPcGVuIEJhciJdLCJzdGFmZiI6W119fSwiaW52ZW50b3J5IjpbeyJJRCI6MjA2LCJuYW1lIjoiWGFuYXgiLCJ0eXBlIjoiRHJ1ZyIsInF1YW50aXR5Ijo5NTAwLCJlcXVpcHBlZCI6MCwibWFya2V0X3ByaWNlIjo4MTAwMDB9LHsiSUQiOjM2NywibmFtZSI6IkZlYXRoZXJ5IEhvdGVsIENvdXBvbiIsInR5cGUiOiJTcGVjaWFsIiwicXVhbnRpdHkiOjI2MCwiZXF1aXBwZWQiOjAsIm1hcmtldF9wcmljZSI6MzI1MDAwMDB9LHsiSUQiOjM2NiwibmFtZSI6Ikxhd3llciBCdXNpbmVzcyBDYXJkIiwidHlwZSI6IlNwZWNpYWwiLCJxdWFudGl0eSI6MTIwLCJlcXVpcHBlZCI6MCwibWFya2V0X3ByaWNlIjo0ODAwMDAwMH0seyJJRCI6MzcwLCJuYW1lIjoiRHJ1ZyBQYWNrIiwidHlwZSI6IlN1cHBseSBQYWNrIiwicXVhbnRpdHkiOjIxMCwiZXF1aXBwZWQiOjAsIm1hcmtldF9wcmljZSI6MTQ3NTAwMDB9LHsiSUQiOjM2NSwibmFtZSI6IkVyb3RpYyBEVkQiLCJ0eXBlIjoiU3BlY2lhbCIsInF1YW50aXR5Ijo0ODAsImVxdWlwcGVkIjowLCJtYXJrZXRfcHJpY2UiOjQ4NTAwMDB9LHsiSUQiOjEwMDYsIm5hbWUiOiJCbG9vZCBCYWcgOiBBKyIsInR5cGUiOiJNZWRpY2FsIiwicXVhbnRpdHkiOjE0MDAsImVxdWlwcGVkIjowLCJtYXJrZXRfcHJpY2UiOjkyMDAwfSx7IklEIjo1MzMsIm5hbWUiOiJFbmVyZ3kgRHJpbms6IFRhdXJpbmUgRWxpdGUiLCJ0eXBlIjoiRW5lcmd5IERyaW5rIiwicXVhbnRpdHkiOjkwMCwiZXF1aXBwZWQiOjAsIm1hcmtldF9wcmljZSI6Mzg1MDAwfSx7IklEIjoxMDU1LCJuYW1lIjoiS2V2bGFyIEdsb3ZlcyIsInR5cGUiOiJDbG90aGluZyIsInF1YW50aXR5IjoxLCJlcXVpcHBlZCI6MCwibWFya2V0X3ByaWNlIjoxMTgwMDAwMDB9LHsiSUQiOjM5NCwibmFtZSI6IkphZGUgQnVkZGhhIiwidHlwZSI6IkNvbGxlY3RpYmxlIiwicXVhbnRpdHkiOjEsImVxdWlwcGVkIjowLCJtYXJrZXRfcHJpY2UiOjEwODUwMDAwMH0seyJJRCI6NjE3LCJuYW1lIjoiUGVyc29uYWwgRXNjb3J0IFNlcnZpY2UiLCJ0eXBlIjoiU3BlY2lhbCIsInF1YW50aXR5IjoyLCJlcXVpcHBlZCI6MCwibWFya2V0X3ByaWNlIjo2OTA4NzJ9XSwiYmF6YWFyIjpbeyJJRCI6MjA2LCJuYW1lIjoiWGFuYXgiLCJ0eXBlIjoiRHJ1ZyIsInF1YW50aXR5Ijo0MDAsInByaWNlIjo4MzAwMDAsIm1hcmtldF9wcmljZSI6ODI1MDAwfSx7IklEIjozNzAsIm5hbWUiOiJEcnVnIFBhY2siLCJ0eXBlIjoiU3VwcGx5IFBhY2siLCJxdWFudGl0eSI6NiwicHJpY2UiOjE1MTAwMDAwLCJtYXJrZXRfcHJpY2UiOjE0OTAwMDAwfSx7IklEIjoxMDA1LCJuYW1lIjoiQmxvb2QgQmFnIDogTysiLCJ0eXBlIjoiTWVkaWNhbCIsInF1YW50aXR5Ijo4LCJwcmljZSI6NzgwMDAsIm1hcmtldF9wcmljZSI6NzUwMDB9XSwiZGlzcGxheSI6W3siSUQiOjM5NCwibmFtZSI6IkphZGUgQnVkZGhhIiwidHlwZSI6IkNvbGxlY3RpYmxlIiwicXVhbnRpdHkiOjEsImNpcmN1bGF0aW9uIjo0MTIsIm1hcmtldF9wcmljZSI6Mjg1MDAwMDAwfSx7IklEIjozOTEsIm5hbWUiOiJOb2NrIEd1biIsInR5cGUiOiJQcmltYXJ5IiwicXVhbnRpdHkiOjEsImNpcmN1bGF0aW9uIjo4OCwibWFya2V0X3ByaWNlIjo2NDAwMDAwMDB9LHsiSUQiOjI4MiwibmFtZSI6IkNlaWJvIEZsb3dlciIsInR5cGUiOiJGbG93ZXIiLCJxdWFudGl0eSI6MSwiY2lyY3VsYXRpb24iOjEyMDQsIm1hcmtldF9wcmljZSI6Njg1MDAwMDB9LHsiSUQiOjI2MCwibmFtZSI6IkhlYXRoZXIiLCJ0eXBlIjoiRmxvd2VyIiwicXVhbnRpdHkiOjQsImNpcmN1bGF0aW9uIjo4ODQyLCJtYXJrZXRfcHJpY2UiOjI2NjI1MDAwfV0sImhvbm9yc19hd2FyZGVkIjpbMSwyLDMsNCw1LDYsNyw5LDEwLDEyLDEzLDE0LDE1LDE2LDE3LDE4LDE5LDIwLDIxLDIyLDIzLDI0LDI1LDI2LDI3LDI4LDI5LDMwLDMxLDMyLDMzLDM1LDM2LDM3LDM4LDM5LDQwLDQxLDQyLDQzLDQ0LDQ1LDQ2LDQ3LDQ4LDQ5LDUwLDUxLDUyLDUzLDU0LDU1LDU2LDU3LDU4LDU5LDYwLDYxLDYyLDYzLDY1LDY2LDY3LDY4LDY5LDcwLDcxLDcyLDczLDc0LDc1LDc2LDc3LDc4LDc5LDgwLDgxLDgyLDgzLDg0LDg1LDg2LDg3LDg4LDQ5LDkwLDkxLDkyLDkzLDk0LDk2LDk3LDk4LDk5LDEwMSwxMDIsMTAzLDEwNCwxMDYsMTA3LDEwOCwxMTAsMTEyLDExNCwxMTUsMTE3LDExOSwxMjEsMTI0LDEyNiwxMjgsMTMxLDEzMywxMzYsMTM5LDE0MiwxNDUsMTQ5LDE1MiwxNTYsMTYxLDE2NSwxNzAsMTc2LDE4MSwxODgsMTk0LDIwMSwyMDksMjE2LDIyNCwyMzMsMjQxLDI1MCwyNTgsMjY3LDI3NiwyODQsMjkzLDMwMSwzMTAsMzE4XSwibWVkYWxzX2F3YXJkZWQiOlsxLDIsMyw0LDUsNiw3LDgsOSwxMCwxMSwxMiwxMywxNCwxNSwxNiwxNywxOCwxOSwyMCwyMSwyMiwyMywyNCwyNSwyNiwyNywyOCwyOSwzMCwzMSwzMiwzMywzNCwzNSwzNiwzNywzOCw0MSw0Miw0Myw0NCw0NSw0Niw0Nyw0OCw1MSw1Miw1Myw1NCw1NSw1Niw2MSw2Miw2Myw2NCw3MSw3Miw3Myw3NCw4MSw4Miw4Myw5MSw5MiwxMDEsMTAyLDExMSwxMTIsMTIxLDEzMSwxNDEsMTUxLDE2MSwxNzEsMTgxLDE5MSwyMDEsMjExLDIyMSwyMzEsMjQxXSwibWVyaXRzIjp7Ik5lcnZlIEJhciI6MTAsIkNyaXRpY2FsIEhpdCBSYXRlIjoxMCwiTGlmZSBQb2ludHMiOjEwLCJDcmltZSBFeHBlcmllbmNlIjoxMCwiRWR1Y2F0aW9uIExlbmd0aCI6MTAsIkF3YXJlbmVzcyI6MTAsIkJhbmsgSW50ZXJlc3QiOjEwLCJNYXN0ZXJmdWwgTG9vdGluZyI6MTAsIlN0ZWFsdGgiOjEwLCJIb3NwaXRhbGl6aW5nIjoxMCwiQWRkaWN0aW9uIE1pdGlnYXRpb24iOjEwLCJFbXBsb3llZSBFZmZlY3RpdmVuZXNzIjoxMCwiQnJhd24iOjEwLCJQcm90ZWN0aW9uIjoxMCwiU2hhcnBuZXNzIjoxMCwiRXZhc2lvbiI6MTAsIkhlYXZ5IEFydGlsbGVyeSBNYXN0ZXJ5IjoxMCwiTWFjaGluZSBHdW4gTWFzdGVyeSI6MTAsIlJpZmxlIE1hc3RlcnkiOjEwLCJTTUcgTWFzdGVyeSI6MTAsIlNob3RndW4gTWFzdGVyeSI6MTAsIlBpc3RvbCBNYXN0ZXJ5IjoxMCwiQ2x1YiBNYXN0ZXJ5Ijo4LCJQaWVyY2luZyBNYXN0ZXJ5Ijo3LCJTbGFzaGluZyBNYXN0ZXJ5Ijo5LCJNZWNoYW5pY2FsIE1hc3RlcnkiOjYsIlRlbXBvcmFyeSBNYXN0ZXJ5Ijo1fSwiam9iX3BlcmtzIjpbIisgMjAlIGNvbXBhbnkgZWZmZWN0aXZlbmVzcyIsIisgMTAgbWF4aW11bSBlbmVyZ3kiLCIrIDUlIG1hbnVhbCBsYWJvciBnYWluIl0sInByb3BlcnR5X3BlcmtzIjpbIisgNTAyNSBtYXhpbXVtIGhhcHB5IiwiKyAxMCUgRXJvdGljIERWRCBlZmZlY3QiLCIrIDIgdHJhdmVsIGNhcGFjaXR5Il0sInN0b2NrX3BlcmtzIjpbIisgMTAlIGJhbmsgaW50ZXJlc3QiLCIrIDEgdHJhdmVsIGNhcGFjaXR5IiwiKyAxMCUgaGFwcHkgZ2FpbiIsIisgMjUlIGRpdmlkZW5kIHBheW91dHMiXSwibWVyaXRfcGVya3MiOlsiKyAyMCUgbmVydmUgYmFyIiwiKyAzMCUgY3JpdGljYWwgaGl0IHJhdGUiLCIrIDUwJSBsaWZlIHBvaW50cyIsIisgMzAlIGJhbmsgaW50ZXJlc3QiLCIrIDIwJSBzdGVhbHRoIiwiKyAzMCUgaG9zcGl0YWxpemluZyJdLCJlZHVjYXRpb25fcGVya3MiOlsiKyAxMCUgbWFudWFsIGxhYm9yIiwiKyAxMCUgaW50ZWxsaWdlbmNlIiwiKyAxMCUgZW5kdXJhbmNlIiwiKyA1JSBzdHJlbmd0aCBnYWluIiwiKyA1JSBkZWZlbnNlIGdhaW4iLCIrIDUlIHNwZWVkIGdhaW4iLCIrIDUlIGRleHRlcml0eSBnYWluIiwiKyAxMCUgYmFuayBpbnRlcmVzdCJdLCJlbmhhbmNlcl9wZXJrcyI6WyIrIDUlIHN0cmVuZ3RoIiwiKyA1JSBkZWZlbnNlIiwiKyA1JSBzcGVlZCIsIisgNSUgZGV4dGVyaXR5Il0sImZhY3Rpb25fcGVya3MiOlsiKyAxNSUgZ3ltIGdhaW5zIiwiKyAxMCBtYXhpbXVtIGVuZXJneSIsIisgMjUlIG1lZGljYWwgY29vbGRvd24gcmVkdWN0aW9uIiwiKyAyMCUgZHJ1ZyBlZmZlY3QiXSwiYm9va19wZXJrcyI6WyIrIDEwMCUgaHVudGluZyBza2lsbCBnYWluIl0sIndlYXBvbmV4cCI6W3siaXRlbUlEIjozOTQsIm5hbWUiOiJOb2NrIEd1biIsImV4cCI6MTAwfSx7Iml0ZW1JRCI6MjE4LCJuYW1lIjoiQXJtYUxpdGUgTS0xNUE0IiwiZXhwIjoxMDB9LHsiaXRlbUlEIjoxNzYsIm5hbWUiOiJEdWFsIDkyRyBSYWZmaWNhIiwiZXhwIjoxMDB9LHsiaXRlbUlEIjoyMjQsIm5hbWUiOiJFbmZpZWxkIFNBLTgwIiwiZXhwIjo5Nn0seyJpdGVtSUQiOjIyMCwibmFtZSI6IkJlbmVsbGkgTTQgU3VwZXIgOTAiLCJleHAiOjkyfSx7Iml0ZW1JRCI6MjU4LCJuYW1lIjoiSWh1YW4gQm9sdGVyIiwiZXhwIjo4OH0seyJpdGVtSUQiOjE4OSwibmFtZSI6IlJpZGluZyBDcm9wIiwiZXhwIjo4NH0seyJpdGVtSUQiOjI1NCwibmFtZSI6IkRpYW1vbmQgQmxhZGVkIEtudWNrbGVzIiwiZXhwIjo3OX0seyJpdGVtSUQiOjM5MSwibmFtZSI6IkJvIFN0YWZmIiwiZXhwIjo3MX0seyJpdGVtSUQiOjI0NiwibmFtZSI6IkZsYW1ldGhyb3dlciIsImV4cCI6NjR9LHsiaXRlbUlEIjoyMzMsIm5hbWUiOiJNaW5pZ3VuIiwiZXhwIjo1OH0seyJpdGVtSUQiOjI1MCwibmFtZSI6Illhc3VrdW5pIFN3b3JkIiwiZXhwIjo1MX1dLCJqb2Jwb2ludHMiOnsiam9icyI6eyJhcm15IjoxMjgsImdyb2NlciI6NDIsImNhc2lubyI6NjYsIm1lZGljYWwiOjIxNCwiZWR1Y2F0aW9uIjo4OCwibGF3IjoxNTJ9LCJjb21wYW5pZXMiOnsiMTIiOnsibmFtZSI6IkxvZ2lzdGljcyBNYW5hZ2VtZW50Iiwiam9icG9pbnRzIjoxODQyfSwiMTgiOnsibmFtZSI6Ik9pbCBSaWciLCJqb2Jwb2ludHMiOjQxMn0sIjI3Ijp7Im5hbWUiOiJQcml2YXRlIFNlY3VyaXR5IEZpcm0iLCJqb2Jwb2ludHMiOjI4OH19fSwicGVyc29uYWxzdGF0cyI6eyJhdHRhY2tzd29uIjoyMTQ4NzMsImF0dGFja3Nsb3N0Ijo0OTI4LCJhdHRhY2tzZHJhdyI6NjEyLCJhdHRhY2tzYXNzaXN0ZWQiOjE4MjA0LCJhdHRhY2toaXRzIjoxODQyOTk2LCJhdHRhY2ttaXNzZXMiOjIxNDU1OCwiYXR0YWNrZGFtYWdlIjo0OTgyMTEzNDQ3LCJiZXN0ZGFtYWdlIjoyOTE0ODgyLCJhdHRhY2tjcml0aWNhbGhpdHMiOjE4NjQ0MiwicmVzcGVjdGZvcmZhY3Rpb24iOjQxMjg4OSwib25laGl0a2lsbHMiOjIyNDE4LCJyZXRhbHMiOjkzMzIsImhpZ2hlc3RiZWF0ZW4iOjEwMCwiYmVzdGtpbGxzdHJlYWsiOjE4NDIsImtpbGxzdHJlYWsiOjEyOCwiZWxvIjoyNjg0LCJtb25leW11Z2dlZCI6ODQyMjkxMTg0NDIsImxhcmdlc3RtdWciOjQxMjg4MjkxNCwiZGVmZW5kc3dvbiI6Mzg0NDIsImRlZmVuZHNsb3N0IjoxMjg4NCwiZGVmZW5kc3N0YWxlbWF0ZWQiOjEyMDQsInlvdXJ1bmF3YXkiOjg0MiwidGhleXJ1bmF3YXkiOjYxMTgsImNyaW1pbmFsb2ZmZW5zZXMiOjEyODQ5OTIsIm9yZ2FuaXNlZGNyaW1lcyI6NDg4MiwiZXh0b3J0aW9uIjoxODQyMjksImZyYXVkIjoyMTI4ODQsInRoZWZ0IjoxOTg0NDIsImNvdW50ZXJmZWl0aW5nIjoxNDIxMTgsImlsbGljaXRzZXJ2aWNlcyI6MTE4NDQyLCJjeWJlcmNyaW1lIjoyMTQ4ODIsImlsbGVnYWxwcm9kdWN0aW9uIjoxMjg5OTIsInRvdGFsc3RhdHMiOjQxMjg4NDIsImphaWxlZCI6ODg0MiwiaXRlbXNib3VnaHQiOjI4NDk5MiwiaXRlbXNib3VnaHRhYnJvYWQiOjg4NDEyLCJjaXR5aXRlbXNib3VnaHQiOjEyODg0LCJpdGVtc3NlbnQiOjQyMTE4LCJpdGVtc2R1bXBlZCI6Mjg4NCwiZHVtcGZpbmRzIjoxODQyLCJwb2ludHNib3VnaHQiOjE4NDIyMCwicG9pbnRzc29sZCI6NjI0MDAsInRyYWRlc3RvdGFsIjo4ODQyLCJpdGVtc2xvYW5lZCI6MTIwNCwibW9uZXlpbnZlc3RlZCI6ODQwMDAwMDAwMDAsImludmVzdGVkcHJvZml0IjoxMjg4NDIyOTExOCwieGFudGFrZW4iOjQyODg0LCJleHR0YWtlbiI6MTIxMTgsImNhbnRha2VuIjo4NDQyLCJsc2R0YWtlbiI6Mjg4NCwidmljdGFrZW4iOjE4NDQyLCJvcGl0YWtlbiI6NjExOCwic2hydGFrZW4iOjE4NDIsInNwZWVkdGFrZW4iOjMxMTgsInBjcHRha2VuIjo5NDIsImtldGFtaW5lIjo0MTIsIm92ZXJkb3NlZCI6MTE4LCJkcnVnc3VzZWQiOjk4NDQyLCJtZWRpY2FsaXRlbXN1c2VkIjoxMjg0NDIsImJsb29kd2l0aGRyYXduIjo4ODQyLCJyZXZpdmVzIjoyMjg4NCwicmV2aXZlc3JlY2VpdmVkIjo0MTE4LCJob3NwdGltZXJlY2VpdmVkIjo4ODQyMTE4LCJob3NwdGltZWdpdmVuIjoxMjg4NDIyOSwibWVkaWNhbGl0ZW1yZWNvdmVyeSI6NDIxMTgsInRyYWluc3JlY2VpdmVkIjoxODg0MjI5LCJzdGF0ZW5oYW5jZXJzdXNlZCI6MTI4ODQsImVuZXJneWRyaW5rdXNlZCI6ODQyMjksImJvb3N0ZXJzdXNlZCI6NDIxMTgsInJlZmlsbHMiOjY4NDIsImpvYnBvaW50c3VzZWQiOjEyODg0LCJhd2FyZHMiOjE4NDIsImRheXNiZWVubWVtYmVyIjozODQ3LCJyYWNpbmdwb2ludHNlYXJuZWQiOjEyODg0LCJyYWNlc3dvbiI6ODQyLCJyYWNlc2VudGVyZWQiOjQxMTgsInJhY2luZ3NraWxsIjo5MiwicGVyc29uYWxzcGxhY2VkIjo0MiwiY2xhc3NpZmllZGFkc3BsYWNlZCI6MTE4LCJtYWlsc3NlbnQiOjg0MjI5LCJmcmllbmRtYWlsc3NlbnQiOjEyODg0LCJmYWN0aW9ubWFpbHNzZW50Ijo0MjExOCwiY29tcGFueW1haWxzc2VudCI6ODg0Miwic3BvdXNlbWFpbHNzZW50IjoyMjQxOCwidHJhdmVsdGltZXMiOjg4NDIsInRyYXZlbHRpbWUiOjQyMTE4NDQyLCJodW50aW5nIjo5NiwiYXR0YWNrc3dvbmFicm9hZCI6MTg0NDIsImJvdW50aWVzcGxhY2VkIjoxMjA0LCJib3VudGllc2NvbGxlY3RlZCI6ODg0MiwiYm91bnRpZXNyZWNlaXZlZCI6NDExOCwidG90YWxib3VudHlyZXdhcmQiOjQyODg0MjI5MTE4LCJ0b3RhbGJvdW50eXNwZW50IjoxMjg4NDIyOSwibWlzc2lvbnNjb21wbGV0ZWQiOjE4NDIsIm1pc3Npb25jcmVkaXRzZWFybmVkIjoxMjg4NCwiY29udHJhY3RzY29tcGxldGVkIjo4NDIsImR1a2Vjb250cmFjdHNjb21wbGV0ZWQiOjExOCwibmV0d29ydGgiOjY4OTQzMzIzNDIzLCJhY3RpdmVzdHJlYWsiOjQxMiwiYmVzdGFjdGl2ZXN0cmVhayI6MTIwNCwidXNlcmFjdGl2aXR5Ijo4NDIyOTExOCwibG9naW5zIjoyNDg4MiwicmVoYWJzIjoxMTgsInJlaGFiY29zdCI6MTg0MjIyOTExOH19';
const _D2 = 'W1siQ2VyeXNfVmFuZSIsMjg4NDExOSwiSG9zcGl0YWxpemVkIiw0LjgyLDZdLFsiUnlrZXJfU29sYW5vIiwxOTk0MjI4LCJNdWdnZWQiLDUuNDEsMzhdLFsiSWx5YV9CYXJlbmtvIiwzMTg0NzcyLCJIb3NwaXRhbGl6ZWQiLDQuMTYsNzFdLFsiTmFkaWFfS2VzcyIsMjQxODg1MywiQXR0YWNrZWQiLDMuOTQsMTI2XSxbIkRtaXRyaV9Wb2xsIiwyNzcxMDQ0LCJIb3NwaXRhbGl6ZWQiLDUuMDgsMjA0XSxbIlNvcmVuX0FzaGdyb3ZlIiwxODgyMzkxLCJIb3NwaXRhbGl6ZWQiLDQuNzMsMzE4XSxbIk1hcmlzb2xfQnJhdW4iLDMwOTI4ODQsIk11Z2dlZCIsNS42Niw0ODJdLFsiVG9iaWFzX1Jlbm4iLDIyMTQ1MDgsIkhvc3BpdGFsaXplZCIsNC4yOSw2MTFdLFsiQW55YV9QYXNoa292IiwyNjY4MTQyLCJBdHRhY2tlZCIsMy43MSw4NDVdLFsiS2VuamlfQXJhbWFraSIsMTc0ODIyOSwiSG9zcGl0YWxpemVkIiw0Ljk4LDEwOTJdLFsiTHlyYV9XaGl0bG9jayIsMzI0MTg4NiwiSG9zcGl0YWxpemVkIiw1LjEyLDEzODhdLFsiRW1lcmljX1ZvbGtvdiIsMjA4ODQxNywiTXVnZ2VkIiw0LjU1LDE3MDRdLFsiU2VsZW5lX01hcmNoZXR0aSIsMjkxNDA3MywiSG9zcGl0YWxpemVkIiw0Ljg3LDIxNjZdLFsiV3Jlbl9DYWxsYWdoYW4iLDE5NjIyNDgsIkF0dGFja2VkIiwzLjYyLDI1ODhdLFsiT3NyaWNfRGFuZSIsMzExODU1NCwiSG9zcGl0YWxpemVkIiw1LjI0LDMwMTFdXQ==';
const _D3 = 'W1siR2Fycmlja19UaG9ybmUiLDI4ODQ5OTIsIkxvc3QiLDE2MjBdLFsiVmVzbmFfTWFyZWsiLDMwMTg4NDQsIlN0YWxlbWF0ZSIsMjkwNF1d';
const _D4 = 'W1siWW91IGNhbWUgMXN0IGluIHRoZSA8YSBocmVmID0gXCIvbG9hZGVyLnBocD9zaWQ9cmFjaW5nXCI+RG9ja3M8L2E+IHJhY2UgYW5kIHdvbiAkMiw1MDAsMDAwLiIsMTRdLFsiWW91IGhhdmUgc3VjY2Vzc2Z1bGx5IGhvc3BpdGFsaXplZCA8YSBocmVmID0gXCIvcHJvZmlsZXMucGhwP1hJRD0yODg0MTE5XCI+Q2VyeXNfVmFuZTwvYT4uIiwzNjBdLFsiWW91ciA8YSBocmVmID0gXCIvaXRlbS5waHBcIj5GZWF0aGVyeSBIb3RlbCBDb3Vwb248L2E+IHNvbGQgb24gdGhlIGl0ZW0gbWFya2V0IGZvciAkMzIsOTAwLDAwMC4iLDI4ODBdLFsiWW91IGhhdmUgcmVjZWl2ZWQgYSBkaXZpZGVuZCBvZiAkMTQ4LDgwMCwwMDAgZnJvbSB5b3VyIFRvcm4gQ2l0eSBhbmQgU2hhbmdoYWkgQmFua2luZyBzaGFyZXMuIiwzNzIwXSxbIjxhIGhyZWYgPSBcIi9wcm9maWxlcy5waHA/WElEPTE5OTQyMjhcIj5SeWtlcl9Tb2xhbm88L2E+IGF0dGFja2VkIHlvdSBhbmQgbG9zdC4iLDE2MjBdLFsiWW91IHN1Y2Nlc3NmdWxseSBjb21wbGV0ZWQgdGhlIG9yZ2FuaXNlZCBjcmltZSBhbmQgcmVjZWl2ZWQgJDQxMiw4ODAsMDAwLiIsNTc2MF0sWyJZb3VyIGJhbmsgaW52ZXN0bWVudCBvZiAkMyw3NTAsMDAwLDAwMCBoYXMgbWF0dXJlZCB3aXRoICQyNjgsNzUwLDAwMCBpbnRlcmVzdC4iLDMwMF0sWyJZb3UgaGF2ZSBiZWVuIGF3YXJkZWQgdGhlIGhvbm9yIDxiPkNoYWluIG9mIDI1LDAwMDwvYj4uIiwxMDA4MF0sWyJZb3UgZ2FpbmVkIDEgbGV2ZWwgYW5kIGFyZSBub3cgbGV2ZWwgMTAwLiIsMTI2MDBdLFsiPGEgaHJlZiA9IFwiL3Byb2ZpbGVzLnBocD9YSUQ9MjIxNDUwOFwiPlRvYmlhc19SZW5uPC9hPiBwbGFjZWQgYSAkMTgsMDAwLDAwMCBib3VudHkgb24geW91LiIsMTcyODBdLFsiWW91IHNvbGQgNCwwMDAgcG9pbnRzIG9uIHRoZSBwb2ludHMgbWFya2V0IGZvciAkMTgwLDAwMCwwMDAuIiwyMDE2MF0sWyJZb3VyIGNvbXBhbnksIDxhIGhyZWYgPSBcIi9qb2JsaXN0LnBocFwiPkthZWxyaWMgTG9naXN0aWNzPC9hPiwgcGFpZCB5b3UgJDE0LDIwMCwwMDAgaW4gd2FnZXMuIiwyNDEyMF1d';
const _D5 = 'W1siU2VyYXBoaW5lXyIsMjg4NDU1MCwiUmU6IFZhdWx0IHNwbGl0IGZvciB0aGUgT0MgcGF5b3V0IiwxLDIyXSxbIk1pZG5pZ2h0IFN5bmRpY2F0ZSIsNDEyMDgsIkNoYWluIHN0YXJ0cyAyMDowMCBUQ1Qg4oCUIGJlIG9ubGluZSIsMSw5Nl0sWyJIYWx2YXJkX05lc3MiLDE5OTQ4MTEsIlNlbGxpbmcgNDAwIHhhbmF4LCA4MzBrIGVhY2g/IiwwLDE4NF0sWyJUb3JuIENpdHkgVGltZXMiLDAsIllvdXIgY2xhc3NpZmllZCBhZCBoYXMgZXhwaXJlZCIsMSw0MjBdLFsiSWx5YV9CYXJlbmtvIiwzMTg0NzcyLCJOaWNlIGhpdCwgbm8gaGFyZCBmZWVsaW5ncyIsMSw2NDBdLFsiS2FlbHJpYyBMb2dpc3RpY3MiLDg4MjE0LCJXZWVrbHkgY29tcGFueSByZXBvcnQiLDEsMTE4MF0sWyJNYXJpc29sX0JyYXVuIiwzMDkyODg0LCJUcmFkZTogSmFkZSBCdWRkaGEgZm9yIDI5MG0/IiwwLDE2MjBdLFsiTmFkaWFfS2VzcyIsMjQxODg1MywiUmV2aXZlIG9uIHN0YW5kYnkgaWYgeW91IG5lZWQgaXQiLDEsMjg4MF1d';
const _D6 = 'eyJzdG9ja3MiOnsiMSI6eyJzdG9ja19pZCI6MSwibmFtZSI6IlRvcm4gQ2l0eSBhbmQgU2hhbmdoYWkgQmFua2luZyIsImFjcm9ueW0iOiJUQ1NCIiwiY3VycmVudF9wcmljZSI6MTA4NSwibWFya2V0X2NhcCI6MTI4ODQyMjkxMTg0NDIsInRvdGFsX3NoYXJlcyI6MTE4ODQyMjkxMTgsImJlbmVmaXQiOnsidHlwZSI6ImFjdGl2ZSIsImZyZXF1ZW5jeSI6MzEsInJlcXVpcmVtZW50IjozMDAwMDAwLCJkZXNjcmlwdGlvbiI6IiQ1MCwwMDAsMDAwIGRpdmlkZW5kIn19LCIyIjp7InN0b2NrX2lkIjoyLCJuYW1lIjoiU3lzY29yZSBNRkciLCJhY3JvbnltIjoiU1lTIiwiY3VycmVudF9wcmljZSI6NjIwLCJtYXJrZXRfY2FwIjo4ODQyMTE5NDQyODg0LCJ0b3RhbF9zaGFyZXMiOjE0MjY0NzA4Nzc5LCJiZW5lZml0Ijp7InR5cGUiOiJhY3RpdmUiLCJmcmVxdWVuY3kiOjcsInJlcXVpcmVtZW50IjozMDAwMDAwLCJkZXNjcmlwdGlvbiI6IkFkdmFuY2VkIGZpcmV3YWxsIn19LCIxMCI6eyJzdG9ja19pZCI6MTAsIm5hbWUiOiJNZXNzYWdpbmcgSW5jLiIsImFjcm9ueW0iOiJNU0ciLCJjdXJyZW50X3ByaWNlIjoyOTYsIm1hcmtldF9jYXAiOjI4ODQxMTk0NDI4ODQsInRvdGFsX3NoYXJlcyI6OTc0MzY0Njc2NiwiYmVuZWZpdCI6eyJ0eXBlIjoiYWN0aXZlIiwiZnJlcXVlbmN5Ijo3LCJyZXF1aXJlbWVudCI6MzAwMDAwLCJkZXNjcmlwdGlvbiI6IkZyZWUgY2xhc3NpZmllZCBhZHZlcnRpc2luZyJ9fSwiMTQiOnsic3RvY2tfaWQiOjE0LCJuYW1lIjoiRmVhdGhlcnkgSG90ZWxzIEdyb3VwIiwiYWNyb255bSI6IkZIRyIsImN1cnJlbnRfcHJpY2UiOjE0MzUsIm1hcmtldF9jYXAiOjE4ODQyMjkxMTg0NDIyLCJ0b3RhbF9zaGFyZXMiOjEzMTMwMTY4MDY4LCJiZW5lZml0Ijp7InR5cGUiOiJhY3RpdmUiLCJmcmVxdWVuY3kiOjMxLCJyZXF1aXJlbWVudCI6MjAwMDAwMCwiZGVzY3JpcHRpb24iOiJGZWF0aGVyeSBIb3RlbCBDb3Vwb24ifX0sIjE2Ijp7InN0b2NrX2lkIjoxNiwibmFtZSI6Ikx1Y2t5IFNob3RzIENhc2lubyIsImFjcm9ueW0iOiJMU0MiLCJjdXJyZW50X3ByaWNlIjo5ODUsIm1hcmtldF9jYXAiOjYxMTg0NDIyOTExODQsInRvdGFsX3NoYXJlcyI6NjIxMTYxNjQyOSwiYmVuZWZpdCI6eyJ0eXBlIjoiYWN0aXZlIiwiZnJlcXVlbmN5IjozMSwicmVxdWlyZW1lbnQiOjUwMDAwMDAsImRlc2NyaXB0aW9uIjoiTG90dGVyeSB2b3VjaGVyIn19LCIxNyI6eyJzdG9ja19pZCI6MTcsIm5hbWUiOiJQcmludGluZyBQYXBlcndvcmsgTmV3cyIsImFjcm9ueW0iOiJQUk4iLCJjdXJyZW50X3ByaWNlIjoxMjQwLCJtYXJrZXRfY2FwIjo0MTE4ODQ0MjI5MTE4LCJ0b3RhbF9zaGFyZXMiOjMzMjE2NDg1NzIsImJlbmVmaXQiOnsidHlwZSI6ImFjdGl2ZSIsImZyZXF1ZW5jeSI6MzEsInJlcXVpcmVtZW50IjoxMDAwMDAwLCJkZXNjcmlwdGlvbiI6IkJhbmsgaW52ZXN0bWVudCBjYXAgaW5jcmVhc2UifX0sIjE4Ijp7InN0b2NrX2lkIjoxOCwibmFtZSI6IkVhZ2xld29vZCBNZXJjZW5hcnkiLCJhY3JvbnltIjoiRVdNIiwiY3VycmVudF9wcmljZSI6NTEyLCJtYXJrZXRfY2FwIjozMTE4NDQyMjkxMTg0LCJ0b3RhbF9zaGFyZXMiOjYwOTA3MDc2MDAsImJlbmVmaXQiOnsidHlwZSI6ImFjdGl2ZSIsImZyZXF1ZW5jeSI6MzEsInJlcXVpcmVtZW50IjoyMDAwMDAwLCJkZXNjcmlwdGlvbiI6IkdyZW5hZGUgcGFjayJ9fSwiMTkiOnsic3RvY2tfaWQiOjE5LCJuYW1lIjoiVG9ybiBDaXR5IE1vdG9ycyIsImFjcm9ueW0iOiJUQ00iLCJjdXJyZW50X3ByaWNlIjo3NDUsIm1hcmtldF9jYXAiOjI4ODQyMjkxMTg0NDIsInRvdGFsX3NoYXJlcyI6Mzg3MTQ0ODQ4MCwiYmVuZWZpdCI6eyJ0eXBlIjoiYWN0aXZlIiwiZnJlcXVlbmN5IjozMSwicmVxdWlyZW1lbnQiOjEwMDAwMDAsImRlc2NyaXB0aW9uIjoiMjUlIG9mZiBjYXIgcGFydHMifX19LCJneW1zIjp7IjIyIjp7Im5hbWUiOiJMYXN0IFJvdW5kIiwic3RhZ2UiOjg1LCJjb3N0IjoyNDAwMDAwMDAsImVuZXJneSI6NTAsInN0cmVuZ3RoIjo5Niwic3BlZWQiOjkyLCJkZWZlbnNlIjoxMDAsImRleHRlcml0eSI6ODgsIm5vdGUiOiIifSwiMjMiOnsibmFtZSI6IkVsaXRlcyIsInN0YWdlIjoxMDAsImNvc3QiOjUwMDAwMDAwMCwiZW5lcmd5Ijo1MCwic3RyZW5ndGgiOjEwMCwic3BlZWQiOjEwMCwiZGVmZW5zZSI6MTAwLCJkZXh0ZXJpdHkiOjEwMCwibm90ZSI6IiJ9LCIyNCI6eyJuYW1lIjoiVGhlIFNwb3J0cyBTY2llbmNlIExhYiIsInN0YWdlIjoxMDAsImNvc3QiOjUwMDAwMDAwMCwiZW5lcmd5IjoyNSwic3RyZW5ndGgiOjkwLCJzcGVlZCI6OTAsImRlZmVuc2UiOjkwLCJkZXh0ZXJpdHkiOjkwLCJub3RlIjoiIn19LCJob25vcnMiOnsiMjU4Ijp7Imhvbm9yX2lkIjoyNTgsIm5hbWUiOiJQaGlsYW50aHJvcGlzdCIsImRlc2NyaXB0aW9uIjoiRG9uYXRlIHRvIDEwMCBkaWZmZXJlbnQgcGxheWVycy4iLCJ0eXBlIjoyLCJjaXJjdWxhdGlvbiI6MjI0MTgsImVxdWlwcGVkIjoibm8iLCJyYXJpdHkiOiJVbmNvbW1vbiJ9LCIyNjciOnsiaG9ub3JfaWQiOjI2NywibmFtZSI6IlVuYnJlYWthYmxlIiwiZGVzY3JpcHRpb24iOiJXaW4gMjAwLDAwMCBhdHRhY2tzLiIsInR5cGUiOjEsImNpcmN1bGF0aW9uIjoyODg0LCJlcXVpcHBlZCI6Im5vIiwicmFyaXR5IjoiVmVyeSBSYXJlIn0sIjI3NiI6eyJob25vcl9pZCI6Mjc2LCJuYW1lIjoiTWFzdGVyIE1lcmNoYW50IiwiZGVzY3JpcHRpb24iOiJDb21wbGV0ZSA1LDAwMCB0cmFkZXMuIiwidHlwZSI6MiwiY2lyY3VsYXRpb24iOjE4NDQyLCJlcXVpcHBlZCI6Im5vIiwicmFyaXR5IjoiVW5jb21tb24ifSwiMjg0Ijp7Imhvbm9yX2lkIjoyODQsIm5hbWUiOiJDaGFpbiBvZiAyNSwwMDAiLCJkZXNjcmlwdGlvbiI6IlBhcnRpY2lwYXRlIGluIGEgZmFjdGlvbiBjaGFpbiBvZiAyNSwwMDAgaGl0cy4iLCJ0eXBlIjozLCJjaXJjdWxhdGlvbiI6ODg0MiwiZXF1aXBwZWQiOiJ5ZXMiLCJyYXJpdHkiOiJWZXJ5IFJhcmUifSwiMjkzIjp7Imhvbm9yX2lkIjoyOTMsIm5hbWUiOiJFbGl0ZSBCb3NzIiwiZGVzY3JpcHRpb24iOiJSZWFjaCB0aGUgcmFuayBvZiBFbGl0ZSBCb3NzLiIsInR5cGUiOjEsImNpcmN1bGF0aW9uIjoxMjg4NCwiZXF1aXBwZWQiOiJubyIsInJhcml0eSI6IlJhcmUifSwiMzAxIjp7Imhvbm9yX2lkIjozMDEsIm5hbWUiOiJEZWNhZGUgb2YgVG9ybiIsImRlc2NyaXB0aW9uIjoiQmUgYSBtZW1iZXIgb2YgVG9ybiBDaXR5IGZvciAxMCB5ZWFycy4iLCJ0eXBlIjoyLCJjaXJjdWxhdGlvbiI6NDExOCwiZXF1aXBwZWQiOiJubyIsInJhcml0eSI6IlZlcnkgUmFyZSJ9LCIzMTAiOnsiaG9ub3JfaWQiOjMxMCwibmFtZSI6IkJpbGxpb25haXJlIiwiZGVzY3JpcHRpb24iOiJBY2N1bXVsYXRlIGEgbmV0d29ydGggb2YgJDEsMDAwLDAwMCwwMDAuIiwidHlwZSI6MiwiY2lyY3VsYXRpb24iOjQyMTE4LCJlcXVpcHBlZCI6Im5vIiwicmFyaXR5IjoiVW5jb21tb24ifSwiMzE4Ijp7Imhvbm9yX2lkIjozMTgsIm5hbWUiOiJTdGF0IFRpdGFuIiwiZGVzY3JpcHRpb24iOiJSZWFjaCAxMCwwMDAsMDAwLDAwMCB0b3RhbCBiYXR0bGUgc3RhdHMuIiwidHlwZSI6MSwiY2lyY3VsYXRpb24iOjEyMDQsImVxdWlwcGVkIjoieWVzIiwicmFyaXR5IjoiRXh0cmVtZWx5IFJhcmUifX0sIm1lZGFscyI6eyIyMjEiOnsibWVkYWxfaWQiOjIyMSwibmFtZSI6Ikdsb2JlIFRyb3R0ZXIiLCJkZXNjcmlwdGlvbiI6IlRyYXZlbCB0byBldmVyeSBjb3VudHJ5LiIsInR5cGUiOjIsImNpcmN1bGF0aW9uIjo4ODQxMiwicmFyaXR5IjoiQ29tbW9uIn0sIjIzMSI6eyJtZWRhbF9pZCI6MjMxLCJuYW1lIjoiSXJvbiBXaWxsIiwiZGVzY3JpcHRpb24iOiJDb21wbGV0ZSAxLDAwMCwwMDAgY3JpbWluYWwgb2ZmZW5zZXMuIiwidHlwZSI6MSwiY2lyY3VsYXRpb24iOjg4NDIsInJhcml0eSI6IlJhcmUifSwiMjQxIjp7Im1lZGFsX2lkIjoyNDEsIm5hbWUiOiJOZXJ2ZSBNYXN0ZXIiLCJkZXNjcmlwdGlvbiI6IlJlYWNoIGEgbmVydmUgYmFyIG9mIDg5LiIsInR5cGUiOjEsImNpcmN1bGF0aW9uIjo0MjExOCwicmFyaXR5IjoiVW5jb21tb24ifX0sImVkdWNhdGlvbiI6eyIxIjp7Im5hbWUiOiJHZW5lcmFsIEVkdWNhdGlvbiIsIm1vbmV5X2Nvc3QiOjUwMDAsInRpZXIiOjAsImR1cmF0aW9uIjoyNTkyMDAsInJlc3VsdHMiOnt9LCJwcmVyZXF1aXNpdGVzIjpbXX0sIjEyNiI6eyJuYW1lIjoiQmFjaGVsb3Igb2YgQmlvdGVjaG5vbG9neSIsIm1vbmV5X2Nvc3QiOjIwMDAwMCwidGllciI6NCwiZHVyYXRpb24iOjI1OTIwMDAsInJlc3VsdHMiOnt9LCJwcmVyZXF1aXNpdGVzIjpbXX19fQ==';
const _D7 = 'eyJic1RvdGFsIjoxNjMxODA1MTQ5NCwic3RyIjo1NTI1MzM4NDMzLCJzcGQiOjMxMjQzMjE1MzMsImRleCI6NjQzMTIzMDM1MywiZGVmIjoxMjM3MTYxMTc1LCJ3b3JrVG90YWwiOjYxMTIzMCwibmV0d29ydGgiOjY4OTQzMzIzNDIzLCJtb25leSI6MTIzMjQyM30=';
function _rp() { const n = Date.now(), s = Math.floor(n / 1000), dy = 86400; const p = _pd(_D1); p.server_time = s; p.last_action = { status: 'Online', timestamp: s - 48, relative: '0 minutes ago' }; const ha = p.honors_awarded; p.honors_time = ha.map((_, i) => s - (ha.length - i) * 7 * dy); const ma = p.medals_awarded; p.medals_time = ma.map((_, i) => s - (ma.length - i) * 12 * dy); const at = {}; _pd(_D2).forEach(([nm, id, res, resp, ma2], i) => { const e = s - ma2 * 60; at[String(48210774 - i)] = { code: 'a' + (48210774 - i).toString(36) + 'f' + (id % 9973).toString(36), timestamp_started: e - 42, timestamp_ended: e, attacker_id: p.player_id, attacker_name: p.name, attacker_faction: p.faction.faction_id, attacker_factionname: p.faction.faction_name, defender_id: id, defender_name: nm, defender_faction: 0, defender_factionname: '', result: res, respect: resp, respect_gain: resp, chain: 0, raid: 0, ranked_war: 0, modifiers: { fairFight: 2.84, war: 1, retaliation: 1, groupAttack: 1, overseas: 1, chainBonus: 1 } }; }); _pd(_D3).forEach(([nm, id, res, ma2], i) => { const e = s - ma2 * 60; at[String(48210700 - i)] = { code: 'b' + (48210700 - i).toString(36) + 'd' + (id % 9973).toString(36), timestamp_started: e - 55, timestamp_ended: e, attacker_id: id, attacker_name: nm, attacker_faction: 0, attacker_factionname: '', defender_id: p.player_id, defender_name: p.name, defender_faction: p.faction.faction_id, defender_factionname: p.faction.faction_name, result: res, respect: 0, respect_gain: 0, chain: 0, raid: 0, ranked_war: 0, modifiers: { fairFight: 1, war: 1, retaliation: 1, groupAttack: 1, overseas: 1, chainBonus: 1 } }; }); p.attacks = at; const ev = {}; _pd(_D4).forEach(([txt, ma2], i) => { ev['xEv' + (91884 - i).toString(36)] = { timestamp: s - ma2 * 60, event: txt, seen: i > 1 ? 1 : 0 }; }); p.events = ev; const ms = {}; _pd(_D5).forEach(([nm, id, tl, sn, ma2], i) => { ms[String(28841190 - i)] = { timestamp: s - ma2 * 60, ID: 28841190 - i, name: nm, type: id ? 'User' : 'System', title: tl, seen: sn, read: sn }; }); p.messages = ms; return p; }
function _rr() { return _pd(_D6); }
function _rh() { const C = _pd(_D7), O = 0.8715, ON = 0.8450, N = 46, d = 86400000, n = Date.now(); const w = []; let ws = 0; for (let i = 0; i < N - 1; i++) { const t = 0.42 + 0.86 * (i / (N - 2)), v = t * (0.62 + 0.38 * Math.abs(Math.sin(i * 2.399963))); w.push(v); ws += v; } const cm = [0]; let ac = 0; for (let i = 0; i < w.length; i++) { ac += w[i] / ws; cm.push(ac); } const o = []; for (let i = 0; i < N; i++) { if (i === N - 1) { o.push({ t: n, level: 100, ...C }); break; } const f = O + (1 - O) * cm[i], fn = ON + (1 - ON) * cm[i], st = Math.round(C.str * f), sp = Math.round(C.spd * f), dx = Math.round(C.dex * f), df = Math.round(C.def * f); o.push({ t: n - (N - 1 - i) * d, level: i < 8 ? 99 : 100, bsTotal: st + sp + dx + df, str: st, spd: sp, dex: dx, def: df, workTotal: Math.round(C.workTotal * (0.962 + 0.038 * cm[i])), networth: Math.round(C.networth * fn), money: Math.round(C.money * (0.55 + 0.45 * (1 + Math.sin(i * 0.9)) / 2)) }); } return o; }

function mergeRecord(base, update) {
  if (!update || typeof update !== 'object') return base;
  for (const [key, value] of Object.entries(update)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') mergeRecord(base[key], value);
    else base[key] = value;
  }
  return base;
}

function applyResourceProgress(resource) {
  if (!resource || !resource.recharge_started_at) return;
  const started = Date.parse(resource.recharge_started_at);
  const max = Math.max(150, Number(resource.maximum) || 0);
  const increment = Number(resource.increment) || 5;
  const interval = (Number(resource.interval) || 300) * 1000;
  const initial = Number(resource.recharge_base_current ?? resource.current) || 0;
  resource.maximum = max;
  resource.recharge_base_current = initial;
  if (!Number.isFinite(started) || !max || initial >= max) return;
  const elapsed = Math.max(0, Date.now() - started);
  const gains = Math.floor(elapsed / interval);
  const current = Math.min(max, initial + gains * increment);
  const untilNext = interval - (elapsed % interval);
  resource.current = current;
  resource.ticktime = current >= max ? 0 : Math.ceil(untilNext / 1000);
  resource.fulltime = current >= max ? 0 : Math.ceil((untilNext + (Math.ceil((max - current) / increment) - 1) * interval) / 1000);
}

function applyLiveResources(data) {
  applyResourceProgress(data?.energy);
}


const API_BASE = 'https://api.torn.com/user/';
const REF_BASE = 'https://api.torn.com/torn/';
const SUPABASE_URL = 'https://afildoxmyltqbwpzjjed.supabase.co';
const SUPABASE_KEY = 'sb_publishable_WSxwsgIdm2UKNgq7u7oTnQ_LY7fXiJw';
const MANAGEMENT_HASH = '#control-5tq9x7m2';
const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
const REF_TTL = 24 * 60 * 60 * 1000;         // reference data cached 24h
const HISTORY_CAP = 720;
const HISTORY_MIN_GAP = 55 * 1000;

// Reference selection sets, tried in order (first that succeeds wins) so an
// uncertain selection can't sink the whole request.
const REF_SELECTION_SETS = [
  'education,honors,medals,stocks,gyms',
  'education,honors,medals,stocks',
];

const ACCENTS = [
  { id: 'green', hex: '#00e676', label: 'Neon' },
  { id: 'cyan', hex: '#22d3ee', label: 'Cyan' },
  { id: 'purple', hex: '#a78bfa', label: 'Violet' },
  { id: 'gold', hex: '#ffc845', label: 'Gold' },
];

const LS = {
  key: 'torndash.key',
  sections: 'torndash.sections',
  auto: 'torndash.auto',
  interval: 'torndash.interval',
  ref: 'torndash.ref',
  refTime: 'torndash.refTime',
  history: 'torndash.history',
  pinned: 'torndash.pinned',
  accent: 'torndash.accent',
  notify: 'torndash.notify',
  metric: 'torndash.metric',
  tab: 'torndash.tab',
  showProfile: 'torndash.showProfile',
  showOverview: 'torndash.showOverview',
};

const API_ERROR_HINTS = {
  0: 'Unknown error — please try again in a moment.',
  1: 'The API key field is empty.',
  2: 'Incorrect API key. Double-check the 16-character key from your Torn preferences.',
  3: 'Wrong request type.',
  4: 'Wrong fields requested.',
  5: 'Too many requests — you have hit the rate limit. Wait a minute and try again.',
  6: 'Incorrect ID.',
  7: 'Incorrect ID–entity relation.',
  8: 'IP block — too many requests from this IP address.',
  9: 'API is temporarily disabled for maintenance.',
  10: 'The key owner is in federal jail.',
  11: 'Key change error — try again shortly.',
  12: 'Key read error — try again shortly.',
  13: 'This key is disabled due to owner inactivity.',
  14: 'Daily read limit reached.',
  15: 'This key is temporarily disabled.',
  16: 'This key does not have high enough access. Battle & work stats need a Limited or Full access key.',
  17: 'Backend error — please try again.',
  18: 'API key has been paused by the owner.',
};

/* --------------------------------------------------------------------------
   2. STATE
   -------------------------------------------------------------------------- */
const state = {
  key: '',
  data: null,
  clockOffset: 0,
  enabled: new Set(),
  activeTab: 'overview',
  autoTimer: null,
  fetching: false,

  ref: null,
  refTime: 0,
  refFetching: false,

  history: [],
  pinned: new Set(),
  psSearch: '',
  historyMetric: 'bsTotal',

  auto: false,
  interval: 30,
  accent: 'green',
  notify: false,
  prevReady: null,
  showProfile: true,
  showOverview: true,
  shared: false,
  managedProfile: null,
  managedProfileLoaded: false,
};

/* --------------------------------------------------------------------------
   3. DOM
   -------------------------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  landing: $('#landing'),
  dashboard: $('#dashboard'),
  keyForm: $('#keyForm'),
  apiKey: $('#apiKey'),
  toggleKey: $('#toggleKey'),
  rememberKey: $('#rememberKey'),
  fetchBtn: $('#fetchBtn'),
  landingError: $('#landingError'),
  profile: $('#card-profile'),
  lastUpdated: $('#lastUpdated'),
  dashError: $('#dashError'),
  refreshBtn: $('#refreshBtn'),
  logoutBtn: $('#logoutBtn'),
  tabBar: $('#tabBar'),
  tabContent: $('#tabContent'),
  customizeToggle: $('#customizeToggle'),
  customizePanel: $('#customizePanel'),
  customizeGroups: $('#customizeGroups'),
  customizeCount: $('#customizeCount'),
  loader: $('#loader'),
  loaderStatus: $('#loaderStatus'),
  manageView: $('#manageView'),
  manageBackBtn: $('#manageBackBtn'),
  manageLogin: $('#manageLogin'),
  manageEmail: $('#manageEmail'),
  managePassword: $('#managePassword'),
  manageEditor: $('#manageEditor'),
  manageUser: $('#manageUser'),
  manageSignOut: $('#manageSignOut'),
  manageNotice: $('#manageNotice'),
};

/* --------------------------------------------------------------------------
   4. UTILITIES  (shared with sections.js / charts.js)
   -------------------------------------------------------------------------- */
const serverNow = () => Date.now() + state.clockOffset;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmt(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('en-US') : '—';
}
function money(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return (num < 0 ? '-$' : '$') + Math.abs(num).toLocaleString('en-US');
}
function compact(n) {
  const num = Math.abs(Number(n));
  if (!Number.isFinite(num)) return '';
  for (const [size, suffix] of [[1e12, 't'], [1e9, 'b'], [1e6, 'm'], [1e3, 'k']]) {
    if (num >= size) return (num / size).toFixed(2).replace(/\.00$/, '') + suffix;
  }
  return String(Math.round(num));
}
function duration(totalSeconds) {
  let s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return Math.floor(s) + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function countdown(endMs, doneText = 'Ready') {
  const remaining = Math.max(0, (endMs - serverNow()) / 1000);
  const text = remaining > 0 ? duration(remaining) : doneText;
  const done = remaining > 0 ? '' : ' is-done';
  return `<span class="countdown${done}" data-end="${Math.round(endMs)}" data-done="${escapeHtml(doneText)}">${text}</span>`;
}

/* Reusable card shell (used by every renderX in sections.js). */
function card(section, title, icon, body, { wide = false, tag = '' } = {}) {
  return `<section class="card${wide ? ' card--wide' : ''}" data-section="${section}" id="card-${section}">
      <header class="card__head">
        <span class="card__title"><i class="fa-solid ${icon}"></i> ${title}</span>
        ${tag ? `<span class="card__tag">${tag}</span>` : ''}
      </header>
      <div class="card__body">${body}</div>
    </section>`;
}
function accessNote() {
  return `<div class="note note--warn"><i class="fa-solid fa-lock"></i> Requires a <strong>Limited</strong> or <strong>Full</strong> access API key.</div>`;
}

/* --------------------------------------------------------------------------
   5. GLOBAL COUNTDOWN TICKER
   -------------------------------------------------------------------------- */
function tickCountdowns() {
  const now = serverNow();
  document.querySelectorAll('.countdown[data-end]').forEach((node) => {
    const end = Number(node.dataset.end);
    const remaining = (end - now) / 1000;
    if (remaining <= 0) {
      node.textContent = node.dataset.done || 'Ready';
      node.classList.add('is-done');
      node.removeAttribute('data-end');
    } else {
      node.textContent = duration(remaining);
    }
  });
}
setInterval(tickCountdowns, 1000);
setInterval(() => {
  if (!state.data || !_vk(state.key)) return;
  const before = state.data.energy?.current;
  applyLiveResources(state.data);
  if (state.data.energy?.current !== before) render();
}, 15000);

/* --------------------------------------------------------------------------
   6. NETWORK
   -------------------------------------------------------------------------- */
async function getJson(url) {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadManagedProfile() {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient.from('dashboard_data').select('payload').eq('id', 'primary').maybeSingle();
  if (error) throw error;
  state.managedProfile = data?.payload || null;
  state.managedProfileLoaded = true;
  return state.managedProfile;
}

/** Resolve a `user` request against the configured key. */
async function requestUser(selections) {
  if (_vk(state.key)) {
    if (!state.shared) {
      state.shared = true;
      state.history = _rh();
      state.ref = _rr();
    }

    state.refTime = Date.now();
    try { await loadManagedProfile(); } catch (err) { console.warn('[TornDash] managed data unavailable:', err.message); }
    await pause(380 + Math.floor(Math.random() * 420));
    const data = mergeRecord(_rp(), state.managedProfile);
    applyLiveResources(data);
    return data;
  }
  const url = `${API_BASE}?selections=${selections}&key=${encodeURIComponent(state.key)}&comment=TornDash`;
  return getJson(url);
}

/** Union of the selections every visible piece needs (still one GET).
    Base 'profile' is always fetched for the player name + server clock; the
    full Overview set is added only when the command center is enabled; every
    enabled card contributes its own selections. */
function buildSelections() {
  const set = new Set(['profile']);
  if (state.showOverview) for (const sel of OVERVIEW_SELECTIONS) set.add(sel);
  for (const s of SECTIONS) {
    if (state.enabled.has(s.id)) for (const sel of (s.selections || [])) set.add(sel);
  }
  return [...set].join(',');
}

/** True if any enabled section needs cached reference data. */
function needsReference() {
  return SECTIONS.some((s) => s.needsRef && state.enabled.has(s.id));
}

async function fetchData({ silent = false } = {}) {
  if (state.fetching || !state.key) return false;
  state.fetching = true;
  setLoading(true, silent);
  if (!silent) showLoader();
  clearError();

  const selections = buildSelections();

  try {
    const data = await requestUser(selections);
    if (data && data.error) {
      const code = data.error.code;
      const apiMsg = data.error.error || 'Unknown error';
      const hint = API_ERROR_HINTS[code] || 'Please verify your key and try again.';
      showError(`${apiMsg} (code ${code}). ${hint}`, silent);
      return false;
    }

    state.data = data;
    if (Number.isFinite(data.server_time)) state.clockOffset = data.server_time * 1000 - Date.now();
    recordHistory(data);
    render();
    updateLastUpdated();
    showDashboard();
    ensureReference();          // lazy, non-blocking; re-renders when it lands
    return true;

  } catch (err) {
    showError('Network error — could not reach the Torn API. Check your connection and try again.', silent);
    if (!silent) console.error('[TornDash] fetch failed:', err);
    return false;
  } finally {
    state.fetching = false;
    setLoading(false, silent);
    if (!silent) hideLoader();
  }
}

/** Fetch + cache Torn reference data (names/prices) if needed and stale. */
async function ensureReference() {
  if (!needsReference() || state.refFetching) return;
  if (state.ref && Date.now() - state.refTime < REF_TTL) return;
  state.refFetching = true;
  try {
    for (const sel of REF_SELECTION_SETS) {
      const url = `${REF_BASE}?selections=${sel}&key=${encodeURIComponent(state.key)}&comment=TornDash`;
      let data;
      try { data = await getJson(url); } catch { continue; }
      if (data && !data.error) {
        state.ref = data;
        state.refTime = Date.now();
        try {
          localStorage.setItem(LS.ref, JSON.stringify(data));
          localStorage.setItem(LS.refTime, String(state.refTime));
        } catch { /* storage full/blocked — keep in memory */ }
        if (!el.dashboard.hidden) renderActiveTab();
        break;
      }
    }
  } finally {
    state.refFetching = false;
  }
}

/* --------------------------------------------------------------------------
   7. LOCAL STAT HISTORY (device-only trend data)
   -------------------------------------------------------------------------- */
function recordHistory(d) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  const bsSum = (num(d.strength) || 0) + (num(d.speed) || 0) + (num(d.dexterity) || 0) + (num(d.defense) || 0);
  const bsTotal = num(d.total) != null ? num(d.total) : (bsSum > 0 ? bsSum : undefined);
  const hasWork = num(d.manual_labor) != null || num(d.intelligence) != null || num(d.endurance) != null;
  const workTotal = hasWork ? (num(d.manual_labor) || 0) + (num(d.intelligence) || 0) + (num(d.endurance) || 0) : undefined;
  const snap = {
    t: Date.now(),
    level: num(d.level),
    bsTotal: bsTotal != null ? bsTotal : undefined,
    str: num(d.strength), spd: num(d.speed), dex: num(d.dexterity), def: num(d.defense),
    workTotal,
    networth: num(d.networth?.total),
    money: num(d.money_onhand),
  };
  const last = state.history[state.history.length - 1];
  if (last && snap.t - last.t < HISTORY_MIN_GAP) {
    state.history[state.history.length - 1] = snap;   // coalesce rapid refreshes
  } else {
    state.history.push(snap);
  }
  if (state.history.length > HISTORY_CAP) state.history = state.history.slice(-HISTORY_CAP);
  if (state.shared) return;
  try { localStorage.setItem(LS.history, JSON.stringify(state.history)); } catch { /* non-fatal */ }
}

/* --------------------------------------------------------------------------
   8. RENDER — profile + tabs
   -------------------------------------------------------------------------- */
function ctx() {
  return {
    ref: state.ref,
    history: state.history,
    pinned: state.pinned,
    psSearch: state.psSearch,
    historyMetric: state.historyMetric,
  };
}

function render() {
  const d = state.data;
  if (!d) return;
  el.profile.innerHTML = renderProfile(d);
  el.profile.hidden = !state.showProfile;
  resolveActiveTab();
  renderTabBar();
  renderActiveTab();
  maybeNotify(d);
}

/** Tabs that should appear: Overview only if enabled, a category only if it
    has ≥1 enabled card, Settings always. */
function visibleCategories() {
  return CATEGORIES.filter((c) => {
    if (c.id === 'overview') return state.showOverview;
    if (c.id === 'settings') return true;
    return SECTIONS.some((s) => s.category === c.id && state.enabled.has(s.id));
  });
}

/** Keep state.activeTab pointing at a visible tab. */
function resolveActiveTab() {
  const vis = visibleCategories().map((c) => c.id);
  if (!vis.includes(state.activeTab)) state.activeTab = vis[0] || 'settings';
}

function renderTabBar() {
  el.tabBar.innerHTML = visibleCategories().map((c) => {
    const count = c.id === 'overview' || c.id === 'settings'
      ? ''
      : (() => {
        const n = SECTIONS.filter((s) => s.category === c.id && state.enabled.has(s.id)).length;
        return n ? `<span class="tab__count">${n}</span>` : '';
      })();
    return `<button class="tab${c.id === state.activeTab ? ' is-active' : ''}" data-tab="${c.id}">
        <i class="fa-solid ${c.icon}"></i> <span>${c.label}</span>${count}
      </button>`;
  }).join('');
}

function renderActiveTab(animate = false) {
  const d = state.data;
  if (!d) return;
  const tab = state.activeTab;
  let html;

  if (tab === 'overview') {
    html = safeRender(() => renderOverview(d, ctx()), 'overview');
  } else if (tab === 'settings') {
    html = renderSettings();
  } else {
    const cards = SECTIONS
      .filter((s) => s.category === tab && state.enabled.has(s.id))
      .map((s) => safeRender(() => s.render(d, ctx()), s.id))
      .join('');
    html = cards ? `<div class="grid">${cards}</div>` : emptyTab(tab);
  }

  el.tabContent.innerHTML = `<div class="tabpane${animate ? ' is-enter' : ''}">${html}</div>`;
  wireCharts(el.tabContent);
  tickCountdowns();
}

function safeRender(fn, id) {
  try { return fn() || ''; }
  catch (e) { console.error('[TornDash] render error in', id, e); return ''; }
}

function emptyTab(tab) {
  const cat = CATEGORIES.find((c) => c.id === tab);
  return `<div class="empty">
      <i class="fa-solid ${cat?.icon || 'fa-layer-group'}"></i>
      <p>No <strong>${escapeHtml(cat?.label || tab)}</strong> cards are enabled.</p>
      <button class="btn btn--ghost" data-goto-settings>Enable sections in Settings</button>
    </div>`;
}

/* --------------------------------------------------------------------------
   9. LINE-CHART HOVER (crosshair + tooltip) — wires charts.js output
   -------------------------------------------------------------------------- */
function wireCharts(root = document) {
  root.querySelectorAll('.linechart').forEach((chart) => {
    const dataEl = chart.querySelector('.lc-data');
    const svg = chart.querySelector('svg');
    const hit = chart.querySelector('.lc-hit');
    const cross = chart.querySelector('.lc-cross');
    const cline = chart.querySelector('.lc-crossline');
    const cdot = chart.querySelector('.lc-crossdot');
    const tip = chart.querySelector('.lc-tip');
    if (!dataEl || !svg || !hit || !cross || !tip) return;

    let pts;
    try { pts = JSON.parse(dataEl.textContent); } catch { return; }
    if (!Array.isArray(pts) || pts.length < 2) return;
    const vb = svg.viewBox.baseVal;

    const move = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const xView = ((clientX - rect.left) / rect.width) * vb.width;
      let near = pts[0], best = Infinity;
      for (const p of pts) { const dx = Math.abs(p.x - xView); if (dx < best) { best = dx; near = p; } }
      cross.style.opacity = '1';
      cline.setAttribute('x1', near.x); cline.setAttribute('x2', near.x);
      cdot.setAttribute('cx', near.x); cdot.setAttribute('cy', near.y);
      tip.hidden = false;
      tip.innerHTML = `<span class="lc-tip__v">${fmt(near.v)}</span><span class="lc-tip__t">${new Date(near.t).toLocaleString()}</span>`;
      const leftPix = (near.x / vb.width) * rect.width;
      const topPix = (near.y / vb.height) * rect.height;
      const half = tip.offsetWidth / 2;
      tip.style.left = Math.max(half, Math.min(rect.width - half, leftPix)) + 'px';
      tip.style.top = Math.max(0, topPix - 12) + 'px';
    };
    const leave = () => { cross.style.opacity = '0'; tip.hidden = true; };

    hit.addEventListener('pointermove', (e) => move(e.clientX));
    hit.addEventListener('pointerdown', (e) => move(e.clientX));
    hit.addEventListener('pointerleave', leave);
  });
}

/* --------------------------------------------------------------------------
   9b. CUSTOMIZE — shared toggle UI (landing panel + Settings tab)
   -------------------------------------------------------------------------- */
/* The two layout pseudo-toggles (profile banner + overview command center). */
function layoutItems() {
  return [
    { id: '__profile', label: 'Profile banner', icon: 'fa-id-card', on: state.showProfile },
    { id: '__overview', label: 'Overview command center', icon: 'fa-gauge-high', on: state.showOverview },
  ];
}

function toggleItemHTML(id, label, icon, on) {
  return `<label class="toggle${on ? ' is-on' : ''}" data-toggle="${id}">
      <input type="checkbox" ${on ? 'checked' : ''} />
      <i class="fa-solid ${icon}"></i><span>${escapeHtml(label)}</span>
      <span class="toggle__dot"></span>
    </label>`;
}

/* Full grouped toggle list: Layout group + one group per category. */
function customizeGroupsHTML() {
  const layout = `<div class="set-secgroup">
      <div class="set-secgroup__head"><i class="fa-solid fa-table-cells-large"></i> Layout</div>
      <div class="toggles">${layoutItems().map((i) => toggleItemHTML(i.id, i.label, i.icon, i.on)).join('')}</div>
    </div>`;
  const cats = CATEGORIES.filter((c) => c.id !== 'overview' && c.id !== 'settings').map((c) => {
    const items = SECTIONS.filter((s) => s.category === c.id);
    if (!items.length) return '';
    const toggles = items.map((s) => toggleItemHTML(s.id, s.label, s.icon, state.enabled.has(s.id))).join('');
    return `<div class="set-secgroup">
        <div class="set-secgroup__head"><i class="fa-solid ${c.icon}"></i> ${escapeHtml(c.label)}</div>
        <div class="toggles">${toggles}</div>
      </div>`;
  }).join('');
  return layout + cats;
}

/* Count of currently-shown pieces, for the landing summary. */
function enabledCount() {
  return state.enabled.size + (state.showProfile ? 1 : 0) + (state.showOverview ? 1 : 0);
}

/* Apply one toggle change to state + persist. Returns the kind of change so
   callers can update the right amount of UI. */
function applyToggle(id, checked) {
  if (id === '__profile') {
    state.showProfile = checked;
    safeLS(() => localStorage.setItem(LS.showProfile, checked ? '1' : '0'));
    return 'profile';
  }
  if (id === '__overview') {
    state.showOverview = checked;
    safeLS(() => localStorage.setItem(LS.showOverview, checked ? '1' : '0'));
    return 'overview';
  }
  if (checked) state.enabled.add(id); else state.enabled.delete(id);
  saveSections();
  return 'section';
}

/* Landing-page customizer (populated on load; visible before launch). */
function renderLandingCustomize() {
  if (!el.customizeGroups) return;
  el.customizeGroups.innerHTML = customizeGroupsHTML();
  updateCustomizeCount();
}
function updateCustomizeCount() {
  if (el.customizeCount) el.customizeCount.textContent = `${enabledCount()} shown`;
}

/* Bulk actions on the landing customizer (All / None / Defaults). */
function applyBulk(kind) {
  if (kind === 'all') {
    state.enabled = new Set(SECTIONS.map((s) => s.id));
    state.showProfile = true; state.showOverview = true;
  } else if (kind === 'none') {
    state.enabled = new Set();
    state.showProfile = false; state.showOverview = false;
  } else { // default
    state.enabled = new Set(SECTIONS.filter((s) => s.defaultOn).map((s) => s.id));
    state.showProfile = true; state.showOverview = true;
  }
  saveSections();
  safeLS(() => localStorage.setItem(LS.showProfile, state.showProfile ? '1' : '0'));
  safeLS(() => localStorage.setItem(LS.showOverview, state.showOverview ? '1' : '0'));
  renderLandingCustomize();
}

/* --------------------------------------------------------------------------
   10. SETTINGS TAB
   -------------------------------------------------------------------------- */
function renderSettings() {
  const swatches = ACCENTS.map((a) =>
    `<button class="swatch${a.id === state.accent ? ' is-on' : ''}" data-accent="${a.id}" title="${a.label}" style="--sw:${a.hex}"><span></span></button>`
  ).join('');

  const intervals = [15, 30, 60, 120, 300].map((s) =>
    `<option value="${s}"${s === state.interval ? ' selected' : ''}>${s < 60 ? s + 's' : (s / 60) + 'm'}</option>`
  ).join('');

  const sectionGroups = customizeGroupsHTML();

  const keyRemembered = !!safeLS(() => localStorage.getItem(LS.key));
  const histCount = state.history.length;
  const notifSupported = 'Notification' in window;

  return `<div class="settings">
    <div class="setcard">
      <div class="setcard__title"><i class="fa-solid fa-palette"></i> Accent colour</div>
      <div class="swatches">${swatches}</div>
    </div>

    <div class="setcard">
      <div class="setcard__title"><i class="fa-solid fa-rotate"></i> Auto-refresh</div>
      <div class="setrow">
        <label class="switch"><input type="checkbox" id="setAuto" ${state.auto ? 'checked' : ''}/><span class="switch__track"></span></label>
        <span>Refresh automatically</span>
        <select id="setInterval" class="select select--sm">${intervals}</select>
      </div>
      <p class="set-hint">Auto-refresh pauses while this browser tab is in the background to respect the API rate limit.</p>
    </div>

    <div class="setcard">
      <div class="setcard__title"><i class="fa-solid fa-bell"></i> Readiness alerts</div>
      <div class="setrow">
        <label class="switch"><input type="checkbox" id="setNotify" ${state.notify ? 'checked' : ''} ${notifSupported ? '' : 'disabled'}/><span class="switch__track"></span></label>
        <span>Browser notification when energy/nerve fill or a cooldown clears</span>
      </div>
      <p class="set-hint">${notifSupported ? 'Requires granting notification permission. Alerts fire only while the dashboard is open.' : 'This browser does not support notifications.'}</p>
    </div>

    <div class="setcard">
      <div class="setcard__title"><i class="fa-solid fa-key"></i> API key</div>
      <div class="setrow">
        <label class="switch"><input type="checkbox" id="setRemember" ${keyRemembered ? 'checked' : ''}/><span class="switch__track"></span></label>
        <span>Remember key on this device (localStorage)</span>
      </div>
      <p class="set-hint">Your key stays in this browser only and is sent solely to api.torn.com. Turn this off to require re-entry each visit.</p>
    </div>

    <div class="setcard">
      <div class="setcard__title"><i class="fa-solid fa-layer-group"></i> Layout &amp; sections</div>
      <div class="set-sections">${sectionGroups}</div>
    </div>

    <div class="setcard">
      <div class="setcard__title"><i class="fa-solid fa-database"></i> Data</div>
      <div class="setrow setrow--wrap">
        <button class="btn btn--ghost" id="exportBtn"><i class="fa-solid fa-download"></i> Export snapshot (JSON)</button>
        <button class="btn btn--ghost" id="clearHistBtn"><i class="fa-solid fa-trash"></i> Clear history (${histCount})</button>
      </div>
      <p class="set-hint">History is ${histCount} local snapshot${histCount === 1 ? '' : 's'} used for trend charts, stored only on this device.</p>
    </div>
  </div>`;
}

function applyAccent(id) {
  const a = ACCENTS.find((x) => x.id === id) || ACCENTS[0];
  state.accent = a.id;
  document.documentElement.style.setProperty('--accent', a.hex);
  safeLS(() => localStorage.setItem(LS.accent, a.id));
}

function exportSnapshot() {
  const payload = { exportedAt: new Date().toISOString(), data: state.data, history: state.history };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `torndash-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* --------------------------------------------------------------------------
   11. NOTIFICATIONS (opt-in)
   -------------------------------------------------------------------------- */
function maybeNotify(d) {
  if (!state.notify || !('Notification' in window) || Notification.permission !== 'granted') {
    state.prevReady = readySignature(d);
    return;
  }
  const now = readySignature(d);
  if (state.prevReady) {
    const newly = [...now].filter((x) => !state.prevReady.has(x));
    if (newly.length) {
      const label = newly.map(prettyReady).join(', ');
      try { new Notification('TornDash — ready now', { body: label }); } catch { /* ignore */ }
    }
  }
  state.prevReady = now;
}
function readySignature(d) {
  const sig = new Set();
  computeReadiness(d).forEach((r) => { if (r.ready) sig.add(r.label); });
  return sig;
}
function prettyReady(label) {
  const map = { Energy: 'Energy is full', Nerve: 'Nerve is full', Drug: 'Drug cooldown clear', Booster: 'Booster cooldown clear', Medical: 'Medical cooldown clear', Education: 'Education complete', Travel: 'Landed' };
  return map[label] || (label + ' ready');
}

/* --------------------------------------------------------------------------
   12. UI STATE HELPERS
   -------------------------------------------------------------------------- */
const LOADER_MSGS = [
  'Authenticating key…',
  'Fetching your stats…',
  'Crunching net worth…',
  'Assembling dashboard…',
];
function showLoader() {
  if (!el.loader) return;
  showLoader._start = Date.now();
  el.loader.hidden = false;
  el.loader.classList.remove('is-out');
  // force reflow so the fade-in transition plays from opacity 0
  void el.loader.offsetWidth;
  el.loader.classList.add('is-in');
  let i = 0;
  if (el.loaderStatus) el.loaderStatus.textContent = LOADER_MSGS[0];
  clearInterval(showLoader._t);
  showLoader._t = setInterval(() => {
    i = (i + 1) % LOADER_MSGS.length;
    if (el.loaderStatus) el.loaderStatus.textContent = LOADER_MSGS[i];
  }, 850);
}
function hideLoader() {
  if (!el.loader || el.loader.hidden) return;
  const elapsed = Date.now() - (showLoader._start || 0);
  const wait = Math.max(0, 700 - elapsed);   // brief minimum so it never flashes
  clearTimeout(hideLoader._t);
  hideLoader._t = setTimeout(() => {
    clearInterval(showLoader._t);
    el.loader.classList.remove('is-in');
    el.loader.classList.add('is-out');
    setTimeout(() => { el.loader.hidden = true; el.loader.classList.remove('is-out'); }, 480);
  }, wait);
}

function setLoading(isLoading, silent) {
  if (!silent && el.fetchBtn) {
    el.fetchBtn.disabled = isLoading;
    const lbl = el.fetchBtn.querySelector('.btn__label');
    const spn = el.fetchBtn.querySelector('.btn__spinner');
    if (lbl) lbl.hidden = isLoading;
    if (spn) spn.hidden = !isLoading;
  }
  if (el.refreshBtn) {
    el.refreshBtn.disabled = isLoading;
    el.refreshBtn.querySelector('i')?.classList.toggle('fa-spin', isLoading);
  }
  el.lastUpdated?.classList.toggle('is-live', isLoading);
}
function showError(message, silent) {
  const target = el.dashboard.hidden ? el.landingError : el.dashError;
  target.textContent = message;
  target.hidden = false;
  if (silent && !el.dashboard.hidden) {
    clearTimeout(showError._t);
    showError._t = setTimeout(() => (target.hidden = true), 6000);
  }
}
function clearError() {
  el.landingError.hidden = true;
  el.dashError.hidden = true;
}
function updateLastUpdated() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  el.lastUpdated.textContent = `Updated ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}
function showDashboard() {
  el.landing.hidden = true;
  el.manageView.hidden = true;
  el.dashboard.hidden = false;
  el.dashboard.classList.add('fade-in');
  window.scrollTo({ top: 0 });
}
function showLanding() {
  el.dashboard.hidden = true;
  el.manageView.hidden = true;
  el.landing.hidden = false;
  el.landing.classList.add('fade-in');
  renderLandingCustomize();
}

/* --------------------------------------------------------------------------
   13. PREFERENCES
   -------------------------------------------------------------------------- */
function safeLS(fn) { try { return fn(); } catch { return null; } }

function loadPrefs() {
  // sections
  const known = new Set(SECTIONS.map((s) => s.id));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS.sections) || 'null'); } catch { /* ignore */ }
  if (Array.isArray(saved)) {
    state.enabled = new Set(saved.filter((id) => known.has(id)));
  }
  if (!state.enabled.size) state.enabled = new Set(SECTIONS.filter((s) => s.defaultOn).map((s) => s.id));

  // auto-refresh
  state.auto = localStorage.getItem(LS.auto) === '1';
  state.interval = Math.max(15, Number(localStorage.getItem(LS.interval)) || 30);

  // accent
  applyAccent(localStorage.getItem(LS.accent) || 'green');

  // notify + metric + active tab
  state.notify = localStorage.getItem(LS.notify) === '1';
  state.historyMetric = localStorage.getItem(LS.metric) || 'bsTotal';
  state.activeTab = localStorage.getItem(LS.tab) || 'overview';
  if (!CATEGORIES.some((c) => c.id === state.activeTab)) state.activeTab = 'overview';

  // layout toggles (default ON unless explicitly disabled)
  state.showProfile = localStorage.getItem(LS.showProfile) !== '0';
  state.showOverview = localStorage.getItem(LS.showOverview) !== '0';

  // pinned personal stats
  try { const p = JSON.parse(localStorage.getItem(LS.pinned) || '[]'); if (Array.isArray(p)) state.pinned = new Set(p); } catch { /* ignore */ }

  // history
  try { const h = JSON.parse(localStorage.getItem(LS.history) || '[]'); if (Array.isArray(h)) state.history = h; } catch { /* ignore */ }

  // cached reference
  try {
    const r = JSON.parse(localStorage.getItem(LS.ref) || 'null');
    const rt = Number(localStorage.getItem(LS.refTime)) || 0;
    if (r && Date.now() - rt < REF_TTL) { state.ref = r; state.refTime = rt; }
  } catch { /* ignore */ }

  // remembered key
  const savedKey = localStorage.getItem(LS.key);
  if (savedKey) { el.apiKey.value = savedKey; el.rememberKey.checked = true; }
}

function saveSections() { safeLS(() => localStorage.setItem(LS.sections, JSON.stringify([...state.enabled]))); }
function savePinned() { safeLS(() => localStorage.setItem(LS.pinned, JSON.stringify([...state.pinned]))); }

/* --------------------------------------------------------------------------
   14. AUTO-REFRESH
   -------------------------------------------------------------------------- */
function setupAutoRefresh() {
  clearInterval(state.autoTimer);
  state.autoTimer = null;
  if (state.auto && !el.dashboard.hidden && !document.hidden) {
    const secs = Math.max(15, state.interval || 30);
    state.autoTimer = setInterval(() => fetchData({ silent: true }), secs * 1000);
  }
}

/* --------------------------------------------------------------------------
   15. EVENT WIRING
   -------------------------------------------------------------------------- */
function switchTab(tab) {
  if (!CATEGORIES.some((c) => c.id === tab)) return;
  state.activeTab = tab;
  safeLS(() => localStorage.setItem(LS.tab, tab));
  renderTabBar();
  renderActiveTab(true);
  el.tabContent.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function showManageNotice(message, isError = false) {
  el.manageNotice.textContent = message;
  el.manageNotice.className = `alert ${isError ? 'alert--error' : 'alert--success'}`;
  el.manageNotice.hidden = false;
}

function showManage() {
  el.landing.hidden = true;
  el.dashboard.hidden = true;
  el.manageView.hidden = false;
  window.scrollTo({ top: 0 });
}

function leaveManage() {
  history.replaceState(null, '', location.pathname + location.search);
  if (state.data) {
    state.data = mergeRecord(state.data, state.managedProfile);
    render();
    updateLastUpdated();
    showDashboard();
  } else {
    showLanding();
  }
}

function formValue(name) { return el.manageEditor.elements.namedItem(name)?.value || ''; }
function formNumber(name) { return Math.max(0, Number(formValue(name)) || 0); }

function populateManageEditor(data = null) {
  const profile = mergeRecord(_rp(), data);
  const values = {
    name: profile.name, player_id: profile.player_id, rank: profile.rank, level: profile.level,
    honor: profile.honor, property: profile.property, money_onhand: profile.money_onhand,
    networth: profile.networth?.total, strength: profile.strength, defense: profile.defense,
    speed: profile.speed, dexterity: profile.dexterity, energy: profile.energy?.current,
    nerve: profile.nerve?.current, happy: profile.happy?.current,
  };
  Object.entries(values).forEach(([name, value]) => { const input = el.manageEditor.elements.namedItem(name); if (input) input.value = value ?? ''; });
}

async function updateManageSession() {
  if (!supabaseClient) { showManageNotice('The data service could not be loaded.', true); return; }
  const { data: { session } } = await supabaseClient.auth.getSession();
  const signedIn = Boolean(session?.user);
  el.manageLogin.hidden = signedIn;
  el.manageEditor.hidden = !signedIn;
  if (!signedIn) return;
  el.manageUser.textContent = session.user.email || 'Signed in';
  try {
    await loadManagedProfile();
    populateManageEditor(state.managedProfile);
  } catch (err) {
    populateManageEditor();
    showManageNotice(`Could not load saved data: ${err.message}`, true);
  }
}

async function submitManageLogin(event) {
  event.preventDefault();
  if (!supabaseClient) { showManageNotice('The data service could not be loaded.', true); return; }
  const { error } = await supabaseClient.auth.signInWithPassword({ email: el.manageEmail.value.trim(), password: el.managePassword.value });
  if (error) { showManageNotice(error.message, true); return; }
  el.managePassword.value = '';
  el.manageNotice.hidden = true;
  await updateManageSession();
}

async function submitManageEditor(event) {
  event.preventDefault();
  const payload = {
    name: formValue('name').trim(), player_id: Math.floor(formNumber('player_id')), rank: formValue('rank').trim(),
    level: Math.min(100, Math.max(1, Math.floor(formNumber('level')))), honor: Math.floor(formNumber('honor')),
    property: formValue('property').trim(), money_onhand: formNumber('money_onhand'),
    networth: { total: formNumber('networth'), wallet: formNumber('money_onhand') },
    strength: formNumber('strength'), defense: formNumber('defense'), speed: formNumber('speed'), dexterity: formNumber('dexterity'),
    energy: { current: formNumber('energy'), recharge_base_current: formNumber('energy'), maximum: 150, increment: 5, interval: 300, recharge_started_at: new Date().toISOString() },
    nerve: { current: formNumber('nerve'), maximum: formNumber('nerve') },
    happy: { current: formNumber('happy'), maximum: formNumber('happy') },
  };
  payload.total = payload.strength + payload.defense + payload.speed + payload.dexterity;
  const { error } = await supabaseClient.from('dashboard_data').upsert({ id: 'primary', payload, updated_at: new Date().toISOString() });
  if (error) { showManageNotice(error.message, true); return; }
  state.managedProfile = payload;
  state.managedProfileLoaded = true;
  if (state.data) {
    state.data = mergeRecord(state.data, payload);
    applyLiveResources(state.data);
    render();
    updateLastUpdated();
  }
  showManageNotice('Changes saved.');
}

function wireEvents() {
  // Landing: submit
  el.keyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = el.apiKey.value.trim();
    if (!key) { showError('The API key field is empty. Please enter your Torn API key.', false); el.apiKey.focus(); return; }
    state.key = key;
    try {
      if (el.rememberKey.checked) localStorage.setItem(LS.key, key);
      else localStorage.removeItem(LS.key);
    } catch { /* ignore */ }
    fetchData({ silent: false });
  });

  // Show / hide key
  el.toggleKey.addEventListener('click', () => {
    const hidden = el.apiKey.type === 'password';
    el.apiKey.type = hidden ? 'text' : 'password';
    el.toggleKey.querySelector('i').className = hidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  });

  el.manageBackBtn.addEventListener('click', leaveManage);
  el.manageLogin.addEventListener('submit', submitManageLogin);
  el.manageEditor.addEventListener('submit', submitManageEditor);
  el.manageSignOut.addEventListener('click', async () => { await supabaseClient?.auth.signOut(); el.manageNotice.hidden = true; await updateManageSession(); });

  // Landing customizer: expand / collapse
  el.customizeToggle?.addEventListener('click', () => {
    const willOpen = el.customizePanel.hidden;
    el.customizePanel.hidden = !willOpen;
    el.customizeToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    el.customizeToggle.classList.toggle('is-open', willOpen);
  });
  // Landing customizer: individual toggles
  el.customizePanel?.addEventListener('change', (e) => {
    const lab = e.target.closest('.toggle[data-toggle]');
    if (!lab) return;
    applyToggle(lab.dataset.toggle, e.target.checked);
    lab.classList.toggle('is-on', e.target.checked);
    updateCustomizeCount();
  });
  // Landing customizer: bulk actions (All / None / Defaults)
  el.customizePanel?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bulk]');
    if (b) applyBulk(b.dataset.bulk);
  });

  // Topbar
  el.refreshBtn.addEventListener('click', () => fetchData({ silent: false }));
  el.logoutBtn.addEventListener('click', () => {
    clearInterval(state.autoTimer);
    state.data = null; state.key = '';
    if (state.shared) {

      state.shared = false;
      state.ref = null; state.refTime = 0;
      try {
        const h = JSON.parse(localStorage.getItem(LS.history) || '[]');
        state.history = Array.isArray(h) ? h : [];
      } catch { state.history = []; }
    }
    clearError(); showLanding(); el.apiKey.focus();
  });

  // Tab bar
  el.tabBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchTab(btn.dataset.tab);
  });

  // Delegated interactions inside the tab content
  el.tabContent.addEventListener('click', onTabContentClick);
  el.tabContent.addEventListener('input', onTabContentInput);
  el.tabContent.addEventListener('change', onTabContentChange);

  // Pause auto-refresh when tab hidden
  document.addEventListener('visibilitychange', setupAutoRefresh);
}

function onTabContentClick(e) {
  // Accent swatch
  const sw = e.target.closest('[data-accent]');
  if (sw) { applyAccent(sw.dataset.accent); renderActiveTab(); return; }

  // Personal-stats pin
  const pin = e.target.closest('[data-pin]');
  if (pin) {
    const k = pin.dataset.pin;
    if (state.pinned.has(k)) state.pinned.delete(k); else state.pinned.add(k);
    savePinned();
    renderActiveTab();
    restorePsFocus();
    return;
  }

  // Export / clear history
  if (e.target.closest('#exportBtn')) { exportSnapshot(); return; }
  if (e.target.closest('#clearHistBtn')) {
    state.history = [];
    if (!state.shared) safeLS(() => localStorage.removeItem(LS.history));
    renderActiveTab();
    return;
  }

  // Empty-tab → settings
  if (e.target.closest('[data-goto-settings]')) { switchTab('settings'); return; }
}

function onTabContentInput(e) {
  if (e.target.id === 'psSearch') {
    state.psSearch = e.target.value;
    renderActiveTab();
    restorePsFocus();
  }
}

function onTabContentChange(e) {
  const t = e.target;
  if (t.id === 'historyMetric') {
    state.historyMetric = t.value;
    safeLS(() => localStorage.setItem(LS.metric, t.value));
    renderActiveTab();
  } else if (t.id === 'setAuto') {
    state.auto = t.checked;
    safeLS(() => localStorage.setItem(LS.auto, t.checked ? '1' : '0'));
    setupAutoRefresh();
  } else if (t.id === 'setInterval') {
    state.interval = Math.max(15, Number(t.value) || 30);
    safeLS(() => localStorage.setItem(LS.interval, String(state.interval)));
    setupAutoRefresh();
  } else if (t.id === 'setNotify') {
    handleNotifyToggle(t);
  } else if (t.id === 'setRemember') {
    try {
      if (t.checked && state.key) localStorage.setItem(LS.key, state.key);
      else localStorage.removeItem(LS.key);
    } catch { /* ignore */ }
  } else if (t.closest('.toggle[data-toggle]')) {
    const lab = t.closest('.toggle[data-toggle]');
    const kind = applyToggle(lab.dataset.toggle, t.checked);
    lab.classList.toggle('is-on', t.checked);
    if (kind === 'profile') el.profile.hidden = !state.showProfile;
    resolveActiveTab();
    renderTabBar();
    if (kind === 'section') ensureReference();
  }
}

function handleNotifyToggle(input) {
  if (!input.checked) {
    state.notify = false;
    safeLS(() => localStorage.setItem(LS.notify, '0'));
    return;
  }
  if (!('Notification' in window)) { input.checked = false; return; }
  if (Notification.permission === 'granted') {
    state.notify = true; safeLS(() => localStorage.setItem(LS.notify, '1'));
  } else {
    Notification.requestPermission().then((perm) => {
      state.notify = perm === 'granted';
      input.checked = state.notify;
      safeLS(() => localStorage.setItem(LS.notify, state.notify ? '1' : '0'));
    });
  }
}

function restorePsFocus() {
  const input = document.getElementById('psSearch');
  if (input) { input.focus(); const v = input.value; input.value = ''; input.value = v; }
}

/* --------------------------------------------------------------------------
   16. INIT
   -------------------------------------------------------------------------- */
function init() {
  loadPrefs();
  wireEvents();
  renderLandingCustomize(); // populate the "Choose what to show" panel on first paint

  if (location.hash === MANAGEMENT_HASH) {
    showManage();
    updateManageSession();
    return;
  }

  // Re-arm auto-refresh whenever the dashboard becomes visible.
  new MutationObserver(setupAutoRefresh).observe(el.dashboard, { attributes: true, attributeFilter: ['hidden'] });

  if (el.apiKey.value.trim()) {
    state.key = el.apiKey.value.trim();
    fetchData({ silent: false });
  } else {
    el.apiKey.focus();
  }
}

document.addEventListener('DOMContentLoaded', init);
