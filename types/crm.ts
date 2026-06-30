export type UserRole = "admin" | "sales_rep" | "office_staff";

export type LeadStage = "new_lead" | "inspection_scheduled" | "inspection_complete" | "estimate_sent" | "follow_up" | "waiting_approval" | "approved" | "scheduled" | "in_progress" | "final_inspection" | "completed" | "paid";

export type Priority = "low" | "medium" | "high" | "urgent";

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  stage: LeadStage;
  value: number;
  assignedTo: string;
  roofType: string;
  source: string;
  lastActivity: string;
  dueDate?: string;
  nextAction?: string;
  inspectionDate?: string;
  roofYear?: string;
  callNotes?: string;
  createdAt?: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  propertyAddress: string;
  roofDetails: string;
  insuranceCarrier: string;
  status: string;
  lifetimeValue: number;
}

export interface Task {
  id: string;
  title: string;
  dueDate: string;
  priority: Priority;
  status: "todo" | "in_progress" | "done";
  assignedTo: string;
  relatedTo: string;
}
