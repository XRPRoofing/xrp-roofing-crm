import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { getTwilioClient } from "@/lib/twilio/server";
import { findTwilioLine } from "@/lib/twilio/numbers";

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * POST /api/twilio/backfill-sms-bodies
 *
 * One-time migration: finds conversation_events rows where `message_sid` is set
 * but `body` is empty (overwritten by Twilio status callbacks before the fix).
 * Fetches the original message body from the Twilio Messages API and patches
 * each row.  Also fixes direction for rows where it was incorrectly set to
 * "inbound" for outbound messages.
 */
export async function POST() {
  const supabase = getAdminClient();
  const twilioClient = getTwilioClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  if (!twilioClient) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 503 });
  }

  // Find all SMS events with an empty body
  const { data: rows, error } = await supabase
    .from("conversation_events")
    .select("id, message_sid, body, direction, from_phone")
    .not("message_sid", "is", null)
    .neq("message_sid", "")
    .or("body.is.null,body.eq.,body.ilike.SMS sent%,body.ilike.SMS received%");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ updated: 0, message: "No SMS events with empty bodies found" });
  }

  let updated = 0;
  let failed = 0;
  const results: Array<{ id: string; status: string }> = [];

  for (const row of rows) {
    try {
      const msg = await twilioClient.messages(row.message_sid).fetch();
      const updates: Record<string, string> = {};

      if (msg.body && (!row.body || row.body.startsWith("SMS sent") || row.body.startsWith("SMS received"))) {
        updates.body = msg.body;
      }

      // Fix direction if it was incorrectly set to inbound for an outbound message
      const twilioDirection = msg.direction;
      if (twilioDirection && twilioDirection.includes("outbound") && row.direction !== "outbound") {
        updates.direction = "outbound";
      } else if (!twilioDirection || !twilioDirection.includes("outbound")) {
        // Infer from From number
        if (row.from_phone && findTwilioLine(row.from_phone)) {
          updates.direction = "outbound";
        }
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from("conversation_events")
          .update(updates)
          .eq("id", row.id);

        if (updateError) {
          results.push({ id: row.id, status: `error: ${updateError.message}` });
          failed++;
        } else {
          results.push({ id: row.id, status: "updated" });
          updated++;
        }
      } else {
        results.push({ id: row.id, status: "skipped (no changes)" });
      }
    } catch (err) {
      results.push({ id: row.id, status: `fetch error: ${err instanceof Error ? err.message : "unknown"}` });
      failed++;
    }
  }

  return NextResponse.json({ total: rows.length, updated, failed, results });
}
