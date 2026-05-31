export type TwilioConversationEventType = "incoming_call" | "incoming_sms" | "call_status" | "message_status" | "call_note";

export interface TwilioSmsPayload {
  to: string;
  body: string;
  conversationId?: string;
  customerId?: string;
  jobId?: string;
  mediaUrl?: string[];
}

export interface TwilioCallPayload {
  to: string;
  conversationId?: string;
  customerId?: string;
  jobId?: string;
}

export interface TwilioCallNotePayload {
  callSid: string;
  conversationId?: string;
  customerId?: string;
  jobId?: string;
  notes: string;
}

export interface TwilioConversationEvent {
  id: string;
  type: TwilioConversationEventType;
  direction?: "inbound" | "outbound";
  from?: string;
  to?: string;
  body?: string;
  status?: string;
  callSid?: string;
  messageSid?: string;
  conversationId?: string;
  customerId?: string;
  jobId?: string;
  recordingUrl?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
