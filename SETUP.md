# TornDash — Setup Guide

TornDash works in **two layers**:

1. **The public site (`index.html`)** — 100% client-side. A visitor pastes a Torn
   API key and sees their live stats. This works on its own with **zero setup** —
   including the built-in demo key `dT7je9WiylNjIuyT`.
2. **The admin backend (`admin.html`)** — *optional*. Lets **you** log in and
   add/edit/delete "fake players" (a fake key + a set of stats). Edits show up on
   the public site instantly. This layer needs a free **Supabase** project.

If you skip the Supabase steps, the site still runs fine — the admin page just
shows a "Backend not configured" notice, and only the built-in demo key + real
Torn keys work.

---

## Part A — Run the public site (no backend)

You only need to serve the folder over **http(s)** or **localhost** — *not* by
double-clicking the file. (`file://` blocks the browser's `crypto.subtle` API
that we use to hash keys, and some CDNs.)

Pick any one:

```powershell
# Option 1 — Python (if installed)
python -m http.server 8000

# Option 2 — Node's http-server (if installed)
npx http-server -p 8000
```

Then open <http://localhost:8000/>.

- Try the demo key: `dT7je9WiylNjIuyT`
- Or paste a real Torn **Full Access** key (get one at
  Torn → Settings → API Keys). Real keys go **only** to Torn's official API.

That's it if you don't need the editable backend.

---

## Part B — Enable the admin backend (Supabase)

### 1. Create a Supabase project

1. Go to <https://supabase.com>, sign up (free), and **New project**.
2. Give it a name and a database password, pick a region, and wait ~2 minutes
   for it to provision.

### 2. Create the database tables

1. In your project: **SQL Editor → New query**.
2. Open [`supabase-schema.sql`](supabase-schema.sql) from this folder, copy the
   **entire** contents, paste into the editor, and click **Run**.
3. You should see "Success. No rows returned." This created two tables
   (`fake_players`, `public_player_stats`), the sync trigger, row-level-security
   policies, and enabled realtime.

### 3. Lock down sign-ups (important!)

Any logged-in user can edit players, so make sure **only you** can log in.

1. **Authentication → Providers → Email**.
2. Turn **OFF** "Allow new users to sign up", then save.

> Extra hardening (optional): in `supabase-schema.sql`, the policy
> `"admin manages fake_players"` uses `using (true)`. You can replace that with an
> email allow-list — see the comment right above that policy in the SQL file —
> then re-run just that policy block.

### 4. Create your admin user

You log in on `admin.html` with a **username** (e.g. `admin`). Supabase, though,
identifies users by **email**, so the app maps `admin` → `admin@torndash.app`
automatically. You just need to create that exact email as a Supabase user:

1. **Authentication → Users → Add user → Create new user**.
2. Email: **`admin@torndash.app`**  ·  Password: **`987654321`**
3. Tick **Auto Confirm User** so you can log in immediately, then create.

Then on the login page you type just:

- Username: **`admin`**
- Password: **`987654321`**

> Different username? Use `<name>@torndash.app` as the email in step 2 (the
> domain must be exactly `torndash.app` — it's never emailed, just an internal
> identifier). Or type a full email as the username; anything containing `@` is
> used as-is.
>
> ⚠️ `987654321` is a very weak, widely-breached password. If Supabase has
> **"Prevent use of leaked passwords"** enabled (Authentication → Policies) it may
> reject it — either pick a stronger password or turn that check off for this
> prototype. For anything real, use a strong password.

### 5. Paste your keys into `config.js`

1. In Supabase: **Project Settings → API**.
2. Copy the **Project URL** and the **anon / public** key (the *public* one — it
   is safe in client-side code; it is **not** the `service_role` secret).
3. Open [`config.js`](config.js) and fill them in:

   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOi...your-anon-key...',
   };
   ```

> ⚠️ Never paste the `service_role` key here — that key bypasses all security and
> would be exposed to every visitor.

### 6. Use it

1. Re-serve the folder over http(s)/localhost (see Part A) and open
   <http://localhost:8000/admin.html>.
2. Log in with the admin user from step 4 (username `admin`, password
   `987654321`).
3. **Add player** → give it a label, a fake API key (what users will type, e.g.
   `DEMO-bighitter`), and the stat values → **Save**.
4. On the public site (`index.html`), enter that fake key. You'll see the stats
   you entered. Leave that tab open and edit the player in the admin — the public
   dashboard updates **live**, no refresh needed.

---

## How the security promise is kept

The original requirement: *the API key must never be sent to or stored on any
external server.* Still true:

- **Real Torn keys** are sent **only** to `api.torn.com` over HTTPS.
- For fake-player lookups, the site sends Supabase only a **SHA-256 hash** of the
  entered key — never the raw text. So even if someone types a real Torn key, its
  plaintext never reaches Supabase.
- The **public** table (`public_player_stats`) that anonymous visitors can read
  holds only hashes + stats — **no plaintext keys, no labels**. Your plaintext
  fake keys live in `fake_players`, which is readable only by a logged-in admin.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Admin page says "Backend not configured" | `config.js` still has the `YOUR-...` placeholders, or the file didn't load. Fill in real values and hard-refresh. |
| "Cannot hash the key" error | You opened the page as a `file://`. Serve it over http(s)/localhost instead (Part A). |
| Can't log in / "Invalid login credentials" | The user doesn't exist or isn't confirmed. Re-check step 4 (Add user + Auto Confirm). |
| A new sign-up worked from the site | You didn't disable public sign-ups (step 3). |
| Fake stats don't appear on the site | Confirm the schema ran (step 2) and that the key you typed exactly matches the fake key you saved (it's case-sensitive). |
| Live updates don't push | Realtime is enabled by the schema. Make sure the browser tab stayed on the dashboard for that key, and that `supabase-schema.sql` ran fully (section 5). |

---

## File reference

| File | Purpose |
| --- | --- |
| `index.html`, `app.js` | The public stats dashboard |
| `admin.html`, `admin.js` | The admin editor (needs Supabase) |
| `styles.css` | Shared styling for both |
| `config.js` | **You edit this** — your Supabase URL + anon key |
| `supabase-client.js` | Sets up the Supabase client + the SHA-256 helper |
| `supabase-schema.sql` | **Run once** in Supabase to create tables/triggers/policies |
