import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTwilioClient } from "@/lib/twilio/server";
import { getTwilioConfig } from "@/lib/twilio/config";
import { publishConversationEvent } from "@/lib/twilio/realtime";

const controlSchema = z.object({
  callSid: z.string().min(1),
  action: z.enum(["end", "hold", "resume", "forward"]),
  forwardTo: z.string().optional(),
  conversationId: z.string().optional(),
});

/**
 * Find the in-progress conference for a given call (conference name: `call-{callSid}`).
 * Returns the conference SID or null.
 */
async function findConference(client: ReturnType<typeof getTwilioClient>, callSid: string) {
  if (!client) return null;
  const confName = `call-${callSid}`;
  const conferences = await client.conferences.list({ friendlyName: confName, status: "in-progress", limit: 1 });
  return conferences[0] || null;
}

/**
 * Find a participant in the conference by label (e.g. "customer" or "agent").
 */
async function findParticipant(client: ReturnType<typeof getTwilioClient>, conferenceSid: string, label: string) {
  if (!client) return null;
  const participants = await client.conferences(conferenceSid).participants.list();
  return participants.find((p) => p.label === label) || null;
}

export async function POST(req: NextRequest) {
  const parsed = controlSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid call control payload" }, { status: 400 });
  }

  const client = getTwilioClient();

  if (!client) {
    return NextResponse.json({ error: "Twilio client could not be created" }, { status: 503 });
  }

  try {
    if (parsed.data.action === "end") {
      const call = await client.calls(parsed.data.callSid).update({ status: "completed" });
      await publishConversationEvent({
        id: crypto.randomUUID(),
        type: "call_status",
        direction: "outbound",
        status: "completed",
        callSid: parsed.data.callSid,
        conversationId: parsed.data.conversationId,
        payload: { sid: call.sid, action: parsed.data.action, status: call.status },
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({ sid: call.sid, status: call.status, action: parsed.data.action });
    }

    if (parsed.data.action === "hold") {
      const conference = await findConference(client, parsed.data.callSid);
      if (!conference) {
        return NextResponse.json({ error: "No active conference found for this call" }, { status: 404 });
      }
      const customer = await findParticipant(client, conference.sid, "customer");
      if (!customer) {
        return NextResponse.json({ error: "Customer participant not found in conference" }, { status: 404 });
      }
      const holdUrl = new URL("/api/twilio/voice/hold-music", req.nextUrl.origin).toString();
      await client.conferences(conference.sid).participants(customer.callSid).update({ hold: true, holdUrl });

      await publishConversationEvent({
        id: crypto.randomUUID(),
        type: "call_status",
        direction: "outbound",
        status: "hold",
        callSid: parsed.data.callSid,
        conversationId: parsed.data.conversationId,
        payload: { action: "hold", conferenceSid: conference.sid },
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({ sid: parsed.data.callSid, status: "held", action: "hold" });
    }

    if (parsed.data.action === "resume") {
      const conference = await findConference(client, parsed.data.callSid);
      if (!conference) {
        return NextResponse.json({ error: "No active conference found for this call" }, { status: 404 });
      }
      const customer = await findParticipant(client, conference.sid, "customer");
      if (!customer) {
        return NextResponse.json({ error: "Customer participant not found in conference" }, { status: 404 });
      }
      await client.conferences(conference.sid).participants(customer.callSid).update({ hold: false });

      await publishConversationEvent({
        id: crypto.randomUUID(),
        type: "call_status",
        direction: "outbound",
        status: "in-progress",
        callSid: parsed.data.callSid,
        conversationId: parsed.data.conversationId,
        payload: { action: "resume", conferenceSid: conference.sid },
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({ sid: parsed.data.callSid, status: "active", action: "resume" });
    }

    if (parsed.data.action === "forward") {
      const forwardTo = parsed.data.forwardTo?.trim();
      const normalizedForwardTo = forwardTo?.startsWith("+") ? `+${forwardTo.slice(1).replace(/\D/g, "")}` : forwardTo?.replace(/\D/g, "");
      if (!normalizedForwardTo || normalizedForwardTo.length < 7) return NextResponse.json({ error: "Enter a valid forwarding number" }, { status: 400 });

      const conference = await findConference(client, parsed.data.callSid);

      if (conference) {
        // Conference-based transfer: add the transfer target to the conference,
        // then remove the agent. Customer stays connected to the new party.
        const config = getTwilioConfig();
        await client.conferences(conference.sid).participants.create({
          to: normalizedForwardTo,
          from: config.phoneNumber,
          endConferenceOnExit: true,
          label: "transfer",
        });
        // Remove the agent from the conference (they're done)
        const agent = await findParticipant(client, conference.sid, "agent");
        if (agent) {
          await client.conferences(conference.sid).participants(agent.callSid).remove();
        }
      } else {
        // Fallback: redirect child call to forward TwiML (non-conference calls)
        const children = await client.calls.list({ parentCallSid: parsed.data.callSid, limit: 1 });
        const url = new URL("/api/twilio/voice/forward", req.nextUrl.origin);
        url.searchParams.set("To", normalizedForwardTo);
        if (children.length > 0 && children[0].status === "in-progress") {
          await client.calls(children[0].sid).update({ url: url.toString(), method: "POST" });
        } else {
          await client.calls(parsed.data.callSid).update({ url: url.toString(), method: "POST" });
        }
      }

      await publishConversationEvent({
        id: crypto.randomUUID(),
        type: "call_status",
        direction: "outbound",
        status: "forwarded",
        callSid: parsed.data.callSid,
        conversationId: parsed.data.conversationId,
        body: `Call forwarded to ${normalizedForwardTo}`,
        payload: { action: "forward", forwardTo: normalizedForwardTo },
        createdAt: new Date().toISOString(),
      });

      return NextResponse.json({ sid: parsed.data.callSid, status: "forwarded", action: "forward" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to control call";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
