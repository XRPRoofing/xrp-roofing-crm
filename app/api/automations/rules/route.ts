import { NextRequest, NextResponse } from "next/server";
import { listRules, getRule, getRulesStatus, upsertRule, deleteRule } from "@/lib/automation/store.server";
import { newRuleId, type AutomationRule } from "@/lib/automation/types";

export const runtime = "nodejs";

function nowIso() {
  return new Date().toISOString();
}

function normalizeIncoming(input: Partial<AutomationRule>, existing?: AutomationRule): AutomationRule {
  const id = existing?.id || input.id || newRuleId();
  const createdAt = existing?.createdAt || input.createdAt || nowIso();
  return {
    id,
    name: input.name ?? existing?.name ?? "Untitled Rule",
    description: input.description ?? existing?.description ?? "",
    trigger: (input.trigger ?? existing?.trigger ?? "job_created") as AutomationRule["trigger"],
    conditions: input.conditions ?? existing?.conditions ?? [{ field: "always", operator: "exists", value: "" }],
    actions: input.actions ?? existing?.actions ?? [],
    enabled: input.enabled ?? existing?.enabled ?? true,
    status: input.status ?? existing?.status ?? "active",
    createdAt,
    updatedAt: nowIso(),
    createdBy: existing?.createdBy ?? input.createdBy,
    updatedBy: input.updatedBy ?? existing?.updatedBy,
    lastTriggered: existing?.lastTriggered ?? input.lastTriggered,
    lastRunAt: existing?.lastRunAt ?? input.lastRunAt,
    lastSuccessAt: existing?.lastSuccessAt ?? input.lastSuccessAt,
    lastFailedAt: existing?.lastFailedAt ?? input.lastFailedAt,
    lastError: existing?.lastError ?? input.lastError,
    triggerCount: existing?.triggerCount ?? input.triggerCount ?? 0,
    successCount: existing?.successCount ?? input.successCount ?? 0,
    failureCount: existing?.failureCount ?? input.failureCount ?? 0,
  };
}

export async function GET() {
  const status = await getRulesStatus();
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Partial<AutomationRule> | null;
  if (!body || !body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const rule = normalizeIncoming({ ...body, id: undefined });
  const res = await upsertRule(rule);
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 503 });
  return NextResponse.json({ rule });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as (Partial<AutomationRule> & { id?: string }) | null;
  if (!body?.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const existing = await getRule(body.id);
  if (!existing) return NextResponse.json({ error: "rule not found" }, { status: 404 });
  const rule = normalizeIncoming(body, existing);
  const res = await upsertRule(rule);
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 503 });
  return NextResponse.json({ rule });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const res = await deleteRule(id);
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 503 });
  return NextResponse.json({ ok: true });
}

/** Bulk import — used once to migrate localStorage rules into shared storage. */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { rules?: Partial<AutomationRule>[] } | null;
  if (!body?.rules?.length) return NextResponse.json({ imported: 0 });
  const existing = await listRules();
  const existingIds = new Set(existing.map((r) => r.id));
  let imported = 0;
  for (const raw of body.rules) {
    if (raw.id && existingIds.has(raw.id)) continue;
    // Migrated rules arrive paused so nothing fires unexpectedly until an admin
    // reviews and turns it on.
    const rule = normalizeIncoming({ ...raw, status: "paused" });
    const res = await upsertRule(rule);
    if (res.ok) imported += 1;
  }
  return NextResponse.json({ imported });
}
