import type { Customer, Lead, LeadStage, Task } from "@/types/crm";

export const leadStages: { id: LeadStage; label: string }[] = [
  { id: "new_lead", label: "New Lead" },
  { id: "inspection_scheduled", label: "Inspection Scheduled" },
  { id: "estimate_sent", label: "Estimate Sent" },
  { id: "insurance_review", label: "Insurance Review" },
  { id: "approved", label: "Approved" },
  { id: "in_progress", label: "In Progress" },
  { id: "completed", label: "Completed" },
];

export const leads: Lead[] = [
  { id: "L-1001", name: "Maria Hernandez", email: "maria@example.com", phone: "(602) 555-0181", address: "2148 E Camelback Rd", city: "Phoenix", stage: "new_lead", value: 18500, assignedTo: "Johnny Roofer", roofType: "Tile", source: "Website", lastActivity: "Requested storm inspection" },
  { id: "L-1002", name: "Desert Plaza HOA", email: "board@example.com", phone: "(480) 555-0134", address: "8800 N Scottsdale Rd", city: "Scottsdale", stage: "inspection_scheduled", value: 72000, assignedTo: "Johnny Roofer", roofType: "Flat/TPO", source: "Referral", lastActivity: "Inspection booked for Friday" },
  { id: "L-1003", name: "Ryan Mitchell", email: "ryan@example.com", phone: "(623) 555-0199", address: "944 W Ocotillo Rd", city: "Glendale", stage: "estimate_sent", value: 24600, assignedTo: "Johnny Roofer", roofType: "Shingle", source: "Google", lastActivity: "Estimate sent" },
  { id: "L-1004", name: "Sage Medical Center", email: "facilities@example.com", phone: "(602) 555-0112", address: "1201 W Thomas Rd", city: "Phoenix", stage: "insurance_review", value: 98000, assignedTo: "Admin User", roofType: "Commercial Flat", source: "Partner", lastActivity: "Carrier document review" },
  { id: "L-1005", name: "Priya Shah", email: "priya@example.com", phone: "(480) 555-0108", address: "3012 S Dobson Rd", city: "Mesa", stage: "approved", value: 31800, assignedTo: "Johnny Roofer", roofType: "Tile Underlayment", source: "Instagram", lastActivity: "Deposit received" },
  { id: "L-1006", name: "Carlos Vega", email: "carlos@example.com", phone: "(602) 555-0148", address: "4119 N 15th Ave", city: "Phoenix", stage: "in_progress", value: 14200, assignedTo: "Office Coordinator", roofType: "Repair", source: "Website", lastActivity: "Crew dispatched" },
  { id: "L-1007", name: "Sunset Retail Center", email: "ops@example.com", phone: "(480) 555-0160", address: "7707 E Main St", city: "Mesa", stage: "completed", value: 64500, assignedTo: "Admin User", roofType: "TPO", source: "Repeat Customer", lastActivity: "Warranty packet uploaded" },
];

export const customers: Customer[] = [
  { id: "C-501", name: "Priya Shah", email: "priya@example.com", phone: "(480) 555-0108", propertyAddress: "3012 S Dobson Rd, Mesa, AZ", roofDetails: "Concrete tile, 2,900 sq ft, underlayment replacement", insuranceCarrier: "State Farm", status: "Active job", lifetimeValue: 31800 },
  { id: "C-502", name: "Sunset Retail Center", email: "ops@example.com", phone: "(480) 555-0160", propertyAddress: "7707 E Main St, Mesa, AZ", roofDetails: "60-mil TPO commercial roof", insuranceCarrier: "Travelers", status: "Completed", lifetimeValue: 64500 },
  { id: "C-503", name: "Carlos Vega", email: "carlos@example.com", phone: "(602) 555-0148", propertyAddress: "4119 N 15th Ave, Phoenix, AZ", roofDetails: "Leak repair and flashing replacement", insuranceCarrier: "USAA", status: "In progress", lifetimeValue: 14200 },
];

export const tasks: Task[] = [
  { id: "T-1", title: "Upload roof inspection photos", dueDate: "Today", priority: "high", status: "todo", assignedTo: "Johnny Roofer", relatedTo: "Maria Hernandez" },
  { id: "T-2", title: "Confirm adjuster appointment", dueDate: "Tomorrow", priority: "urgent", status: "in_progress", assignedTo: "Office Coordinator", relatedTo: "Sage Medical Center" },
  { id: "T-3", title: "Send proposal follow-up", dueDate: "Friday", priority: "medium", status: "todo", assignedTo: "Johnny Roofer", relatedTo: "Ryan Mitchell" },
  { id: "T-4", title: "Close completed TPO job", dueDate: "Next week", priority: "low", status: "done", assignedTo: "Admin User", relatedTo: "Sunset Retail Center" },
];
