/**
 * Server-side helpers for the PDF Signer feature.
 *
 * - Service-role Supabase client (bypasses RLS)
 * - Authenticated user check
 * - Signed URL generation for the private `pdf-documents` bucket
 * - Audit event insertion
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import {
  PDF_DOCUMENTS_BUCKET,
  type PdfDocument,
  type PdfDocumentEventType,
  type PdfField,
  type PdfRecipient,
  type PdfTemplate,
  type PdfTemplateField,
} from "@/lib/pdf-signer-types";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function getAdminClient(): SupabaseClient | null {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = getServiceRoleKey();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function requireAuthUser(): Promise<{ id: string; email?: string } | null> {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // no-op in read-only route context
      },
    },
  });

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}

export async function createSignedUrl(
  admin: SupabaseClient,
  path: string | undefined | null,
  expiresInSeconds = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await admin.storage
    .from(PDF_DOCUMENTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function downloadStorageBytes(admin: SupabaseClient, path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(PDF_DOCUMENTS_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function uploadStorageBytes(
  admin: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ path?: string; error?: string }> {
  const { error } = await admin.storage
    .from(PDF_DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) {
    return { error: error.message };
  }
  return { path };
}

export async function deleteStorageObjects(admin: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await admin.storage.from(PDF_DOCUMENTS_BUCKET).remove(paths.filter(Boolean));
  } catch {
    // best-effort cleanup
  }
}

export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://www.xrproofing.app").replace(/\/+$/, "");
}

export function signingUrl(token: string): string {
  return `${getAppUrl()}/sign/pdf/${encodeURIComponent(token)}`;
}

export async function addAuditEvent(
  admin: SupabaseClient,
  input: {
    documentId: string;
    recipientId?: string;
    eventType: PdfDocumentEventType | string;
    actor?: string;
    ipAddress?: string;
    userAgent?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("pdf_document_events").insert({
      document_id: input.documentId,
      recipient_id: input.recipientId,
      event_type: input.eventType,
      actor: input.actor,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      payload: input.payload ?? {},
    });
  } catch {
    // audit failures should never break the workflow
  }
}

export async function attachDocumentToJobAndCustomer(
  admin: SupabaseClient,
  doc: PdfDocument,
  actor: string,
): Promise<void> {
  if (!doc.customerId && !doc.jobId) return;

  try {
    if (doc.jobId) {
      await admin.from("crew_activity_log").insert({
        id: `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        job_id: doc.jobId,
        job_name: doc.customerName || doc.title,
        actor,
        action: "PDF document completed",
        details: `${doc.title} — signed document attached to job`,
        module: "PDF Signer",
        created_at: new Date().toISOString(),
      });
    }

    await admin.from("crm_notifications").upsert(
      {
        id: `pdf-notif-${doc.id}`,
        payload: {
          id: `pdf-notif-${doc.id}`,
          title: "PDF document completed",
          message: `${doc.title} ${doc.customerName ? `for ${doc.customerName}` : ""} has been signed and attached.`,
          actor,
          module: "PDF Signer",
          read: false,
          status: "unread",
          createdAt: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  } catch {
    // best-effort attachment notification
  }
}

export async function loadRecipientsForDocument(
  admin: SupabaseClient,
  documentId: string,
): Promise<PdfRecipient[]> {
  const { data, error } = await admin
    .from("pdf_document_recipients")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => mapRecipientRow(row));
}

export async function loadFieldsForDocument(admin: SupabaseClient, documentId: string): Promise<PdfField[]> {
  const { data, error } = await admin
    .from("pdf_document_fields")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => mapFieldRow(row));
}

export async function loadEventsForDocument(
  admin: SupabaseClient,
  documentId: string,
): Promise<{ id: string; event_type: string; actor?: string; created_at: string; payload?: Record<string, unknown> }[]> {
  const { data, error } = await admin
    .from("pdf_document_events")
    .select("id, event_type, actor, created_at, payload")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return data as { id: string; event_type: string; actor?: string; created_at: string; payload?: Record<string, unknown> }[];
}

export function mapRecipientRow(row: Record<string, unknown>): PdfRecipient {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    role: (row.role as PdfRecipient["role"]) || "Customer",
    label: (row.label as string) || undefined,
    name: (row.name as string) || undefined,
    email: (row.email as string) || undefined,
    phone: (row.phone as string) || undefined,
    token: row.token as string,
    tokenExpiresAt: (row.token_expires_at as string) || undefined,
    status: (row.status as PdfRecipient["status"]) || "pending",
    openedAt: (row.opened_at as string) || undefined,
    signedAt: (row.signed_at as string) || undefined,
    payload: (row.payload as Record<string, unknown>) || {},
  };
}

export function mapFieldRow(row: Record<string, unknown>): PdfField {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    recipientId: (row.recipient_id as string) || undefined,
    type: row.type as PdfField["type"],
    label: (row.label as string) || undefined,
    placeholder: (row.placeholder as string) || undefined,
    page: typeof row.page === "number" ? row.page : 0,
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
    width: Number(row.width) || 150,
    height: Number(row.height) || 40,
    required: row.required !== false,
    options: Array.isArray(row.options) ? (row.options as string[]) : [],
    value: (row.value as string) || undefined,
    filledAt: (row.filled_at as string) || undefined,
    filledBy: (row.filled_by as string) || undefined,
  };
}

export function mapDocumentRow(row: Record<string, unknown>): PdfDocument {
  return {
    id: row.id as string,
    title: (row.title as string) || "",
    documentName: (row.title as string) || "",
    status: (row.status as PdfDocument["status"]) || "Draft",
    templateId: (row.template_id as string) || undefined,
    customerId: (row.customer_id as string) || undefined,
    customerName: (row.payload as Record<string, unknown> | undefined)?.customerName as string | undefined,
    jobId: (row.job_id as string) || undefined,
    jobAddress: (row.payload as Record<string, unknown> | undefined)?.jobAddress as string | undefined,
    createdBy: (row.created_by as string) || undefined,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    dateCreated: ((row.created_at as string) || "").slice(0, 10),
    completedAt: (row.completed_at as string) || null,
    dateCompleted: (row.completed_at as string)?.slice(0, 10) || null,
    originalPdfPath: (row.original_pdf_path as string) || "",
    signedPdfPath: (row.signed_pdf_path as string) || undefined,
    pdfFileName: (row.payload as Record<string, unknown> | undefined)?.pdfFileName as string | undefined,
    signedBy: (row.payload as Record<string, unknown> | undefined)?.signedBy as string | undefined,
    signedAt: (row.signed_at as string) || undefined,
    sentAt: (row.payload as Record<string, unknown> | undefined)?.sentAt as string | undefined,
    viewedAt: (row.payload as Record<string, unknown> | undefined)?.viewedAt as string | undefined,
    payload: (row.payload as Record<string, unknown>) || {},
  };
}

export function mapTemplateRow(row: Record<string, unknown>): PdfTemplate {
  const fields = (row.payload as Record<string, unknown> | undefined)?.fields;
  return {
    id: row.id as string,
    name: (row.name as string) || "",
    description: (row.description as string) || undefined,
    pdfPath: (row.pdf_path as string) || undefined,
    createdBy: (row.created_by as string) || undefined,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || undefined,
    fields: Array.isArray(fields) ? (fields as PdfTemplateField[]) : [],
    payload: (row.payload as Record<string, unknown>) || {},
  };
}

export async function getDocumentById(
  admin: SupabaseClient,
  id: string,
): Promise<PdfDocument | null> {
  const { data, error } = await admin.from("pdf_documents").select("*").eq("id", id).single();
  if (error || !data) return null;
  return mapDocumentRow(data as Record<string, unknown>);
}

export async function getDocumentWithDetails(
  admin: SupabaseClient,
  id: string,
): Promise<PdfDocument | null> {
  const doc = await getDocumentById(admin, id);
  if (!doc) return null;
  const [recipients, fields, events] = await Promise.all([
    loadRecipientsForDocument(admin, id),
    loadFieldsForDocument(admin, id),
    loadEventsForDocument(admin, id),
  ]);
  doc.recipients = recipients;
  doc.fields = fields;
  doc.events = events.map((e) => ({
    id: e.id,
    documentId: id,
    recipientId: e.payload?.recipientId as string | undefined,
    eventType: e.event_type,
    actor: e.actor,
    createdAt: e.created_at,
    payload: e.payload,
  }));
  return doc;
}

export async function enrichDocumentUrls(admin: SupabaseClient, doc: PdfDocument): Promise<PdfDocument> {
  const [originalPdfUrl, signedPdfUrl] = await Promise.all([
    createSignedUrl(admin, doc.originalPdfPath),
    createSignedUrl(admin, doc.signedPdfPath),
  ]);
  doc.originalPdfUrl = originalPdfUrl || undefined;
  doc.signedPdfUrl = signedPdfUrl || undefined;
  return doc;
}

export async function getTemplateById(admin: SupabaseClient, id: string): Promise<PdfTemplate | null> {
  const { data, error } = await admin.from("pdf_templates").select("*").eq("id", id).single();
  if (error || !data) return null;
  return mapTemplateRow(data as Record<string, unknown>);
}

export async function enrichTemplateUrl(admin: SupabaseClient, tpl: PdfTemplate): Promise<PdfTemplate> {
  tpl.pdfUrl = (await createSignedUrl(admin, tpl.pdfPath)) || undefined;
  return tpl;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  try {
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    return new Uint8Array(Buffer.from(base64, "base64"));
  } catch {
    return null;
  }
}
