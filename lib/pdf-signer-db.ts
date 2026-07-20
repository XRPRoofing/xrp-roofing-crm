"use client";

/**
 * PDF Signer client data layer.
 *
 * Supabase is the only source of truth for documents and templates.
 * localStorage is only used to read legacy data for the one-time migration UI
 * and for temporary UI state (drafts, signatures in progress).
 */

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import {
  PDF_DOCUMENTS_BUCKET,
  type FieldType,
  type PdfDocStatus,
  type PdfDocument,
  type PdfField,
  type PdfRecipient,
  type PdfTemplate,
  type PdfTemplateField,
  type LegacyPdfDocument,
  type LegacyPdfTemplate,
  type SigningPageData,
} from "@/lib/pdf-signer-types";

export type {
  FieldType,
  PdfDocStatus,
  PdfDocument,
  PdfField,
  PdfRecipient,
  PdfTemplate,
  PdfTemplateField,
  SigningPageData,
};

/* ── localStorage legacy keys (read-only) ─────────────────────────────── */

const DOC_KEY = "xrp_pdf_documents";
const TPL_KEY = "xrp_pdf_templates";
const MIGRATED_KEY = "xrp_pdf_migrated_v2";

function readLocal<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(key) || "[]") as T[];
  } catch {
    return [];
  }
}

/* ── Generic fetch helper ───────────────────────────────────────────── */

async function apiFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const url = path.startsWith("/api/") ? path : `/api/${path}`;
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  let body = init?.body;

  if (init?.json !== undefined && body === undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }

  const response = await fetch(url, { ...init, headers, body });
  const data = (await response.json().catch(() => ({}))) as { error?: string; detail?: string } & T;

  if (!response.ok) {
    throw new Error(
      (data && typeof data === "object" && (data.error || data.detail)) || `Request failed: ${response.status}`,
    );
  }
  return data as T;
}

function ensureSupabase() {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase is not configured. PDF Signer requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
}

/* ── Documents ────────────────────────────────────────────────────────── */

export async function loadDocuments(): Promise<PdfDocument[]> {
  ensureSupabase();
  const { documents } = await apiFetch<{ documents: PdfDocument[] }>("/api/pdf-documents");
  return documents ?? [];
}

export async function loadDocumentsByCustomer(customerId?: string, name?: string): Promise<PdfDocument[]> {
  ensureSupabase();
  if (customerId) {
    const { documents } = await apiFetch<{ documents: PdfDocument[] }>(`/api/pdf-documents?customerId=${encodeURIComponent(customerId)}`);
    return documents ?? [];
  }
  if (name) {
    const all = await loadDocuments();
    return all.filter((d) => d.customerName?.toLowerCase().includes(name.toLowerCase()));
  }
  return [];
}

export async function loadDocumentsByJob(jobId?: string, address?: string): Promise<PdfDocument[]> {
  ensureSupabase();
  if (jobId) {
    const { documents } = await apiFetch<{ documents: PdfDocument[] }>(`/api/pdf-documents?jobId=${encodeURIComponent(jobId)}`);
    return documents ?? [];
  }
  if (address) {
    const all = await loadDocuments();
    return all.filter((d) => d.jobAddress?.toLowerCase().includes(address.toLowerCase()));
  }
  return [];
}

export async function loadDocument(id: string): Promise<PdfDocument> {
  ensureSupabase();
  const { document } = await apiFetch<{ document: PdfDocument }>(`/api/pdf-documents/${encodeURIComponent(id)}`);
  if (!document) throw new Error("Document not found");
  return document;
}

export type CreateDocumentInput = {
  title: string;
  customerName?: string;
  customerId?: string;
  jobAddress?: string;
  jobId?: string;
  createdBy?: string;
  originalPdfPath: string;
  pdfFileName?: string;
  templateId?: string;
};

export async function createDocument(input: CreateDocumentInput): Promise<PdfDocument> {
  ensureSupabase();
  const { document } = await apiFetch<{ document: PdfDocument }>("/api/pdf-documents", {
    method: "POST",
    json: input,
  });
  return document;
}

export async function updateDocument(
  id: string,
  updates: Partial<Omit<PdfDocument, "id" | "recipients" | "fields" | "events">>,
): Promise<PdfDocument> {
  ensureSupabase();
  const { document } = await apiFetch<{ document: PdfDocument }>(`/api/pdf-documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: updates,
  });
  return document;
}

export async function deleteDocument(id: string): Promise<void> {
  ensureSupabase();
  await apiFetch<{ ok: true }>(`/api/pdf-documents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadPdfFile(file: File, folder: "originals" | "signatures" | "signed" | "templates" = "originals"): Promise<{ path: string; signedUrl: string }> {
  ensureSupabase();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", folder);
  return await apiFetch<{ path: string; signedUrl: string }>("/api/pdf-documents/upload", {
    method: "POST",
    body: formData,
  });
}

export type SendDocumentInput = {
  name?: string;
  email?: string;
  phone?: string;
  role?: PdfRecipient["role"];
  label?: string;
  expiresInDays?: number;
};

export async function sendDocument(id: string, input: SendDocumentInput): Promise<{ recipient: PdfRecipient; signingUrl: string }> {
  ensureSupabase();
  return await apiFetch<{ recipient: PdfRecipient; signingUrl: string }>(`/api/pdf-documents/${encodeURIComponent(id)}/send`, {
    method: "POST",
    json: input,
  });
}

export async function adminSignDocument(id: string, signaturePng: string): Promise<PdfDocument> {
  ensureSupabase();
  const { document } = await apiFetch<{ document: PdfDocument }>(`/api/pdf-documents/${encodeURIComponent(id)}/admin-sign`, {
    method: "POST",
    json: { signaturePng },
  });
  return document;
}

export async function updateDocumentFields(id: string, fields: PdfTemplateField[]): Promise<PdfField[]> {
  ensureSupabase();
  const { fields: saved } = await apiFetch<{ fields: PdfField[] }>(`/api/pdf-documents/${encodeURIComponent(id)}/fields`, {
    method: "PATCH",
    json: { fields },
  });
  return saved ?? [];
}

export async function voidDocument(id: string): Promise<PdfDocument> {
  ensureSupabase();
  const { document } = await apiFetch<{ document: PdfDocument }>(`/api/pdf-documents/${encodeURIComponent(id)}/void`, {
    method: "POST",
  });
  return document;
}

export type CreateRecipientInput = {
  name?: string;
  email?: string;
  phone?: string;
  role?: PdfRecipient["role"];
  label?: string;
};

export async function createDocumentRecipient(documentId: string, input: CreateRecipientInput): Promise<PdfRecipient> {
  ensureSupabase();
  const { recipient } = await apiFetch<{ recipient: PdfRecipient }>(
    `/api/pdf-documents/${encodeURIComponent(documentId)}/recipients`,
    {
      method: "POST",
      json: input,
    },
  );
  if (!recipient) throw new Error("Recipient could not be created");
  return recipient;
}

export async function loadDocumentRecipients(documentId: string): Promise<PdfRecipient[]> {
  ensureSupabase();
  const { recipients } = await apiFetch<{ recipients: PdfRecipient[] }>(
    `/api/pdf-documents/${encodeURIComponent(documentId)}/recipients`,
  );
  return recipients ?? [];
}

export async function sendReminder(id: string, recipientId?: string): Promise<void> {
  ensureSupabase();
  await apiFetch<{ ok: true }>(`/api/pdf-documents/${encodeURIComponent(id)}/remind`, {
    method: "POST",
    json: recipientId ? { recipientId } : {},
  });
}

/* ── Templates ────────────────────────────────────────────────────────── */

export async function loadTemplates(): Promise<PdfTemplate[]> {
  ensureSupabase();
  const { templates } = await apiFetch<{ templates: PdfTemplate[] }>("/api/pdf-templates");
  return templates ?? [];
}

export async function loadTemplate(id: string): Promise<PdfTemplate> {
  ensureSupabase();
  const { template } = await apiFetch<{ template: PdfTemplate }>(`/api/pdf-templates/${encodeURIComponent(id)}`);
  if (!template) throw new Error("Template not found");
  return template;
}

export type CreateTemplateInput = {
  name: string;
  description?: string;
  pdfPath?: string;
  createdBy?: string;
  fields?: PdfTemplateField[];
};

export async function createTemplate(input: CreateTemplateInput): Promise<PdfTemplate> {
  ensureSupabase();
  const { template } = await apiFetch<{ template: PdfTemplate }>("/api/pdf-templates", {
    method: "POST",
    json: input,
  });
  return template;
}

export async function updateTemplate(id: string, updates: Partial<PdfTemplate>): Promise<PdfTemplate> {
  ensureSupabase();
  const { template } = await apiFetch<{ template: PdfTemplate }>(`/api/pdf-templates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: updates,
  });
  return template;
}

export async function deleteTemplate(id: string): Promise<void> {
  ensureSupabase();
  await apiFetch<{ ok: true }>(`/api/pdf-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ── Legacy migration (read-only from localStorage) ───────────────────── */

export function getLegacyMigrationStats(): { documentCount: number; templateCount: number; hasMigrated: boolean } {
  if (typeof window === "undefined") return { documentCount: 0, templateCount: 0, hasMigrated: false };
  return {
    documentCount: readLocal<LegacyPdfDocument>(DOC_KEY).filter((d) => d.pdfDataUrl || d.documentName).length,
    templateCount: readLocal<LegacyPdfTemplate>(TPL_KEY).filter((t) => t.name).length,
    hasMigrated: window.localStorage.getItem(MIGRATED_KEY) === "true",
  };
}

export async function migrateLegacyDocuments(
  onProgress?: (done: number, total: number, item: string) => void,
): Promise<{ documents: number; templates: number; errors: string[] }> {
  ensureSupabase();
  const docs = readLocal<LegacyPdfDocument>(DOC_KEY).filter((d) => d.pdfDataUrl || d.documentName);
  const tpls = readLocal<LegacyPdfTemplate>(TPL_KEY).filter((t) => t.name);
  const errors: string[] = [];
  let done = 0;
  const total = docs.length + tpls.length;

  for (const doc of docs) {
    try {
      await apiFetch<{ ok: true }>("/api/pdf-documents/migrate", {
        method: "POST",
        json: doc,
      });
      done += 1;
      onProgress?.(done, total, doc.documentName || "Untitled document");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Migration failed";
      errors.push(`${doc.documentName || "Document"}: ${message}`);
      done += 1;
      onProgress?.(done, total, doc.documentName || "Untitled document");
    }
  }

  for (const tpl of tpls) {
    try {
      await apiFetch<{ ok: true }>("/api/pdf-templates/migrate", {
        method: "POST",
        json: tpl,
      });
      done += 1;
      onProgress?.(done, total, tpl.name || "Untitled template");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Migration failed";
      errors.push(`${tpl.name || "Template"}: ${message}`);
      done += 1;
      onProgress?.(done, total, tpl.name || "Untitled template");
    }
  }

  if (errors.length === 0) {
    window.localStorage.setItem(MIGRATED_KEY, "true");
  }

  return { documents: docs.length, templates: tpls.length, errors };
}

export function clearMigrationFlag() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(MIGRATED_KEY);
}

/* ── Realtime subscriptions ─────────────────────────────────────────── */

const docListeners = new Set<() => void>();
let docChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;

export function subscribeToPdfDocuments(onChange: () => void): () => void {
  if (!hasSupabaseConfig()) return () => {};

  docListeners.add(onChange);

  if (!docChannel) {
    const supabase = createClient();
    docChannel = supabase.channel("pdf-documents-sync-shared");
    docChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pdf_documents" },
      () => docListeners.forEach((cb) => cb()),
    );
    docChannel.subscribe();
  }

  return () => {
    docListeners.delete(onChange);
    if (docListeners.size === 0 && docChannel) {
      createClient().removeChannel(docChannel);
      docChannel = null;
    }
  };
}

const tplListeners = new Set<() => void>();
let tplChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;

export function subscribeToPdfTemplates(onChange: () => void): () => void {
  if (!hasSupabaseConfig()) return () => {};

  tplListeners.add(onChange);

  if (!tplChannel) {
    const supabase = createClient();
    tplChannel = supabase.channel("pdf-templates-sync-shared");
    tplChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pdf_templates" },
      () => tplListeners.forEach((cb) => cb()),
    );
    tplChannel.subscribe();
  }

  return () => {
    tplListeners.delete(onChange);
    if (tplListeners.size === 0 && tplChannel) {
      createClient().removeChannel(tplChannel);
      tplChannel = null;
    }
  };
}

/* ── Helpers ────────────────────────────────────────────────────────── */

export function newDocId(): string {
  return `PDF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newTemplateId(): string {
  return `TPL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function signingUrlFromToken(token: string): string {
  return `${window.location.origin}/sign/pdf/${encodeURIComponent(token)}`;
}

export function defaultSignatureField(recipientId?: string, pageWidth = 612, pageHeight = 792): PdfTemplateField {
  const width = 200;
  const height = 60;
  return {
    type: "signature",
    label: "Signature",
    required: true,
    page: 0,
    x: Math.max(0, pageWidth - width - 50),
    y: Math.max(0, pageHeight / 2 - height / 2),
    width,
    height,
    recipientId,
  };
}
