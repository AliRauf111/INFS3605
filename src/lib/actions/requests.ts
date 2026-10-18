import "server-only";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { db, toDbError } from "@/lib/db/supabase";
import { ApiError } from "@/lib/api/handler";
import { toolEvaluate, toolRetrievePolicy, toolRetrieveRecords } from "@/lib/agent/tools";
import { logActivity } from "@/lib/agent/activity";
import type { DecisionResult } from "@/lib/engine/evaluate";
import type { EvidenceSnapshot } from "@/lib/engine/evidence";
import type { PolicySnapshot } from "@/lib/engine/policy";
import { SubmitRequestSchema, validateFactsForm, type ConfirmedFacts } from "@/lib/validation/facts";

// Action handling for requests: validate, retrieve context, evaluate, then save
// everything in one database transaction.

function requestColumns(facts: ConfirmedFacts, result: DecisionResult, evidence: EvidenceSnapshot) {
  return {
    request_type: facts.requestType,
    money_involved: facts.moneyInvolved,
    amount_cents: facts.amountCents,
    complaint_status: facts.complaint,
    welfare_status: facts.welfare,
    reference_id: facts.referenceId ?? facts.bookingId,
    booking_id: evidence.booking.status === "found" ? evidence.booking.record.id : null,
    context: facts.context,
    confirmed_facts: facts,
    decision: result.colour,
    decision_reason: result.explanation,
    matched_rule_id: result.matchedRuleId,
    policy_version: result.policyVersion,
    policy_version_id: result.policyVersionId,
    next_step: result.nextSteps[0] ?? "",
    status: result.suggestedStatus,
  };
}

function decisionColumns(facts: ConfirmedFacts, result: DecisionResult, policy: PolicySnapshot | null, inputHash: string) {
  return {
    colour: result.colour,
    matched_rule_id: result.matchedRuleId,
    policy_version: result.policyVersion,
    policy_version_id: result.policyVersionId,
    // A full copy of the rules used, so later edits cannot change what this decision meant.
    policy_snapshot: result.policyVersionId ? policy : null,
    facts,
    result,
    input_hash: inputHash,
    engine_version: result.engineVersion,
  };
}

async function decide(user: SessionUser, sessionKey: string, facts: ConfirmedFacts) {
  const evidence = await toolRetrieveRecords(user, { sessionKey, facts });
  const policy = await toolRetrievePolicy(user, sessionKey, facts.requestType);
  const { result, inputHash } = await toolEvaluate(user, sessionKey, facts, evidence, policy);
  return { evidence, policy, result, inputHash };
}

function validated(input: unknown): ConfirmedFacts {
  const v = validateFactsForm(input);
  if (!v.ok) throw new ApiError(400, "Some answers need fixing before this can be saved.", v.errors);
  return v.facts;
}

export async function submitRequest(user: SessionUser, body: unknown) {
  const parsed = SubmitRequestSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "The submission was not in the expected format.");
  const { idempotencyKey, intakeMethod } = parsed.data;
  const facts = validated(parsed.data.facts);

  // A repeat of an earlier submission returns the saved request without re-running anything.
  const { data: existing } = await db().from("requests").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) return { id: existing.id as string, duplicate: true };

  const { evidence, policy, result, inputHash } = await decide(user, idempotencyKey, facts);
  const { data, error } = await db().rpc("create_request", {
    p: {
      idempotency_key: idempotencyKey,
      actor_id: user.id,
      intake_method: intakeMethod,
      session_key: idempotencyKey,
      request: requestColumns(facts, result, evidence),
      decision: decisionColumns(facts, result, policy, inputHash),
      evidence,
    },
  });
  if (error) throw toDbError(error);
  const saved = data as { id: string; duplicate: boolean };
  return { id: saved.id, duplicate: saved.duplicate, colour: result.colour, status: result.suggestedStatus };
}

const ReevaluateSchema = z.object({ expectedDecisionId: z.uuid(), facts: z.unknown(), note: z.string().max(2000).optional() }).strict();

export async function reevaluateRequest(user: SessionUser, requestId: string, body: unknown) {
  const parsed = ReevaluateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "The update was not in the expected format.");
  const facts = validated(parsed.data.facts);
  const { data: current } = await db().from("requests").select("id, request_type, idempotency_key").eq("id", requestId).maybeSingle();
  if (!current) throw new ApiError(404, "Request not found.");
  if (current.request_type !== facts.requestType) throw new ApiError(400, "The request type cannot change. Create a new request instead.");

  const sessionKey = crypto.randomUUID();
  const { evidence, policy, result, inputHash } = await decide(user, sessionKey, facts);
  const { data, error } = await db().rpc("reevaluate_request", {
    p: {
      request_id: requestId,
      actor_id: user.id,
      expected_decision_id: parsed.data.expectedDecisionId,
      note: parsed.data.note ?? "",
      request: requestColumns(facts, result, evidence),
      decision: decisionColumns(facts, result, policy, inputHash),
      evidence,
    },
  });
  if (error) throw toDbError(error);
  await db().from("ai_activity").update({ request_id: requestId }).eq("session_key", sessionKey);
  return { ...(data as object), colour: result.colour };
}

export const TRANSITIONS = ["send_to_owner", "approve", "decline", "request_info", "record_and_close"] as const;
export const OWNER_ONLY = new Set(["approve", "decline", "request_info"]);
const TransitionSchema = z.object({ action: z.enum(TRANSITIONS), note: z.string().trim().min(1, "Add a note or reason.").max(4000) }).strict();

export async function transitionRequest(user: SessionUser, requestId: string, body: unknown) {
  const parsed = TransitionSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid action.");
  const { action, note } = parsed.data;
  // Checked here and again inside the database function.
  if (OWNER_ONLY.has(action) && user.role !== "owner") throw new ApiError(403, "Only the owner can do this.");
  const { data, error } = await db().rpc("transition_request", {
    p_request_id: requestId,
    p_actor: user.id,
    p_action: action,
    p_note: note,
  });
  if (error) throw toDbError(error);
  if (action === "send_to_owner") {
    await logActivity({
      sessionKey: crypto.randomUUID(), requestId, actorId: user.id, mode: "system",
      eventType: "owner_review_created", state: "completed",
      summary: `Owner review request created by ${user.displayName} after confirming the summary.`,
    });
  }
  return data as { id: string; status: string };
}
