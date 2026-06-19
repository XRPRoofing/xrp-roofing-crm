import { NextRequest, NextResponse } from "next/server";
import { normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { ensureCustomerFromLeadServer } from "@/lib/customers/ensure-server";
import { getLeadSourceForNumber } from "@/lib/twilio/numbers";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const event = normalizeTwilioWebhookEvent("incoming_sms", formData);

  await publishConversationEvent(event);
  // Inbound SMS = a lead. Auto-create/update the customer (best-effort).
  try {
    const source = getLeadSourceForNumber(event.to || "", "Inbound SMS");
    await ensureCustomerFromLeadServer({ name: event.from, phone: event.from, status: "New lead", source });
  } catch {}

  return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
