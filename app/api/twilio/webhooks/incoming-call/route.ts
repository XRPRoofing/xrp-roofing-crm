import { NextRequest, NextResponse, after } from "next/server";
import { buildIvrGreetingTwiml, normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { ensureCustomerFromLeadServer } from "@/lib/customers/ensure-server";
import { isPartnerReferralNumber } from "@/lib/twilio/config";

const XML_HEADERS = { "Content-Type": "text/xml" };

function handleIncomingCall(formData: FormData, req: NextRequest) {
  const origin = req.nextUrl.origin;
  const attempt = parseInt(req.nextUrl.searchParams.get("attempt") || "0", 10) || 0;
  const menuActionUrl = new URL("/api/twilio/webhooks/menu", origin).toString();
  const selfUrl = new URL("/api/twilio/webhooks/incoming-call", origin).toString();
  const twiml = buildIvrGreetingTwiml(menuActionUrl, selfUrl, attempt);

  if (attempt === 0) {
    after(async () => {
      const event = normalizeTwilioWebhookEvent("incoming_call", formData);

      // Only create/find the customer record here — push notifications and
      // conversation events are deferred to the /menu handler so agents are
      // not alerted until the caller completes the IVR selection.
      const toNumber = String(formData.get("To") || "");
      const source = isPartnerReferralNumber(toNumber) ? "Partner Referral" : "Inbound call";
      await ensureCustomerFromLeadServer({
        name: event.from,
        phone: event.from,
        status: "New lead",
        source,
      }).catch((err) => {
        console.error("[incoming-call] ensureCustomer failed:", err);
      });
    });
  }

  return new NextResponse(twiml, { headers: XML_HEADERS });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  return handleIncomingCall(formData, req);
}

export async function GET(req: NextRequest) {
  const formData = new FormData();
  req.nextUrl.searchParams.forEach((value, key) => formData.set(key, value));
  return handleIncomingCall(formData, req);
}
