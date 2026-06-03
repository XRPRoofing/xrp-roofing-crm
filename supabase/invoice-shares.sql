-- Invoice sharing + Stripe payment sync schema.
--
-- This makes Supabase the single source of truth for invoice payment status,
-- shared by the public invoice page (/invoice/[id]), the Stripe webhook
-- (/api/stripe/webhook), the view tracker (/api/invoices/track) and the Admin
-- CRM Invoice Board (/crm/invoices). Stripe writes payment results into the
-- `invoice_shares.payload` JSON via the webhook (service role), and every
-- change is broadcast to connected admin clients through the supabase_realtime
-- publication so the board updates without a page refresh.
--
-- Run this in the Supabase SQL editor for your project. It is idempotent and
-- safe to re-run.

-- ---------------------------------------------------------------------------
-- invoice_shares: one row per shared invoice. `payload` holds the full invoice
-- object (line items, payments, status, activity, tracking timestamps).
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_shares (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Keep updated_at fresh on every write.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists invoice_shares_set_updated_at on public.invoice_shares;
create trigger invoice_shares_set_updated_at
  before update on public.invoice_shares
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security.
--   * The Stripe webhook, invoice share API and view tracker use the service
--     role key, which bypasses RLS, so writes always succeed server-side.
--   * Authenticated CRM users (admin board) need SELECT so realtime can deliver
--     payment updates to their browser.
-- ---------------------------------------------------------------------------
alter table public.invoice_shares enable row level security;

drop policy if exists "Authenticated read invoice_shares" on public.invoice_shares;
drop policy if exists "Authenticated write invoice_shares" on public.invoice_shares;

create policy "Authenticated read invoice_shares"
  on public.invoice_shares
  for select
  to authenticated
  using (true);

create policy "Authenticated write invoice_shares"
  on public.invoice_shares
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Realtime: broadcast INSERT/UPDATE/DELETE so the admin board stays in sync.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'invoice_shares'
  ) then
    alter publication supabase_realtime add table public.invoice_shares;
  end if;
end;
$$;

-- Ensure UPDATE/DELETE payloads include the full row for realtime consumers.
alter table public.invoice_shares replica identity full;
