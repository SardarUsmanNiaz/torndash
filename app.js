/* ==========================================================================
   TornDash — app.js
   100% client-side logic. Talks to the Torn City API directly from the
   browser via a single GET request. The API key is only ever:
     • put in the request URL to api.torn.com (over HTTPS), and
     • optionally cached in this browser's localStorage (opt-in).
   It is never sent anywhere else.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   1. CONFIG
   -------------------------------------------------------------------------- */

// All selections requested in a SINGLE GET request, comma-separated.
const SELECTIONS = [
  'profile',      // name, id, level, rank, status, job, faction, last action…
  'bars',         // energy, nerve, happy, life, chain, server_time
  'battlestats',  // strength, speed, dexterity, defense, total
  'workstats',    // manual_labor, intelligence, endurance
  'money',        // money_onhand, points, vault, city bank, networth{}
  'cooldowns',    // drug, medical, booster
  'jobpoints',    // job points per city job / company
  'education',    // current course + time left
  'travel',       // destination + time left
  'refills',      // energy/nerve/token refill status
  'perks',        // perk lists
  'icons',        // status icons
].join(',');

const API_BASE = 'https://api.torn.com/user/';

// localStorage keys (all namespaced under torndash.*)
const LS = {
  key:      'torndash.key',
  sections: 'torndash.sections',
  auto:     'torndash.auto',
  interval: 'torndash.interval',
};

// Human-friendly messages for Torn API error codes.
// (The API's own message is always shown too.)
const API_ERROR_HINTS = {
  0:  'Unknown error — please try again in a moment.',
  1:  'The API key field is empty.',
  2:  'Incorrect API key. Double-check the 16-character key from your Torn preferences.',
  3:  'Wrong request type.',
  4:  'Wrong fields requested.',
  5:  'Too many requests — you have hit the rate limit. Wait a minute and try again.',
  6:  'Incorrect ID.',
  7:  'Incorrect ID–entity relation.',
  8:  'IP block — too many requests from this IP address.',
  9:  'API is temporarily disabled for maintenance.',
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

// The sections offered on the landing page and mirrored in the dashboard.
// `locked` sections (Profile) are always shown.
const SECTIONS = [
  { id: 'profile',   label: 'Profile',        icon: 'fa-user',          default: true,  locked: false },
  { id: 'bars',      label: 'Status Bars',    icon: 'fa-heart-pulse',   default: true  },
  { id: 'resources', label: 'Money on Hand',  icon: 'fa-wallet',        default: true  },
  { id: 'networth',  label: 'Networth',       icon: 'fa-sack-dollar',   default: true  },
  { id: 'battle',    label: 'Battle Stats',   icon: 'fa-hand-fist',     default: true  },
  { id: 'work',      label: 'Working Stats',  icon: 'fa-briefcase',     default: true  },
  { id: 'cooldowns', label: 'Cooldowns',      icon: 'fa-hourglass-half',default: true  },
  { id: 'job',       label: 'Job',            icon: 'fa-id-badge',      default: true  },
  { id: 'faction',   label: 'Faction',        icon: 'fa-users',         default: true  },
  { id: 'education', label: 'Education',       icon: 'fa-graduation-cap',default: true  },
  { id: 'travel',    label: 'Travel',         icon: 'fa-plane',         default: false },
  { id: 'refills',   label: 'Refills',        icon: 'fa-bottle-droplet',default: false },
  { id: 'perks',     label: 'Perks',          icon: 'fa-star',          default: false },
];

/* --------------------------------------------------------------------------
   2. STATE
   -------------------------------------------------------------------------- */

const state = {
  key: '',
  data: null,
  clockOffset: 0,          // (serverTime - clientTime) in ms, for accurate timers
  enabled: new Set(),      // enabled section ids
  autoTimer: null,
  fetching: false,
};

/* --------------------------------------------------------------------------
   3. DOM SHORTCUTS
   -------------------------------------------------------------------------- */

const $  = (sel, root = document) => root.querySelector(sel);
const el = {
  landing:        $('#landing'),
  dashboard:      $('#dashboard'),
  keyForm:        $('#keyForm'),
  apiKey:         $('#apiKey'),
  toggleKey:      $('#toggleKey'),
  rememberKey:    $('#rememberKey'),
  fetchBtn:       $('#fetchBtn'),
  landingError:   $('#landingError'),
  sectionToggles: $('#sectionToggles'),
  dashToggles:    $('#dashToggles'),
  grid:           $('#grid'),
  profile:        $('#card-profile'),
  lastUpdated:    $('#lastUpdated'),
  dashError:      $('#dashError'),
  autoRefresh:    $('#autoRefresh'),
  refreshInterval:$('#refreshInterval'),
  refreshBtn:     $('#refreshBtn'),
  logoutBtn:      $('#logoutBtn'),
  customizeBtn:   $('#customizeBtn'),
  customizePanel: $('#customizePanel'),
};

/* --------------------------------------------------------------------------
   4. UTILITIES
   -------------------------------------------------------------------------- */

/** Current time in the SERVER's reference frame (ms). */
const serverNow = () => Date.now() + state.clockOffset;

/** Escape text before inserting into innerHTML. */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 1234567 -> "1,234,567" */
function fmt(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('en-US') : '—';
}

/** 1500000 -> "$1,500,000" (handles negatives, e.g. loans) */
function money(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return (num < 0 ? '-$' : '$') + Math.abs(num).toLocaleString('en-US');
}

/** 1234567890 -> "1.23b" — compact form for subtitles. */
function compact(n) {
  const num = Math.abs(Number(n));
  if (!Number.isFinite(num)) return '';
  const units = [
    [1e12, 't'], [1e9, 'b'], [1e6, 'm'], [1e3, 'k'],
  ];
  for (const [size, suffix] of units) {
    if (num >= size) return (num / size).toFixed(2).replace(/\.00$/, '') + suffix;
  }
  return String(num);
}

/** seconds -> "1d 02:30:15" | "02:30:15" | "05:09" */
function duration(totalSeconds) {
  let s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600);  s -= h * 3600;
  const m = Math.floor(s / 60);    s -= m * 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Build a live countdown <span>. It carries the absolute end time (server ms)
 * in data-end; a global ticker updates it every second and survives re-renders.
 */
function countdown(endMs, doneText = 'Ready') {
  const remaining = Math.max(0, (endMs - serverNow()) / 1000);
  const text = remaining > 0 ? duration(remaining) : doneText;
  const done = remaining > 0 ? '' : ' is-done';
  return `<span class="countdown${done}" data-end="${Math.round(endMs)}" data-done="${escapeHtml(doneText)}">${text}</span>`;
}

/* --------------------------------------------------------------------------
   5. GLOBAL COUNTDOWN TICKER
   Updates every element carrying data-end once per second.
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

/* --------------------------------------------------------------------------
   6. NETWORK — single GET request + robust error handling
   -------------------------------------------------------------------------- */

async function fetchData({ silent = false } = {}) {
  if (state.fetching || !state.key) return false;

  state.fetching = true;
  setLoading(true, silent);
  clearError();

  const url = `${API_BASE}?selections=${SELECTIONS}&key=${encodeURIComponent(state.key)}&comment=TornDash`;

  try {
    const res = await fetch(url, { method: 'GET' });

    // Torn normally answers 200 even for logical errors, but guard anyway.
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const data = await res.json();

    // API-level error object => surface the exact message + a friendly hint.
    if (data && data.error) {
      const code = data.error.code;
      const apiMsg = data.error.error || 'Unknown error';
      const hint = API_ERROR_HINTS[code] || 'Please verify your key and try again.';
      showError(`${apiMsg} (code ${code}). ${hint}`, silent);
      return false;
    }

    // Success — store, sync clock, render, reveal.
    state.data = data;
    if (Number.isFinite(data.server_time)) {
      state.clockOffset = data.server_time * 1000 - Date.now();
    }
    render();
    updateLastUpdated();
    showDashboard();
    return true;

  } catch (err) {
    // Network / CORS / JSON failure.
    const msg = 'Network error — could not reach the Torn API. Check your connection and try again.';
    showError(msg, silent);
    if (!silent) console.error('[TornDash] fetch failed:', err);
    return false;

  } finally {
    state.fetching = false;
    setLoading(false, silent);
  }
}

/* --------------------------------------------------------------------------
   7. RENDER — profile banner + card grid
   -------------------------------------------------------------------------- */

function render() {
  const d = state.data;
  if (!d) return;

  el.profile.innerHTML = renderProfile(d);

  // Cards are always rendered; visibility is handled by section toggles.
  el.grid.innerHTML = [
    renderBars(d),
    renderResources(d),
    renderNetworth(d),
    renderBattle(d),
    renderWork(d),
    renderCooldowns(d),
    renderJob(d),
    renderFaction(d),
    renderEducation(d),
    renderTravel(d),
    renderRefills(d),
    renderPerks(d),
  ].join('');

  applySectionVisibility();
  tickCountdowns(); // paint timers immediately
}

/** Reusable card shell. */
function card(section, title, icon, body, { wide = false, tag = '' } = {}) {
  return `
    <section class="card${wide ? ' card--wide' : ''} fade-in" data-section="${section}" id="card-${section}">
      <header class="card__head">
        <span class="card__title"><i class="fa-solid ${icon}"></i> ${title}</span>
        ${tag ? `<span class="card__tag">${tag}</span>` : ''}
      </header>
      <div class="card__body">${body}</div>
    </section>`;
}

/** Note shown when a selection needs a higher-access key. */
function accessNote() {
  return `<div class="note note--warn"><i class="fa-solid fa-lock"></i>Requires a <strong>Limited</strong> or <strong>Full</strong> access API key.</div>`;
}

/* ----- Profile banner ----- */
function renderProfile(d) {
  const name   = d.name ?? d.playername ?? 'Unknown';
  const id     = d.player_id ?? '—';
  const level  = d.level ?? '—';
  const rank   = d.rank ?? '';
  const img    = d.profile_image || '';
  const st     = d.status || {};
  const colorMap = { green: 'green', red: 'red', blue: 'blue', orange: 'gold' };
  const badgeColor = colorMap[st.color] || 'green';

  // Status (may include a hospital/jail release countdown).
  let statusText = escapeHtml(st.description || st.state || 'Okay');
  if (st.until && st.until > 0) {
    statusText += ' · ' + countdown(st.until * 1000, 'Out');
  }

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
    : `<div class="profile__img" style="display:grid;place-items:center;color:var(--text-faint);font-size:1.8rem"><i class="fa-solid fa-user"></i></div>`;

  return `
    ${avatar}
    <div class="profile__main">
      <div class="profile__name">${escapeHtml(name)}</div>
      <div class="profile__id">ID <b>#${escapeHtml(String(id))}</b></div>
      <div class="profile__badges">${badges}</div>
    </div>
    <div class="profile__meta">${meta}</div>`;
}

/* ----- Status bars (energy / nerve / happy / life) ----- */
function bar(name, icon, obj, color) {
  if (!obj) return '';
  const cur = obj.current ?? 0;
  const max = obj.maximum ?? 0;
  const pct = max ? Math.min(100, (cur / max) * 100) : 0;
  const full = cur >= max;
  const meta = full
    ? '<span class="bar__full">FULL</span>'
    : (obj.fulltime ? `Full in ${countdown(obj.fulltime * 1000, 'Full')}` : '&nbsp;');
  return `
    <div class="bar" style="--bar:${color}">
      <div class="bar__top">
        <span class="bar__name"><i class="fa-solid ${icon}"></i> ${name}</span>
        <span class="bar__val">${fmt(cur)} / ${fmt(max)}</span>
      </div>
      <div class="bar__track"><div class="bar__fill" style="width:${pct}%"></div></div>
      <div class="bar__meta">${meta}</div>
    </div>`;
}

function renderBars(d) {
  const hasAny = d.energy || d.nerve || d.happy || d.life;
  const body = hasAny ? `
    <div class="bars">
      ${bar('Energy', 'fa-bolt',        d.energy, 'var(--accent)')}
      ${bar('Nerve',  'fa-fire',        d.nerve,  '#ff5470')}
      ${bar('Happy',  'fa-face-smile',  d.happy,  '#ffce54')}
      ${bar('Life',   'fa-heart',       d.life,   '#22d3ee')}
    </div>
    ${renderChain(d.chain)}
  ` : `<div class="note">No bar data available.</div>`;
  return card('bars', 'Status Bars', 'fa-heart-pulse', body);
}

function renderChain(chain) {
  if (!chain || !chain.current) return '';
  const timeout = chain.timeout ? ` · ${countdown(serverNow() + chain.timeout * 1000, 'Ended')} left` : '';
  return `<div class="kv" style="margin-top:14px"><div class="kv__row">
      <span class="kv__k"><i class="fa-solid fa-link"></i> Chain</span>
      <span class="kv__v accent">${fmt(chain.current)} / ${fmt(chain.maximum)}${timeout}</span>
    </div></div>`;
}

/* ----- Core resources (money on hand + wallet extras) ----- */
function renderResources(d) {
  const onhand = d.money_onhand;
  if (onhand == null) return card('resources', 'Money on Hand', 'fa-wallet', accessNote());

  const rows = [
    d.points     != null ? ['Points',       fmt(d.points),            'fa-coins',        'cyan'] : null,
    d.cayman_bank!= null && d.cayman_bank > 0 ? ['Cayman Bank', money(d.cayman_bank), 'fa-building-columns', ''] : null,
    d.vault_amount != null && d.vault_amount > 0 ? ['Faction Vault', money(d.vault_amount), 'fa-vault', ''] : null,
    d.city_bank && d.city_bank.amount ? ['City Bank', money(d.city_bank.amount), 'fa-piggy-bank', ''] : null,
  ].filter(Boolean).map(([k, v, icon, cls]) =>
    `<div class="kv__row"><span class="kv__k"><i class="fa-solid ${icon}"></i> ${k}</span><span class="kv__v ${cls}">${v}</span></div>`
  ).join('');

  const bankTimer = d.city_bank && d.city_bank.time_left
    ? `<div class="kv__row"><span class="kv__k"><i class="fa-solid fa-clock"></i> Bank matures</span><span class="kv__v">${countdown(serverNow() + d.city_bank.time_left * 1000, 'Ready')}</span></div>`
    : '';

  const body = `
    <div class="bignum">
      <div class="bignum__val">${money(onhand)}</div>
      <div class="bignum__sub">≈ $${compact(onhand)} on hand</div>
    </div>
    ${(rows || bankTimer) ? `<div class="kv">${rows}${bankTimer}</div>` : ''}`;
  return card('resources', 'Money on Hand', 'fa-wallet', body);
}

/* ----- Networth ----- */
const NETWORTH_LABELS = {
  wallet: 'Wallet', bank: 'City Bank', cayman: 'Cayman Bank', vault: 'Vault',
  points: 'Points', items: 'Items', displaycase: 'Display Case', bazaar: 'Bazaar',
  properties: 'Properties', stockmarket: 'Stock Market', auctionhouse: 'Auction House',
  company: 'Company', bookie: 'Bookie', enlistedcars: 'Enlisted Cars',
  piggybank: 'Piggy Bank', pending: 'Pending', loan: 'Loans', unpaidfees: 'Unpaid Fees',
};
function renderNetworth(d) {
  const nw = d.networth;
  if (!nw || nw.total == null) return card('networth', 'Networth', 'fa-sack-dollar', accessNote());

  const rows = Object.entries(NETWORTH_LABELS)
    .filter(([k]) => nw[k] != null && Math.abs(nw[k]) >= 1)
    .sort((a, b) => Math.abs(nw[b[0]]) - Math.abs(nw[a[0]]))
    .slice(0, 8)
    .map(([k, label]) =>
      `<div class="kv__row"><span class="kv__k">${label}</span><span class="kv__v ${nw[k] < 0 ? 'muted' : ''}">${money(nw[k])}</span></div>`
    ).join('');

  const body = `
    <div class="bignum">
      <div class="bignum__val cyan">${money(nw.total)}</div>
      <div class="bignum__sub">≈ $${compact(nw.total)} total networth</div>
    </div>
    <div class="kv">${rows}</div>`;
  return card('networth', 'Networth', 'fa-sack-dollar', body, { wide: true });
}

/* ----- Battle stats ----- */
function renderBattle(d) {
  if (d.strength == null) return card('battle', 'Battle Stats', 'fa-hand-fist', accessNote());

  const parts = [
    ['Strength',  d.strength,  'var(--accent)'],
    ['Speed',     d.speed,     'var(--accent-2)'],
    ['Dexterity', d.dexterity, 'var(--accent-3)'],
    ['Defense',   d.defense,   'var(--gold)'],
  ];
  const total = d.total ?? parts.reduce((sum, [, v]) => sum + (Number(v) || 0), 0);

  const lines = parts.map(([label, val, color]) => {
    const pct = total ? (Number(val) / total) * 100 : 0;
    return `
      <div class="statline" style="--c:${color}">
        <div class="statline__top"><span>${label}</span><span class="num">${fmt(val)}</span></div>
        <div class="statline__bar"><div style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  const body = `
    <div class="statlines">${lines}</div>
    <div class="total">
      <span>Total Battle Stats</span>
      <span class="total__num">${fmt(total)}</span>
    </div>`;
  return card('battle', 'Battle Stats', 'fa-hand-fist', body);
}

/* ----- Working stats (total calculated in JS per spec) ----- */
function renderWork(d) {
  if (d.manual_labor == null && d.intelligence == null && d.endurance == null) {
    return card('work', 'Working Stats', 'fa-briefcase', accessNote());
  }
  const manual = Number(d.manual_labor) || 0;
  const intel  = Number(d.intelligence) || 0;
  const endur  = Number(d.endurance) || 0;
  const total  = manual + intel + endur; // calculated manually

  const parts = [
    ['Manual Labor',  manual, 'var(--accent-2)'],
    ['Intelligence',  intel,  'var(--accent-3)'],
    ['Endurance',     endur,  'var(--accent)'],
  ];
  const lines = parts.map(([label, val, color]) => {
    const pct = total ? (val / total) * 100 : 0;
    return `
      <div class="statline" style="--c:${color}">
        <div class="statline__top"><span>${label}</span><span class="num">${fmt(val)}</span></div>
        <div class="statline__bar"><div style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  const body = `
    <div class="statlines">${lines}</div>
    <div class="total total--cyan">
      <span>Total Working Stats</span>
      <span class="total__num">${fmt(total)}</span>
    </div>`;
  return card('work', 'Working Stats', 'fa-briefcase', body);
}

/* ----- Cooldowns (drug / medical / booster) ----- */
function cooldownTile(name, icon, seconds, color) {
  const ready = !seconds || seconds <= 0;
  const endMs = serverNow() + (seconds || 0) * 1000;
  const time = ready ? 'Ready' : countdown(endMs, 'Ready');
  return `
    <div class="cd${ready ? ' cd--ready' : ''}" style="--c:${color}">
      <div class="cd__icon"><i class="fa-solid ${icon}"></i></div>
      <div class="cd__body">
        <span class="cd__name">${name}</span>
        <span class="cd__time">${time}</span>
      </div>
    </div>`;
}
function renderCooldowns(d) {
  const cd = d.cooldowns || {};
  const body = `
    <div class="cds">
      ${cooldownTile('Drug',    'fa-pills',        cd.drug,    'var(--accent-3)')}
      ${cooldownTile('Medical', 'fa-kit-medical',  cd.medical, 'var(--danger)')}
      ${cooldownTile('Booster', 'fa-bottle-water', cd.booster, 'var(--warn)')}
    </div>`;
  return card('cooldowns', 'Cooldowns', 'fa-hourglass-half', body);
}

/* ----- Job ----- */
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
  const hasJob = job.job || job.company_name;
  if (!hasJob) return card('job', 'Job', 'fa-id-badge', `<div class="note">Not currently employed.</div>`);

  const points = totalJobPoints(d);
  const rows = [
    job.position ? ['Position', escapeHtml(job.position), 'fa-user-tie'] : null,
    job.company_name ? ['Company', escapeHtml(job.company_name), 'fa-building'] : null,
    points != null ? ['Total Job Points', fmt(points), 'fa-award'] : null,
  ].filter(Boolean).map(([k, v, icon]) =>
    `<div class="kv__row"><span class="kv__k"><i class="fa-solid ${icon}"></i> ${k}</span><span class="kv__v accent">${v}</span></div>`
  ).join('');

  const body = `
    <div class="bignum">
      <div class="bignum__val" style="font-size:1.5rem">${escapeHtml(job.company_name || job.job || 'Employed')}</div>
      <div class="bignum__sub">${escapeHtml(job.job || '')}</div>
    </div>
    <div class="kv">${rows}</div>`;
  return card('job', 'Job', 'fa-id-badge', body);
}

/* ----- Faction ----- */
function renderFaction(d) {
  const f = d.faction || {};
  if (!f.faction_id) return card('faction', 'Faction', 'fa-users', `<div class="note">Not in a faction.</div>`);

  const rows = [
    ['Position', escapeHtml(f.position || '—'), 'fa-user-shield'],
    f.days_in_faction != null ? ['Days in Faction', fmt(f.days_in_faction), 'fa-calendar-day'] : null,
    ['Faction ID', `#${escapeHtml(String(f.faction_id))}`, 'fa-hashtag'],
  ].filter(Boolean).map(([k, v, icon]) =>
    `<div class="kv__row"><span class="kv__k"><i class="fa-solid ${icon}"></i> ${k}</span><span class="kv__v">${v}</span></div>`
  ).join('');

  const tag = f.faction_tag ? `<span class="badge badge--blue">[${escapeHtml(f.faction_tag)}]</span>` : '';
  const body = `
    <div class="bignum">
      <div class="bignum__val cyan" style="font-size:1.4rem">${escapeHtml(f.faction_name || 'Faction')}</div>
      <div class="bignum__sub">${tag}</div>
    </div>
    <div class="kv">${rows}</div>`;
  return card('faction', 'Faction', 'fa-users', body);
}

/* ----- Education ----- */
function renderEducation(d) {
  const left = d.education_timeleft;
  const completed = Array.isArray(d.education_completed) ? d.education_completed.length : null;

  let body;
  if (left && left > 0) {
    body = `
      <div class="bignum">
        <div class="bignum__val" style="font-size:1.6rem">${countdown(serverNow() + left * 1000, 'Complete')}</div>
        <div class="bignum__sub">until current course completes</div>
      </div>`;
  } else {
    body = `<div class="note"><i class="fa-solid fa-circle-check"></i> No active course.</div>`;
  }
  if (completed != null) {
    body += `<div class="kv"><div class="kv__row"><span class="kv__k"><i class="fa-solid fa-certificate"></i> Courses completed</span><span class="kv__v accent">${fmt(completed)}</span></div></div>`;
  }
  return card('education', 'Education', 'fa-graduation-cap', body);
}

/* ----- Travel ----- */
function renderTravel(d) {
  const t = d.travel || {};
  const traveling = t.time_left && t.time_left > 0;

  let body;
  if (traveling) {
    const rows = [
      ['Destination', escapeHtml(t.destination || '—'), 'fa-location-dot'],
      t.method ? ['Method', escapeHtml(t.method), 'fa-plane-departure'] : null,
    ].filter(Boolean).map(([k, v, icon]) =>
      `<div class="kv__row"><span class="kv__k"><i class="fa-solid ${icon}"></i> ${k}</span><span class="kv__v">${v}</span></div>`
    ).join('');
    body = `
      <div class="bignum">
        <div class="bignum__val cyan" style="font-size:1.6rem">${countdown(serverNow() + t.time_left * 1000, 'Landed')}</div>
        <div class="bignum__sub">until arrival</div>
      </div>
      <div class="kv">${rows}</div>`;
  } else {
    const where = t.destination && t.destination !== 'Torn' ? escapeHtml(t.destination) : 'Torn';
    body = `<div class="note"><i class="fa-solid fa-house"></i> Not travelling — currently in <strong>${where}</strong>.</div>`;
  }
  return card('travel', 'Travel', 'fa-plane', body);
}

/* ----- Refills ----- */
function refillPill(label, used) {
  return used
    ? `<span class="badge badge--green"><i class="fa-solid fa-check"></i> ${label} used</span>`
    : `<span class="badge badge--red"><i class="fa-solid fa-xmark"></i> ${label} available</span>`;
}
function renderRefills(d) {
  const r = d.refills;
  if (!r) return card('refills', 'Refills', 'fa-bottle-droplet', `<div class="note">No refill data.</div>`);
  const body = `
    <div class="pill-row">
      ${refillPill('Energy',  r.energy_refill_used)}
      ${refillPill('Nerve',   r.nerve_refill_used)}
      ${refillPill('Token',   r.token_refill_used)}
    </div>
    ${r.special_refills_available != null
      ? `<div class="kv" style="margin-top:12px"><div class="kv__row"><span class="kv__k"><i class="fa-solid fa-gift"></i> Special refills</span><span class="kv__v accent">${fmt(r.special_refills_available)}</span></div></div>`
      : ''}`;
  return card('refills', 'Refills', 'fa-bottle-droplet', body);
}

/* ----- Perks ----- */
const PERK_GROUPS = [
  ['job_perks', 'Job', 'fa-briefcase'],
  ['property_perks', 'Property', 'fa-house'],
  ['stock_perks', 'Stock', 'fa-chart-line'],
  ['merit_perks', 'Merit', 'fa-medal'],
  ['education_perks', 'Education', 'fa-graduation-cap'],
  ['enhancer_perks', 'Enhancer', 'fa-flask'],
  ['faction_perks', 'Faction', 'fa-users'],
  ['book_perks', 'Book', 'fa-book'],
];
function renderPerks(d) {
  const groups = PERK_GROUPS
    .map(([key, label, icon]) => [label, icon, Array.isArray(d[key]) ? d[key].length : 0])
    .filter(([, , count]) => count > 0);

  if (!groups.length) return card('perks', 'Perks', 'fa-star', `<div class="note">No perk data available.</div>`);

  const total = groups.reduce((s, [, , c]) => s + c, 0);
  const rows = groups.map(([label, icon, count]) =>
    `<div class="kv__row"><span class="kv__k"><i class="fa-solid ${icon}"></i> ${label} perks</span><span class="kv__v accent">${fmt(count)}</span></div>`
  ).join('');

  const body = `
    <div class="bignum">
      <div class="bignum__val">${fmt(total)}</div>
      <div class="bignum__sub">active perks</div>
    </div>
    <div class="kv">${rows}</div>`;
  return card('perks', 'Perks', 'fa-star', body, { wide: groups.length > 4 });
}

/* --------------------------------------------------------------------------
   8. SECTION TOGGLES (landing + dashboard, kept in sync)
   -------------------------------------------------------------------------- */

function renderToggles(container) {
  container.innerHTML = SECTIONS.map((s) => {
    const on = state.enabled.has(s.id);
    return `
      <label class="toggle${on ? ' is-on' : ''}${s.locked ? ' is-locked' : ''}" data-id="${s.id}">
        <input type="checkbox" ${on ? 'checked' : ''} ${s.locked ? 'disabled' : ''} />
        <i class="fa-solid ${s.icon}"></i>
        <span>${s.label}</span>
        <span class="toggle__dot"></span>
      </label>`;
  }).join('');

  container.querySelectorAll('.toggle input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const id = e.target.closest('.toggle').dataset.id;
      if (e.target.checked) state.enabled.add(id);
      else state.enabled.delete(id);
      savePrefs();
      syncToggleUI();
      applySectionVisibility();
    });
  });
}

/** Reflect state into both toggle groups' visual on/off classes. */
function syncToggleUI() {
  document.querySelectorAll('.toggle').forEach((t) => {
    const on = state.enabled.has(t.dataset.id);
    t.classList.toggle('is-on', on);
    const input = t.querySelector('input');
    if (input && !input.disabled) input.checked = on;
  });
}

/** Show/hide dashboard cards according to enabled sections. */
function applySectionVisibility() {
  document.querySelectorAll('[data-section]').forEach((node) => {
    const id = node.dataset.section;
    node.hidden = !(state.enabled.has(id));
  });
}

/* --------------------------------------------------------------------------
   9. UI STATE HELPERS
   -------------------------------------------------------------------------- */

function setLoading(isLoading, silent) {
  // Landing button spinner (only when not a silent auto-refresh).
  if (!silent) {
    el.fetchBtn.disabled = isLoading;
    el.fetchBtn.querySelector('.btn__label').hidden = isLoading;
    el.fetchBtn.querySelector('.btn__spinner').hidden = !isLoading;
  }
  // Dashboard refresh button feedback.
  el.refreshBtn.disabled = isLoading;
  el.refreshBtn.querySelector('i')?.classList.toggle('fa-spin', isLoading);
  el.lastUpdated.classList.toggle('is-live', isLoading);
}

function showError(message, silent) {
  const target = el.dashboard.hidden ? el.landingError : el.dashError;
  target.textContent = message;
  target.hidden = false;
  if (silent && !el.dashboard.hidden) {
    // Auto-refresh failure — keep old data, just flag it briefly.
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
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  el.lastUpdated.textContent = `Updated ${hh}:${mm}:${ss}`;
}

function showDashboard() {
  el.landing.hidden = true;
  el.dashboard.hidden = false;
  el.dashboard.classList.add('fade-in');
  window.scrollTo({ top: 0 });
}

function showLanding() {
  el.dashboard.hidden = true;
  el.landing.hidden = false;
  el.landing.classList.add('fade-in');
}

/* --------------------------------------------------------------------------
   10. PREFERENCES (localStorage — stays on this device only)
   -------------------------------------------------------------------------- */

function loadPrefs() {
  // Enabled sections
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS.sections) || 'null'); } catch { /* ignore */ }
  if (Array.isArray(saved)) {
    state.enabled = new Set(saved);
  } else {
    state.enabled = new Set(SECTIONS.filter((s) => s.default).map((s) => s.id));
  }
  state.enabled.add('profile'); // always on

  // Auto-refresh prefs
  el.autoRefresh.checked = localStorage.getItem(LS.auto) === '1';
  const iv = localStorage.getItem(LS.interval);
  if (iv) el.refreshInterval.value = iv;

  // Saved key (opt-in)
  const savedKey = localStorage.getItem(LS.key);
  if (savedKey) {
    el.apiKey.value = savedKey;
    el.rememberKey.checked = true;
  }
}

function savePrefs() {
  try {
    localStorage.setItem(LS.sections, JSON.stringify([...state.enabled]));
    localStorage.setItem(LS.auto, el.autoRefresh.checked ? '1' : '0');
    localStorage.setItem(LS.interval, el.refreshInterval.value);
  } catch { /* storage may be unavailable (private mode) — non-fatal */ }
}

/* --------------------------------------------------------------------------
   11. AUTO-REFRESH
   -------------------------------------------------------------------------- */

function setupAutoRefresh() {
  clearInterval(state.autoTimer);
  state.autoTimer = null;
  if (el.autoRefresh.checked && !el.dashboard.hidden) {
    const secs = Math.max(15, Number(el.refreshInterval.value) || 30);
    state.autoTimer = setInterval(() => fetchData({ silent: true }), secs * 1000);
  }
}

/* --------------------------------------------------------------------------
   12. EVENT WIRING
   -------------------------------------------------------------------------- */

function wireEvents() {
  // Submit — validate + fetch.
  el.keyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = el.apiKey.value.trim();
    if (!key) {
      showError('The API key field is empty. Please enter your Torn API key.', false);
      el.apiKey.focus();
      return;
    }
    state.key = key;

    // Remember (opt-in, local only) or forget.
    try {
      if (el.rememberKey.checked) localStorage.setItem(LS.key, key);
      else localStorage.removeItem(LS.key);
    } catch { /* ignore */ }

    savePrefs();
    fetchData({ silent: false });
  });

  // Show / hide key.
  el.toggleKey.addEventListener('click', () => {
    const hidden = el.apiKey.type === 'password';
    el.apiKey.type = hidden ? 'text' : 'password';
    el.toggleKey.querySelector('i').className = hidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  });

  // Manual refresh.
  el.refreshBtn.addEventListener('click', () => fetchData({ silent: false }));

  // Change key / logout.
  el.logoutBtn.addEventListener('click', () => {
    clearInterval(state.autoTimer);
    state.data = null;
    state.key = '';
    clearError();
    showLanding();
    el.apiKey.focus();
  });

  // Customize panel toggle.
  el.customizeBtn.addEventListener('click', () => {
    el.customizePanel.hidden = !el.customizePanel.hidden;
    if (!el.customizePanel.hidden) renderToggles(el.dashToggles);
  });

  // Auto-refresh controls.
  el.autoRefresh.addEventListener('change', () => { savePrefs(); setupAutoRefresh(); });
  el.refreshInterval.addEventListener('change', () => { savePrefs(); setupAutoRefresh(); });

  // Pause auto-refresh while the tab is hidden; resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(state.autoTimer);
    else setupAutoRefresh();
  });
}

/* --------------------------------------------------------------------------
   13. INIT
   -------------------------------------------------------------------------- */

function init() {
  loadPrefs();
  renderToggles(el.sectionToggles);
  wireEvents();

  // Re-arm auto-refresh whenever we land on the dashboard.
  const armAuto = new MutationObserver(setupAutoRefresh);
  armAuto.observe(el.dashboard, { attributes: true, attributeFilter: ['hidden'] });

  // Convenience: if a key was remembered, fetch straight away.
  if (el.apiKey.value.trim()) {
    state.key = el.apiKey.value.trim();
    fetchData({ silent: false });
  } else {
    el.apiKey.focus();
  }
}

document.addEventListener('DOMContentLoaded', init);
