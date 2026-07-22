// Generic server-side automation engine.
//
// This runs ONCE as infrastructure: every backend event source calls
// `dispatchAutomation(context)` with a trigger + context, and the engine loads
// the matching enabled rules from Supabase, evaluates their conditions, executes
// their actions, and records a run (Last Run / Success / Failed + error log).
//
// Adding new rules/triggers/actions later is pure UI + data — no backend edits.

import { sendConversationSms } from "@/lib/twilio/server";
import { publishConversationEvent } from "@/lib/twilio/realtime";
import { pushServerNotification } from "@/lib/server-notifications";
import { getAutomationClient } from "@/lib/automation/store.server";
import { listRules, upsertRule, appendRun } from "@/lib/automation/store.server";
import {
  newRunId,
  resolveTemplate,
  type AutomationContext,
  type AutomationRule,
  type AutomationRun,
  type AutomationRunStatus,
  type WorkflowCondition,
  type WorkflowAction,
} from "@/lib/automation/types";

// ── Condition evaluation ─────────────────────────────────────────────────────

function evaluateCondition(condition: WorkflowCondition, ctx: AutomationContext): boolean {
  const { field, operator, value } = condition;
  if (field === "always") return true;

  if (field === "schedule_date_exists") {
    const exists = !!ctx.scheduleDate;
    return operator === "not_exists" ? !exists : exists;
  }

  const numericCompare = (actual: number) => {
    const target = Number(value) || 0;
    if (operator === "greater_than") return actual > target;
    if (operator === "less_than") return actual < target;
    if (operator === "equals") return actual === target;
    if (operator === "not_equals") return actual !== target;
    return true;
  };

  const stringCompare = (actual: string) => {
    if (operator === "equals") return actual === value;
    if (operator === "not_equals") return actual !== value;
    if (operator === "exists") return !!actual;
    if (operator === "not_exists") return !actual;
    return !!actual;
  };

  switch (field) {
    case "days_since_sent": return numericCompare(ctx.daysSinceSent ?? 0);
    case "payment_amount": return numericCompare(ctx.paymentAmount ?? 0);
    case "proposal_status": return stringCompare(ctx.proposalStatus || "");
    case "job_stage": return stringCompare(ctx.jobStage || "");
    case "assigned_crew": return stringCompare(ctx.assignedCrew || "");
    default: return true;
  }
}

// ── Action execution ─────────────────────────────────────────────────────────

const OFFICE_SMS_NUMBER = process.env.OFFICE_SMS_NUMBER || process.env.NEXT_PUBLIC_OFFICE_PHONE || "";

function resolveRecipientPhone(recipient: string, ctx: AutomationContext): string {
  if (recipient === "customer") return String(ctx.customerPhone || "");
  return OFFICE_SMS_NUMBER;
}

async function sendEmailViaResend(to: string, subject: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: "XRP Roofing <noreply@xrproofing.com>", to: [to], subject, html: `<p style="white-space:pre-line">${body}</p>` }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
}

/**
 * Execute a single action. Returns a short human-readable label for the run log.
 * Throwing marks the action (and rule run) as failed with the error recorded.
 */
async function executeAction(action: WorkflowAction, ctx: AutomationContext): Promise<string> {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(action.params || {})) p[k] = resolveTemplate(String(v ?? ""), ctx);

  switch (action.type) {
    case "send_sms": {
      const to = resolveRecipientPhone(p.recipient || "customer", ctx);
      if (!to) return `SMS skipped — no ${p.recipient || "customer"} number`;
      const body = p.message || "";
      const message = await sendConversationSms({ to, body });
      // Log the outbound text into the conversation inbox so it threads into
      // the customer's Messages history (same as a manually-sent SMS).
      await publishConversationEvent({
        id: message.sid,
        type: "message_status",
        direction: "outbound",
        from: message.from,
        to: message.to,
        body: message.body || body,
        status: message.status,
        messageSid: message.sid,
        payload: { sid: message.sid, status: message.status, source: "automation" },
        createdAt: new Date().toISOString(),
      }).catch(() => {});
      return `SMS → ${p.recipient || "customer"}`;
    }
    case "send_email": {
      const to = p.recipient === "customer" ? String(ctx.customerEmail || "") : (process.env.OFFICE_EMAIL || "");
      if (!to) return `Email skipped — no ${p.recipient || "customer"} email`;
      await sendEmailViaResend(to, p.subject || "XRP Roofing", p.message || "");
      return `Email → ${p.recipient || "customer"}`;
    }
    case "send_notification":
    case "notify_admin": {
      await pushServerNotification({ title: action.type === "notify_admin" ? "Automation Alert" : "Automation", message: p.message || "", actor: "Automation", module: "automations" });
      return action.type === "notify_admin" ? "Admin notified" : `Notification → ${p.recipient || "office"}`;
    }
    case "create_reminder": {
      await pushServerNotification({ title: "Reminder", message: p.message || "", actor: "Automation", module: "automations" });
      return `Reminder created${p.delay_hours ? ` (in ${p.delay_hours}h)` : ""}`;
    }
    case "log_activity": {
      const supabase = getAutomationClient();
      if (supabase && ctx.jobId) {
        try {
          await supabase.from("crew_activity_log").insert({
            id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            job_id: ctx.jobId,
            action: "automation",
            actor: "Automation",
            details: p.message || "Automation action",
            created_at: new Date().toISOString(),
          });
        } catch { /* best-effort */ }
      }
      return "Logged activity";
    }
    case "trigger_webhook": {
      if (!p.url) return "Webhook skipped — no URL";
      const res = await fetch(p.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: ctx.trigger, context: ctx }),
      });
      if (!res.ok) throw new Error(`Webhook ${res.status}`);
      return `Webhook → ${p.url}`;
    }
    case "wait": return `Wait ${p.delay_minutes || "?"}m (scheduled in a later phase)`;
    case "end_workflow": return "Workflow ended";
    // Job/invoice/customer-mutating actions are wired in a later phase; recorded
    // here so rules referencing them don't hard-fail in the meantime.
    case "move_job_to_stage": return `Move to ${p.stage || "stage"} (pending)`;
    case "mark_invoice_paid": return "Mark invoice paid (pending)";
    case "assign_crew": return `Assign crew ${p.crew || ""} (pending)`;
    case "create_calendar_event": return "Create calendar event (pending)";
    case "create_task": return `Create task "${p.title || ""}" (pending)`;
    case "create_job": return `Create job "${p.title || ""}" (pending)`;
    case "add_note": return "Add note (pending)";
    case "add_tag": return `Add tag ${p.tag || ""} (pending)`;
    case "remove_tag": return `Remove tag ${p.tag || ""} (pending)`;
    case "update_customer": return `Update customer ${p.field || ""} (pending)`;
    case "if_else": return "If/Else branch (pending)";
    default: return `${action.type}`;
  }
}

// ── Rule execution ───────────────────────────────────────────────────────────

async function persistRunResult(rule: AutomationRule, run: AutomationRun): Promise<void> {
  const now = run.executedAt;
  const patch: AutomationRule = {
    ...rule,
    lastTriggered: now,
    lastRunAt: now,
    triggerCount: (rule.triggerCount || 0) + 1,
    updatedAt: rule.updatedAt,
  };
  if (run.status === "success") {
    patch.lastSuccessAt = now;
    patch.successCount = (rule.successCount || 0) + 1;
    patch.lastError = undefined;
  } else if (run.status === "failed") {
    patch.lastFailedAt = now;
    patch.failureCount = (rule.failureCount || 0) + 1;
    patch.lastError = run.error;
  }
  await upsertRule(patch);
  await appendRun(run);
}

/** Run a single rule regardless of its enabled/paused state (used by Run Now / Test). */
export async function runRule(rule: AutomationRule, ctx: AutomationContext, source: string): Promise<AutomationRun> {
  const executedAt = new Date().toISOString();
  const actionsExecuted: string[] = [];
  let status: AutomationRunStatus = "success";
  let error: string | undefined;

  const conditionsMet = (rule.conditions || []).every((c) => evaluateCondition(c, ctx));
  if (!conditionsMet) {
    status = "skipped";
  } else {
    for (const action of rule.actions || []) {
      try {
        actionsExecuted.push(await executeAction(action, ctx));
        if (action.type === "end_workflow") break;
      } catch (e) {
        status = "failed";
        error = e instanceof Error ? e.message : String(e);
        actionsExecuted.push(`${action.type} failed: ${error}`);
        break;
      }
    }
  }

  const run: AutomationRun = {
    id: newRunId(),
    ruleId: rule.id,
    ruleName: rule.name,
    trigger: ctx.trigger,
    status,
    actionsExecuted,
    error,
    context: Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
    source,
    executedAt,
  };

  await persistRunResult(rule, run);
  return run;
}

/**
 * Fire a trigger. Loads all enabled + active rules for this trigger, evaluates
 * conditions, executes actions, and records runs. Safe no-op if unconfigured.
 */
export async function dispatchAutomation(ctx: AutomationContext, source = "trigger"): Promise<AutomationRun[]> {
  const rules = await listRules();
  const matching = rules.filter((r) => r.enabled && r.status !== "paused" && r.trigger === ctx.trigger);
  const runs: AutomationRun[] = [];
  for (const rule of matching) {
    // A skipped run (conditions not met) isn't logged as noise.
    const run = await runRule(rule, ctx, source);
    if (run.status !== "skipped") runs.push(run);
  }
  return runs;
}
