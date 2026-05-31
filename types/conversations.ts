export type ConversationChannel = "sms" | "call" | "email" | "note";
export type ConversationDirection = "inbound" | "outbound" | "internal";
export type ConversationFilter = "Unread" | "Missed Calls" | "New Leads" | "Assigned Rep" | "SMS" | "Calls";

export interface ConversationMessage {
  id: string;
  channel: ConversationChannel;
  direction: ConversationDirection;
  author: string;
  body: string;
  timestamp: string;
  status?: "sent" | "delivered" | "read" | "missed";
  attachments?: string[];
  customerId?: string;
  jobId?: string;
  recordingUrl?: string;
}

export interface ConversationContact {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  roofType: string;
  assignedRep: string;
  insuranceStatus: string;
  jobStatus: string;
  leadSource: string;
  tags: string[];
  notes: string;
}

export interface ConversationRecord {
  id: string;
  customerId?: string;
  jobId?: string;
  contact: ConversationContact;
  lastMessage: string;
  lastActivityAt: string;
  unreadCount: number;
  isMissedCall: boolean;
  isNewLead: boolean;
  channels: ConversationChannel[];
  messages: ConversationMessage[];
}
