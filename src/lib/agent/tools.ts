import "server-only";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { getActivePolicy, retrieveEvidence } from "@/lib/context/retrieve";
import { evaluate, type DecisionResult } from "@/lib/engine/evaluate";
import type { EvidenceSnapshot } from "@/lib/engine/evidence";
import { hashDecisionInput } from "@/lib/engine/hash";
import { policyVersionLabel, type PolicySnapshot } from "@/lib/engine/policy";
import { formatAud } from "@/lib/domain/money";
import { ConfirmedFactsSchema, type ConfirmedFacts } from "@/lib/validation/facts";
import { logActivity, type ActivityInput } from "./activity";

// The agent's tools. They are ordinary server functions with checked inputs, run in a
// fixed order by our code. The language model never picks or calls them directly, which
// keeps the agent predictable and stops a pasted message from steering it.

const Input = z.object({ sessionKey: z.uuid(), facts: ConfirmedFactsSchema });

/** Tool: retrieve authorised records for the confirmed identifiers. */
export async function toolRetrieveRecords(user: SessionUser, input: z.input<typeof Input>) {
  const { sessionKey, facts } = Input.parse(input);
  const evidence = await retrieveEvidence(facts);
  const events: ActivityInput[] = [];
  const base = { sessionKey, actorId: user.id, mode: "system" as const };
  const b = evidence.booking;
  if (b.status === "found") {
    events.push({
      ...base, eventType: "booking_retrieved", state: b.record.stale ? "blocked" : "completed",
      summary: `Booking ${b.record.id} retrieved: ${b.record.subject} with ${b.record.tutorName}${b.record.stale ? " (may be out of date)" : ""}.`,
      detail: { source: "bookings", id: b.record.id, dataLabel: b.record.dataLabel, lastSyncedAt: b.record.lastSyncedAt },
    });
  } else if (b.status === "multiple") {
    events.push({ ...base, eventType: "booking_retrieved", state: "blocked", summary: `${b.candidates.length} bookings match ${b.reference}. The admin must choose one.`, detail: { candidates: b.candidates.map((c) => c.id) } });
  } else if (b.status === "not_found") {
    events.push({ ...base, eventType: "booking_retrieved", state: "failed", summary: `No booking matches ${b.reference}.`, detail: { reference: b.reference } });
  }
  if (evidence.payments.status === "checked") {
    const recs = evidence.payments.records;
    events.push({
      ...base, eventType: "payment_found", state: recs.length ? "completed" : "blocked",
      summary: recs.length
        ? `${recs.length} payment record${recs.length > 1 ? "s" : ""} found: ${recs.map((r) => `${r.id} ${formatAud(r.amountCents)} ${r.status}`).join(", ")}.`
        : "No payment records found for this booking.",
      detail: { source: "payments", ids: recs.map((r) => r.id), dataLabel: recs[0]?.dataLabel },
    });
  }
  const a = evidence.availability;
  if (a.status === "found") {
    events.push({
      ...base, eventType: "availability_checked", state: a.record.status === "free" && !a.record.stale ? "completed" : "blocked",
      summary: `Slot ${a.record.id} for ${a.record.tutorName} is ${a.record.status}.`,
      detail: { source: "tutor_availability", id: a.record.id, dataLabel: a.record.dataLabel },
    });
  } else if (a.status === "not_found") {
    events.push({ ...base, eventType: "availability_checked", state: "failed", summary: `Slot ${a.slotId} was not found.` });
  }
  await logActivity(events);
  return evidence;
}

/** Tool: retrieve the active owner-approved policy for a category. */
export async function toolRetrievePolicy(user: SessionUser, sessionKey: string, category: ConfirmedFacts["requestType"]) {
  const policy = category === "other" ? null : await getActivePolicy(category);
  await logActivity({
    sessionKey, actorId: user.id, mode: "system", eventType: "policy_retrieved",
    state: policy ? "completed" : "blocked",
    summary: policy
      ? `Approved policy retrieved: ${policy.definition.title} (${policyVersionLabel(policy)}).`
      : category === "other"
        ? "No policy exists for this kind of request."
        : "No active owner-approved policy was found for this request type.",
    detail: policy ? { source: "policy_versions", id: policy.id, version: policy.version } : {},
  });
  return policy;
}

/** Tool: run the deterministic rule engine on confirmed facts and log the outcome. */
export async function toolEvaluate(
  user: SessionUser,
  sessionKey: string,
  facts: ConfirmedFacts,
  evidence: EvidenceSnapshot,
  policy: PolicySnapshot | null,
): Promise<{ result: DecisionResult; inputHash: string }> {
  const result = evaluate({ facts, evidence, policy });
  const inputHash = hashDecisionInput({ facts, evidence, policy, engine: result.engineVersion });
  const events: ActivityInput[] = [];
  if (result.missing.length || result.blockers.length) {
    events.push({
      sessionKey, actorId: user.id, mode: "system", eventType: "missing_information", state: "blocked",
      summary: [...result.missing.map((m) => m.message), ...result.blockers].slice(0, 4).join(" "),
      detail: { missing: result.missing, blockers: result.blockers },
    });
  }
  events.push({
    sessionKey, actorId: user.id, mode: "system", eventType: "decision_completed", state: "completed",
    summary: `Rule engine: ${result.colour.toUpperCase()} under ${result.matchedRuleId} (${result.policyVersion}).`,
    detail: { colour: result.colour, rule: result.matchedRuleId, policyVersion: result.policyVersion, inputHash },
  });
  await logActivity(events);
  return { result, inputHash };
}
