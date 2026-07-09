import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";
import { pushServerNotification } from "@/lib/server-notifications";
import { dispatchAutomation } from "@/lib/automation/engine.server";

export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Proposal id is required" }, { status: 400 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("proposal_shares")
    .select("payload")
    .eq("id", id)
    .single();

  if (error || !data?.payload) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const payload = data.payload as Record<string, unknown>;

  if (payload.status === "Won" || payload.status === "Signed" || payload.status === "Signed Offline") {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.xrproofing.app").replace(/\/+$/, "");
    return new NextResponse(declinePage("This proposal has already been signed and cannot be declined.", appUrl), { headers: { "Content-Type": "text/html" } });
  }

  if (payload.status === "Declined") {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.xrproofing.app").replace(/\/+$/, "");
    return new NextResponse(declinePage("This proposal has already been declined. Thank you for letting us know.", appUrl), { headers: { "Content-Type": "text/html" } });
  }

  const updatedPayload = {
    ...payload,
    status: "Declined",
    declinedAt: new Date().toISOString(),
    followUpStepCompleted: 999,
  };

  await supabase
    .from("proposal_shares")
    .upsert({ id, payload: updatedPayload, updated_at: new Date().toISOString() }, { onConflict: "id" });

  const customerName = (payload.customerName as string) || "Customer";
  const jobId = payload.job && typeof payload.job === "object" ? (payload.job as Record<string, unknown>)?.id as string | undefined : undefined;
  if (jobId) {
    try {
      await supabase.from("crew_activity_log").insert({
        id: `act-pdecline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        job_id: jobId,
        job_name: customerName,
        actor: customerName || "Client",
        action: `Proposal declined by ${customerName || "client"}`,
        details: `Proposal ${id} was declined by the customer`,
        module: "Proposal",
        created_at: new Date().toISOString(),
      });
    } catch { /* ignore */ }
  }

  await pushServerNotification({
    title: "Proposal declined",
    message: `${customerName} declined proposal ${id}`,
    actor: customerName,
    module: "Proposals",
  });

  // Fire admin-defined automations for the declined proposal (best-effort).
  await dispatchAutomation({ trigger: "proposal_declined", customerName, jobId, proposalStatus: "Declined" }).catch(() => {});

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.xrproofing.app").replace(/\/+$/, "");
  return new NextResponse(declinePage("Thank you for letting us know. We have noted your decision. If you change your mind in the future, please don't hesitate to reach out to us.", appUrl), { headers: { "Content-Type": "text/html" } });
}

function declinePage(message: string, appUrl: string) {
  const logoUrl = `${appUrl}/images/logo.jpeg`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>XRP Roofing — Proposal</title>
  <style>
    body { margin: 0; background: #f1f5f9; font-family: Arial, Helvetica, sans-serif; color: #0f172a; }
    .wrapper { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { max-width: 480px; width: 100%; background: #fff; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; padding: 48px 32px; }
    .logo { width: 120px; height: auto; margin-bottom: 24px; }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 16px; color: #1e293b; }
    p { font-size: 15px; line-height: 1.7; color: #475569; margin: 0; }
    .footer { margin-top: 32px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <img src="${logoUrl}" alt="XRP Roofing" class="logo" />
      <h1>Proposal Response Received</h1>
      <p>${message}</p>
      <p class="footer">XRP Roofing &middot; xrproofing.com</p>
    </div>
  </div>
</body>
</html>`;
}
