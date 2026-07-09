import { getAdminClient } from "@/lib/twilio/realtime";

export const MISSED_CALL_AUTO_TEXT =
  "Hi! Sorry we missed your call at XRP Roofing — we'll get back to you shortly. You can reply right here and we'll help you out. — XRP Roofing";

/**
 * Auto-text a caller once when their inbound call is missed (nobody answered
 * anywhere — softphone, IVR-routed destination, or failover ring group).
 *
 * De-duplicated via an insert-only marker row (`${callSid}-missed-autotext`) so
 * that re-fired webhooks and the two call paths that call this (the direct
 * call-status branch and the IVR/failover call-ended branch) can never send
 * the caller more than one text for the same call.
 *
 * Only fires for a real answered-nowhere inbound call to an external number, so
 * an answered call (which produces a recording / positive dial status) is never
 * texted.
 */
export async function maybeSendMissedCallAutoText(params: {
  callSid: string;
  direction?: "inbound" | "outbound";
  caller?: string;
  line?: string;
  origin: string;
}) {
  const { callSid, direction, caller, line, origin } = params;

  // Only inbound missed calls, and only to a real external phone number.
  if (direction !== "inbound") return;
  if (!callSid || !caller || !caller.startsWith("+") || caller.replace(/\D/g, "").length < 8) return;

  const supabase = getAdminClient();
  if (!supabase) return;

  const markerId = `${callSid}-missed-autotext`;

  // Claim the marker with an insert-only write; if it already exists (duplicate
  // key), another webhook fire already sent the text, so skip.
  const { error: claimError } = await supabase.from("conversation_events").insert({
    id: markerId,
    type: "call_status",
    direction: "inbound",
    from_phone: caller,
    to_phone: line,
    status: "missed-autotext",
    call_sid: callSid,
    body: "Missed-call auto-text queued",
    payload: { missedCallAutoText: true },
    created_at: new Date().toISOString(),
  });

  if (claimError) {
    // Duplicate marker (already handled) or storage issue — either way, do not send.
    return;
  }

  try {
    const res = await fetch(`${origin}/api/twilio/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: caller, from: line, body: MISSED_CALL_AUTO_TEXT }),
    });
    console.log("[missed-call] auto-text sent", { callSid, to: caller, ok: res.ok, status: res.status });
  } catch (error) {
    console.error("[missed-call] auto-text failed", error);
  }
}
