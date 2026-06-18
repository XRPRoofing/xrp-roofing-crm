import { NextRequest, NextResponse, after } from "next/server";
import { buildIvrGreetingTwiml, normalizeTwilioWebhookEvent } from "@/lib/twilio/server";
import { ensureCustomerFromLeadServer } from "@/lib/customers/ensure-server";

const XML_HEADERS = { "Content-Type": "text/xml" };

function handleIncomingCall(formData: FormData, origin: string) {
  const menuActionUrl = new URL("/api/twilio/webhooks/menu", origin).toString();
  const selfUrl = new URL("/api/twilio/webhooks/incoming-call", origin).toString();
  const twiml = buildIvrGreetingTwiml(menuActionUrl, selfUrl);

  after(async () => {
    const event = normalizeTwilioWebhookEvent("incoming_call", formData);

    // Only create/find the customer record here — push notifications and
    // conversation events are deferred to the /menu handler so agents are
    // not alerted until the caller completes the IVR selection.
    await ensureCustomerFromLeadServer({
      name: event.from,
      phone: event.from,
      status: "New lead",
      source: "Inbound call",
    }).catch((err) => {
      console.error("[incoming-call] ensureCustomer failed:", err);
    });
  });

  return new NextResponse(twiml, { headers: XML_HEADERS });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  return handleIncomingCall(formData, req.nextUrl.origin);
}

export async function GET(req: NextRequest) {
  const formData = new FormData();
  req.nextUrl.searchParams.forEach((value, key) => formData.set(key, value));
  return handleIncomingCall(formData, req.nextUrl.origin);
}
