"use client";

import { createClient } from "@/lib/supabase/client";
import type { TwilioCallNotePayload, TwilioCallPayload, TwilioConversationEvent, TwilioSmsPayload } from "@/types/twilio-conversations";

type VoiceDevice = import("@twilio/voice-sdk").Device;
export type BrowserVoiceDevice = VoiceDevice & {
  updateToken?: (token: string) => void;
};
export type BrowserVoiceCall = {
  accept: () => void;
  disconnect: () => void;
  reject: () => void;
  mute?: (shouldMute: boolean) => void;
  on: (event: "accept" | "disconnect" | "error" | "cancel", handler: (error?: Error) => void) => void;
  parameters?: Record<string, string>;
};

export async function getVoiceToken(identity = "crm-agent") {
  const response = await fetch("/api/twilio/voice/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Unable to create Twilio voice token");
  }

  return response.json() as Promise<{ token: string; identity: string }>;
}

export async function createBrowserVoiceDevice(identity = "crm-agent") {
  const [{ Device }, { token }] = await Promise.all([import("@twilio/voice-sdk"), getVoiceToken(identity)]);
  return new Device(token) as BrowserVoiceDevice;
}

export async function sendSms(payload: TwilioSmsPayload) {
  const response = await fetch("/api/twilio/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Unable to send SMS");
  }

  return response.json() as Promise<{ sid: string; status: string }>;
}

export async function startOutboundCall(payload: TwilioCallPayload) {
  const response = await fetch("/api/twilio/voice/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Unable to start call");
  }

  return response.json() as Promise<{ sid: string; status: string }>;
}

export async function controlCall(payload: { callSid: string; action: "end" | "hold" | "resume" | "forward"; conversationId?: string; forwardTo?: string }) {
  const response = await fetch("/api/twilio/voice/call-control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Unable to control call");
  }

  return response.json() as Promise<{ sid: string; status: string; action: string }>;
}

export async function saveCallNotes(payload: TwilioCallNotePayload) {
  const response = await fetch("/api/twilio/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Unable to save call notes");
  }

  return response.json() as Promise<{ ok: boolean; eventId: string }>;
}

function mapConversationEventRow(row: Record<string, unknown>): TwilioConversationEvent {
  return {
    id: String(row.id),
    type: row.type as TwilioConversationEvent["type"],
    direction: row.direction as TwilioConversationEvent["direction"],
    from: row.from_phone ? String(row.from_phone) : undefined,
    to: row.to_phone ? String(row.to_phone) : undefined,
    body: row.body ? String(row.body) : undefined,
    status: row.status ? String(row.status) : undefined,
    callSid: row.call_sid ? String(row.call_sid) : undefined,
    messageSid: row.message_sid ? String(row.message_sid) : undefined,
    conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
    recordingUrl: row.recording_url ? String(row.recording_url) : row.payload && typeof row.payload === "object" && "recordingUrl" in row.payload ? String((row.payload as Record<string, unknown>).recordingUrl) : undefined,
    payload: (row.payload as Record<string, unknown>) || {},
    createdAt: String(row.created_at),
  };
}

export async function listConversationEvents(limit = 250) {
  const response = await fetch(`/api/twilio/events?limit=${limit}`);
  const data = await response.json().catch(() => null) as { events?: TwilioConversationEvent[]; error?: string } | null;

  if (!response.ok || data?.error) throw new Error(data?.error || "Unable to load saved call history");

  return data?.events || [];
}

export function subscribeToConversationEvents(onEvent: (event: TwilioConversationEvent) => void) {
  const supabase = createClient();
  const channel = supabase
    .channel("crm-conversation-events")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "conversation_events" },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        onEvent(mapConversationEventRow(row));
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}


export async function listConversationReadStates() {
  const response = await fetch("/api/twilio/conversations/read-state");
  const data = await response.json().catch(() => null) as { readStates?: Record<string, string> } | null;

  return data?.readStates || {};
}

export async function markConversationRead(conversationId: string) {
  await fetch("/api/twilio/conversations/read-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId }),
  });
}
