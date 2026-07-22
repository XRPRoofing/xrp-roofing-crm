import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { applyProposalLock } from "@/lib/proposal-lock";
import { pushServerNotification } from "@/lib/server-notifications";
import { dispatchAutomation } from "@/lib/automation/engine.server";

const proposalSchema = z.record(z.string(), z.unknown()).and(z.object({ id: z.string().min(1) }));

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) return null;

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const proposal = proposalSchema.parse(await req.json());
    const supabase = getAdminClient();

    if (!supabase) {
      return NextResponse.json({ error: "Proposal sharing requires SUPABASE_SERVICE_ROLE_KEY so server writes can bypass row-level security." }, { status: 503 });
    }

    // A signed proposal is immutable: keep its locked package/price/signature
    // even if a stale board copy re-sends the whole record.
    const { data: existing } = await supabase
      .from("proposal_shares")
      .select("payload")
      .eq("id", proposal.id)
      .single();

    // Preserve heavy image fields (brochures + estimate/inspection photos) from
    // the existing record when the incoming data doesn't include them — the
    // board list strips them for performance, so a save from that slim copy
    // must not wipe them.
    const existingPayload = existing?.payload as Record<string, unknown> | null;
    let preserved = proposal;
    if (existingPayload?.brochures && !preserved.brochures) {
      preserved = { ...preserved, brochures: existingPayload.brochures };
    }
    if (existingPayload?.inspectionPhotos && !preserved.inspectionPhotos) {
      preserved = { ...preserved, inspectionPhotos: existingPayload.inspectionPhotos };
    }

    const payload = applyProposalLock(existingPayload ?? null, preserved);

    const { error } = await supabase
      .from("proposal_shares")
      .upsert({ id: proposal.id, payload, updated_at: new Date().toISOString() }, { onConflict: "id" });

    if (error) {
      return NextResponse.json({ error: error.message.includes("row-level security") ? "Supabase rejected the proposal share because SUPABASE_SERVICE_ROLE_KEY is missing or invalid. Add the service role key in Vercel environment variables and redeploy." : error.message }, { status: 503 });
    }

    return NextResponse.json({ ok: true, id: proposal.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid proposal data", details: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to share proposal" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Proposal id is required" }, { status: 400 });
  }

  const supabase = getAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: "Proposal sharing requires SUPABASE_SERVICE_ROLE_KEY so server reads can bypass row-level security." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("proposal_shares")
    .select("payload")
    .eq("id", id)
    .single();

  if (error || !data?.payload) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  return NextResponse.json({ proposal: data.payload }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" } });
}

export async function PATCH(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const updates = z.record(z.string(), z.unknown()).parse(await req.json());

    if (!id) {
      return NextResponse.json({ error: "Proposal id is required" }, { status: 400 });
    }

    const supabase = getAdminClient();

    if (!supabase) {
      return NextResponse.json({ error: "Proposal sharing requires SUPABASE_SERVICE_ROLE_KEY so server updates can bypass row-level security." }, { status: 503 });
    }

    const { data, error } = await supabase
      .from("proposal_shares")
      .select("payload")
      .eq("id", id)
      .single();

    if (error || !data?.payload) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    const proposal = proposalSchema.parse(data.payload);
    // Once signed, locked fields ignore further updates (e.g. re-opening the
    // link and tapping a different package must not change the accepted record).
    const nextProposal = applyProposalLock(proposal, { ...proposal, ...updates, id, updatedAt: new Date().toISOString() });
    const { error: updateError } = await supabase
      .from("proposal_shares")
      .upsert({ id, payload: nextProposal, updated_at: new Date().toISOString() }, { onConflict: "id" });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 503 });
    }

    const jobId = (proposal as Record<string, unknown>).job && typeof (proposal as Record<string, unknown>).job === "object" ? ((proposal as Record<string, unknown>).job as Record<string, unknown>)?.id as string | undefined : undefined;
    const proposalCustomerName = ((proposal as Record<string, unknown>).customerName as string) || "Customer";
    if (updates.status === "Viewed" && !(proposal as Record<string, unknown>).viewedAt) {
      await pushServerNotification({
        title: "Proposal viewed",
        message: `${proposalCustomerName} viewed proposal ${id}`,
        actor: proposalCustomerName,
        module: "Proposals",
      });
      if (jobId) {
        try {
          await supabase.from("crew_activity_log").insert({
            id: `act-pview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            job_id: jobId,
            job_name: proposalCustomerName,
            actor: proposalCustomerName || "Client",
            action: `Proposal viewed by ${proposalCustomerName || "client"}`,
            details: `Proposal ${id} opened by customer`,
            module: "Proposal",
            created_at: new Date().toISOString(),
          });
        } catch { /* ignore */ }
      }
    }

    if (updates.signedAt || updates.signatureData) {
      await pushServerNotification({
        title: "Proposal signed",
        message: `${proposalCustomerName} signed proposal ${id}`,
        actor: proposalCustomerName,
        module: "Proposals",
      });
      if (jobId) {
        try {
          await supabase.from("crew_activity_log").insert({
            id: `act-psign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            job_id: jobId,
            job_name: proposalCustomerName,
            actor: proposalCustomerName || "Client",
            action: `Proposal signed by ${proposalCustomerName || "client"}`,
            details: `Proposal ${id} accepted and signed`,
            module: "Proposal",
            created_at: new Date().toISOString(),
          });
        } catch { /* ignore */ }

        // Auto-move job to "approved" stage when proposal is signed
        try {
          await supabase.from("jobs").update({ stage: "approved" }).eq("id", jobId);
          await supabase.from("crew_activity_log").insert({
            id: `act-jauto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            job_id: jobId,
            job_name: proposalCustomerName,
            actor: "System",
            action: "Proposal signed by customer – Job moved to Approved",
            details: `Job automatically moved to Approved after proposal ${id} was signed by ${proposalCustomerName || "customer"}`,
            module: "Jobs",
            created_at: new Date().toISOString(),
          });
        } catch { /* ignore — job update is best-effort */ }
      }

      // Fire admin-defined automations for the signed proposal (best-effort).
      await dispatchAutomation({ trigger: "proposal_signed", customerName: proposalCustomerName, jobId, proposalStatus: "Signed", jobStage: "approved" }).catch(() => {});
    }

    // Fire down-payment automations the first time a deposit is recorded.
    if (updates.depositPaidAt && !(proposal as Record<string, unknown>).depositPaidAt) {
      const customerPhone = ((proposal as Record<string, unknown>).customerPhone as string) || "";
      const customerEmail = ((proposal as Record<string, unknown>).customerEmail as string) || "";
      const paymentAmount = Number(updates.depositPaidAmount ?? (proposal as Record<string, unknown>).depositPaidAmount ?? 0) || undefined;

      await pushServerNotification({
        title: "Down payment received",
        message: `${proposalCustomerName} paid a down payment on proposal ${id}`,
        actor: proposalCustomerName,
        module: "Proposals",
      });
      if (jobId) {
        try {
          await supabase.from("crew_activity_log").insert({
            id: `act-pdep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            job_id: jobId,
            job_name: proposalCustomerName,
            actor: proposalCustomerName || "Client",
            action: `Down payment received from ${proposalCustomerName || "client"}`,
            details: `Down payment recorded on proposal ${id}`,
            module: "Proposal",
            created_at: new Date().toISOString(),
          });
        } catch { /* ignore */ }
      }

      // Fire admin-defined automations for the down payment (best-effort).
      await dispatchAutomation({ trigger: "deposit_paid", customerName: proposalCustomerName, customerPhone, customerEmail, jobId, paymentAmount, proposalStatus: "Signed" }).catch(() => {});
    }

    return NextResponse.json({ proposal: nextProposal });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid proposal update data", details: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to update proposal" }, { status: 500 });
  }
}
