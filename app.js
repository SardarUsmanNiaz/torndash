/* ==========================================================================
   TornDash — app.js  (core)
   100% client-side. Talks to the Torn City API directly from the browser.
   The API key is only ever put in the request URL to api.torn.com (HTTPS)
   and, if the user opts in, cached in this browser's localStorage. It is
   never sent anywhere else.

   Loaded AFTER charts.js and sections.js, which provide the chart helpers,
   the SECTIONS registry, CATEGORIES, and every renderX() function.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   1. CONFIG
   -------------------------------------------------------------------------- */
const API_BASE = 'https://api.torn.com/user/';
const REF_BASE = 'https://api.torn.com/torn/';
const REF_TTL = 24 * 60 * 60 * 1000;         // reference data cached 24h
const HISTORY_CAP = 720;                      // ~ snapshots kept
const HISTORY_MIN_GAP = 55 * 1000;            // min ms between stored snapshots

// Reference selection sets, tried in order (first that succeeds wins) so an
// uncertain selection can't sink the whole request.
const REF_SELECTION_SETS = [
  'education,honors,medals,stocks,gyms',
  'education,honors,medals,stocks',
];

const ACCENTS = [
  { id: 'green',  hex: '#00e676', label: 'Neon' },
  { id: 'cyan',   hex: '#22d3ee', label: 'Cyan' },
  { id: 'purple', hex: '#a78bfa', label: 'Violet' },
  { id: 'gold',   hex: '#ffc845', label: 'Gold' },
];

const LS = {
  key:      'torndash.key',
  sections: 'torndash.sections',
  auto:     'torndash.auto',
  interval: 'torndash.interval',
  ref:      'torndash.ref',
  refTime:  'torndash.refTime',
  history:  'torndash.history',
  pinned:   'torndash.pinned',
  accent:   'torndash.accent',
  notify:   'torndash.notify',
  metric:   'torndash.metric',
  tab:      'torndash.tab',
  showProfile:  'torndash.showProfile',
  showOverview: 'torndash.showOverview',
};

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
};

/* --------------------------------------------------------------------------
   3. DOM
   -------------------------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  landing:      $('#landing'),
  dashboard:    $('#dashboard'),
  keyForm:      $('#keyForm'),
  apiKey:       $('#apiKey'),
  toggleKey:    $('#toggleKey'),
  rememberKey:  $('#rememberKey'),
  fetchBtn:     $('#fetchBtn'),
  landingError: $('#landingError'),
  profile:      $('#card-profile'),
  lastUpdated:  $('#lastUpdated'),
  dashError:    $('#dashError'),
  refreshBtn:   $('#refreshBtn'),
  logoutBtn:    $('#logoutBtn'),
  tabBar:       $('#tabBar'),
  tabContent:   $('#tabContent'),
  customizeToggle: $('#customizeToggle'),
  customizePanel:  $('#customizePanel'),
  customizeGroups: $('#customizeGroups'),
  customizeCount:  $('#customizeCount'),
  loader:       $('#loader'),
  loaderStatus: $('#loaderStatus'),
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
  const h = Math.floor(s / 3600);  s -= h * 3600;
  const m = Math.floor(s / 60);    s -= m * 60;
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

/* --------------------------------------------------------------------------
   6. NETWORK
   -------------------------------------------------------------------------- */
async function getJson(url) {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
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
  const url = `${API_BASE}?selections=${selections}&key=${encodeURIComponent(state.key)}&comment=TornDash`;

  try {
    const data = await getJson(url);
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
    { id: '__profile',  label: 'Profile banner',          icon: 'fa-id-card',    on: state.showProfile },
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
  el.dashboard.hidden = false;
  el.dashboard.classList.add('fade-in');
  window.scrollTo({ top: 0 });
}
function showLanding() {
  el.dashboard.hidden = true;
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
    safeLS(() => localStorage.removeItem(LS.history));
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
