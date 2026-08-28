-- =========================================================================
-- TornDash — Supabase schema
-- Run this once in your Supabase project:  Dashboard → SQL Editor → New query
-- → paste all of this → Run.
--
-- Design:
--   • fake_players        — private source of truth (admin-only). Holds the
--                           PLAINTEXT fake key (so you can copy/share it),
--                           a label, and every stat.
--   • public_player_stats — public, read-only projection. Contains ONLY the
--                           SHA-256 hash of the key + the stats (no plaintext
--                           key, no label). This is what the website reads.
--   • A trigger keeps the projection in sync automatically.
--
-- Why the split? The website looks players up by the *hash* of the entered
-- key, so a real Torn key typed on the site is never revealed to Supabase,
-- and nobody browsing the public table can read your plaintext demo keys.
-- =========================================================================

-- ---------- 1. Tables ----------------------------------------------------

create table if not exists public.fake_players (
  id             uuid primary key default gen_random_uuid(),
  label          text,                       -- your own reference name
  api_key        text not null unique,       -- the fake key (plaintext)
  key_hash       text not null unique,       -- sha256(api_key), lowercase hex
  energy_current bigint not null default 0,
  energy_maximum bigint not null default 0,
  life_current   bigint not null default 0,
  life_maximum   bigint not null default 0,
  money_onhand   bigint not null default 0,
  networth_total bigint not null default 0,
  strength       bigint not null default 0,
  defense        bigint not null default 0,
  speed          bigint not null default 0,
  dexterity      bigint not null default 0,
  manual_labor   bigint not null default 0,
  intelligence   bigint not null default 0,
  endurance      bigint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.public_player_stats (
  key_hash       text primary key,
  energy_current bigint,
  energy_maximum bigint,
  life_current   bigint,
  life_maximum   bigint,
  money_onhand   bigint,
  networth_total bigint,
  strength       bigint,
  defense        bigint,
  speed          bigint,
  dexterity      bigint,
  manual_labor   bigint,
  intelligence   bigint,
  endurance      bigint,
  updated_at     timestamptz not null default now()
);

-- ---------- 2. Keep the public projection in sync ------------------------

create or replace function public.sync_public_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    delete from public.public_player_stats where key_hash = old.key_hash;
    return old;
  end if;

  -- If the key (hash) changed on update, drop the stale projection row.
  if (tg_op = 'UPDATE' and old.key_hash is distinct from new.key_hash) then
    delete from public.public_player_stats where key_hash = old.key_hash;
  end if;

  insert into public.public_player_stats (
    key_hash, energy_current, energy_maximum, life_current, life_maximum,
    money_onhand, networth_total, strength, defense, speed, dexterity,
    manual_labor, intelligence, endurance, updated_at
  ) values (
    new.key_hash, new.energy_current, new.energy_maximum, new.life_current, new.life_maximum,
    new.money_onhand, new.networth_total, new.strength, new.defense, new.speed, new.dexterity,
    new.manual_labor, new.intelligence, new.endurance, now()
  )
  on conflict (key_hash) do update set
    energy_current = excluded.energy_current,
    energy_maximum = excluded.energy_maximum,
    life_current   = excluded.life_current,
    life_maximum   = excluded.life_maximum,
    money_onhand   = excluded.money_onhand,
    networth_total = excluded.networth_total,
    strength       = excluded.strength,
    defense        = excluded.defense,
    speed          = excluded.speed,
    dexterity      = excluded.dexterity,
    manual_labor   = excluded.manual_labor,
    intelligence   = excluded.intelligence,
    endurance      = excluded.endurance,
    updated_at     = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_public_stats on public.fake_players;
create trigger trg_sync_public_stats
after insert or update or delete on public.fake_players
for each row execute function public.sync_public_stats();

-- Auto-touch updated_at on the source table.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_fake_players on public.fake_players;
create trigger trg_touch_fake_players
before update on public.fake_players
for each row execute function public.touch_updated_at();

-- ---------- 3. Row Level Security ---------------------------------------

alter table public.fake_players        enable row level security;
alter table public.public_player_stats enable row level security;

-- Any LOGGED-IN user is treated as an admin and may manage the source table.
-- ⚠️  IMPORTANT: turn OFF public sign-ups (Authentication → Providers → Email →
--     "Allow new users to sign up") so only the accounts YOU create can log in.
--     For extra safety, replace `using (true)` below with an email allow-list:
--       using ( (auth.jwt() ->> 'email') = 'you@example.com' )
drop policy if exists "admin manages fake_players" on public.fake_players;
create policy "admin manages fake_players"
  on public.fake_players
  for all
  to authenticated
  using (true)
  with check (true);

-- The public projection is world-readable (it contains no secrets).
drop policy if exists "anyone reads public stats" on public.public_player_stats;
create policy "anyone reads public stats"
  on public.public_player_stats
  for select
  to anon, authenticated
  using (true);

-- ---------- 4. Grants ----------------------------------------------------

grant select                         on public.public_player_stats to anon, authenticated;
grant select, insert, update, delete on public.fake_players        to authenticated;

-- ---------- 5. Realtime --------------------------------------------------
-- Let the website receive live UPDATE/INSERT/DELETE events for a player row.

alter table public.public_player_stats replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'public_player_stats'
  ) then
    alter publication supabase_realtime add table public.public_player_stats;
  end if;
end $$;

-- Done. Next: create your admin user under Authentication → Users → "Add user".
