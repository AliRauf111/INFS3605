import "server-only";
import { db } from "@/lib/db/supabase";
import { logActivity } from "@/lib/agent/activity";
import { UNFINISHED } from "@/lib/agent/briefing-logic";
import type { ProposalAction } from "@/lib/agent/permissions";
import { attentionRows } from "@/lib/agent/reads";
import type { TurnCtx } from "@/lib/assistant/owner";
import type { AttentionBlock, Mood } from "@/lib/assistant/logic";
import type { RequestStatus } from "@/lib/domain/types";
import { countMissing } from "@/lib/workflow/next-step";
import { tr } from "@/lib/i18n/reply";
import { buildAttention, attentionHeadline, type AttentionFailure, type AttentionProposal, type AttentionRun } from "./attention-logic";
import { RunStateSchema, type WorkflowData } from "./logic";
import { openRuns } from "./records";
import { retentionAlert } from "@/lib/retention/server";

// "What Needs My Attention?": one prioritised list from current records. Each source is
// read with the signed-in person's permissions in mind: their own previews and workflows,
// and failed actions they prepared (the owner sees everyone's). Counts are exact.

const FAILED_DAYS = 14;

async function missingByDecision(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const res = await db().from("decisions").select("id, missing:result->missing").in("id", chunk);
    if (res.error) throw new Error(`Could not read rule results: ${res.error.message}`);
    for (const d of (res.data ?? []) as Array<{ id: string; missing: Array<{ fact: string }> | null }>) out.set(d.id, countMissing(d.missing));
  }
  return out;
}

function proposalIdsIn(d: WorkflowData): string[] {
  const ids = d.kind === "tutor_absence" ? [d.absenceProposalId, ...d.items.map((i) => i.pipeline.pendingProposalId)] : [d.pipeline.pendingProposalId];
  return ids.filter((x): x is string => Boolean(x));
}

type ProposalRow = { id: string; action_type: ProposalAction; created_at: string; created_by: string; target_id: string | null; inputs: Record<string, unknown> | null; result: Record<string, unknown> | null; status: string };

/** Everything that needs this person's attention, from current records. Shared by Compass and Insights. */
export async function readAttention(user: TurnCtx["user"], now: Date): Promise<AttentionBlock> {
  const since = new Date(now.getTime() - FAILED_DAYS * 86_400_000).toISOString();
  let failedQ = db().from("agent_proposals").select("id, action_type, created_at, created_by, target_id, inputs, result, status").eq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(200);
  if (user.role !== "owner") failedQ = failedQ.eq("created_by", user.id);
  const [requests, runRows, pendingRes, failedRes, laterRes] = await Promise.all([
    attentionRows(UNFINISHED),
    openRuns(user.id),
    db().from("agent_proposals").select("id, action_type, created_at, created_by, target_id, inputs, result, status").eq("created_by", user.id).eq("status", "pending").gt("expires_at", now.toISOString()).order("created_at", { ascending: false }).limit(200),
    failedQ,
    // A later success on the same request and action means the failure was sorted out.
    db().from("agent_proposals").select("action_type, target_id, created_at").eq("status", "succeeded").gte("created_at", since).limit(2000),
  ]);
  for (const r of [pendingRes, failedRes, laterRes]) if (r.error) throw new Error(`Could not read Compass actions: ${r.error.message}`);

  const missing = await missingByDecision(requests.map((r) => r.current_decision_id).filter((x): x is string => Boolean(x)));
  const byId = new Map(requests.map((r) => [r.id, r]));

  // Workflow runs, with the request each is working on.
  const runIds = new Map<string, string>();
  const runs: AttentionRun[] = [];
  const runRequestIds = runRows.map((r) => r.request_id).filter((x): x is string => Boolean(x) && !byId.has(x as string));
  const extra = runRequestIds.length
    ? ((await db().from("requests").select("id, status, current_decision_id").in("id", runRequestIds)).data ?? []) as Array<{ id: string; status: string; current_decision_id: string | null }>
    : [];
  const extraMissing = await missingByDecision(extra.map((r) => r.current_decision_id).filter((x): x is string => Boolean(x)));
  for (const row of runRows) {
    const parsed = RunStateSchema.safeParse(row.state);
    if (parsed.success) for (const id of proposalIdsIn(parsed.data.data)) runIds.set(id, row.id);
    let request: AttentionRun["request"] = null;
    if (row.request_id) {
      const r = byId.get(row.request_id);
      const e = extra.find((x) => x.id === row.request_id);
      if (r) request = { id: r.id, status: r.status, missing: r.current_decision_id ? missing.get(r.current_decision_id) ?? 0 : 0 };
      else if (e) request = { id: e.id, status: e.status as RequestStatus, missing: e.current_decision_id ? extraMissing.get(e.current_decision_id) ?? 0 : 0 };
    }
    runs.push({ id: row.id, workflow: row.workflow, status: row.status as "active" | "waiting", stage: row.stage, summary: row.summary, updated_at: row.updated_at, request });
  }

  const pending: AttentionProposal[] = ((pendingRes.data ?? []) as ProposalRow[])
    .filter((p) => !runIds.has(p.id))
    .map((p) => ({ id: p.id, action: p.action_type, created_at: p.created_at, target: targetLabel(p, byId) }));

  const later = (laterRes.data ?? []) as Array<{ action_type: string; target_id: string | null; created_at: string }>;
  const failed: AttentionFailure[] = ((failedRes.data ?? []) as ProposalRow[])
    .filter((f) => !later.some((s) => s.action_type === f.action_type && s.target_id && s.target_id === f.target_id && s.created_at > f.created_at))
    .filter((f) => !f.target_id || byId.has(f.target_id) || f.action_type === "tutor.record_absence")
    .map((f) => ({
      id: f.id,
      action: f.action_type,
      created_at: f.created_at,
      error: String(f.result?.error ?? f.result?.message ?? ""),
      targetId: f.target_id && byId.has(f.target_id) ? f.target_id : null,
      mine: f.created_by === user.id,
      runId: f.created_by === user.id ? runIds.get(f.id) ?? runForFailure(f, runs) : null,
    }));

  // The Student Retention alert is optional: a database without its tables just skips it.
  const retention = await retentionAlert(user, now).catch(() => null);

  return buildAttention({
    retention,
    role: user.role,
    now,
    requests: requests.map((r) => ({ ...r, missing: r.current_decision_id ? missing.get(r.current_decision_id) ?? 0 : 0 })),
    runs,
    pending,
    failed,
  });
}

export async function attentionTurn(ctx: TurnCtx): Promise<Mood> {
  const { user } = ctx;
  try {
    const block = await readAttention(user, new Date());
    ctx.steps.push({ label: tr("reply.att.stepReading"), state: "done" });
    ctx.steps.push({ label: tr("reply.att.stepApplying"), state: "done" });
    ctx.blocks.push({ kind: "text", text: attentionHeadline(block) });
    ctx.blocks.push(block);
    await logActivity({
      sessionKey: ctx.sessionKey, actorId: user.id, mode: "system", eventType: "briefing_prepared", state: "completed",
      summary: `Compass listed what needs attention from current records: ${block.counts.map((c) => `${c.key} ${c.count}`).join(", ")}.`,
      detail: { counts: Object.fromEntries(block.counts.map((c) => [c.key, c.count])) },
    });
    return block.total === 0 ? "success" : "neutral";
  } catch (e) {
    console.error("[compass] attention failed:", e instanceof Error ? e.message : e);
    ctx.steps.push({ label: tr("reply.att.stepFailed"), state: "failed" });
    ctx.blocks.push({ kind: "notice", tone: "error", text: tr("reply.att.readFailed") });
    return "error";
  }
}

function targetLabel(p: ProposalRow, byId: Map<string, { reference_id: string | null; booking_id: string | null }>): string | null {
  if (p.target_id) {
    const r = byId.get(p.target_id);
    return r ? r.reference_id ?? r.booking_id ?? null : null;
  }
  const facts = (p.inputs?.facts ?? null) as { referenceId?: string; bookingId?: string } | null;
  const inputs = (p.inputs?.inputs ?? null) as { tutorId?: string } | null;
  return facts?.referenceId || facts?.bookingId || inputs?.tutorId || null;
}

/** A failed apply step belongs to the workflow working on that request. */
function runForFailure(f: ProposalRow, runs: AttentionRun[]): string | null {
  if (!f.target_id) return null;
  return runs.find((r) => r.request?.id === f.target_id)?.id ?? null;
}
