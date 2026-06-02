create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_endpoint_idx on public.push_subscriptions (endpoint);
create index if not exists push_subscriptions_updated_at_idx on public.push_subscriptions (updated_at desc);

alter table public.push_subscriptions enable row level security;

create policy "Allow insert push subscriptions"
  on public.push_subscriptions
  for insert
  with check (true);

create policy "Allow update push subscriptions"
  on public.push_subscriptions
  for update
  using (true)
  with check (true);

create policy "Allow read push subscriptions"
  on public.push_subscriptions
  for select
  using (true);
