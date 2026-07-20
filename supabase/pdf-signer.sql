-- PDF Signer / e-signature workflow schema.
--
-- This makes Supabase the single source of truth for PDF documents, reusable
-- templates, signer recipients, field placements/values, and the full audit log.
-- Original and signed PDFs live in the `pdf-documents` Storage bucket; only
-- metadata, field definitions, and event history live in Postgres.
--
-- Run this in the Supabase SQL editor for your project. It is idempotent and
-- safe to re-run.

-- ---------------------------------------------------------------------------
-- Updated-at trigger function (shared by other CRM tables).
-- Reuse the existing function if it is already present; otherwise create it.
-- This avoids replacing a live production helper that other modules may depend on.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    execute $func$
      create function public.set_updated_at()
      returns trigger
      language plpgsql
      security invoker
      set search_path = ''
      as $inner$
      begin
        new.updated_at = now();
        return new;
      end;
      $inner$;
    $func$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- pdf_templates: reusable templates with a base PDF and field definitions.
-- Field arrays live in `payload` so the drag-and-drop editor can evolve
-- without constant schema migrations.
-- ---------------------------------------------------------------------------
create table if not exists public.pdf_templates (
  id text primary key,
  name text not null,
  description text,
  pdf_path text,                         -- Storage path for the base PDF
  created_by text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pdf_templates_created_by_idx on public.pdf_templates (created_by);
create index if not exists pdf_templates_updated_at_idx on public.pdf_templates (updated_at desc);

create or replace trigger pdf_templates_set_updated_at
  before update on public.pdf_templates
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pdf_documents: each signing request (contract, proposal, warranty, etc.).
-- Status lifecycle: Draft -> Sent -> Viewed -> Partially Completed -> Completed
--                 (or Declined / Expired / Voided).
-- ---------------------------------------------------------------------------
create table if not exists public.pdf_documents (
  id text primary key,
  template_id text references public.pdf_templates(id) on delete set null,
  status text not null default 'Draft'
    check (status in ('Draft','Sent','Viewed','Partially Completed','Completed','Declined','Expired','Voided')),
  title text not null default '',
  customer_id text,                      -- References customer_records.id (loose text ref to avoid locking existing tables)
  job_id text,                           -- References jobs.id (loose text ref to avoid locking existing tables)
  created_by text,
  original_pdf_path text not null,       -- Storage path of the uploaded PDF
  signed_pdf_path text,                  -- Storage path of the flattened final PDF
  completed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pdf_documents_customer_id_idx on public.pdf_documents (customer_id);
create index if not exists pdf_documents_job_id_idx on public.pdf_documents (job_id);
create index if not exists pdf_documents_status_idx on public.pdf_documents (status);
create index if not exists pdf_documents_updated_at_idx on public.pdf_documents (updated_at desc);

create or replace trigger pdf_documents_set_updated_at
  before update on public.pdf_documents
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pdf_document_recipients: the signers assigned to a document.
-- Each recipient gets an unguessable token used in the public signing link
-- (/sign/{token}). The token is the only thing a customer needs to access
-- their assigned fields.
-- ---------------------------------------------------------------------------
create table if not exists public.pdf_document_recipients (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.pdf_documents(id) on delete cascade,
  role text not null
    check (role in ('Customer','Sales Rep','Office','Manager')),
  label text,                             -- e.g. "Customer 1", "Manager"
  name text,
  email text,
  phone text,
  token text not null unique default gen_random_uuid()::text,
  token_expires_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','viewed','partially_completed','completed','declined','expired')),
  opened_at timestamptz,
  signed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pdf_document_recipients_document_id_idx on public.pdf_document_recipients (document_id);
create index if not exists pdf_document_recipients_token_idx on public.pdf_document_recipients (token);

create or replace trigger pdf_document_recipients_set_updated_at
  before update on public.pdf_document_recipients
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pdf_document_fields: one row per placed field (signature, text, date, etc.).
-- Coordinates are in PDF points relative to the page origin.
-- The value column stores the filled value; signatures/initials store a
-- Storage path to the PNG image drawn by the signer.
-- ---------------------------------------------------------------------------
create table if not exists public.pdf_document_fields (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.pdf_documents(id) on delete cascade,
  recipient_id uuid references public.pdf_document_recipients(id) on delete set null,
  page int not null default 1,
  type text not null,                     -- signature, initials, date, text, full_name, phone, email, address, checkbox, radio, dropdown, label
  label text,                             -- Field label shown to the signer
  placeholder text,
  x numeric not null,
  y numeric not null,
  width numeric not null default 150,
  height numeric not null default 40,
  required boolean not null default true,
  options jsonb default '[]'::jsonb,      -- Options for radio / dropdown / checkbox groups
  value text,                             -- Filled value or Storage path for signature/initials
  filled_at timestamptz,
  filled_by text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pdf_document_fields_document_id_idx on public.pdf_document_fields (document_id);
create index if not exists pdf_document_fields_recipient_id_idx on public.pdf_document_fields (recipient_id);

create or replace trigger pdf_document_fields_set_updated_at
  before update on public.pdf_document_fields
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pdf_document_events: immutable audit trail.
-- Every view, field save, signature, completion, decline, expiry, and void
-- is recorded here with IP address and user agent.
-- ---------------------------------------------------------------------------
create table if not exists public.pdf_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.pdf_documents(id) on delete cascade,
  recipient_id uuid references public.pdf_document_recipients(id) on delete set null,
  event_type text not null,               -- created, sent, viewed, field_filled, signed, completed, declined, expired, voided, reminder_sent, attachment_added, etc.
  actor text,                             -- Signer name/role/admin/system
  ip_address text,
  user_agent text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pdf_document_events_document_id_idx on public.pdf_document_events (document_id, created_at desc);
create index if not exists pdf_document_events_recipient_id_idx on public.pdf_document_events (recipient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security.
-- All reads/writes are done server-side with the service role key, which
-- bypasses RLS. Authenticated CRM users get full access so the admin boards
-- can query documents, templates, recipients, fields, and the audit log.
-- Public signing is handled by API routes that return short-lived signed
-- Storage URLs; the public does not query these tables directly.
-- ---------------------------------------------------------------------------
alter table public.pdf_templates enable row level security;
alter table public.pdf_documents enable row level security;
alter table public.pdf_document_recipients enable row level security;
alter table public.pdf_document_fields enable row level security;
alter table public.pdf_document_events enable row level security;

do $$
declare
  tables text[] := array['pdf_templates','pdf_documents','pdf_document_recipients','pdf_document_fields','pdf_document_events'];
  t text;
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'Authenticated manage ' || t
    ) then
      execute format(
        'create policy "Authenticated manage %1$s" on public.%2$I for all to authenticated using (true) with check (true)',
        t, t
      );
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes to connected CRM clients.
-- ---------------------------------------------------------------------------
do $$
declare
  tables text[] := array['pdf_templates','pdf_documents','pdf_document_recipients','pdf_document_fields','pdf_document_events'];
  t text;
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

alter table public.pdf_templates replica identity full;
alter table public.pdf_documents replica identity full;
alter table public.pdf_document_recipients replica identity full;
alter table public.pdf_document_fields replica identity full;
alter table public.pdf_document_events replica identity full;

-- ---------------------------------------------------------------------------
-- Storage bucket for original and signed PDFs, signature images, and templates.
-- Private bucket: public signing and admin previews are served through
-- short-lived signed URLs generated by the API routes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('pdf-documents', 'pdf-documents', false)
on conflict (id) do update set public = excluded.public, name = excluded.name;

-- No Storage RLS policies are created in this phase. The bucket is private,
-- and all reads/writes are performed by server-side API routes using the
-- service role key, which bypasses RLS. This keeps the migration isolated
-- from existing storage policies and production data.
