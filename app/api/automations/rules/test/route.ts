import { NextRequest, NextResponse } from "next/server";
import { getRule } from "@/lib/automation/store.server";
import { runRule } from "@/lib/automation/engine.server";
import type { AutomationContext } from "@/lib/automation/types";

export const runtime = "nodejs";

/** Run Now / Test — executes a rule immediately regardless of its ON/OFF state. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: string; context?: Partial<AutomationContext> } | null;
  if (!body?.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const rule = await getRule(body.id);
  if (!rule) return NextResponse.json({ error: "rule not found" }, { status: 404 });

  const ctx: AutomationContext = {
    trigger: rule.trigger,
    customerName: "Test Customer",
    ...body.context,
  };
  const run = await runRule(rule, ctx, "test");
  return NextResponse.json({ run });
}
