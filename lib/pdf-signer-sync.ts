"use client";

/**
 * PDF Signer document & template persistence.
 *
 * Uses localStorage as the primary store (same pattern as the rest of the CRM).
 * Data is keyed by `xrp_pdf_documents` and `xrp_pdf_templates`.
 */

/* ── Types ──────────────────────────────────────────────────────────── */

export type PdfDocStatus = "Draft" | "Sent" | "Viewed" | "Completed";

export interface PdfDocument {
  id: string;
  jobAddress: string;
  customerName: string;
  documentName: string;
  dateCreated: string;
  dateCompleted: string | null;
  createdBy: string;
  status: PdfDocStatus;
  pdfDataUrl?: string;
  signatureDataUrl?: string;
  signedBy?: string;
  signedAt?: string;
  sentAt?: string;
  viewedAt?: string;
  templateId?: string;
}

export interface PdfTemplate {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  dateCreated: string;
  pdfDataUrl?: string;
  fields: PdfTemplateField[];
}

export interface PdfTemplateField {
  id: string;
  label: string;
  type: "signature" | "text" | "date" | "initials" | "checkbox";
  x: number;
  y: number;
  page: number;
  width: number;
  height: number;
}

/* ── Storage keys ───────────────────────────────────────────────────── */

const DOC_KEY = "xrp_pdf_documents";
const TPL_KEY = "xrp_pdf_templates";

/* ── Documents CRUD ─────────────────────────────────────────────────── */

export function readDocuments(): PdfDocument[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(DOC_KEY) || "[]");
  } catch {
    return [];
  }
}

export function writeDocuments(docs: PdfDocument[]): void {
  localStorage.setItem(DOC_KEY, JSON.stringify(docs));
}

export function upsertDocument(doc: PdfDocument): PdfDocument[] {
  const docs = readDocuments();
  const idx = docs.findIndex((d) => d.id === doc.id);
  if (idx >= 0) docs[idx] = doc;
  else docs.unshift(doc);
  writeDocuments(docs);
  return docs;
}

export function deleteDocument(id: string): PdfDocument[] {
  const docs = readDocuments().filter((d) => d.id !== id);
  writeDocuments(docs);
  return docs;
}

/* ── Templates CRUD ─────────────────────────────────────────────────── */

export function readTemplates(): PdfTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(TPL_KEY) || "[]");
  } catch {
    return [];
  }
}

export function writeTemplates(tpls: PdfTemplate[]): void {
  localStorage.setItem(TPL_KEY, JSON.stringify(tpls));
}

export function upsertTemplate(tpl: PdfTemplate): PdfTemplate[] {
  const tpls = readTemplates();
  const idx = tpls.findIndex((t) => t.id === tpl.id);
  if (idx >= 0) tpls[idx] = tpl;
  else tpls.unshift(tpl);
  writeTemplates(tpls);
  return tpls;
}

export function deleteTemplate(id: string): PdfTemplate[] {
  const tpls = readTemplates().filter((t) => t.id !== id);
  writeTemplates(tpls);
  return tpls;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

export function newDocId(): string {
  return `PDF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newTemplateId(): string {
  return `TPL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
