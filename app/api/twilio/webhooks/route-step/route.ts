import { NextRequest, NextResponse } from "next/server";
import { buildRoutingStepTwiml, resolveCallStatusCallbackUrl, resolveInboundAgents } from "@/lib/twilio/server";
import { getCallRoutingForOption } from "@/lib/twilio/routing-server";
import { routeStepUrlFor } from "@/lib/twilio/routing-urls";

const XML_HEADERS = { "Content-Type": "text/xml" };
const HANGUP_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>';

// Advances a configured inbound routing sequence. Twilio calls this as the
// `action` of a step's <Dial>. If the previous step was answered we hang up;
// otherwise we ring the next step. When the sequence is exhausted we route to
// the same "no answer" ending used elsewhere (call-ended logs it + hangs up).
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const origin = req.nextUrl.origin;
  const option = req.nextUrl.searchParams.get("option") || "";
  const stepIndex = parseInt(req.nextUrl.searchParams.get("step") || "0", 10) || 0;

  const dialStatus = String(formData.get("DialCallStatus") || "").toLowerCase();
  // Someone answered (and the bridged call has now ended) — nothing left to do.
  if (dialStatus === "completed" || dialStatus === "answered") {
    return new NextResponse(HANGUP_TWIML, { headers: XML_HEADERS });
  }

  const statusCallbackUrl = resolveCallStatusCallbackUrl(origin);
  const finalNoAnswerUrl = new URL("/api/twilio/webhooks/call-ended", origin).toString();
  const callerNumber = formData.get("From")?.toString() || "";

  const steps = await getCallRoutingForOption(option);
  const { status: onlineAgents, shouldQueue } = await resolveInboundAgents();
  const queue = shouldQueue
    ? {
        waitUrl: new URL("/api/twilio/webhooks/queue-wait", origin).toString(),
        actionUrl: new URL("/api/twilio/webhooks/queue-action", origin).toString(),
      }
    : undefined;

  const twiml = buildRoutingStepTwiml({
    steps,
    option,
    stepIndex,
    statusCallbackUrl,
    nextStepUrlFor: (opt, idx) => routeStepUrlFor(origin, opt, idx),
    finalNoAnswerUrl,
    agentStatus: onlineAgents,
    callerNumber,
    queue,
  });

  return new NextResponse(twiml, { headers: XML_HEADERS });
}
