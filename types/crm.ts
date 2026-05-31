export type UserRole = "admin" | "sales_rep" | "office_staff";

export type LeadStage = "new_lead" | "inspection_scheduled" | "estimate_sent" | "insurance_review" | "approved" | "in_progress" | "completed";

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
