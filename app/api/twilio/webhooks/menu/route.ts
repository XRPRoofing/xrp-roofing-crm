import { NextRequest, NextResponse, after } from "next/server";
import { buildIvrMenuTwiml, buildRoutingStepTwiml, fetchOnlineAgents, ivrDepartmentSay, normalizeTwilioWebhookEvent, resolveCallStatusCallbackUrl, resolveIvrDepartment } from "@/lib/twilio/server";
import { getCallRoutingForOption } from "@/lib/twilio/routing-server";
import { routeStepUrlFor } from "@/lib/twilio/routing-urls";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { sendIncomingCallPushNotification } from "@/lib/push-notifications";

const XML_HEADERS = { "Content-Type": "text/xml" };

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const digit = formData.get("Digits")?.toString() || "";

  const origin = req.nextUrl.origin;
  const statusCallbackUrl = resolveCallStatusCallbackUrl(origin);
  const actionCallbackUrl = new URL("/api/twilio/webhooks/call-ended", origin).toString();
  const greetingRedirect = new URL("/api/twilio/webhooks/incoming-call", origin);
  greetingRedirect.searchParams.set("attempt", "1");
  const greetingRedirectUrl = greetingRedirect.toString();
  const queueHoldUrl = new URL("/api/twilio/webhooks/queue-hold", origin).toString();

  const callerNumber = formData.get("From")?.toString() || "";
  const onlineAgents = await fetchOnlineAgents();

  // Configurable step-based routing: if this option has a saved sequence, ring
  // its steps one after another (failover). If no config exists, fall back to
  // the existing simultaneous-ring behavior — so a missing config never breaks
  // inbound calls.
  const dept = resolveIvrDepartment(digit);
  const routingSteps = dept ? await getCallRoutingForOption(digit) : [];

  console.log(
    `[call-trace] IVR option selected | callSid=${formData.get("CallSid") || ""} | from=${callerNumber} | digit="${digit}" | department=${dept?.label ?? "invalid/none"} | routingConfigured=${routingSteps.length > 0} | onlineAgents=[${onlineAgents.agents.join(",")}]`,
  );

  let twiml: string;
  let department: string | null;
  if (dept && routingSteps.length > 0) {
    twiml = buildRoutingStepTwiml({
      steps: routingSteps,
      option: digit,
      stepIndex: 0,
      statusCallbackUrl,
      nextStepUrlFor: (option, stepIndex) => routeStepUrlFor(origin, option, stepIndex),
      finalNoAnswerUrl: actionCallbackUrl,
      agentStatus: onlineAgents,
      callerNumber,
      sayText: ivrDepartmentSay(dept.label),
    });
    department = dept.label;
  } else {
    ({ twiml, department } = buildIvrMenuTwiml(digit, statusCallbackUrl, actionCallbackUrl, greetingRedirectUrl, onlineAgents, queueHoldUrl, callerNumber));
  }

  if (department) {
    after(async () => {
      const event = normalizeTwilioWebhookEvent("call_status", formData);

      const results = await Promise.allSettled([
        sendIncomingCallPushNotification(event.from),
        publishConversationEvent({
          ...event,
          id: `${event.callSid}-ivr-${department}`,
          type: "call_status",
          status: "ivr-routed",
          body: `IVR: caller selected ${department}`,
          payload: { ...event.payload, ivrSelection: digit, ivrDepartment: department },
        }),
      ]);

      const [pushResult, convResult] = results;
      if (pushResult.status === "fulfilled" && pushResult.value.sent === 0 && pushResult.value.reason) {
        console.warn("[menu] push notification skipped:", pushResult.value.reason);
      }
      if (pushResult.status === "rejected") console.error("[menu] push failed:", pushResult.reason);
      if (convResult.status === "rejected") console.error("[menu] publishConversationEvent failed:", convResult.reason);
    });
  }

  return new NextResponse(twiml, { headers: XML_HEADERS });
}
