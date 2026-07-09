import { NextRequest, NextResponse } from "next/server";
import { dispatchAutomation } from "@/lib/automation/engine.server";
import type { AutomationContext, WorkflowTrigger } from "@/lib/automation/types";

export const runtime = "nodejs";

/**
 * Fire a trigger into the automation engine. Backend event sources call this
 * (or `dispatchAutomation` directly). Also used by the UI's Manual Trigger.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as (Partial<AutomationContext> & { trigger?: WorkflowTrigger }) | null;
  if (!body?.trigger) return NextResponse.json({ error: "trigger is required" }, { status: 400 });
  const runs = await dispatchAutomation({ ...body, trigger: body.trigger } as AutomationContext, "trigger");
  return NextResponse.json({ ran: runs.length, runs });
}
