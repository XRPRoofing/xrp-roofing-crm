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
  on: {
    (event: "accept" | "disconnect" | "error" | "cancel", handler: (error?: Error) => void): void;
    (event: "volume", handler: (inputVolume: number, outputVolume: number) => void): void;
  };
  parameters?: Record<string, string>;
};

export function proxyRecordingUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "api.twilio.com") {
      return `/api/twilio/recording?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return undefined;
  }
  return url;
}

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

export async function uploadMmsMedia(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/twilio/mms/upload", { method: "POST", body: formData });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Unable to upload media");
  }
  const data = await response.json() as { url: string };
  return data.url;
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
    recordingSid: row.recording_sid ? String(row.recording_sid) : row.payload && typeof row.payload === "object" && "RecordingSid" in row.payload ? String((row.payload as Record<string, unknown>).RecordingSid) : undefined,
    recordingUrl: row.recording_url ? String(row.recording_url) : row.payload && typeof row.payload === "object" && "recordingUrl" in row.payload ? String((row.payload as Record<string, unknown>).recordingUrl) : undefined,
    payload: (row.payload as Record<string, unknown>) || {},
    createdAt: String(row.created_at),
  };
}

export async function listConversationEvents(limit = 1000) {
  const response = await fetch(`/api/twilio/events?limit=${limit}`);
  const data = await response.json().catch(() => null) as { events?: TwilioConversationEvent[]; error?: string } | null;

  if (!response.ok || data?.error) throw new Error(data?.error || "Unable to load saved call history");

  return data?.events || [];
}

// Shared singleton channel for conversation events — prevents duplicate
// channels when multiple components subscribe (CrmShell, Dashboard, Customers,
// ConversationBoard all listen to the same table).
const conversationEventListeners = new Set<(event: TwilioConversationEvent) => void>();
let conversationEventChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;

export function subscribeToConversationEvents(onEvent: (event: TwilioConversationEvent) => void) {
  conversationEventListeners.add(onEvent);

  if (!conversationEventChannel) {
    const supabase = createClient();
    conversationEventChannel = supabase
      .channel("crm-conversation-events-shared")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_events" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const mapped = mapConversationEventRow(row);
          conversationEventListeners.forEach((cb) => cb(mapped));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversation_events" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const mapped = mapConversationEventRow(row);
          conversationEventListeners.forEach((cb) => cb(mapped));
        }
      )
      .subscribe();
  }

  return () => {
    conversationEventListeners.delete(onEvent);
    if (conversationEventListeners.size === 0 && conversationEventChannel) {
      createClient().removeChannel(conversationEventChannel);
      conversationEventChannel = null;
    }
  };
}


// --- Agent presence -------------------------------------------------------
// Report the current admin's online/offline state to /api/agent/presence.
export async function reportAgentPresence(status: "online" | "offline") {
  try {
    const { data } = await createClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/agent/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, token }),
      keepalive: true,
    });
  } catch {
    // Presence is best-effort; ringing still targets all admins via profiles.
  }
}

// Best-effort "offline" ping that survives page unload. sendBeacon cannot set
// an Authorization header, so the JWT travels in the JSON body.
export function beaconAgentOffline(accessToken: string) {
  try {
    if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
    const blob = new Blob([JSON.stringify({ status: "offline", token: accessToken })], {
      type: "application/json",
    });
    navigator.sendBeacon("/api/agent/presence", blob);
  } catch {
    // ignore
  }
}

// --- Ephemeral call signals (e.g. "answered by X") ------------------------
// A lightweight Supabase Realtime broadcast channel used to tell other admins'
// browsers that a ringing call was just answered — and by whom — so their
// incoming-call popup can show "Answered by <name>" as it dismisses. This is
// intentionally NOT persisted (no DB row) to avoid polluting call history.
export type CallAnsweredSignal = { name: string; at: number };

let callSignalChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
const callAnsweredListeners = new Set<(signal: CallAnsweredSignal) => void>();

function ensureCallSignalChannel() {
  if (callSignalChannel) return callSignalChannel;
  const supabase = createClient();
  callSignalChannel = supabase
    .channel("crm-call-signals", { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "answered" }, (message) => {
      const payload = (message.payload || {}) as Partial<CallAnsweredSignal>;
      const signal: CallAnsweredSignal = {
        name: typeof payload.name === "string" && payload.name.trim() ? payload.name : "another agent",
        at: typeof payload.at === "number" ? payload.at : Date.now(),
      };
      callAnsweredListeners.forEach((cb) => cb(signal));
    })
    .subscribe();
  return callSignalChannel;
}

export function subscribeToCallSignals(onAnswered: (signal: CallAnsweredSignal) => void) {
  callAnsweredListeners.add(onAnswered);
  ensureCallSignalChannel();
  return () => {
    callAnsweredListeners.delete(onAnswered);
    if (callAnsweredListeners.size === 0 && callSignalChannel) {
      createClient().removeChannel(callSignalChannel);
      callSignalChannel = null;
    }
  };
}

export function broadcastCallAnswered(name: string) {
  try {
    const channel = ensureCallSignalChannel();
    void channel.send({ type: "broadcast", event: "answered", payload: { name, at: Date.now() } });
  } catch {
    // Best-effort; the losing legs still dismiss via Twilio's cancel event.
  }
}

// Shared singleton channel for conversation read states
const readStateListeners = new Set<(conversationId: string, readAt: string) => void>();
let readStateChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;

export function subscribeToConversationReadStates(onRead: (conversationId: string, readAt: string) => void) {
  readStateListeners.add(onRead);

  if (!readStateChannel) {
    const supabase = createClient();
    readStateChannel = supabase
      .channel("crm-conversation-read-states-shared")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_read_states" },
        (payload) => {
          const row = (payload.new || {}) as Record<string, unknown>;
          if (!row.conversation_id) return;
          const cid = String(row.conversation_id);
          const rat = row.read_at ? String(row.read_at) : new Date().toISOString();
          readStateListeners.forEach((cb) => cb(cid, rat));
        }
      )
      .subscribe();
  }

  return () => {
    readStateListeners.delete(onRead);
    if (readStateListeners.size === 0 && readStateChannel) {
      createClient().removeChannel(readStateChannel);
      readStateChannel = null;
    }
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
