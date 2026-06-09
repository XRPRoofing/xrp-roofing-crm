-- Public folder sharing for the Files module.
-- Stores a secure share token -> job folder mapping so customers can view a
-- job's photo gallery without CRM access. Safe to re-run (idempotent).

create table if not exists public.folder_shares (
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

create or replace trigger folder_shares_set_updated_at
  before update on public.folder_shares
  for each row
  execute function public.set_updated_at();

alter table public.folder_shares enable row level security;

-- Reads/writes happen server-side with the service role (which bypasses RLS),
-- so no anon policies are exposed. Authenticated CRM users may also manage rows.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='folder_shares' and policyname='Authenticated manage folder_shares') then
    create policy "Authenticated manage folder_shares" on public.folder_shares for all to authenticated using (true) with check (true);
  end if;
end;
$$;
