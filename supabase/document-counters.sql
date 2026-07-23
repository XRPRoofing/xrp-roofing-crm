-- Atomic document numbering for proposals/estimates + invoices.
--
-- WHY: numbers were allocated in each browser's localStorage (non-atomic), so
-- two devices creating at the same moment could mint the SAME number, and there
-- was no database guard. This adds a single source of truth that hands out the
-- next number atomically, so concurrent creates always get distinct, sequential
-- numbers.
--
-- SAFE TO RUN ON PRODUCTION: this is ADDITIVE ONLY. It creates one small table
-- and one function. It does NOT read, alter, delete, or renumber any existing
-- proposal, invoice, payment, or customer row. It is idempotent (safe to re-run).
--
-- Run this in the Supabase SQL editor for your project.

-- ---------------------------------------------------------------------------
-- document_counters: one row per logical sequence. `value` is the last number
-- that was handed out. The shared proposal+invoice sequence uses key
-- 'unified'. `value` starts unset and is seeded on first allocation from the
-- current max of existing documents (passed in by the server), so live numbers
-- are never reused or rewound.
-- ---------------------------------------------------------------------------
create table if not exists public.document_counters (
  key text primary key,
  value bigint not null,
  updated_at timestamptz not null default now()
);

-- Reuse the shared updated_at trigger helper if present; define if missing.
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

drop trigger if exists document_counters_set_updated_at on public.document_counters;
create trigger document_counters_set_updated_at
  before update on public.document_counters
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- next_document_number(p_key, p_seed): atomically allocate and return the next
-- number for a sequence.
--   * First call for a key initializes the counter to p_seed (the current max
--     free number the server computed from existing docs) and returns it.
--   * Subsequent calls return greatest(stored+1, p_seed) so the sequence always
--     moves forward and never dips below a freshly observed max.
-- The single UPSERT is atomic (row-locked on conflict), so simultaneous callers
-- can never receive the same number.
-- ---------------------------------------------------------------------------
create or replace function public.next_document_number(p_key text, p_seed bigint default 1)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result bigint;
begin
  insert into public.document_counters (key, value)
  values (p_key, greatest(p_seed, 1))
  on conflict (key) do update
    set value = greatest(public.document_counters.value + 1, excluded.value)
  returning value into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security. Only the server (service role, which bypasses RLS) writes
-- here; authenticated users get read access for transparency. The function runs
-- as the caller (security invoker) and is granted to the service role.
-- ---------------------------------------------------------------------------
alter table public.document_counters enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'document_counters'
      and policyname = 'Authenticated read document_counters'
  ) then
    create policy "Authenticated read document_counters"
      on public.document_counters
      for select
      to authenticated
      using (true);
  end if;
end;
$$;

grant execute on function public.next_document_number(text, bigint) to service_role;
