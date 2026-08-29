/* ==========================================================================
   TornDash — sections.js
   The data-driven section registry + every card renderer, plus the Overview
   command-center composition. Each SECTIONS entry declares the API selections
   it needs so app.js can request only what's enabled in a single GET.

   Globals used (defined in app.js):  card, accessNote, countdown, serverNow,
     escapeHtml, fmt, money, compact, duration, pct, timeAgo
   Globals used (defined in charts.js): sparkline, donutChart, rankedBars,
     lineChart, CAT_COLORS, OTHER_COLOR
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   TABS
   -------------------------------------------------------------------------- */
const CATEGORIES = [
  { id: 'overview',   label: 'Overview',       icon: 'fa-gauge-high' },
  { id: 'combat',     label: 'Combat',         icon: 'fa-hand-fist' },
  { id: 'finance',    label: 'Finance',        icon: 'fa-sack-dollar' },
  { id: 'stats',      label: 'Personal Stats', icon: 'fa-chart-simple' },
  { id: 'activity',   label: 'Activity',       icon: 'fa-wave-square' },
  { id: 'factionjob', label: 'Faction & Job',  icon: 'fa-users' },
  { id: 'items',      label: 'Items',          icon: 'fa-box-open' },
  { id: 'settings',   label: 'Settings',       icon: 'fa-gear' },
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
  if (d.nerve)  push(d.nerve.current >= d.nerve.maximum, 'Nerve', 'fa-fire', 'Commit a crime');
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

/* KPI tile with optional history sparkline + delta. */
function kpiTile(label, value, opts = {}) {
  const series = (opts.series || []).filter(Number.isFinite);
  const spark = series.length > 1 ? sparkline(series, { color: opts.color || 'var(--accent)', w: 128, h: 30 }) : '';
  let delta = '';
  if (series.length > 1) {
    const diff = series[series.length - 1] - series[0];
    if (diff !== 0) {
      const up = diff > 0;
      delta = `<span class="kpi__delta ${up ? 'up' : 'down'}"><i class="fa-solid fa-arrow-${up ? 'up' : 'down'}"></i> ${opts.fmtDelta ? opts.fmtDelta(diff) : fmt(Math.abs(diff))}</span>`;
    }
  }
  return `<div class="kpi">
      <div class="kpi__label">${escapeHtml(label)}</div>
      <div class="kpi__value ${opts.cls || ''}">${value}</div>
      <div class="kpi__foot">${delta}<span class="kpi__spark">${spark}</span></div>
    </div>`;
}

function renderOverview(d, ctx) {
  const h = ctx.history || [];
  const ser = (key) => h.map((s) => s[key]).filter(Number.isFinite);

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
      ${kpiTile('Level', fmt(d.level), { series: ser('level'), color: 'var(--gold)' })}
      ${kpiTile('Networth', '$' + compact(d.networth?.total ?? 0), { cls: 'cyan', color: 'var(--accent-2)', series: ser('networth'), fmtDelta: (x) => (x > 0 ? '+' : '-') + '$' + compact(Math.abs(x)) })}
      ${kpiTile('Money', '$' + compact(d.money_onhand ?? 0), { series: ser('money'), fmtDelta: (x) => (x > 0 ? '+' : '-') + '$' + compact(Math.abs(x)) })}
      ${kpiTile('Battle stats', compact(bsTotal), { color: 'var(--accent)', series: ser('bsTotal'), fmtDelta: (x) => (x > 0 ? '+' : '-') + compact(Math.abs(x)) })}
      ${kpiTile('Work stats', compact(workTotal), { cls: 'violet', color: 'var(--accent-3)', series: ser('workTotal') })}
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
  { id: 'battle',        label: 'Battle Stats',   icon: 'fa-hand-fist',   category: 'combat',     selections: ['battlestats'], defaultOn: true,  render: renderBattle },
  { id: 'attacks',       label: 'Recent Attacks', icon: 'fa-swords',      category: 'combat',     selections: ['attacks'],     defaultOn: true,  render: renderAttacks },
  { id: 'weaponexp',     label: 'Weapon EXP',     icon: 'fa-gun',         category: 'combat',     selections: ['weaponexp'],   defaultOn: false, render: renderWeaponExp },

  // Finance
  { id: 'networth',      label: 'Networth',       icon: 'fa-sack-dollar', category: 'finance',    selections: ['networth'],    defaultOn: true,  render: renderNetworth },
  { id: 'money',         label: 'Money',          icon: 'fa-wallet',      category: 'finance',    selections: ['money'],       defaultOn: true,  render: renderMoney },
  { id: 'stocks',        label: 'Stock Portfolio',icon: 'fa-chart-line',  category: 'finance',    selections: ['stocks'],      defaultOn: true,  needsRef: true, render: renderStocks },
  { id: 'itemvalue',     label: 'Item Value',     icon: 'fa-boxes-stacked',category: 'finance',   selections: ['inventory', 'bazaar', 'display'], defaultOn: false, render: renderItemValue },

  // Personal Stats
  { id: 'personalstats', label: 'Personal Stats', icon: 'fa-chart-simple',category: 'stats',      selections: ['personalstats'], defaultOn: true, render: renderPersonalStats },
  { id: 'history',       label: 'Stat History',   icon: 'fa-clock-rotate-left', category: 'stats', selections: [],             defaultOn: true,  render: renderHistory },
  { id: 'skills',        label: 'Skills',         icon: 'fa-wand-sparkles',category: 'stats',     selections: ['skills'],      defaultOn: true,  render: renderSkills },
  { id: 'gym',           label: 'Gym',            icon: 'fa-dumbbell',    category: 'stats',      selections: ['gym'],         defaultOn: false, needsRef: true, render: renderGym },
  { id: 'education',     label: 'Education',      icon: 'fa-graduation-cap', category: 'stats',   selections: ['education'],   defaultOn: false, needsRef: true, render: renderEducation },
  { id: 'awards',        label: 'Awards & Honors',icon: 'fa-trophy',      category: 'stats',      selections: ['honors', 'medals', 'merits'], defaultOn: false, needsRef: true, render: renderAwards },
  { id: 'perks',         label: 'Perks',          icon: 'fa-star',        category: 'stats',      selections: ['perks'],       defaultOn: false, render: renderPerks },

  // Activity
  { id: 'events',        label: 'Activity Feed',  icon: 'fa-wave-square', category: 'activity',   selections: ['events'],      defaultOn: true,  render: renderEvents },
  { id: 'messages',      label: 'Messages',       icon: 'fa-envelope',    category: 'activity',   selections: ['messages'],    defaultOn: false, render: renderMessages },
  { id: 'icons',         label: 'Status Icons',   icon: 'fa-icons',       category: 'activity',   selections: ['icons'],       defaultOn: false, render: renderIcons },

  // Faction & Job
  { id: 'faction',       label: 'Faction',        icon: 'fa-users',       category: 'factionjob', selections: ['profile'],     defaultOn: true,  render: renderFaction },
  { id: 'job',           label: 'Job',            icon: 'fa-id-badge',    category: 'factionjob', selections: ['profile', 'jobpoints'], defaultOn: true, render: renderJob },
  { id: 'work',          label: 'Working Stats',  icon: 'fa-briefcase',   category: 'factionjob', selections: ['workstats'],   defaultOn: true,  render: renderWork },

  // Items
  { id: 'properties',    label: 'Properties',     icon: 'fa-house',       category: 'items',      selections: ['properties'],  defaultOn: false, render: renderProperties },
  { id: 'itemvalue2',    label: 'Item Value',     icon: 'fa-boxes-stacked',category: 'items',     selections: ['inventory', 'bazaar', 'display'], defaultOn: true, render: renderItemValue, alias: 'itemvalue' },
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
