import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export const runtime = "nodejs";

const integrationsTable = "app_integrations";
const manualFoldersKey = "manual_folders";
const jobsTable = "jobs";
const jobPhotosTable = "job_photos";
// Keep in sync with MANUAL_FOLDER_SOURCE in lib/crew-sync.ts. Backing job rows
// carry this source so loadCrewDataset hides them from every job board.
const manualFolderSource = "Manual Folder";

const folderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  workType: z.string().min(1),
  customerName: z.string().default(""),
  createdAt: z.string().min(1),
});

type ManualFolder = z.infer<typeof folderSchema>;

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type AdminClient = NonNullable<ReturnType<typeof getAdminClient>>;

async function readFolders(admin: AdminClient): Promise<ManualFolder[]> {
  const { data } = await admin.from(integrationsTable).select("payload").eq("id", manualFoldersKey).maybeSingle();
  const payload = data?.payload as { folders?: ManualFolder[] } | undefined;
  return payload?.folders || [];
}

async function writeFolders(admin: AdminClient, folders: ManualFolder[]) {
  await admin
    .from(integrationsTable)
    .upsert({ id: manualFoldersKey, payload: { folders }, updated_at: new Date().toISOString() });
}

// Every manual folder needs a hidden backing row in `jobs` so its photos satisfy
// the job_photos -> jobs foreign key. Done server-side with the service role so
// it bypasses RLS (the browser's anon client cannot write to `jobs`). Idempotent
// upsert by id, so it also heals folders created before this existed.
async function upsertBackingJob(admin: AdminClient, folder: ManualFolder) {
  const { error } = await admin.from(jobsTable).upsert(
    {
      id: folder.id,
      name: folder.customerName || folder.name,
      email: "",
      phone: "",
      address: folder.address || folder.name,
      city: "",
      stage: "new_lead",
      value: 0,
      assigned_to: "",
      roof_type: folder.workType || "General",
      source: manualFolderSource,
      last_activity: "Manual folder",
      next_action: "",
      due_date: "",
      status: "Assigned",
      assigned_crew: [],
      schedule_date: "",
      job_scope: folder.workType || "General",
      job_notes: "",
      completion_notes: "",
      materials_used: "",
      submitted_at: null,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
}

export async function GET() {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ folders: [] });
  try {
    return NextResponse.json({ folders: await readFolders(admin) });
  } catch {
    return NextResponse.json({ folders: [] });
  }
}

export async function POST(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Manual folders require SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }

  let folder: ManualFolder;
  try {
    folder = folderSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
  }

  try {
    // Create the backing job first so photos can be saved into the folder.
    await upsertBackingJob(admin, folder);
    const existing = await readFolders(admin);
    const next = [folder, ...existing.filter((item) => item.id !== folder.id)];
    await writeFolders(admin, next);
    return NextResponse.json({ ok: true, folder });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("does not exist")
      ? "The app_integrations table is missing. Run supabase/app-integrations.sql, then try again."
      : "Unable to save folder.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ ok: true });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    // Remove the backing job's photos then the job row itself, then drop the
    // folder metadata.
    await admin.from(jobPhotosTable).delete().eq("job_id", id);
    await admin.from(jobsTable).delete().eq("id", id);
    const existing = await readFolders(admin);
    await writeFolders(admin, existing.filter((item) => item.id !== id));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to delete folder." }, { status: 503 });
  }
}
