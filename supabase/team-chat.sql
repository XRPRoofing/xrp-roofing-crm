create table if not exists public.team_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null default 'general',
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  user_avatar_url text,
  message text not null check (char_length(message) > 0 and char_length(message) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists team_chat_messages_room_created_at_idx on public.team_chat_messages (room_id, created_at);

alter table public.team_chat_messages enable row level security;

create policy "Authenticated users can read general chat messages"
  on public.team_chat_messages
  for select
  to authenticated
  using (room_id = 'general');

create policy "Authenticated users can send general chat messages"
  on public.team_chat_messages
  for insert
  to authenticated
  with check (room_id = 'general' and user_id = auth.uid());
