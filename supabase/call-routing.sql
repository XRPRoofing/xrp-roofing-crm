-- Configurable inbound IVR call routing (per-option ordered failover steps).
--
-- Additive only: creates ONE new table (public.call_routing) plus its RLS
-- policies. It does not alter, drop, or touch any existing table. Safe to
-- run once and safe to re-run (idempotent). Until rows are added / edited
-- from CRM Settings, the call flow keeps its current behavior (the server
-- falls back to the existing simultaneous ring when no steps are configured).

create table if not exists public.call_routing (
  -- IVR key the caller presses: '1' | '2' | '3' | '0'
  option text primary key,
  -- Friendly label for the option (display only)
  label text,
  -- Whether step-based routing is active for this option. When false (or when
  -- steps is empty) the call flow uses the current default behavior.
  enabled boolean not null default true,
  -- Ordered failover steps. Each step is one of:
  --   { "type": "ring_group", "seconds": 30, "label": "All Admins" }
  --   { "type": "number", "number": "+16233008097", "seconds": 20, "label": "Customer Service" }
  -- Twilio dials each step for `seconds`; if unanswered it advances to the next.
  steps jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.call_routing enable row level security;

drop policy if exists "Authenticated can read call routing" on public.call_routing;
create policy "Authenticated can read call routing"
  on public.call_routing for select to authenticated using (true);

drop policy if exists "Authenticated can manage call routing" on public.call_routing;
create policy "Authenticated can manage call routing"
  on public.call_routing for all to authenticated
  using (true) with check (true);
