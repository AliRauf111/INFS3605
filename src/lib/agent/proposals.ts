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
import { DRAFT_KINDS, DRAFT_LABELS, REQUEST_TYPE_LABELS, STATUS_LABELS, type DraftKind, type RequestStatus, type RequestType } from "@/lib/domain/types";
import { canonicalJson, hashDecisionInput } from "@/lib/engine/hash";
import type { EvidenceSnapshot } from "@/lib/engine/evidence";
import { policyVersionLabel } from "@/lib/engine/policy";
import { validateFactsForm, type FactsForm } from "@/lib/validation/facts";
import { ACTION_RULES, PROPOSAL_ACTIONS, canConfirm, canPrepare, type ProposalAction } from "./permissions";
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
  })
  .strict();
export type PrepareInput = z.infer<typeof PrepareSchema>;

type StoredInputs =
  | { note: string }
  | { kind: DraftKind; body: string; generatedBy: string }
  | { form: FactsForm; facts: unknown; activityKey: string };

type Plan = {
  action: ProposalAction;
  targetId: string | null;
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
};

const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

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
  if (!data) throw new ApiError(404, "That request could not be found.");
  return data as RequestRow;
}

function targetOf(r: RequestRow) {
  return {
    reference: r.reference_id ?? r.booking_id ?? "No reference",
    shortId: shortId(r.id),
    href: `/requests/${r.id}`,
    typeLabel: REQUEST_TYPE_LABELS[r.request_type],
    statusLabel: STATUS_LABELS[r.status],
  };
}

const COLOUR_WORD = { green: "Green", amber: "Amber", red: "Red" } as const;

const ROLE_TEXT = { staff: "You (an admin or the owner) can confirm this.", owner: "Only the owner can confirm this." } as const;

/** Build the plan for an action from its inputs and the records as they are now. Throws ApiError if it isn't allowed. */
async function buildPlan(user: SessionUser, action: ProposalAction, requestId: string | null, raw: PrepareInput | StoredInputs, sessionKey: string | null): Promise<Plan> {
  const rule = ACTION_RULES[action];

  if (action === "request.create") {
    const r = raw as Partial<PrepareInput & { form: FactsForm; activityKey: string }>;
    const form = (("form" in r && r.form) || r.facts) as FactsForm | undefined;
    const v = validateFactsForm(form);
    if (!v.ok) throw new ApiError(400, "Some answers need fixing before this can be saved.", v.errors);
    const activityKey = ("activityKey" in r && r.activityKey) || crypto.randomUUID();
    const { evidence, policy, result, inputHash: decisionHash } = await decide(user, activityKey, v.facts);
    const procedures = await approvedProcedures().catch(() => []);
    const findings = procedureChecks(policy, procedures);
    const gaps = [...result.missing.map((m) => m.message), ...result.blockers];
    const changes: Change[] = [
      { field: "Request", current: "Not saved", proposed: `${REQUEST_TYPE_LABELS[v.facts.requestType]}${v.facts.amountCents !== null ? ` of ${formatAud(v.facts.amountCents)}` : ""}${v.facts.extensionDays ? `, ${v.facts.extensionDays} extra days` : ""} on ${v.facts.referenceId ?? v.facts.bookingId ?? "no reference"}` },
      { field: "Rule result", current: "None", proposed: `${COLOUR_WORD[result.colour]}: ${policy?.definition.rules.find((x) => x.id === result.matchedRuleId)?.label ?? result.outcomeLabel} (${result.policyVersion})` },
      { field: "Status", current: "None", proposed: STATUS_LABELS[result.suggestedStatus] },
    ];
    return {
      action, targetId: null, requestId: null, requestType: v.facts.requestType,
      inputs: { form: form!, facts: v.facts, activityKey },
      preconditions: {
        activePolicyId: policy?.id ?? null,
        recordsHash: evidenceHash(evidence),
        decision: { colour: result.colour, matchedRuleId: result.matchedRuleId, policyVersionId: result.policyVersionId, suggestedStatus: result.suggestedStatus, gaps },
      },
      preview: {
        title: "Save this request",
        target: { reference: v.facts.referenceId ?? v.facts.bookingId ?? "No reference", shortId: null, href: null, typeLabel: REQUEST_TYPE_LABELS[v.facts.requestType], statusLabel: null },
        changes,
        note: null,
        body: null,
        editable: null,
        requiredRoleText: ROLE_TEXT[rule.confirm],
        outcome: rule.outcome,
        warnings: [
          ...gaps.map((g) => `Still to confirm: ${g}`),
          ...findings.map((f) => f.text),
        ],
        policyRefs: policy ? [`${policy.definition.title} (${policyVersionLabel(policy)})`] : ["No active policy for this type"],
        versions: [`Records read ${fmtTime(evidence.retrievedAt)}`],
      },
      payload: {
        session_key: activityKey,
        request: requestColumns(v.facts, result, evidence),
        decision: decisionColumns(v.facts, result, policy, decisionHash),
        evidence,
      },
    };
  }

  if (!requestId || !UUID.test(requestId)) throw new ApiError(400, "Choose a request first.");
  const req = await loadRequest(requestId);
  const allowed = canPrepare(action, user.role, req.status);
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
    `Rule check #${req.decision_count}: ${req.decision.toUpperCase()} under ${req.matched_rule_id} (${req.policy_version})`,
    ...(active ? [`Active policy: ${active.definition.title} (${policyVersionLabel(active)})`] : []),
  ];
  const versions = [`Request last updated ${fmtTime(req.updated_at)}`];
  const warnings: string[] = [];
  if (active && req.policy_version_id && active.id !== req.policy_version_id) {
    warnings.push(`This request was checked under ${req.policy_version}, but ${policyVersionLabel(active)} is active now.`);
  }

  if (action === "draft.save") {
    const r = raw as { kind?: DraftKind; body?: string; generatedBy?: string };
    const kind = z.enum(DRAFT_KINDS).safeParse(r.kind);
    const body = z.string().trim().min(1, "The draft is empty.").max(6000, "Drafts must be under 6000 characters.").safeParse(r.body);
    if (!kind.success) throw new ApiError(400, "Unknown draft type.");
    if (!body.success) throw new ApiError(400, body.error.issues[0]?.message ?? "Check the draft.");
    const { data: existing, error } = await db().from("drafts").select("body, updated_at").eq("request_id", req.id).eq("kind", kind.data).maybeSingle();
    if (error) throw toDbError(error);
    const promises = findUnsupportedPromises(body.data, req.status);
    return {
      action, targetId: req.id, requestId: req.id, requestType: req.request_type,
      inputs: { kind: kind.data, body: body.data, generatedBy: r.generatedBy && r.generatedBy !== "edited" && r.generatedBy !== "simulated" ? r.generatedBy : "edited" },
      preconditions: { ...base, draftUpdatedAt: (existing?.updated_at as string | undefined) ?? null },
      preview: {
        title: `Save ${DRAFT_LABELS[kind.data].toLowerCase()} draft`,
        target, note: null, body: body.data,
        changes: [{ field: `${DRAFT_LABELS[kind.data]} draft`, current: existing ? `Saved draft from ${fmtTime(existing.updated_at as string)} (will be replaced)` : "No saved draft", proposed: "The text below" }],
        editable: { field: "body", label: "Draft text" },
        requiredRoleText: ROLE_TEXT[rule.confirm],
        outcome: rule.outcome,
        warnings: [...warnings, ...promises.map((p) => `The draft says "${p}", which hasn't happened. Change it before sending it anywhere.`)],
        policyRefs, versions,
      },
      payload: {},
    };
  }

  const note = NOTE.safeParse((raw as { note?: string }).note);
  if (!note.success) throw new ApiError(400, note.error.issues[0]?.message ?? "Add a note.");
  if (action === "request.approve" && req.request_type === "refund") {
    warnings.push("Approving records your decision. It does not transfer money. The admin team processes the refund outside Tutor Compass.");
  }
  if (action === "request.record_outcome" && /\b(refunded|processed|paid|moved|rescheduled|extended)\b/i.test(note.data) === false) {
    warnings.push("Say what was actually done, for example the amount refunded and where, so the record is useful later.");
  }
  if (req.welfare_status === "yes" && action === "request.send_to_owner") {
    warnings.push("Welfare concern: also phone the owner, as the welfare procedure (KB-01) says.");
  }
  return {
    action, targetId: req.id, requestId: req.id, requestType: req.request_type,
    inputs: { note: note.data },
    preconditions: base,
    preview: {
      title: `${rule.label}: ${target.reference}`,
      target,
      changes: [{ field: "Status", current: STATUS_LABELS[req.status], proposed: rule.to ? STATUS_LABELS[rule.to] : STATUS_LABELS[req.status] }],
      note: note.data,
      body: null,
      editable: { field: "note", label: action === "request.record_outcome" ? "What was done" : "Note" },
      requiredRoleText: ROLE_TEXT[rule.confirm],
      outcome: rule.outcome,
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
  target_type: "request" | "new_request";
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

const SETUP_MESSAGE = "Compass approvals aren't set up in the database yet. Run sql/compass-assistant.sql in Supabase (see the setup note), then try again.";

async function store(user: SessionUser, plan: Plan, sessionKey: string | null, replaces: string | null): Promise<ProposalRow> {
  const rule = ACTION_RULES[plan.action];
  const { data, error } = await db()
    .from("agent_proposals")
    .insert({
      created_by: user.id,
      created_role: user.role,
      session_key: sessionKey,
      action_type: plan.action,
      target_type: plan.targetId ? "request" : "new_request",
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
  if (notSetUp(error)) throw new ApiError(503, SETUP_MESSAGE);
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
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "That action wasn't in the expected format.");
  const p = parsed.data;
  const plan = await buildPlan(user, p.action, p.requestId ?? null, p, p.sessionKey ?? null);
  return view(await store(user, plan, p.sessionKey ?? null, null), user);
}

async function loadProposal(id: string, user: SessionUser): Promise<ProposalRow> {
  if (!UUID.test(id)) throw new ApiError(404, "That proposal could not be found.");
  const { data, error } = await db().from("agent_proposals").select("*").eq("id", id).maybeSingle();
  if (notSetUp(error)) throw new ApiError(503, SETUP_MESSAGE);
  if (error) throw toDbError(error);
  if (!data) throw new ApiError(404, "That proposal could not be found.");
  if (data.created_by !== user.id) throw new ApiError(403, "Only the person who prepared this can confirm, edit or cancel it.");
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

const STATUS_MESSAGES: Record<string, string> = {
  expired: "This preview has expired. Prepare it again to see the current records.",
  cancelled: "This was cancelled, so nothing was changed.",
  superseded: "This preview was replaced by an edited one. Confirm the newer preview instead.",
  stale: "The records changed after this preview, so it can't be used. Prepare it again.",
  failed: "This didn't go through earlier. Prepare it again.",
};

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
  if (row.status !== "pending") return { outcome: row.status, message: STATUS_MESSAGES[row.status] ?? "This can no longer be confirmed." } as ConfirmOutcome;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await settle(row.id, "expired");
    return { outcome: "expired", message: STATUS_MESSAGES.expired };
  }
  if (!canConfirm(row.required_role, user.role)) throw new ApiError(403, "Only the owner can confirm this decision.");

  // Revalidate against the records as they are now.
  const { plan, refusal } = await replan(user, row);
  const reasons = plan ? diffPreconditions(row.preconditions, plan.preconditions) : [refusal ?? "This action is no longer allowed."];
  if (!plan || reasons.length) {
    if (!(await settle(row.id, "stale", { changed: reasons }))) return confirmProposal(user, id);
    const fresh = plan ? view(await store(user, plan, row.session_key, row.id), user) : null;
    return {
      outcome: "changed",
      reasons,
      proposal: fresh,
      message: fresh ? "Something changed since you looked. Check the updated preview before confirming." : "Something changed since you looked, and this action is no longer available.",
    };
  }

  const { data, error } = await db().rpc("execute_agent_proposal", { p_id: row.id, p_actor: user.id, p_payload: plan.payload });
  if (notSetUp(error)) throw new ApiError(503, SETUP_MESSAGE);
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
      message: resultMessage(row.action_type, { requestType: plan.requestType ?? undefined, status: status ? STATUS_LABELS[status as RequestStatus] ?? status : undefined }),
    };
  }
  if (res.code === "stale") {
    const changed = describeDbChanges(res.changed ?? []);
    const again = await replan(user, row);
    const fresh = again.plan ? view(await store(user, again.plan, row.session_key, row.id), user) : null;
    return { outcome: "changed", reasons: changed, proposal: fresh, message: fresh ? "Something changed since you looked. Check the updated preview before confirming." : "Something changed since you looked, and this action is no longer available." };
  }
  if (res.code === "failed") {
    const clean = (res.error ?? "").replace(/^[a-z_]+:\s*/, "");
    return { outcome: "failed", message: `Nothing was changed. ${clean || "The database refused the change."}` };
  }
  return { outcome: (res.code as "expired") ?? "failed", message: STATUS_MESSAGES[res.code ?? "failed"] ?? "Nothing was changed." };
}

const EditSchema = z.object({ note: z.string().max(4000).optional(), body: z.string().max(6000).optional() }).strict();

/** Editing never changes a stored proposal. It replaces it with a new preview. */
export async function editProposal(user: SessionUser, id: string, body: unknown): Promise<ProposalView> {
  const parsed = EditSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "That edit wasn't in the expected format.");
  const row = await loadProposal(id, user);
  if (row.status !== "pending") throw new ApiError(409, STATUS_MESSAGES[row.status] ?? "This can no longer be edited.");
  const inputs = { ...(row.inputs as object), ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}), ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}) } as StoredInputs;
  if (canonicalJson(inputs) === canonicalJson(row.inputs)) return view(row, user);
  const plan = await buildPlan(user, row.action_type, row.target_id, inputs, row.session_key);
  if (!(await settle(row.id, "superseded"))) throw new ApiError(409, "This changed while you were editing. Open it again.");
  return view(await store(user, plan, row.session_key, row.id), user);
}

export async function cancelProposal(user: SessionUser, id: string): Promise<{ status: ProposalStatus; message: string }> {
  const row = await loadProposal(id, user);
  if (row.status !== "pending") return { status: row.status, message: STATUS_MESSAGES[row.status] ?? "This is already finished." };
  await settle(row.id, "cancelled");
  await logActivity({
    sessionKey: row.session_key ?? row.id, requestId: row.target_id, actorId: user.id, mode: "system",
    eventType: "proposal_cancelled", state: "completed", summary: `Cancelled "${ACTION_RULES[row.action_type].label}". Nothing was changed.`,
  });
  return { status: "cancelled", message: "Cancelled. Nothing was changed." };
}
