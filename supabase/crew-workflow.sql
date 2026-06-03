-- Crew workflow real-time sync schema.
--
-- This makes Supabase the single source of truth shared by the Crew Portal
-- (/crm/crew, /crew) and the Admin CRM (jobs board, files, etc.). Every crew
-- update is written to these tables and broadcast to all connected clients via
-- the supabase_realtime publication, so admins and crew always see identical
-- job data without a page refresh.
--
-- Run this in the Supabase SQL editor for your project. It is idempotent and
-- safe to re-run.

-- ---------------------------------------------------------------------------
-- jobs: single record per job, shared by admin board and crew workflow.
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id text primary key,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  city text not null default '',
  stage text not null default 'new_lead',
  value numeric not null default 0,
  assigned_to text not null default '',
  roof_type text not null default '',
  source text not null default '',
  last_activity text not null default '',
  next_action text not null default '',
  due_date text not null default '',
  -- crew workflow fields
  status text not null default 'Assigned',
  assigned_crew jsonb not null default '[]'::jsonb,
  schedule_date text not null default '',
  job_scope text not null default '',
  job_notes text not null default '',
  completion_notes text not null default '',
  materials_used text not null default '',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- job_photos: one row per uploaded photo (Before / After / Job Photo).
-- ---------------------------------------------------------------------------
create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  photo_type text not null default 'Job Photo' check (photo_type in ('Before', 'After', 'Job Photo')),
  name text not null default '',
  data_url text not null,
  uploaded_by text not null default 'Crew',
  created_at timestamptz not null default now()
);

create index if not exists job_photos_job_id_created_at_idx on public.job_photos (job_id, created_at);

-- ---------------------------------------------------------------------------
-- job_notes: append-only notes feed for a job.
-- ---------------------------------------------------------------------------
create table if not exists public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  author text not null default 'Crew',
  body text not null default '' check (char_length(body) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists job_notes_job_id_created_at_idx on public.job_notes (job_id, created_at);

-- ---------------------------------------------------------------------------
-- job_checklist_items: per-job checklist that crew can complete.
-- ---------------------------------------------------------------------------
create table if not exists public.job_checklist_items (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  label text not null default '',
  done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists job_checklist_items_job_id_position_idx on public.job_checklist_items (job_id, position);

-- ---------------------------------------------------------------------------
-- Keep updated_at fresh on jobs.
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

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: any authenticated CRM user can read/write.
-- ---------------------------------------------------------------------------
alter table public.jobs enable row level security;
alter table public.job_photos enable row level security;
alter table public.job_notes enable row level security;
alter table public.job_checklist_items enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['jobs', 'job_photos', 'job_notes', 'job_checklist_items']
  loop
    execute format('drop policy if exists "Authenticated read %1$s" on public.%1$I', t);
    execute format('drop policy if exists "Authenticated write %1$s" on public.%1$I', t);
    execute format(
      'create policy "Authenticated read %1$s" on public.%1$I for select to authenticated using (true)',
      t
    );
    execute format(
      'create policy "Authenticated write %1$s" on public.%1$I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast INSERT/UPDATE/DELETE on all four tables.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['jobs', 'job_photos', 'job_notes', 'job_checklist_items']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Ensure UPDATE/DELETE payloads include the full previous row for realtime.
alter table public.jobs replica identity full;
alter table public.job_photos replica identity full;
alter table public.job_notes replica identity full;
alter table public.job_checklist_items replica identity full;

-- ---------------------------------------------------------------------------
-- Seed the demo jobs so the board is not empty on first run.
-- ---------------------------------------------------------------------------
insert into public.jobs (id, name, email, phone, address, city, stage, value, assigned_to, roof_type, source, last_activity, next_action, due_date, status, assigned_crew, schedule_date, job_scope, job_notes)
values
  ('L-1001', 'Maria Hernandez', 'maria@example.com', '(602) 555-0181', '2148 E Camelback Rd', 'Phoenix', 'new_lead', 18500, 'Johnny Roofer', 'Tile', 'Website', 'Requested storm inspection', 'Schedule inspection', '2026-06-05', 'Assigned', '["Jonathan"]'::jsonb, '2026-06-05', 'Tile', 'Requested storm inspection'),
  ('L-1002', 'Desert Plaza HOA', 'board@example.com', '(480) 555-0134', '8800 N Scottsdale Rd', 'Scottsdale', 'inspection_scheduled', 72000, 'Johnny Roofer', 'Flat/TPO', 'Referral', 'Inspection booked for Friday', 'Complete inspection', '2026-06-03', 'Assigned', '["Adrian"]'::jsonb, '2026-06-05', 'Flat/TPO', 'Inspection booked for Friday'),
  ('L-1003', 'Ryan Mitchell', 'ryan@example.com', '(623) 555-0199', '944 W Ocotillo Rd', 'Glendale', 'estimate_sent', 24600, 'Johnny Roofer', 'Shingle', 'Google', 'Estimate sent', 'Follow up on estimate', '2026-06-01', 'Assigned', '["Jonathan"]'::jsonb, '2026-06-05', 'Shingle', 'Estimate sent'),
  ('L-1004', 'Sage Medical Center', 'facilities@example.com', '(602) 555-0112', '1201 W Thomas Rd', 'Phoenix', 'waiting_approval', 98000, 'Admin User', 'Commercial Flat', 'Partner', 'Carrier document review', 'Get approval decision', '2026-05-30', 'Assigned', '["Adrian"]'::jsonb, '2026-06-05', 'Commercial Flat', 'Carrier document review'),
  ('L-1005', 'Priya Shah', 'priya@example.com', '(480) 555-0108', '3012 S Dobson Rd', 'Mesa', 'approved', 31800, 'Johnny Roofer', 'Tile Underlayment', 'Instagram', 'Deposit received', 'Schedule install', '2026-06-07', 'Assigned', '["Jonathan"]'::jsonb, '2026-06-05', 'Tile Underlayment', 'Deposit received'),
  ('L-1006', 'Carlos Vega', 'carlos@example.com', '(602) 555-0148', '4119 N 15th Ave', 'Phoenix', 'in_progress', 14200, 'Office Coordinator', 'Repair', 'Website', 'Crew dispatched', 'Confirm crew progress', '2026-05-31', 'In Progress', '["Adrian"]'::jsonb, '2026-06-05', 'Repair', 'Crew dispatched'),
  ('L-1007', 'Sunset Retail Center', 'ops@example.com', '(480) 555-0160', '7707 E Main St', 'Mesa', 'completed', 64500, 'Admin User', 'TPO', 'Repeat Customer', 'Warranty packet uploaded', 'Collect final payment', '2026-06-02', 'Completed', '["Jonathan"]'::jsonb, '2026-06-05', 'TPO', 'Warranty packet uploaded')
on conflict (id) do nothing;
