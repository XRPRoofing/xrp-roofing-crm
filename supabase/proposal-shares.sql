-- Proposals / Estimates device-sync schema.
--
-- Makes Supabase the shared source of truth for proposals (a.k.a. estimates) so
-- they stay consistent across every device (computer, laptop, phone) instead of
-- living in each browser's localStorage. The Estimates board (/crm/proposals)
-- reads/writes through /api/proposals (service role) and subscribes to realtime
-- so a change on one device appears on the others without a refresh. The public
-- proposal page (/proposal/[id]) and send flow also write here via
-- /api/proposals/share.
--
-- Run this in the Supabase SQL editor for your project. It is idempotent and
-- safe to re-run.

-- ---------------------------------------------------------------------------
-- proposal_shares: one row per proposal. `payload` holds the full Proposal
-- object (scope, totals, packages, photos, status, signature, deletedAt).
-- ---------------------------------------------------------------------------
create table if not exists public.proposal_shares (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh on every write. security invoker + a pinned empty
-- search_path satisfy Supabase's Security Advisor.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger proposal_shares_set_updated_at
  before update on public.proposal_shares
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security. Writes happen server-side with the service role (bypasses
-- RLS). Authenticated CRM users need SELECT so realtime can deliver updates.
-- The public proposal page reads a single proposal through the service-role API
-- route, so no anon policy is required.
-- ---------------------------------------------------------------------------
alter table public.proposal_shares enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'proposal_shares'
      and policyname = 'Authenticated manage proposal_shares'
  ) then
    create policy "Authenticated manage proposal_shares"
      on public.proposal_shares
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast INSERT/UPDATE/DELETE so every device stays in sync.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'proposal_shares'
  ) then
    alter publication supabase_realtime add table public.proposal_shares;
  end if;
end;
$$;

-- Ensure UPDATE/DELETE payloads include the full row for realtime consumers.
alter table public.proposal_shares replica identity full;
