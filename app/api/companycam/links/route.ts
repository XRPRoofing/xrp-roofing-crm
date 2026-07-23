import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

export const runtime = "nodejs";

const integrationsTable = "app_integrations";
// Single row holding the { jobId -> CompanyCam project } map for the whole
// tenant, so every device/user opens the same linked project. Stored in the
// existing app_integrations JSON table — no schema change required.
const linksKey = "companycam_job_links";

const linkSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  projectUrl: z.string().default(""),
  address: z.string().default(""),
});

export type CompanyCamJobLink = {
  projectId: string;
  projectUrl: string;
  address: string;
  linkedAt: string;
};

type LinkMap = Record<string, CompanyCamJobLink>;

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type AdminClient = NonNullable<ReturnType<typeof getAdminClient>>;

async function readLinks(admin: AdminClient): Promise<LinkMap> {
  const { data } = await admin
    .from(integrationsTable)
    .select("payload")
    .eq("id", linksKey)
    .maybeSingle();
  const payload = data?.payload as { links?: LinkMap } | undefined;
  return payload?.links || {};
}

async function writeLinks(admin: AdminClient, links: LinkMap) {
  await admin
    .from(integrationsTable)
    .upsert({ id: linksKey, payload: { links }, updated_at: new Date().toISOString() });
}

/** GET /api/companycam/links — returns the whole { jobId -> link } map. */
export async function GET() {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ links: {} });
  try {
    return NextResponse.json({ links: await readLinks(admin) });
  } catch {
    return NextResponse.json({ links: {} });
  }
}

/** POST /api/companycam/links — save/replace the link for one job. */
export async function POST(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "CompanyCam linking requires SUPABASE_SERVICE_ROLE_KEY." },
      { status: 503 },
    );
  }

  let input: z.infer<typeof linkSchema>;
  try {
    input = linkSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }

  try {
    const links = await readLinks(admin);
    links[input.jobId] = {
      projectId: input.projectId,
      projectUrl: input.projectUrl,
      address: input.address,
      linkedAt: new Date().toISOString(),
    };
    await writeLinks(admin, links);
    return NextResponse.json({ ok: true, link: links[input.jobId] });
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("does not exist")
        ? "The app_integrations table is missing. Run supabase/app-integrations.sql, then try again."
        : "Unable to save CompanyCam link.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

/** DELETE /api/companycam/links?jobId=X — unlink one job. */
export async function DELETE(req: NextRequest) {
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ ok: true });
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  try {
    const links = await readLinks(admin);
    if (links[jobId]) {
      delete links[jobId];
      await writeLinks(admin, links);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to unlink." }, { status: 503 });
  }
}
