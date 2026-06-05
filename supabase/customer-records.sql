-- Customer records device-sync schema.
--
-- Makes Supabase the shared source of truth for manually-added / edited
-- Customer records so they stay consistent across every device (computer,
-- laptop, phone) instead of living in each browser's localStorage. The
-- Customers board (/crm/customers) reads/writes through /api/customers (service
-- role) and subscribes to realtime so changes on one device appear on the
-- others without a refresh.
--
-- Run this in the Supabase SQL editor for your project. It is idempotent and
-- safe to re-run.

-- ---------------------------------------------------------------------------
-- customer_records: one row per customer. `payload` holds the full Customer
-- object (name, email, phone, address, roof/insurance details, status, value).
-- ---------------------------------------------------------------------------
create table if not exists public.customer_records (
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

create or replace trigger customer_records_set_updated_at
  before update on public.customer_records
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security. Writes happen server-side with the service role (bypasses
-- RLS). Authenticated CRM users need SELECT so realtime can deliver updates.
-- ---------------------------------------------------------------------------
alter table public.customer_records enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_records'
      and policyname = 'Authenticated manage customer_records'
  ) then
    create policy "Authenticated manage customer_records"
      on public.customer_records
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
      and tablename = 'customer_records'
  ) then
    alter publication supabase_realtime add table public.customer_records;
  end if;
end;
$$;

-- Ensure UPDATE/DELETE payloads include the full row for realtime consumers.
alter table public.customer_records replica identity full;
