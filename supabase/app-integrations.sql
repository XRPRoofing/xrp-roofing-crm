-- Shared integration storage (server-side, single-tenant).
-- Used to persist OAuth tokens (e.g. Google Calendar) once so every device
-- — computer and phone — uses the same connection instead of a per-browser
-- cookie. Safe to re-run (idempotent).

create table if not exists public.app_integrations (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

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

create or replace trigger app_integrations_set_updated_at
  before update on public.app_integrations
  for each row
  execute function public.set_updated_at();

alter table public.app_integrations enable row level security;

-- Reads/writes happen server-side with the service role (which bypasses RLS),
-- so no anon policies are exposed. Authenticated CRM users may also manage rows.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_integrations' and policyname='Authenticated manage app_integrations') then
    create policy "Authenticated manage app_integrations" on public.app_integrations for all to authenticated using (true) with check (true);
  end if;
end;
$$;
