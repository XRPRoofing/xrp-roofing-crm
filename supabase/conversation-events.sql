create table if not exists public.conversation_events (
  id text primary key,
  type text not null,
  direction text,
  from_phone text,
  to_phone text,
  body text,
  status text,
  call_sid text,
  message_sid text,
  recording_sid text,
  recording_url text,
  conversation_id text,
  customer_id text,
  job_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversation_events_created_at_idx on public.conversation_events (created_at desc);
create index if not exists conversation_events_call_sid_idx on public.conversation_events (call_sid);
create index if not exists conversation_events_message_sid_idx on public.conversation_events (message_sid);
create index if not exists conversation_events_recording_sid_idx on public.conversation_events (recording_sid);
create index if not exists conversation_events_from_phone_idx on public.conversation_events (from_phone);
create index if not exists conversation_events_to_phone_idx on public.conversation_events (to_phone);

alter table public.conversation_events enable row level security;

drop policy if exists "Allow realtime read conversation events" on public.conversation_events;
create policy "Allow realtime read conversation events"
  on public.conversation_events
  for select
  using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_events'
  ) then
    alter publication supabase_realtime add table public.conversation_events;
  end if;
end;
$$;


create table if not exists public.conversation_read_states (
  conversation_id text primary key,
  read_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversation_read_states enable row level security;

drop policy if exists "Allow read conversation read states" on public.conversation_read_states;
create policy "Allow read conversation read states"
  on public.conversation_read_states
  for select
  using (true);

create index if not exists conversation_read_states_updated_at_idx on public.conversation_read_states (updated_at desc);

-- Broadcast read-state changes in real time so opening a conversation on one
-- device immediately marks it Read on every other device.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_read_states'
  ) then
    alter publication supabase_realtime add table public.conversation_read_states;
  end if;
end;
$$;

alter table public.conversation_read_states replica identity full;


alter table public.conversation_events add column if not exists recording_sid text;
create index if not exists conversation_events_recording_sid_idx on public.conversation_events (recording_sid);

-- Performance: index by contact (customer_id) and a composite (type, created_at)
-- so paginated call-history reads and per-contact lookups stay fast as the
-- events table grows.
create index if not exists conversation_events_customer_id_idx on public.conversation_events (customer_id);
create index if not exists conversation_events_type_created_at_idx on public.conversation_events (type, created_at desc);
