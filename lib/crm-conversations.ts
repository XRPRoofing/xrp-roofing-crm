import type { ConversationFilter, ConversationRecord } from "@/types/conversations";
import type { Lead } from "@/types/crm";

export const conversationFilters: ConversationFilter[] = ["Unread", "Missed Calls", "New Leads", "Assigned Rep", "SMS", "Calls"];

export const quickTemplates = [
  "Thanks for reaching out. Can you send photos of the roof area?",
  "We can schedule a roof inspection this week. What time works best?",
  "Your estimate is ready. I can walk you through the options.",
  "We will follow up with your insurance carrier and update you shortly.",
];

export const pipelineStages = ["New Lead", "Inspection Scheduled", "Inspection Complete", "Estimate Sent", "Waiting Approval", "Approved", "Scheduled", "In Production"];

export const appointmentTypes = ["Roof inspection", "Insurance adjuster meeting", "Estimate review", "Production walkthrough", "Warranty follow-up"];

export function createConversationFromLead(lead: Lead): ConversationRecord {
  const stageLabel = lead.stage.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const isCallLead = lead.lastActivity.toLowerCase().includes("call") || lead.stage === "inspection_scheduled";
  const isNewLead = lead.stage === "new_lead";

  return {
    id: `conv-${lead.id}`,
    contact: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      address: `${lead.address}, ${lead.city}, AZ`,
      roofType: lead.roofType,
      assignedRep: lead.assignedTo,
      insuranceStatus: lead.stage === "waiting_approval" ? "Waiting approval" : lead.stage === "approved" ? "Approved" : "Not confirmed",
      jobStatus: stageLabel,
      leadSource: lead.source,
      tags: [lead.roofType, lead.source, stageLabel],
      notes: lead.lastActivity,
    },
    lastMessage: lead.lastActivity,
    lastActivityAt: isNewLead ? "12 min ago" : isCallLead ? "Today" : "Recently",
    unreadCount: isNewLead ? 2 : lead.stage === "estimate_sent" ? 1 : 0,
    isMissedCall: lead.lastActivity.toLowerCase().includes("missed"),
    isNewLead,
    channels: isCallLead ? ["call", "sms"] : ["sms"],
    messages: [
      { id: `${lead.id}-m1`, channel: "note", direction: "internal", author: "CRM", body: `${stageLabel}: ${lead.lastActivity}`, timestamp: "CRM sync" },
      { id: `${lead.id}-m2`, channel: "sms", direction: "outbound", author: lead.assignedTo, body: `Hi ${lead.name.split(" ")[0]}, this is XRP Roofing following up about ${lead.roofType.toLowerCase()} at ${lead.address}.`, timestamp: "Ready", status: "sent" },
    ],
  };
}

export const conversationsData: ConversationRecord[] = [
  {
    id: "conv-1001",
    contact: {
      id: "contact-1001",
      name: "Maria Hernandez",
      phone: "(602) 555-0181",
      email: "maria@example.com",
      address: "2148 E Camelback Rd, Phoenix, AZ",
      roofType: "Tile underlayment",
      assignedRep: "Johnny Roofer",
      insuranceStatus: "Claim started",
      jobStatus: "New Lead",
      leadSource: "Website",
      tags: ["Storm damage", "Insurance", "Hot lead"],
      notes: "Needs inspection after monsoon wind damage. Asked about insurance claim help.",
    },
    lastMessage: "Can we schedule the roof inspection for tomorrow morning?",
    lastActivityAt: "12 min ago",
    unreadCount: 3,
    isMissedCall: false,
    isNewLead: true,
    channels: ["sms", "call"],
    messages: [
      { id: "m-1", channel: "sms", direction: "inbound", author: "Maria", body: "Hi, we noticed missing tiles after the storm.", timestamp: "9:12 AM", status: "read" },
      { id: "m-2", channel: "sms", direction: "outbound", author: "Johnny", body: "We can help. Can you send a few roof photos and the property address?", timestamp: "9:14 AM", status: "delivered" },
      { id: "m-3", channel: "note", direction: "internal", author: "Office", body: "Lead intake started. Ask for insurance carrier during call.", timestamp: "9:17 AM" },
      { id: "m-4", channel: "sms", direction: "inbound", author: "Maria", body: "Can we schedule the roof inspection for tomorrow morning?", timestamp: "9:25 AM", status: "read", attachments: ["roof-photo-1.jpg", "roof-photo-2.jpg"] },
    ],
  },
  {
    id: "conv-1002",
    contact: {
      id: "contact-1002",
      name: "Desert Plaza HOA",
      phone: "(480) 555-0134",
      email: "board@example.com",
      address: "8800 N Scottsdale Rd, Scottsdale, AZ",
      roofType: "Commercial TPO",
      assignedRep: "Admin User",
      insuranceStatus: "Cash / HOA approval",
      jobStatus: "Estimate Sent",
      leadSource: "Referral",
      tags: ["Commercial", "HOA", "TPO"],
      notes: "Board needs warranty comparison and phased production plan.",
    },
    lastMessage: "Board requested updated TPO warranty options before approval.",
    lastActivityAt: "38 min ago",
    unreadCount: 0,
    isMissedCall: false,
    isNewLead: false,
    channels: ["email", "call"],
    messages: [
      { id: "m-5", channel: "email", direction: "inbound", author: "HOA Board", body: "Please send updated warranty options for 60-mil and 80-mil TPO.", timestamp: "Yesterday", status: "read" },
      { id: "m-6", channel: "call", direction: "outbound", author: "Admin User", body: "Call completed - discussed board meeting timeline and material lead time.", timestamp: "Today", status: "sent" },
    ],
  },
  {
    id: "conv-1003",
    contact: {
      id: "contact-1003",
      name: "Ryan Mitchell",
      phone: "(623) 555-0199",
      email: "ryan@example.com",
      address: "944 W Ocotillo Rd, Glendale, AZ",
      roofType: "Shingle replacement",
      assignedRep: "Johnny Roofer",
      insuranceStatus: "Cash financing",
      jobStatus: "Inspection Scheduled",
      leadSource: "Google Ads",
      tags: ["Financing", "Shingle", "Inspection"],
      notes: "Requested financing and fast install window before listing home.",
    },
    lastMessage: "Missed call - asked for financing options and install timing.",
    lastActivityAt: "1 hr ago",
    unreadCount: 1,
    isMissedCall: true,
    isNewLead: false,
    channels: ["call", "sms"],
    messages: [
      { id: "m-7", channel: "call", direction: "inbound", author: "Ryan", body: "Missed call from customer.", timestamp: "8:45 AM", status: "missed" },
      { id: "m-8", channel: "sms", direction: "outbound", author: "Johnny", body: "Sorry we missed you. I can help with financing and scheduling. Are you free today?", timestamp: "8:48 AM", status: "delivered" },
    ],
  },
];
