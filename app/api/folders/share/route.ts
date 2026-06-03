import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export const runtime = "nodejs";

const folderSharesTable = "folder_shares";
const jobPhotosTable = "job_photos";

const createSchema = z.object({
  folderId: z.string().min(1),
  jobId: z.string().min(1),
  address: z.string().min(1),
  customerName: z.string().min(1),
  workType: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
});

type FolderSharePayload = {
  folderId: string;
  jobId: string;
  address: string;
  customerName: string;
  workType: string;
  expiresAt?: string;
  passwordHash?: string;
  createdAt: string;
};

type PhotoRow = { id: string; photo_type: string; name: string; data_url: string; uploaded_by: string; created_at: string };

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function hashPassword(password: string) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function isExpired(expiresAt?: string) {
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt.length === 10 ? `${expiresAt}T23:59:59` : expiresAt);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now();
}

export async function POST(req: NextRequest) {
  let input: z.infer<typeof createSchema>;
  try {
    input = createSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Folder sharing requires SUPABASE_SERVICE_ROLE_KEY so server writes can bypass row-level security." }, { status: 503 });
  }

  const id = crypto.randomBytes(9).toString("base64url");
  const payload: FolderSharePayload = {
    folderId: input.folderId,
    jobId: input.jobId,
    address: input.address,
    customerName: input.customerName,
    workType: input.workType,
    expiresAt: input.expiresAt,
    passwordHash: input.password ? hashPassword(input.password) : undefined,
    createdAt: new Date().toISOString(),
  };

  const { error } = await supabase.from(folderSharesTable).upsert({ id, payload, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) {
    const message = error.message.includes("does not exist")
      ? "The folder_shares table is missing. Run supabase/folder-shares.sql in Supabase, then try again."
      : error.message;
    return NextResponse.json({ error: message }, { status: 503 });
  }

  return NextResponse.json({ ok: true, id });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const password = req.nextUrl.searchParams.get("password") || "";
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Folder sharing is not configured." }, { status: 503 });
  }

  const { data } = await supabase.from(folderSharesTable).select("payload").eq("id", id).single();
  const share = data?.payload as FolderSharePayload | undefined;
  if (!share) {
    return NextResponse.json({ error: "This share link is invalid or has been removed." }, { status: 404 });
  }

  if (isExpired(share.expiresAt)) {
    return NextResponse.json({ error: "This share link has expired." }, { status: 410 });
  }

  if (share.passwordHash) {
    if (!password) {
      return NextResponse.json({ error: "This gallery is password protected.", protected: true }, { status: 401 });
    }
    if (hashPassword(password) !== share.passwordHash) {
      return NextResponse.json({ error: "Incorrect password.", protected: true }, { status: 401 });
    }
  }

  const { data: photoRows } = await supabase
    .from(jobPhotosTable)
    .select("id, photo_type, name, data_url, uploaded_by, created_at")
    .eq("job_id", share.jobId)
    .order("created_at", { ascending: true });

  const photos = ((photoRows as PhotoRow[] | null) || []).map((row) => ({
    id: row.id,
    name: row.name || `${row.photo_type} photo`,
    dataUrl: row.data_url,
    photoType: row.photo_type,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.created_at,
  }));

  return NextResponse.json({
    ok: true,
    folder: {
      address: share.address,
      customerName: share.customerName,
      workType: share.workType,
    },
    photos,
  });
}
