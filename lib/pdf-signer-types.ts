/**
 * Shared types for the PDF Signer / e-signature workflow.
 *
 * These types are isomorphic: no React or browser-only imports. They are used
 * by the client sync layer, the server API routes, and the public signing page.
 */

export const PDF_DOCUMENTS_BUCKET = "pdf-documents";

export const PDF_DOC_STATUSES = [
  "Draft",
  "Sent",
  "Viewed",
  "Partially Completed",
  "Completed",
  "Declined",
  "Expired",
  "Voided",
] as const;

export type PdfDocStatus = (typeof PDF_DOC_STATUSES)[number];

export const FIELD_TYPES = [
  "signature",
  "initials",
  "text",
  "date",
  "full_name",
  "phone",
  "email",
  "address",
  "checkbox",
  "radio",
  "dropdown",
  "label",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const RECIPIENT_ROLES = ["Customer", "Sales Rep", "Office", "Manager"] as const;
export type RecipientRole = (typeof RECIPIENT_ROLES)[number];

export const RECIPIENT_STATUSES = [
  "pending",
  "viewed",
  "partially_completed",
  "completed",
  "declined",
  "expired",
] as const;

export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const PDF_EVENT_TYPES = [
  "Created",
  "Sent",
  "Viewed",
  "Reminder Sent",
  "Field Updated",
  "Signed",
  "Completed",
  "Voided",
  "Downloaded by Admin",
  "Downloaded by Customer",
  "Deleted",
] as const;

export type PdfDocumentEventType = (typeof PDF_EVENT_TYPES)[number];

export interface PdfTemplateField {
  id?: string;
  type: FieldType;
  label?: string;
  placeholder?: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  required?: boolean;
  options?: string[];
  // Filled state (used when a field is copied from a template into a document)
  value?: string;
  recipientId?: string;
}

export interface PdfField extends PdfTemplateField {
  id: string;
  documentId: string;
  recipientId?: string;
  filledAt?: string;
  filledBy?: string;
}

export interface PdfTemplate {
  id: string;
  name: string;
  description?: string;
  pdfPath?: string;
  pdfUrl?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  fields: PdfTemplateField[];
  payload?: Record<string, unknown>;
}

export interface PdfRecipient {
  id: string;
  documentId: string;
  role: RecipientRole;
  label?: string;
  name?: string;
  email?: string;
  phone?: string;
  token: string;
  tokenExpiresAt?: string;
  status: RecipientStatus;
  openedAt?: string;
  signedAt?: string;
  payload?: Record<string, unknown>;
}

export interface PdfDocumentEvent {
  id: string;
  documentId: string;
  recipientId?: string;
  eventType: PdfDocumentEventType | string;
  actor?: string;
  ipAddress?: string;
  userAgent?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface PdfDocument {
  id: string;
  title: string;
  documentName: string;
  status: PdfDocStatus;
  templateId?: string;
  customerId?: string;
  customerName?: string;
  jobId?: string;
  jobAddress?: string;
  createdBy?: string;
  createdAt: string;
  dateCreated: string;
  completedAt?: string | null;
  dateCompleted?: string | null;
  originalPdfPath: string;
  originalPdfUrl?: string;
  signedPdfPath?: string;
  signedPdfUrl?: string;
  signedBy?: string;
  signedAt?: string;
  sentAt?: string;
  viewedAt?: string;
  pdfFileName?: string;
  recipients?: PdfRecipient[];
  fields?: PdfField[];
  events?: PdfDocumentEvent[];
  payload?: Record<string, unknown>;
}

export interface SigningPageData {
  document: PdfDocument;
  recipient: PdfRecipient;
  fields: PdfField[];
}

export interface PublicField {
  id: string;
  type: FieldType;
  label?: string;
  placeholder?: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  required?: boolean;
  options?: string[];
  value?: string;
}

export interface LegacyPdfDocument {
  id: string;
  jobAddress: string;
  customerName: string;
  documentName: string;
  dateCreated: string;
  dateCompleted: string | null;
  createdBy: string;
  status: PdfDocStatus;
  pdfDataUrl?: string;
  pdfFileName?: string;
  signatureDataUrl?: string;
  signedBy?: string;
  signedAt?: string;
  sentAt?: string;
  viewedAt?: string;
  templateId?: string;
}

export interface LegacyPdfTemplate {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  dateCreated: string;
  pdfDataUrl?: string;
  fields: PdfTemplateField[];
}
