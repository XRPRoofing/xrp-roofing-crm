-- Agent presence + profiles
-- ---------------------------------------------------------------------------
-- Restores multi-admin inbound ringing. The inbound <Dial> fans out to every
-- admin's per-user Voice identity (`agent-<user_id>`), which requires two
-- tables that were referenced in code but never created:
--   * profiles      — one row per auth user, carrying their role. Used by
--                     lib/agent-status-server.ts getAdminAgentIdentities() to
--                     ring every admin-access user's browser.
--   * agent_status  — presence (which agents are currently online). Used by
--                     getOnlineAgentIdentities(). Optional refinement; ringing
--                     still works from profiles alone if presence is stale.
--
-- Run once in the Supabase SQL editor (Database → SQL editor → New query).
-- Safe to re-run: everything is idempotent.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

-- Backfill a profile for every existing auth user, pulling role/name from the
-- user's auth metadata (role defaults to 'admin' when unset — matching the
-- app's getUserRole() default in CrmShell).
insert into public.profiles (id, email, full_name, role)
select
  u.id,
  u.email,
  coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    split_part(coalesce(u.email, ''), '@', 1)
  ),
  coalesce(u.raw_user_meta_data ->> 'role', 'admin')
from auth.users u
on conflict (id) do update set
  email = excluded.email,
  full_name = coalesce(public.profiles.full_name, excluded.full_name),
  role = excluded.role,
  updated_at = now();

-- Keep profiles in sync with auth.users on signup and metadata changes.
create or replace function public.handle_profile_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    coalesce(new.raw_user_meta_data ->> 'role', 'admin')
  )
  on conflict (id) do update set
    email = excluded.email,
    role = excluded.role,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_profile_sync();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function public.handle_profile_sync();

alter table public.profiles enable row level security;

-- Any authenticated user may read profiles (needed so the app can resolve
-- names/roles). The server fan-out uses the service role and bypasses RLS.
drop policy if exists "Authenticated can read profiles" on public.profiles;
create policy "Authenticated can read profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

-- A user may update their own profile row (e.g. full_name).
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- agent_status (presence)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'offline',
  full_name text,
  updated_at timestamptz not null default now()
);

create index if not exists agent_status_status_idx on public.agent_status (status);

alter table public.agent_status enable row level security;

-- Authenticated users may read presence.
drop policy if exists "Authenticated can read agent status" on public.agent_status;
create policy "Authenticated can read agent status"
  on public.agent_status
  for select
  to authenticated
  using (true);

-- A user may upsert their own presence row. (The presence API route also uses
-- the service role, so this policy is a convenience for direct client writes.)
drop policy if exists "Users can upsert own agent status" on public.agent_status;
create policy "Users can upsert own agent status"
  on public.agent_status
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Broadcast presence changes in real time.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_status'
  ) then
    alter publication supabase_realtime add table public.agent_status;
  end if;
end;
$$;

alter table public.agent_status replica identity full;
