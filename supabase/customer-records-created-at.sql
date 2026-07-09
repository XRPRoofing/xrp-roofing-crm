-- Add a durable creation timestamp to customer_records.
--
-- WHY: the Customer Profile's "Date Added" was inferred from the customer id
-- (`C-<epoch-ms>`), which is fragile for imported/legacy records. This adds a
-- real database creation timestamp that becomes the source of truth for
-- "Date Added", while remaining 100% NON-DESTRUCTIVE:
--   * It only ADDS a nullable column — no existing column, payload, or row is
--     modified, merged, deleted, or recreated.
--   * The backfill writes ONLY the new created_at column, and ONLY where it is
--     still NULL, deriving the value from the id's embedded epoch-ms
--     (`C-1712345678901`). Rows whose id has no parseable timestamp are left
--     NULL and fall back to the id/other date at display time.
--   * A DEFAULT now() ensures every NEW customer automatically receives an
--     accurate created_at going forward.
--
-- Idempotent: safe to run multiple times. Reversible: see the rollback block at
-- the bottom (commented out).
--
-- Run in the Supabase SQL editor AFTER taking a backup / snapshot of the
-- project (Dashboard → Database → Backups, or `pg_dump`).

-- 1) Add the column (nullable, no default yet so the backfill can distinguish
--    "not yet backfilled" from "stamped by default").
ALTER TABLE public.customer_records
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- 2) Backfill ONLY missing values, ONLY from the id's embedded epoch-ms.
--    `C-1712345678901` or `C-1712345678901-ab12x` → 2024-04-05T…Z.
--    Guards: only ids matching C-<13+ digits>, and only where created_at IS NULL.
UPDATE public.customer_records
SET created_at = to_timestamp(
      (substring(id from '^C-([0-9]{10,})'))::bigint / 1000.0
    )
WHERE created_at IS NULL
  AND id ~ '^C-[0-9]{10,}';

-- 3) From now on, new rows that don't specify created_at get an accurate DB
--    timestamp automatically.
ALTER TABLE public.customer_records
  ALTER COLUMN created_at SET DEFAULT now();

-- ---------------------------------------------------------------------------
-- ROLLBACK (fully reversible) — run this to undo the change. It only drops the
-- added column; it never touches id, payload, or updated_at.
--
--   ALTER TABLE public.customer_records ALTER COLUMN created_at DROP DEFAULT;
--   ALTER TABLE public.customer_records DROP COLUMN IF EXISTS created_at;
-- ---------------------------------------------------------------------------

-- Verification (optional): counts must be unchanged; created_at now populated.
--   SELECT count(*) AS total,
--          count(created_at) AS with_created_at,
--          count(*) FILTER (WHERE created_at IS NULL) AS still_null
--   FROM public.customer_records;
