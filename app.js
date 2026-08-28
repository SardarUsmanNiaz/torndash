/* =========================================================================
   TornDash — app.js
   100% client-side. The API key lives ONLY in this page's memory for the
   current session and is never persisted to disk/localStorage.

   Where the key can go:
     • Real Torn keys are sent ONLY to Torn's official API over HTTPS.
     • For the optional Supabase-backed "fake players", the site sends just a
       SHA-256 HASH of the entered key (never the raw key) to look it up — so a
       real key typed here is never revealed to Supabase.
   ========================================================================= */
'use strict';

/* ------------------------------------------------------------------ *
 * Configuration                                                      *
 * ------------------------------------------------------------------ */

// Single Torn API endpoint. We combine several "selections" so that all the
// data we need arrives in ONE GET request (the fields are merged into a flat
// object at the top level of the response):
//   bars        -> energy { current, maximum }
//   money       -> money_onhand
//   networth    -> networth { total, ... }
//   battlestats -> strength, speed, dexterity, defense, total
//   workstats   -> manual_labor, intelligence, endurance
// NOTE: the `profile` selection is intentionally NOT requested, so the
// player's name and ID are never fetched or displayed.
const TORN_API_BASE = 'https://api.torn.com/user/';
const SELECTIONS = 'bars,money,networth,battlestats,workstats';
const APP_COMMENT = 'TornDash'; // polite identifier passed to the API

// The user's API key is held here in memory only (cleared on "Log Out").
let currentApiKey = '';

// Tracks where the most recent stats came from, so we know whether to open a
// realtime subscription (Supabase-backed players only).
let lastFetch = { source: null, hash: null };

// Active Supabase realtime channel (if any) for live stat updates.
let realtimeChannel = null;

// Remembers the last rendered numeric value per element so refreshes animate
// smoothly from the previous number instead of restarting from zero.
const lastValues = Object.create(null);

// Honour the OS-level "reduce motion" setting for the count-up animation.
const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ *
 * Element references                                                 *
 * ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);

const el = {
  // views
  landing: $('landing'),
  dashboard: $('dashboard'),
  // landing controls
  form: $('keyForm'),
  keyInput: $('apiKey'),
  toggleKey: $('toggleKey'),
  fetchBtn: $('fetchBtn'),
  errorBox: $('errorBox'),
  // dashboard controls
  dashError: $('dashError'),
  refreshBtn: $('refreshBtn'),
  logoutBtn: $('logoutBtn'),
  lastUpdated: $('lastUpdated'),
  // resources
  energyText: $('energyText'),
  energyBar: $('energyBar'),
  lifeText: $('lifeText'),
  lifeBar: $('lifeBar'),
  money: $('money'),
  networth: $('networth'),
  // battle stats
  strength: $('strength'),
  speed: $('speed'),
  dexterity: $('dexterity'),
  defense: $('defense'),
  battleTotal: $('battleTotal'),
  // working stats
  manual: $('manual'),
  intelligence: $('intelligence'),
  endurance: $('endurance'),
  workTotal: $('workTotal'),
};

/* ------------------------------------------------------------------ *
 * Torn API error-code hints (the API's own message is always shown;  *
 * these add a friendly nudge for the most common cases).             *
 * ------------------------------------------------------------------ */
const API_ERROR_HINTS = {
  2: 'Double-check that you pasted the key correctly.',
  5: 'You are being rate-limited by Torn. Wait a moment, then try again.',
  9: 'The Torn API is temporarily disabled. Try again shortly.',
  10: 'This account is in federal jail, so the API is blocked.',
  13: 'This key was disabled due to inactivity — make a request on Torn to re-enable it.',
  16: 'This key lacks the access level needed for these stats. Use a Full Access key.',
  18: 'This API key is paused. Un-pause it in your Torn API settings.',
};

/* ------------------------------------------------------------------ *
 * Helpers                                                            *
 * ------------------------------------------------------------------ */

/** Coerce a value to a finite number, or return null if it isn't one. */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Format a number with thousands separators; returns 'N/A' for null. */
function fmt(n, { money = false } = {}) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return 'N/A';
  return (money ? '$' : '') + Number(n).toLocaleString();
}

/**
 * Animate a number from its previous value up to `to`, formatting every frame
 * with toLocaleString(). Falls back to an instant set when the value is
 * unavailable or the user prefers reduced motion.
 */
function setNumber(node, to, { money = false, duration = 900 } = {}) {
  const target = toNum(to);

  // Unavailable value -> show N/A, style it, and reset any stored value.
  if (target === null) {
    node.textContent = 'N/A';
    node.classList.add('na');
    delete lastValues[node.id];
    return;
  }
  node.classList.remove('na');

  const from = lastValues[node.id] ?? 0;
  lastValues[node.id] = target;

  const prefix = money ? '$' : '';

  if (prefersReducedMotion || from === target) {
    node.textContent = prefix + target.toLocaleString();
    return;
  }

  const startTime = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic

  function frame(now) {
    const p = Math.min((now - startTime) / duration, 1);
    const value = Math.round(from + (target - from) * ease(p));
    node.textContent = prefix + value.toLocaleString();
    if (p < 1) requestAnimationFrame(frame);
    else node.textContent = prefix + target.toLocaleString(); // exact final value
  }
  requestAnimationFrame(frame);
}

/** Switch between the landing and dashboard views. */
function showView(name) {
  const isDash = name === 'dashboard';
  el.dashboard.hidden = !isDash;
  el.landing.hidden = isDash;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/** Show / clear the landing-page error box. */
function showError(msg, box = el.errorBox) {
  box.textContent = msg;
  box.hidden = false;
}
function clearError(box = el.errorBox) {
  box.textContent = '';
  box.hidden = true;
}

/** Toggle the button/page loading state. */
function setLoading(isLoading) {
  const label = el.fetchBtn.querySelector('.btn-label');
  const spinner = el.fetchBtn.querySelector('.spinner');
  el.fetchBtn.disabled = isLoading;
  el.keyInput.disabled = isLoading;
  if (label) label.hidden = isLoading;
  if (spinner) spinner.hidden = !isLoading;
}

/** Build a friendly message from an API error object. */
function friendlyApiError(err) {
  const code = err.code;
  const base = err.message || 'The Torn API returned an error.';
  const hint = API_ERROR_HINTS[code];
  const codeLabel = code !== undefined ? ` (code ${code})` : '';
  return hint ? `${base}${codeLabel}. ${hint}` : `${base}${codeLabel}.`;
}

/* ------------------------------------------------------------------ *
 * API request                                                        *
 * ------------------------------------------------------------------ */

/**
 * Perform the single GET request to the Torn API and return parsed data.
 * Throws:
 *   - an error with `.isApiError = true` and `.code` for Torn API errors
 *   - a generic Error for network / parsing failures
 */
async function fetchStats(apiKey) {
  // Supabase fake-player lookup — by HASH, so the raw key is never sent to
  // Supabase. A match returns editable fake stats; no match falls through to
  // the real Torn API below.
  if (window.SB_CONFIGURED && window.SB) {
    try {
      const hash = await window.sha256Hex(apiKey);
      const { data, error } = await window.SB
        .from('public_player_stats')
        .select('*')
        .eq('key_hash', hash)
        .maybeSingle();
      if (!error && data) {
        lastFetch = { source: 'supabase', hash };
        return rowToData(data);
      }
    } catch (e) {
      // e.g. crypto.subtle unavailable (file://) — just skip Supabase.
      console.warn('[TornDash] Supabase lookup skipped:', e && e.message);
    }
  }

  // ----- Real Torn API -----
  lastFetch = { source: 'torn', hash: null };
  const url =
    `${TORN_API_BASE}?selections=${encodeURIComponent(SELECTIONS)}` +
    `&key=${encodeURIComponent(apiKey)}&comment=${encodeURIComponent(APP_COMMENT)}`;

  let response;
  try {
    response = await fetch(url, { method: 'GET', cache: 'no-store' });
  } catch (networkErr) {
    // fetch() rejects only on network-level failures (offline, DNS, CORS…)
    throw new Error('network');
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
  }

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    throw new Error('Received an unreadable response from the Torn API.');
  }

  // Torn signals problems with a 200 response containing an `error` object.
  if (data && data.error) {
    const apiErr = new Error(data.error.error || 'Unknown Torn API error');
    apiErr.isApiError = true;
    apiErr.code = data.error.code;
    throw apiErr;
  }

  return data;
}

/* ------------------------------------------------------------------ *
 * Rendering                                                          *
 * ------------------------------------------------------------------ */

/**
 * Render a "current / maximum" bar (energy, life, …) from a Torn bar object.
 */
function renderBar(textEl, barEl, obj) {
  const cur = toNum(obj && obj.current);
  const max = toNum(obj && obj.maximum);
  if (cur !== null && max !== null) {
    textEl.textContent = `${cur.toLocaleString()} / ${max.toLocaleString()}`;
    const pct = max > 0 ? Math.min(100, (cur / max) * 100) : 0;
    barEl.style.width = pct + '%';
    barEl.parentElement.setAttribute('aria-valuenow', String(cur));
    barEl.parentElement.setAttribute('aria-valuemax', String(max));
  } else {
    textEl.textContent = 'N/A';
    barEl.style.width = '0%';
  }
}

/**
 * Convert a Supabase `public_player_stats` row into the same flat shape that
 * renderDashboard expects from the Torn API. Battle total is summed here.
 */
function rowToData(row) {
  const str = toNum(row.strength) || 0;
  const def = toNum(row.defense) || 0;
  const spd = toNum(row.speed) || 0;
  const dex = toNum(row.dexterity) || 0;
  return {
    energy: { current: row.energy_current, maximum: row.energy_maximum },
    life: { current: row.life_current, maximum: row.life_maximum },
    money_onhand: row.money_onhand,
    networth: { total: row.networth_total },
    strength: row.strength,
    defense: row.defense,
    speed: row.speed,
    dexterity: row.dexterity,
    total: str + def + spd + dex,
    manual_labor: row.manual_labor,
    intelligence: row.intelligence,
    endurance: row.endurance,
  };
}

/** Map the API payload onto the dashboard UI. */
function renderDashboard(data) {
  /* ----- Core resources: energy & life ----- */
  renderBar(el.energyText, el.energyBar, data.energy);
  renderBar(el.lifeText, el.lifeBar, data.life);

  /* ----- Core resources: money ----- */
  setNumber(el.money, data.money_onhand, { money: true });

  /* ----- Networth ----- */
  const networth = data.networth || {};
  setNumber(el.networth, networth.total, { money: true });

  /* ----- Battle stats ----- */
  const str = toNum(data.strength);
  const spd = toNum(data.speed);
  const dex = toNum(data.dexterity);
  const def = toNum(data.defense);
  setNumber(el.strength, str);
  setNumber(el.speed, spd);
  setNumber(el.dexterity, dex);
  setNumber(el.defense, def);

  // Prefer the API-provided total; otherwise sum the four sub-stats.
  let battleTotal = toNum(data.total);
  if (battleTotal === null && [str, spd, dex, def].some((v) => v !== null)) {
    battleTotal = (str || 0) + (spd || 0) + (dex || 0) + (def || 0);
  }
  setNumber(el.battleTotal, battleTotal);

  /* ----- Working stats ----- */
  const manual = toNum(data.manual_labor);
  const intel = toNum(data.intelligence);
  const endur = toNum(data.endurance);
  setNumber(el.manual, manual);
  setNumber(el.intelligence, intel);
  setNumber(el.endurance, endur);

  // Total working stats is calculated manually (sum of the three fields).
  let workTotal = null;
  if ([manual, intel, endur].some((v) => v !== null)) {
    workTotal = (manual || 0) + (intel || 0) + (endur || 0);
  }
  setNumber(el.workTotal, workTotal);

  /* ----- Timestamp ----- */
  el.lastUpdated.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

/* ------------------------------------------------------------------ *
 * Realtime — live updates for Supabase-backed players                *
 * ------------------------------------------------------------------ */

/** Tear down any open realtime subscription. */
function unsubscribeRealtime() {
  if (realtimeChannel && window.SB) {
    window.SB.removeChannel(realtimeChannel);
  }
  realtimeChannel = null;
}

/**
 * Subscribe to changes for one player row (by key hash). When the admin edits
 * that player, the dashboard re-renders instantly — no refresh needed.
 */
function subscribeRealtime(hash) {
  if (!window.SB || !hash) return;
  unsubscribeRealtime();
  realtimeChannel = window.SB
    .channel('stats-' + hash)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'public_player_stats',
        filter: 'key_hash=eq.' + hash,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          showError('This player was removed by the admin.', el.dashError);
          return;
        }
        if (payload.new) {
          renderDashboard(rowToData(payload.new));
          el.lastUpdated.textContent = 'Live update · ' + new Date().toLocaleTimeString();
        }
      }
    )
    .subscribe();
}

/* ------------------------------------------------------------------ *
 * Event handlers                                                     *
 * ------------------------------------------------------------------ */

// --- Submit the API key from the landing page ---
el.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const key = el.keyInput.value.trim();
  if (!key) {
    showError('Please enter your Torn API key to continue.');
    el.keyInput.focus();
    return;
  }

  setLoading(true);
  try {
    const data = await fetchStats(key);
    currentApiKey = key;          // keep in memory for refreshes
    renderDashboard(data);
    showView('dashboard');
    clearError(el.dashError);
    el.keyInput.value = '';       // don't leave the key sitting in the field

    // Live updates only for Supabase-backed players; otherwise ensure none.
    if (lastFetch.source === 'supabase') subscribeRealtime(lastFetch.hash);
    else unsubscribeRealtime();
  } catch (err) {
    if (err.isApiError) {
      showError(friendlyApiError(err));
    } else if (err.message === 'network') {
      showError('Could not reach the Torn API. Check your internet connection and try again.');
    } else {
      showError(`Something went wrong: ${err.message}`);
    }
  } finally {
    setLoading(false);
  }
});

// --- Show / hide the API key ---
el.toggleKey.addEventListener('click', () => {
  const showing = el.keyInput.type === 'text';
  el.keyInput.type = showing ? 'password' : 'text';
  el.toggleKey.querySelector('i').className = showing
    ? 'fa-solid fa-eye'
    : 'fa-solid fa-eye-slash';
  el.keyInput.focus();
});

// --- Refresh stats from the dashboard (single GET request again) ---
el.refreshBtn.addEventListener('click', async () => {
  if (!currentApiKey || el.refreshBtn.disabled) return;
  clearError(el.dashError);
  el.refreshBtn.disabled = true;
  el.refreshBtn.classList.add('is-loading');
  try {
    const data = await fetchStats(currentApiKey);
    renderDashboard(data);
  } catch (err) {
    const msg = err.isApiError
      ? friendlyApiError(err)
      : err.message === 'network'
      ? 'Could not reach the Torn API. Check your connection and try again.'
      : `Refresh failed: ${err.message}`;
    showError(msg, el.dashError);
  } finally {
    el.refreshBtn.disabled = false;
    el.refreshBtn.classList.remove('is-loading');
  }
});

// --- Log out: wipe the key, drop realtime, and return to the landing view ---
el.logoutBtn.addEventListener('click', () => {
  unsubscribeRealtime();
  currentApiKey = '';
  lastFetch = { source: null, hash: null };
  for (const k in lastValues) delete lastValues[k]; // reset animation baselines
  clearError();
  clearError(el.dashError);
  el.keyInput.value = '';
  el.keyInput.type = 'password';
  el.toggleKey.querySelector('i').className = 'fa-solid fa-eye';
  showView('landing');
  el.keyInput.focus();
});
