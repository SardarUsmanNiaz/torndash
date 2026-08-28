/* =========================================================================
   TornDash — admin.js
   Login + CRUD for "fake players". Requires Supabase to be configured in
   config.js and the schema from supabase-schema.sql to be applied.

   Security model: any logged-in user may edit (RLS policy `to authenticated`).
   Keep public sign-ups DISABLED in Supabase so only accounts you create work.
   ========================================================================= */
'use strict';

const $ = (id) => document.getElementById(id);

// All numeric stat fields (id suffix === DB column name).
const STAT_FIELDS = [
  'energy_current', 'energy_maximum', 'life_current', 'life_maximum',
  'money_onhand', 'networth_total',
  'strength', 'defense', 'speed', 'dexterity',
  'manual_labor', 'intelligence', 'endurance',
];

// Admin logins use a simple username, mapped to a synthetic email because
// Supabase Auth identifies every user by email. Create a Supabase user whose
// email is <username>@torndash.app (e.g. admin@torndash.app) with your password.
const ADMIN_EMAIL_DOMAIN = 'torndash.app';
const toEmail = (id) => (id.includes('@') ? id : id + '@' + ADMIN_EMAIL_DOMAIN);

const views = {
  notConfigured: $('notConfigured'),
  login: $('adminLogin'),
  app: $('adminApp'),
};

/* ------------------------------------------------------------------ *
 * Small helpers                                                      *
 * ------------------------------------------------------------------ */
function show(view) {
  Object.values(views).forEach((v) => (v.hidden = true));
  view.hidden = false;
}
function showErr(box, msg) { box.textContent = msg; box.hidden = false; }
function clearErr(box) { box.textContent = ''; box.hidden = true; }
function fmt(n) { return Number(n || 0).toLocaleString(); }

function setBtnLoading(btn, loading) {
  const label = btn.querySelector('.btn-label');
  const spinner = btn.querySelector('.spinner');
  btn.disabled = loading;
  if (label) label.hidden = loading;
  if (spinner) spinner.hidden = !loading;
}

/** Read a numeric field, returning 0 for blanks/invalid. */
function numVal(id) {
  const raw = $(id).value.trim();
  if (raw === '') return 0;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* ------------------------------------------------------------------ *
 * Auth                                                               *
 * ------------------------------------------------------------------ */
async function initAuth() {
  const { data } = await window.SB.auth.getSession();
  if (data && data.session) {
    enterApp(data.session);
  } else {
    show(views.login);
  }

  // React to future sign-in / sign-out events.
  window.SB.auth.onAuthStateChange((_event, session) => {
    if (session) enterApp(session);
    else show(views.login);
  });
}

function enterApp(session) {
  const email = (session.user && session.user.email) || '';
  const suffix = '@' + ADMIN_EMAIL_DOMAIN;
  $('adminEmail').textContent =
    email.endsWith(suffix) ? email.slice(0, -suffix.length) : (email || 'Signed in');
  show(views.app);
  loadPlayers();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErr($('loginError'));
  const username = $('email').value.trim();
  const password = $('password').value;
  if (!username || !password) {
    showErr($('loginError'), 'Enter your username and password.');
    return;
  }
  setBtnLoading($('loginBtn'), true);
  const { error } = await window.SB.auth.signInWithPassword({ email: toEmail(username), password });
  setBtnLoading($('loginBtn'), false);
  if (error) {
    showErr($('loginError'), error.message || 'Sign-in failed.');
  } else {
    $('password').value = '';
  }
});

$('signOutBtn').addEventListener('click', async () => {
  await window.SB.auth.signOut();
});

/* ------------------------------------------------------------------ *
 * Load + render the player list                                      *
 * ------------------------------------------------------------------ */
async function loadPlayers() {
  const list = $('playerList');
  clearErr($('adminError'));
  list.innerHTML = '<p class="muted">Loading…</p>';

  const { data, error } = await window.SB
    .from('fake_players')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    list.innerHTML = '';
    showErr($('adminError'), 'Could not load players: ' + error.message);
    return;
  }
  renderList(data || []);
}

function renderList(players) {
  const list = $('playerList');
  if (!players.length) {
    list.innerHTML = '<p class="muted">No fake players yet. Click “Add player” to create one.</p>';
    return;
  }

  list.innerHTML = '';
  players.forEach((p) => {
    const battle = (Number(p.strength) || 0) + (Number(p.defense) || 0) +
                   (Number(p.speed) || 0) + (Number(p.dexterity) || 0);

    const card = document.createElement('article');
    card.className = 'admin-card';
    card.innerHTML = `
      <div class="admin-card-main">
        <div class="admin-card-title">
          <strong>${escapeHtml(p.label || 'Untitled')}</strong>
          <span class="key-chip" title="Fake API key">
            <code>${escapeHtml(p.api_key)}</code>
            <button class="icon-btn copy-btn" type="button" title="Copy key"><i class="fa-solid fa-copy"></i></button>
          </span>
        </div>
        <div class="admin-card-stats">
          <span><i class="fa-solid fa-chart-line"></i> $${fmt(p.networth_total)}</span>
          <span><i class="fa-solid fa-hand-fist"></i> ${fmt(battle)}</span>
          <span><i class="fa-solid fa-bolt"></i> ${fmt(p.energy_current)}/${fmt(p.energy_maximum)}</span>
          <span><i class="fa-solid fa-heart-pulse"></i> ${fmt(p.life_current)}/${fmt(p.life_maximum)}</span>
        </div>
      </div>
      <div class="admin-card-actions">
        <button class="btn btn--ghost edit-btn" type="button"><i class="fa-solid fa-pen"></i><span>Edit</span></button>
        <button class="btn btn--ghost danger del-btn" type="button"><i class="fa-solid fa-trash"></i><span>Delete</span></button>
      </div>`;

    card.querySelector('.copy-btn').addEventListener('click', () => {
      navigator.clipboard?.writeText(p.api_key);
      const i = card.querySelector('.copy-btn i');
      i.className = 'fa-solid fa-check';
      setTimeout(() => (i.className = 'fa-solid fa-copy'), 1200);
    });
    card.querySelector('.edit-btn').addEventListener('click', () => openForm(p));
    card.querySelector('.del-btn').addEventListener('click', () => deletePlayer(p));

    list.appendChild(card);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ *
 * Add / edit modal                                                   *
 * ------------------------------------------------------------------ */
function openForm(player) {
  clearErr($('formError'));
  $('modalTitle').textContent = player ? 'Edit player' : 'Add player';
  $('f_id').value = player ? player.id : '';
  $('f_label').value = player ? (player.label || '') : '';
  $('f_api_key').value = player ? player.api_key : '';
  STAT_FIELDS.forEach((f) => ($('f_' + f).value = player ? (player[f] ?? 0) : 0));
  $('modal').hidden = false;
}
function closeForm() { $('modal').hidden = true; }

$('addBtn').addEventListener('click', () => openForm(null));
$('modalClose').addEventListener('click', closeForm);
$('cancelBtn').addEventListener('click', closeForm);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeForm(); });

$('playerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErr($('formError'));

  const apiKey = $('f_api_key').value.trim();
  if (!apiKey) {
    showErr($('formError'), 'A fake API key is required.');
    return;
  }

  let keyHash;
  try {
    keyHash = await window.sha256Hex(apiKey);
  } catch (err) {
    showErr($('formError'),
      'Cannot hash the key — open this page over http(s) or localhost, not as a file://. See SETUP.md.');
    return;
  }

  const record = { label: $('f_label').value.trim() || null, api_key: apiKey, key_hash: keyHash };
  STAT_FIELDS.forEach((f) => (record[f] = numVal('f_' + f)));

  const id = $('f_id').value;
  setBtnLoading($('saveBtn'), true);

  const query = id
    ? window.SB.from('fake_players').update(record).eq('id', id)
    : window.SB.from('fake_players').insert(record);
  const { error } = await query;

  setBtnLoading($('saveBtn'), false);

  if (error) {
    const dup = error.code === '23505' || /duplicate|unique/i.test(error.message || '');
    showErr($('formError'), dup
      ? 'That API key is already used by another player. Pick a different one.'
      : 'Save failed: ' + error.message);
    return;
  }

  closeForm();
  loadPlayers();
});

async function deletePlayer(player) {
  if (!confirm(`Delete "${player.label || player.api_key}"? This cannot be undone.`)) return;
  clearErr($('adminError'));
  const { error } = await window.SB.from('fake_players').delete().eq('id', player.id);
  if (error) showErr($('adminError'), 'Delete failed: ' + error.message);
  else loadPlayers();
}

/* ------------------------------------------------------------------ *
 * Boot                                                               *
 * ------------------------------------------------------------------ */
if (!window.SB_CONFIGURED || !window.SB) {
  show(views.notConfigured);
} else {
  initAuth().catch((err) => {
    show(views.login);
    showErr($('loginError'), 'Startup error: ' + (err && err.message));
  });
}
