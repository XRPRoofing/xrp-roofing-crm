#!/usr/bin/env node
/**
 * One-time migration: move existing crew job photos that are stored as base64
 * `data:` URLs in `job_photos.data_url` into the `job-photos` Storage bucket,
 * replacing each row's `data_url` with the bucket's public URL.
 *
 * Rows whose `data_url` is already an http(s) URL are skipped, so this is safe
 * to re-run. Run supabase/job-photos-storage.sql first to create the bucket.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-photos-to-storage.mjs
 *
 * (NEXT_PUBLIC_SUPABASE_URL is also accepted for the URL.)
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "job-photos";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function main() {
  console.log("Fetching job_photos rows...");
  const { data: rows, error } = await supabase
    .from("job_photos")
    .select("id, job_id, photo_type, data_url")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to read job_photos:", error.message);
    process.exit(1);
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows || []) {
    const value = row.data_url || "";
    if (!value.startsWith("data:")) {
      skipped += 1;
      continue;
    }
    const parsed = dataUrlToBuffer(value);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    const ext = (parsed.mime.split("/")[1] || "jpg").split("+")[0];
    const safeType = String(row.photo_type || "photo").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const path = `${row.job_id}/${safeType}-${row.id}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, parsed.buffer, { contentType: parsed.mime, upsert: true });
    if (uploadError) {
      console.error(`  upload failed for ${row.id}: ${uploadError.message}`);
      failed += 1;
      continue;
    }
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const { error: updateError } = await supabase
      .from("job_photos")
      .update({ data_url: pub.publicUrl })
      .eq("id", row.id);
    if (updateError) {
      console.error(`  row update failed for ${row.id}: ${updateError.message}`);
      failed += 1;
      continue;
    }
    migrated += 1;
    if (migrated % 25 === 0) console.log(`  migrated ${migrated}...`);
  }

  console.log(`Done. migrated=${migrated} skipped=${skipped} failed=${failed} total=${(rows || []).length}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
