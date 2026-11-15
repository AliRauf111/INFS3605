import "server-only";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/handler";
import { db, toDbError } from "@/lib/db/supabase";
import { logActivity } from "@/lib/agent/activity";
import { decide, decisionColumns, requestColumns } from "@/lib/actions/requests";
import { findUnsupportedPromises } from "@/lib/actions/drafts-logic";
import { getActivePolicy, liveRecordsForBooking } from "@/lib/context/retrieve";
import { formatAud } from "@/lib/domain/money";
import { DRAFT_KINDS, type DraftKind, type RequestStatus, type RequestType } from "@/lib/domain/types";
import { tr } from "@/lib/i18n/reply";
import { formatStamp } from "@/lib/workflows/dates";
import { canonicalJson, hashDecisionInput } from "@/lib/engine/hash";
import type { EvidenceSnapshot } from "@/lib/engine/evidence";
import { policyVersionLabel } from "@/lib/engine/policy";
import { validateFactsForm, type FactsForm } from "@/lib/validation/facts";
import { countMissing } from "@/lib/workflow/next-step";
import { ACTION_RULES, PROPOSAL_ACTIONS, actionLabel, actionOutcome, canConfirm, canPrepare, type ProposalAction } from "./permissions";
import {
  describeDbChanges,
  diffPreconditions,
  expiryFrom,
  inputHash,
  resultMessage,
  type Change,
  type Preconditions,
  type ProposalPreview,
  type ProposalStatus,
  type ProposalView,
} from "./proposal-logic";
import { approvedProcedures, UUID } from "./reads";
import { shortId } from "./briefing-logic";
import { procedureChecks } from "./review-logic";
import { absencePlan, extensionPlan, reschedulePlan, type WorkflowRequest } from "@/lib/workflows/plans";

// The shared approval process. Compass prepares; the person confirms; the server checks
// everything again and only then makes the change.
//
//   Understand -> Retrieve -> Validate -> Preview -> User confirms -> Revalidate -> Execute -> Report
//
// prepareProposal builds and stores the exact preview. confirmProposal rebuilds the plan
// from the stored inputs, compares the record and policy versions, and hands over to the
// execute_agent_proposal database function, which checks role, expiry, duplicates and
// the request row again under a lock, and writes the change and its audit record in one
// transaction. Success is reported only from that function's answer.

const NOTE = z.string().trim().min(1, "Add a note.").max(4000, "Keep the note under 4000 characters.");

export const PrepareSchema = z
  .object({
    sessionKey: z.uuid().optional(),
    action: z.enum(PROPOSAL_ACTIONS),
    requestId: z.uuid().optional(),
    note: z.string().max(4000).optional(),
    kind: z.enum(DRAFT_KINDS).optional(),
    body: z.string().max(6000).optional(),
    generatedBy: z.enum(["template", "live_ai", "simulated", "edited"]).optional(),
    facts: z.unknown().optional(),
    /** Inputs for a workflow action (Move Lesson, Extend Due Date, Record Absence). */
    inputs: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type PrepareInput = z.infer<typeof PrepareSchema>;

type StoredInputs =
  | { note: string }
  | { kind: DraftKind; body: string; generatedBy: string }
  | { form: FactsForm; facts: unknown; activityKey: string }
  | Record<string, unknown>;

type Plan = {
  action: ProposalAction;
  targetId: string | null;
  targetType: "request" | "new_request" | "tutor";
  inputs: StoredInputs;
  preconditions: Preconditions;
  preview: ProposalPreview;
  /** Extra data the database needs to execute, built fresh at confirm time. */
  payload: Record<string, unknown>;
  requestId: string | null;
  requestType: RequestType | null;
};

type RequestRow = {
  id: string;
  request_type: RequestType;
  status: RequestStatus;
  current_decision_id: string | null;
  updated_at: string;
  archived_at?: string | null;
  hidden_at?: string | null;
  reference_id: string | null;
  booking_id: string | null;
  amount_cents: number | null;
  decision: string;
  matched_rule_id: string;
  policy_version: string;
  policy_version_id: string | null;
  decision_count: number;
  welfare_status: string | null;
  confirmed_facts: { proposedSlotId?: string | null; extensionDays?: number | null } | null;
};

// Previews and messages follow the reader's language. Activity summaries, notes and the
// stored inputs stay in English, so the audit trail reads the same for everyone.
const fmtTime = (iso: string) => formatStamp(iso);
const statusLabel = (s: RequestStatus) => tr(`domain.status.${s}`);
const typeLabel = (t: RequestType) => tr(`domain.requestType.${t}`);
const draftLabel = (k: DraftKind) => tr(`domain.draft.${k}`);

function recordsHash(evidence: { booking: unknown; payments: unknown; slot?: unknown }): string {
  return hashDecisionInput(evidence);
}

async function liveHash(bookingId: string | null): Promise<string | null> {
  if (!bookingId) return null;
  const live = await liveRecordsForBooking(bookingId);
  return recordsHash({
    booking: live.booking && { id: live.booking.id, status: live.booking.status, used: live.booking.lessonsUsed, bought: live.booking.lessonsPurchased, price: live.booking.priceCents, synced: live.booking.lastSyncedAt },
    payments: (live.payments ?? []).map((p) => ({ id: p.id, status: p.status, amount: p.amountCents, synced: p.lastSyncedAt })),
  });
}

function evidenceHash(e: EvidenceSnapshot): string {
  return recordsHash({
    booking: e.booking.status === "found" ? { id: e.booking.record.id, status: e.booking.record.status, used: e.booking.record.lessonsUsed, synced: e.booking.record.lastSyncedAt } : e.booking.status,
    payments: e.payments.status === "checked" ? e.payments.records.map((p) => ({ id: p.id, status: p.status, amount: p.amountCents, synced: p.lastSyncedAt })) : "not_checked",
    slot: e.availability.status === "found" ? { id: e.availability.record.id, status: e.availability.record.status, synced: e.availability.record.lastSyncedAt } : e.availability.status,
  });
}

async function loadRequest(id: string): Promise<RequestRow> {
  const { data, error } = await db().from("requests").select("*").eq("id", id).maybeSingle();
  if (error) throw toDbError(error);
  if (!data) throw new ApiError(404, tr("reply.prop.requestNotFound"));
  return data as RequestRow;
}

/** Required details the request's latest rule check says are missing. */
async function missingFor(decisionId: string | null): Promise<number> {
  if (!decisionId) return 0;
  const { data, error } = await db().from("decisions").select("missing:result->missing").eq("id", decisionId).maybeSingle();
  if (error) throw toDbError(error);
  return countMissing((data as { missing: Array<{ fact: string }> | null } | null)?.missing);
}

function targetOf(r: RequestRow) {
  return {
    reference: r.reference_id ?? r.booking_id ?? tr("reply.prop.noReference"),
    shortId: shortId(r.id),
    href: `/requests/${r.id}`,
    typeLabel: typeLabel(r.request_type),
    statusLabel: statusLabel(r.status),
  };
}

const colourWord = (c: "green" | "amber" | "red") => tr(`reply.colour.${c}`);

const roleText = (r: "staff" | "owner") => tr(`reply.prop.role.${r}`);

/** Build the plan for an action from its inputs and the records as they are now. Throws ApiError if it isn't allowed. */
async function buildPlan(user: SessionUser, action: ProposalAction, requestId: string | null, raw: PrepareInput | StoredInputs, sessionKey: string | null): Promise<Plan> {
  const rule = ACTION_RULES[action];

  if (action === "request.create") {
    const r = raw as Partial<PrepareInput & { form: FactsForm; activityKey: string }>;
    const form = (("form" in r && r.form) || r.facts) as FactsForm | undefined;
    const v = validateFactsForm(form);
    if (!v.ok) throw new ApiError(400, tr("reply.prop.fixAnswers"), v.errors);
    const activityKey = ("activityKey" in r && r.activityKey) || crypto.randomUUID();
    const { evidence, policy, result, inputHash: decisionHash } = await decide(user, activityKey, v.facts);
    const procedures = await approvedProcedures().catch(() => []);
    const findings = procedureChecks(policy, procedures);
    const gaps = [...result.missing.map((m) => m.message), ...result.blockers];
    const changes: Change[] = [
      {
        field: tr("reply.plan.request"),
        current: tr("reply.prop.notSaved"),
        proposed: tr("reply.prop.newRequest", {
          type: typeLabel(v.facts.requestType),
          amount: v.facts.amountCents !== null ? tr("reply.prop.ofAmount", { amount: formatAud(v.facts.amountCents) }) : "",
          days: v.facts.extensionDays ? tr("reply.prop.extraDays", { count: Number(v.facts.extensionDays) }) : "",
          reference: v.facts.referenceId ?? v.facts.bookingId ?? tr("reply.prop.noReferenceLower"),
        }),
      },
      { field: tr("reply.prop.ruleResult"), current: tr("reply.wf.none"), proposed: `${colourWord(result.colour)}: ${policy?.definition.rules.find((x) => x.id === result.matchedRuleId)?.label ?? result.outcomeLabel} (${result.policyVersion})` },
      { field: tr("reply.prop.status"), current: tr("reply.wf.none"), proposed: statusLabel(result.suggestedStatus) },
    ];
    return {
      action, targetId: null, targetType: "new_request", requestId: null, requestType: v.facts.requestType,
      inputs: { form: form!, facts: v.facts, activityKey },
      preconditions: {
        activePolicyId: policy?.id ?? null,
        recordsHash: evidenceHash(evidence),
        decision: { colour: result.colour, matchedRuleId: result.matchedRuleId, policyVersionId: result.policyVersionId, suggestedStatus: result.suggestedStatus, gaps },
      },
      preview: {
        title: tr("reply.prop.saveTitle"),
        target: { reference: v.facts.referenceId ?? v.facts.bookingId ?? tr("reply.prop.noReference"), shortId: null, href: null, typeLabel: typeLabel(v.facts.requestType), statusLabel: null },
        changes,
        note: null,
        body: null,
        editable: null,
        requiredRoleText: roleText(rule.confirm),
        outcome: actionOutcome(action),
        warnings: [
          ...gaps.map((g) => tr("reply.prop.stillToConfirm", { gap: g })),
          ...findings.map((f) => f.text),
        ],
        policyRefs: policy ? [`${policy.definition.title} (${policyVersionLabel(policy)})`] : [tr("reply.prop.noPolicy")],
        versions: [tr("reply.prop.recordsRead", { time: fmtTime(evidence.retrievedAt) })],
      },
      payload: {
        session_key: activityKey,
        request: requestColumns(v.facts, result, evidence),
        decision: decisionColumns(v.facts, result, policy, decisionHash),
        evidence,
      },
    };
  }

  // Workflow inputs arrive as `inputs` when first prepared, and as the stored inputs when re-checked.
  const workflowInputs = (raw as { inputs?: unknown }).inputs ?? raw;

  if (action === "tutor.record_absence") {
    if (!rule.prepare.includes(user.role)) throw new ApiError(403, tr("reply.prop.cantRecordAbsence"));
    const part = await absencePlan(workflowInputs);
    return {
      action, targetId: null, targetType: "tutor", requestId: null, requestType: null,
      inputs: part.inputs,
      preconditions: { workflow: part.workflow },
      preview: {
        title: part.title,
        target: { reference: part.target!.reference, shortId: null, href: null, typeLabel: part.target!.typeLabel, statusLabel: null },
        changes: part.changes, note: null, body: null, editable: null,
        requiredRoleText: roleText(rule.confirm), outcome: actionOutcome(action), warnings: part.warnings, policyRefs: [], versions: part.versions,
      },
      payload: {},
    };
  }

  if (!requestId || !UUID.test(requestId)) throw new ApiError(400, tr("reply.prop.chooseRequest"));
  const req = await loadRequest(requestId);
  const allowed = canPrepare(action, user.role, req.status, await missingFor(req.current_decision_id));
  if (!allowed.ok) throw new ApiError(user.role !== "owner" && rule.prepare.length === 1 ? 403 : 409, allowed.reason);
  const active = req.request_type === "other" ? null : await getActivePolicy(req.request_type);
  const target = targetOf(req);
  const base: Preconditions = {
    status: req.status,
    currentDecisionId: req.current_decision_id,
    updatedAt: req.updated_at,
    archivedAt: req.archived_at ?? null,
    hiddenAt: req.hidden_at ?? null,
    activePolicyId: active?.id ?? null,
    recordsHash: await liveHash(req.booking_id),
  };
  const policyRefs = [
    tr("reply.prop.ruleCheck", { n: req.decision_count, colour: req.decision.toUpperCase(), rule: req.matched_rule_id, version: req.policy_version }),
    ...(active ? [tr("reply.prop.activePolicy", { title: active.definition.title, version: policyVersionLabel(active) })] : []),
  ];
  const versions = [tr("reply.prop.requestUpdated", { time: fmtTime(req.updated_at) })];
  const warnings: string[] = [];
  if (active && req.policy_version_id && active.id !== req.policy_version_id) {
    warnings.push(tr("reply.prop.olderPolicy", { old: req.policy_version, now: policyVersionLabel(active) }));
  }

  if (action === "booking.reschedule" || action === "invoice.extend_due_date") {
    const part = action === "booking.reschedule" ? await reschedulePlan(req as WorkflowRequest, workflowInputs) : await extensionPlan(req as WorkflowRequest, workflowInputs);
    return {
      action, targetId: req.id, targetType: "request", requestId: req.id, requestType: req.request_type,
      inputs: part.inputs,
      preconditions: { ...base, workflow: part.workflow },
      preview: {
        title: part.title,
        target: { ...target, reference: part.target?.reference ?? target.reference },
        changes: part.changes, note: null, body: null, editable: null,
        requiredRoleText: roleText(rule.confirm), outcome: actionOutcome(action),
        warnings: [...warnings, ...part.warnings],
        policyRefs, versions: [...versions, ...part.versions],
      },
      payload: {},
    };
  }

  if (action === "draft.save") {
    const r = raw as { kind?: DraftKind; body?: string; generatedBy?: string };
    const kind = z.enum(DRAFT_KINDS).safeParse(r.kind);
    const body = z.string().trim().min(1, "The draft is empty.").max(6000, "Drafts must be under 6000 characters.").safeParse(r.body);
    if (!kind.success) throw new ApiError(400, tr("reply.prop.unknownDraft"));
    if (!body.success) throw new ApiError(400, body.error.issues[0]?.message ?? tr("reply.prop.checkDraft"));
    const { data: existing, error } = await db().from("drafts").select("body, updated_at").eq("request_id", req.id).eq("kind", kind.data).maybeSingle();
    if (error) throw toDbError(error);
    const promises = findUnsupportedPromises(body.data, req.status);
    return {
      action, targetId: req.id, targetType: "request", requestId: req.id, requestType: req.request_type,
      inputs: { kind: kind.data, body: body.data, generatedBy: r.generatedBy && r.generatedBy !== "edited" && r.generatedBy !== "simulated" ? r.generatedBy : "edited" },
      preconditions: { ...base, draftUpdatedAt: (existing?.updated_at as string | undefined) ?? null },
      preview: {
        title: tr("reply.prop.saveDraftTitle", { kind: draftLabel(kind.data).toLowerCase() }),
        target, note: null, body: body.data,
        changes: [{ field: tr("reply.prop.draftField", { kind: draftLabel(kind.data) }), current: existing ? tr("reply.prop.savedDraftFrom", { time: fmtTime(existing.updated_at as string) }) : tr("reply.prop.noSavedDraft"), proposed: tr("reply.prop.textBelow") }],
        editable: { field: "body", label: tr("reply.prop.draftText") },
        requiredRoleText: roleText(rule.confirm),
        outcome: actionOutcome(action),
        warnings: [...warnings, ...promises.map((p) => tr("reply.prop.unsupportedPromise", { phrase: p }))],
        policyRefs, versions,
      },
      payload: {},
    };
  }

  const note = NOTE.safeParse((raw as { note?: string }).note);
  if (!note.success) throw new ApiError(400, note.error.issues[0]?.message ?? tr("reply.prop.addNote"));
  if (action === "request.approve" && req.request_type === "refund") {
    warnings.push(tr("reply.prop.approveNoMoney"));
  }
  if (action === "request.record_outcome" && /\b(refunded|processed|paid|moved|rescheduled|extended)\b/i.test(note.data) === false) {
    warnings.push(tr("reply.prop.sayWhatWasDone"));
  }
  if (req.welfare_status === "yes" && action === "request.send_to_owner") {
    warnings.push(tr("reply.prop.welfarePhone"));
  }
  return {
    action, targetId: req.id, targetType: "request", requestId: req.id, requestType: req.request_type,
    inputs: { note: note.data },
    preconditions: base,
    preview: {
      title: `${actionLabel(action)}: ${target.reference}`,
      target,
      changes: [{ field: tr("reply.prop.status"), current: statusLabel(req.status), proposed: statusLabel(rule.to ?? req.status) }],
      note: note.data,
      body: null,
      editable: { field: "note", label: tr(action === "request.record_outcome" ? "reply.prop.whatWasDone" : "reply.prop.note") },
      requiredRoleText: roleText(rule.confirm),
      outcome: actionOutcome(action),
      warnings,
      policyRefs,
      versions,
    },
    payload: {},
  };
}

type ProposalRow = {
  id: string;
  created_by: string;
  created_role: string;
  session_key: string | null;
  action_type: ProposalAction;
  target_type: "request" | "new_request" | "tutor";
  target_id: string | null;
  inputs: StoredInputs;
  preconditions: Preconditions;
  preview: ProposalPreview;
  required_role: "staff" | "owner";
  status: ProposalStatus;
  replaces: string | null;
  expires_at: string;
  result: Record<string, unknown> | null;
};

function view(row: ProposalRow, user: SessionUser): ProposalView {
  return {
    id: row.id,
    action: row.action_type,
    status: row.status,
    preview: row.preview,
    requiredRole: row.required_role,
    canConfirm: row.created_by === user.id && canConfirm(row.required_role, user.role) && row.status === "pending",
    expiresAt: row.expires_at,
    replaces: row.replaces,
  };
}

function notSetUp(error: { message?: string; code?: string } | null): boolean {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /agent_proposals|execute_agent_proposal/.test(error.message ?? "")));
}

export const workflowSetupMessage = () => tr("reply.prop.workflowSetup");

const setupMessage = () => tr("reply.prop.setup");

async function store(user: SessionUser, plan: Plan, sessionKey: string | null, replaces: string | null): Promise<ProposalRow> {
  const rule = ACTION_RULES[plan.action];
  const { data, error } = await db()
    .from("agent_proposals")
    .insert({
      created_by: user.id,
      created_role: user.role,
      session_key: sessionKey,
      action_type: plan.action,
      target_type: plan.targetType,
      target_id: plan.targetId,
      inputs: plan.inputs,
      input_hash: inputHash(plan.action, plan.targetId, plan.inputs),
      preconditions: plan.preconditions,
      preview: plan.preview,
      required_role: rule.confirm,
      expires_at: expiryFrom(new Date()),
      replaces,
    })
    .select("*")
    .single();
  if (notSetUp(error)) throw new ApiError(503, setupMessage());
  if (error && error.code === "23514" && /action_type|target_type/.test(error.message ?? "")) throw new ApiError(503, workflowSetupMessage());
  if (error) throw toDbError(error);
  await logActivity({
    sessionKey: sessionKey ?? data.id, requestId: plan.requestId, actorId: user.id, mode: "system",
    eventType: "proposal_prepared", state: "pending",
    summary: `Compass prepared "${rule.label}"${plan.preview.target.reference ? ` for ${plan.preview.target.reference}` : ""}. Waiting for confirmation; nothing is saved yet.`,
    detail: { proposalId: data.id, action: plan.action },
  });
  return data as ProposalRow;
}

/** Validate and preview an action, and store the proposal. Nothing about the request changes. */
export async function prepareProposal(user: SessionUser, body: unknown): Promise<ProposalView> {
  const parsed = PrepareSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? tr("reply.prop.badFormat"));
  const p = parsed.data;
  const plan = await buildPlan(user, p.action, p.requestId ?? null, p, p.sessionKey ?? null);
  return view(await store(user, plan, p.sessionKey ?? null, null), user);
}

async function loadProposal(id: string, user: SessionUser): Promise<ProposalRow> {
  if (!UUID.test(id)) throw new ApiError(404, tr("reply.prop.proposalNotFound"));
  const { data, error } = await db().from("agent_proposals").select("*").eq("id", id).maybeSingle();
  if (notSetUp(error)) throw new ApiError(503, setupMessage());
  if (error) throw toDbError(error);
  if (!data) throw new ApiError(404, tr("reply.prop.proposalNotFound"));
  if (data.created_by !== user.id) throw new ApiError(403, tr("reply.prop.onlyPreparer"));
  return data as ProposalRow;
}

/** Move a pending proposal to another state. Returns false if it was no longer pending. */
async function settle(id: string, status: ProposalStatus, result?: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await db()
    .from("agent_proposals")
    .update({ status, updated_at: new Date().toISOString(), ...(result ? { result } : {}) })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw toDbError(error);
  return (data ?? []).length > 0;
}

export type ConfirmOutcome =
  | { outcome: "succeeded"; message: string; duplicate: boolean; requestId: string | null; status: string | null }
  | { outcome: "changed"; message: string; reasons: string[]; proposal: ProposalView | null }
  | { outcome: "expired" | "cancelled" | "superseded" | "failed" | "stale"; message: string };

const MESSAGE_STATUSES = ["expired", "cancelled", "superseded", "stale", "failed"] as const;
const statusMessage = (s: string | undefined, fallback: string): string =>
  (MESSAGE_STATUSES as readonly string[]).includes(s ?? "") ? tr(`reply.prop.statusMessage.${s as (typeof MESSAGE_STATUSES)[number]}`) : fallback;

async function replan(user: SessionUser, row: ProposalRow): Promise<{ plan: Plan | null; refusal: string | null }> {
  try {
    return { plan: await buildPlan(user, row.action_type, row.target_id, row.inputs, row.session_key), refusal: null };
  } catch (e) {
    if (e instanceof ApiError && e.status < 500) return { plan: null, refusal: e.message };
    throw e;
  }
}

/**
 * Confirm a proposal. The server re-reads the records and re-runs the rules first. If
 * anything material changed, the old proposal is marked stale and a fresh one is
 * returned for the person to look at again. Repeated calls never repeat the change.
 */
export async function confirmProposal(user: SessionUser, id: string): Promise<ConfirmOutcome> {
  const row = await loadProposal(id, user);
  if (row.status === "succeeded") {
    return { outcome: "succeeded", duplicate: true, message: resultMessage(row.action_type, {}), requestId: (row.result?.id as string) ?? row.target_id, status: (row.result?.status as string) ?? null };
  }
  if (row.status !== "pending") return { outcome: row.status, message: statusMessage(row.status, tr("reply.prop.noLongerConfirm")) } as ConfirmOutcome;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await settle(row.id, "expired");
    return { outcome: "expired", message: statusMessage("expired", "") };
  }
  if (!canConfirm(row.required_role, user.role)) throw new ApiError(403, tr("reply.prop.ownerConfirms"));

  // Revalidate against the records as they are now.
  const { plan, refusal } = await replan(user, row);
  const reasons = plan ? diffPreconditions(row.preconditions, plan.preconditions) : [refusal ?? tr("reply.prop.noLongerAllowed")];
  if (!plan || reasons.length) {
    if (!(await settle(row.id, "stale", { changed: reasons }))) return confirmProposal(user, id);
    const fresh = plan ? view(await store(user, plan, row.session_key, row.id), user) : null;
    return {
      outcome: "changed",
      reasons,
      proposal: fresh,
      message: tr(fresh ? "reply.prop.changedCheck" : "reply.prop.changedGone"),
    };
  }

  const { data, error } = await db().rpc("execute_agent_proposal", { p_id: row.id, p_actor: user.id, p_payload: plan.payload });
  if (notSetUp(error)) throw new ApiError(503, setupMessage());
  if (error) throw toDbError(error);
  const res = data as { ok: boolean; duplicate?: boolean; code?: string; changed?: string[]; error?: string; result?: Record<string, unknown> };

  if (res.ok) {
    const requestId = (res.result?.id as string | undefined) ?? row.target_id;
    let status = (res.result?.status as string | undefined) ?? null;
    if (!status && requestId) {
      const { data: saved } = await db().from("requests").select("status").eq("id", requestId).maybeSingle();
      status = (saved?.status as string | undefined) ?? null;
    }
    await logActivity({
      sessionKey: row.session_key ?? row.id, requestId, actorId: user.id, mode: "system",
      eventType: "proposal_confirmed", state: "completed",
      summary: `${user.displayName} confirmed "${ACTION_RULES[row.action_type].label}" prepared by Compass. The server rechecked the records and rules before saving.`,
      detail: { proposalId: row.id, action: row.action_type },
    });
    return {
      outcome: "succeeded",
      duplicate: Boolean(res.duplicate),
      requestId,
      status,
      message: resultMessage(row.action_type, { requestType: plan.requestType ?? undefined, status: status ? statusLabel(status as RequestStatus) || status : undefined }),
    };
  }
  if (res.code === "stale") {
    const changed = describeDbChanges(res.changed ?? []);
    const again = await replan(user, row);
    const fresh = again.plan ? view(await store(user, again.plan, row.session_key, row.id), user) : null;
    return { outcome: "changed", reasons: changed, proposal: fresh, message: tr(fresh ? "reply.prop.changedCheck" : "reply.prop.changedGone") };
  }
  if (res.code === "failed") {
    const clean = (res.error ?? "").replace(/^[a-z_]+:\s*/, "");
    return { outcome: "failed", message: `${tr("reply.common.nothingChanged")} ${clean || tr("reply.wf.dbRefused")}` };
  }
  return { outcome: (res.code as "expired") ?? "failed", message: statusMessage(res.code ?? "failed", tr("reply.common.nothingChanged")) };
}

const EditSchema = z.object({ note: z.string().max(4000).optional(), body: z.string().max(6000).optional() }).strict();

/** Editing never changes a stored proposal. It replaces it with a new preview. */
export async function editProposal(user: SessionUser, id: string, body: unknown): Promise<ProposalView> {
  const parsed = EditSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, tr("reply.prop.badEdit"));
  const row = await loadProposal(id, user);
  if (row.status !== "pending") throw new ApiError(409, statusMessage(row.status, tr("reply.prop.noLongerEdit")));
  const inputs = { ...(row.inputs as object), ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}), ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}) } as StoredInputs;
  if (canonicalJson(inputs) === canonicalJson(row.inputs)) return view(row, user);
  const plan = await buildPlan(user, row.action_type, row.target_id, inputs, row.session_key);
  if (!(await settle(row.id, "superseded"))) throw new ApiError(409, tr("reply.prop.changedWhileEditing"));
  return view(await store(user, plan, row.session_key, row.id), user);
}

/** The current preview of a proposal this person prepared, to show it again. */
export async function proposalView(user: SessionUser, id: string): Promise<ProposalView> {
  return view(await loadProposal(id, user), user);
}

export async function cancelProposal(user: SessionUser, id: string): Promise<{ status: ProposalStatus; message: string }> {
  const row = await loadProposal(id, user);
  if (row.status !== "pending") return { status: row.status, message: statusMessage(row.status, tr("reply.prop.alreadyFinished")) };
  await settle(row.id, "cancelled");
  await logActivity({
    sessionKey: row.session_key ?? row.id, requestId: row.target_id, actorId: user.id, mode: "system",
    eventType: "proposal_cancelled", state: "completed", summary: `Cancelled "${ACTION_RULES[row.action_type].label}". Nothing was changed.`,
  });
  return { status: "cancelled", message: tr("reply.prop.cancelled") };
}
