-- Add a durable creation timestamp to customer_records.
--
-- WHY: the Customer Profile's "Date Added" was inferred from the customer id
-- (`C-<epoch-ms>`), which is fragile for imported/legacy records. This adds a
-- real database creation timestamp that becomes the source of truth for
-- "Date Added", while remaining 100% NON-DESTRUCTIVE:
--   * It only ADDS a nullable column — no existing column, payload, id, or row
--     is deleted, merged, or recreated.
--   * The backfill writes ONLY the new created_at column, and ONLY where it is
--     still NULL, deriving the value from the id's embedded epoch-ms
--     (`C-1712345678901`). Rows whose id has no parseable timestamp are left
--     NULL and fall back to the id/other date at display time.
--   * The backfill runs with the updated_at trigger temporarily disabled so it
--     does NOT touch `updated_at`. That preserves the exact value of every
--     existing column AND the Customers list order (sorted by updated_at), so
--     realtime consumers see no spurious "updated" events.
--   * A DEFAULT now() ensures every NEW customer automatically receives an
--     accurate created_at going forward.
--
-- Idempotent: safe to run multiple times (ADD COLUMN IF NOT EXISTS; the backfill
-- only touches rows where created_at IS NULL). Reversible: see the rollback
-- block at the bottom. Runs in a single transaction so a failure rolls back
-- cleanly and the trigger is never left disabled.
--
-- Run in the Supabase SQL editor AFTER taking a backup / snapshot of the
-- project (Dashboard → Database → Backups, or `pg_dump`).

begin;

-- 1) Add the column (nullable, no default yet so the backfill can distinguish
--    "not yet backfilled" from "stamped by default").
alter table public.customer_records
  add column if not exists created_at timestamptz;

-- 2) Backfill ONLY missing values, ONLY from the id's embedded epoch-ms, WITHOUT
--    bumping updated_at (disable the BEFORE UPDATE trigger for this statement).
--    `C-1712345678901` or `C-1712345678901-ab12x` -> 2024-04-05T...Z.
alter table public.customer_records disable trigger customer_records_set_updated_at;

update public.customer_records
set created_at = to_timestamp(
      (substring(id from '^C-([0-9]{10,})'))::bigint / 1000.0
    )
where created_at is null
  and id ~ '^C-[0-9]{10,}';

alter table public.customer_records enable trigger customer_records_set_updated_at;

-- 3) From now on, new rows that don't specify created_at get an accurate DB
--    timestamp automatically.
alter table public.customer_records
  alter column created_at set default now();

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK (fully reversible) — run this to undo the change. It only drops the
-- added column; it never touches id, payload, or updated_at.
--
--   alter table public.customer_records alter column created_at drop default;
--   alter table public.customer_records drop column if exists created_at;
-- ---------------------------------------------------------------------------

-- Verification (optional): total must be unchanged; updated_at must be unchanged.
--   SELECT count(*) AS total,
--          count(created_at) AS with_created_at,
--          count(*) FILTER (WHERE created_at IS NULL) AS still_null
--   FROM public.customer_records;
