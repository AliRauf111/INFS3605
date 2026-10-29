import type { ActionKey, Colour, RequestStatus } from "@/lib/domain/types";
import { formatAud } from "@/lib/domain/money";
import type { ConfirmedFacts } from "@/lib/validation/facts";
import type { EvidenceSnapshot, PaymentRecord } from "./evidence";
import {
  CATEGORY_CONFIG,
  FACT_LABELS,
  type FactKey,
  type PolicySnapshot,
  type Rule,
  describeRange,
  policyVersionLabel,
  toInterval,
} from "./policy";

// The deterministic decision engine.
//
// It is a pure function: no database, no AI, no clock, no randomness. Give it the same
// confirmed facts, the same evidence snapshot and the same policy version and it returns
// exactly the same result. That is what makes decisions explainable and testable.
// The AI never calls this with its own guesses: facts must be confirmed by a person first.

export const ENGINE_VERSION = "engine-1";
export const SYSTEM_RULES_VERSION = "system-v1";

export type EvidenceRef = {
  kind: "booking" | "payment" | "slot" | "policy";
  id: string;
  label: string;
  dataLabel?: string;
};

export type MissingItem = { fact: FactKey | "policy" | "request_type"; message: string };

export type DecisionResult = {
  colour: Colour;
  outcomeLabel: string;
  matchedRuleId: string;
  /** The owner rule that would have applied if nothing had blocked it, when different. */
  candidateRuleId: string | null;
  policyVersion: string;
  policyVersionId: string | null;
  explanation: string;
  evidence: EvidenceRef[];
  missing: MissingItem[];
  blockers: string[];
  permittedActions: ActionKey[];
  nextSteps: string[];
  escalation: string | null;
  suggestedStatus: RequestStatus;
  engineVersion: string;
};

export type EngineInput = {
  facts: ConfirmedFacts;
  evidence: EvidenceSnapshot;
  policy: PolicySnapshot | null;
};

const OUTCOME: Record<Colour, string> = {
  green: "Go ahead with the approved steps",
  amber: "Check first or get owner approval",
  red: "Stop and escalate to the owner",
};

const ESCALATION_ACTIONS: ActionKey[] = ["prepare_escalation_summary", "send_to_owner"];

function result(partial: Omit<DecisionResult, "outcomeLabel" | "engineVersion">): DecisionResult {
  return { ...partial, outcomeLabel: OUTCOME[partial.colour], engineVersion: ENGINE_VERSION };
}

function triMissing(value: string | null, fact: FactKey, question: string): MissingItem | null {
  if (value === null) return { fact, message: `${question} was not answered.` };
  if (value === "unsure") return { fact, message: `${question} is marked "not sure". Confirm it before going ahead.` };
  return null;
}

function evidenceRefs(evidence: EvidenceSnapshot, policy: PolicySnapshot | null): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  if (evidence.booking.status === "found") {
    const b = evidence.booking.record;
    refs.push({ kind: "booking", id: b.id, label: `${b.subject} with ${b.tutorName}`, dataLabel: b.dataLabel });
  }
  if (evidence.payments.status === "checked") {
    for (const p of evidence.payments.records) {
      refs.push({
        kind: "payment",
        id: p.id,
        label: `${p.invoiceRef}: ${formatAud(p.amountCents)} (${p.status})`,
        dataLabel: p.dataLabel,
      });
    }
  }
  if (evidence.availability.status === "found") {
    const s = evidence.availability.record;
    refs.push({ kind: "slot", id: s.id, label: `${s.tutorName}, ${s.startsAt} (${s.status})`, dataLabel: s.dataLabel });
  }
  if (policy) {
    refs.push({ kind: "policy", id: policy.id, label: `${policy.definition.title} (${policyVersionLabel(policy)})` });
  }
  return refs;
}

/** Look for payment records that disagree with each other or with the request. */
function paymentProblems(payments: PaymentRecord[], refundCents: number | null): string[] {
  const problems: string[] = [];
  const disputed = payments.filter((p) => p.status === "disputed");
  if (disputed.length > 0) {
    problems.push(`Payment ${disputed.map((p) => p.id).join(", ")} is marked as disputed.`);
  }
  const byInvoice = new Map<string, Set<number>>();
  for (const p of payments) {
    if (p.status !== "paid") continue;
    const set = byInvoice.get(p.invoiceRef) ?? new Set<number>();
    set.add(p.amountCents);
    byInvoice.set(p.invoiceRef, set);
  }
  for (const [invoice, amounts] of byInvoice) {
    if (amounts.size > 1) {
      problems.push(`Invoice ${invoice} has paid records with different amounts. The records conflict.`);
    }
  }
  if (refundCents !== null) {
    const paid = payments.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amountCents, 0);
    const refunded = payments.filter((p) => p.status === "refunded").reduce((sum, p) => sum + p.amountCents, 0);
    if (refundCents > paid - refunded) {
      problems.push(
        `The refund (${formatAud(refundCents)}) is more than the amount paid and not yet refunded (${formatAud(
          Math.max(0, paid - refunded),
        )}).`,
      );
    }
  }
  return problems;
}

/** Check each fact the policy says is required. Returns what is missing and what blocks green. */
function checkRequiredFacts(
  required: FactKey[],
  facts: ConfirmedFacts,
  evidence: EvidenceSnapshot,
): { missing: MissingItem[]; blockers: string[] } {
  const missing: MissingItem[] = [];
  const blockers: string[] = [];
  const add = (m: MissingItem | null) => m && missing.push(m);

  for (const fact of required) {
    switch (fact) {
      case "amount":
        if (facts.moneyInvolved === "no") {
          blockers.push("This is recorded as a refund, but the answers say no money is involved. The records conflict.");
        } else if (facts.moneyInvolved !== "yes") {
          add(triMissing(facts.moneyInvolved, "amount", "Whether money is involved"));
        }
        if (facts.amountCents === null) missing.push({ fact, message: "The refund amount was not provided." });
        break;
      case "complaint":
        add(triMissing(facts.complaint, fact, "Complaint status"));
        break;
      case "welfare":
        add(triMissing(facts.welfare, fact, "Child welfare status"));
        break;
      case "reference": {
        const b = evidence.booking;
        if (!facts.referenceId && !facts.bookingId) missing.push({ fact, message: "No booking reference was given." });
        else if (b.status === "not_checked") missing.push({ fact, message: "The booking has not been looked up yet." });
        else if (b.status === "not_found") missing.push({ fact, message: `No booking matches "${b.reference}".` });
        else if (b.status === "multiple")
          missing.push({ fact, message: `${b.candidates.length} bookings match "${b.reference}". Choose the right one.` });
        else if (b.record.stale) blockers.push(`Booking ${b.record.id} has not been updated recently, so it may be out of date.`);
        break;
      }
      case "payment_record": {
        const p = evidence.payments;
        if (p.status === "not_checked") missing.push({ fact, message: "Payment records have not been checked." });
        else if (p.records.length === 0) missing.push({ fact, message: "No payment record was found for this booking." });
        else {
          blockers.push(...paymentProblems(p.records, facts.requestType === "refund" ? facts.amountCents : null));
          const stale = p.records.filter((r) => r.stale);
          if (stale.length) blockers.push(`Payment ${stale.map((r) => r.id).join(", ")} may be out of date.`);
        }
        break;
      }
      case "financial_impact":
        add(triMissing(facts.financialImpact, fact, "Whether the change affects fees"));
        break;
      case "availability": {
        const a = evidence.availability;
        if (!facts.proposedSlotId) missing.push({ fact, message: "No new lesson time was chosen." });
        else if (a.status === "not_checked") missing.push({ fact, message: "Tutor availability has not been checked." });
        else if (a.status === "not_found") missing.push({ fact, message: `Time slot ${a.slotId} was not found.` });
        else {
          const slot = a.record;
          if (slot.status !== "free") blockers.push(`The tutor is not free at ${slot.startsAt}.`);
          if (slot.stale) blockers.push(`Availability for slot ${slot.id} may be out of date.`);
          if (evidence.booking.status === "found" && evidence.booking.record.tutorId !== slot.tutorId) {
            blockers.push("The chosen time slot belongs to a different tutor from the booking.");
          }
        }
        break;
      }
      case "extension_days":
        if (facts.extensionDays === null) missing.push({ fact, message: "The number of extra days was not provided." });
        break;
      case "outstanding_invoice": {
        const p = evidence.payments;
        if (p.status === "not_checked") missing.push({ fact, message: "Payment records have not been checked." });
        else if (!p.records.some((r) => r.status === "pending" || r.status === "overdue"))
          missing.push({ fact, message: "No unpaid invoice was found for this booking." });
        else if (p.records.some((r) => r.status === "disputed"))
          blockers.push("A payment on this booking is disputed. The records conflict.");
        break;
      }
    }
  }
  return { missing, blockers };
}

function ruleMatches(rule: Rule, facts: ConfirmedFacts, numericValue: number | null): boolean | "unknown" {
  if (rule.range) {
    if (numericValue === null) return "unknown";
    const [lo, hi] = toInterval(rule.range);
    if (numericValue < lo || numericValue > hi) return false;
  }
  if (rule.financialImpact) {
    if (facts.financialImpact === null || facts.financialImpact === "unsure") return "unknown";
    if (facts.financialImpact !== rule.financialImpact) return false;
  }
  return true;
}

export function evaluate({ facts, evidence, policy }: EngineInput): DecisionResult {
  const refs = evidenceRefs(evidence, policy);

  // 1. Safety rules come first and win even when other information is missing.
  if (facts.welfare === "yes" || facts.complaint === "yes") {
    const both = facts.welfare === "yes" && facts.complaint === "yes";
    const welfare = facts.welfare === "yes";
    return result({
      colour: "red",
      matchedRuleId: welfare ? "safety.welfare" : "safety.complaint",
      candidateRuleId: null,
      policyVersion: SYSTEM_RULES_VERSION,
      policyVersionId: null,
      explanation: welfare
        ? `A child welfare concern was confirmed${both ? ", along with a complaint" : ""}. Routine processing stops and the owner must handle this personally.`
        : "A complaint was confirmed. Complaints always go to the owner, whatever the amount.",
      evidence: refs,
      missing: [],
      blockers: [],
      permittedActions: welfare
        ? ESCALATION_ACTIONS
        : ["prepare_parent_response", ...ESCALATION_ACTIONS],
      nextSteps: welfare
        ? [
            "Do not discuss the concern with the tutor or other parents.",
            "Record only the facts you were told, in the words used.",
            "Send the restricted handover to the owner now.",
            "If a child is in immediate danger, call 000 first.",
          ]
        : [
            "Do not offer a refund, credit or apology that admits fault.",
            "Prepare a short holding reply saying the owner will be in touch.",
            "Send the escalation summary to the owner.",
          ],
      escalation: welfare
        ? "Follow the owner-approved welfare escalation procedure in the knowledge hub."
        : "The owner reviews every complaint personally.",
      suggestedStatus: "review_required",
    });
  }

  // 2. Request types the app has no policy model for.
  if (facts.requestType === "other") {
    return result({
      colour: "amber",
      matchedRuleId: "default.unsupported",
      candidateRuleId: null,
      policyVersion: SYSTEM_RULES_VERSION,
      policyVersionId: null,
      explanation: "Tutor Compass has no approved rules for this kind of request yet, so it cannot be treated as routine.",
      evidence: refs,
      missing: [{ fact: "request_type", message: "This request type is not covered by an owner-approved policy." }],
      blockers: [],
      permittedActions: ["prepare_parent_response", ...ESCALATION_ACTIONS],
      nextSteps: ["Tell the family you are checking and will reply soon.", "Send the request to the owner for a decision."],
      escalation: "The owner decides unsupported requests.",
      suggestedStatus: "review_required",
    });
  }

  // 3. No active owner-approved policy for this category.
  if (!policy || policy.category !== facts.requestType || policy.status === "archived") {
    return result({
      colour: "amber",
      matchedRuleId: "default.missing_policy",
      candidateRuleId: null,
      policyVersion: SYSTEM_RULES_VERSION,
      policyVersionId: null,
      explanation: "There is no active owner-approved policy for this request type, so it cannot be green.",
      evidence: refs,
      missing: [{ fact: "policy", message: "No active policy was found for this request type." }],
      blockers: [],
      permittedActions: ["prepare_parent_response", ...ESCALATION_ACTIONS],
      nextSteps: ["Send the request to the owner.", "Ask the owner to activate a policy for this kind of request."],
      escalation: null,
      suggestedStatus: "review_required",
    });
  }

  const def = policy.definition;
  const config = CATEGORY_CONFIG[def.category];
  const numericValue = config.numeric ? facts[config.numeric.fact] : null;
  const { missing, blockers } = checkRequiredFacts(def.requiredFacts, facts, evidence);
  const versionLabel = policyVersionLabel(policy);

  // 4. Find the owner rule that covers these facts. Rules are checked in order.
  let matched: Rule | null = null;
  let unknownMatch = false;
  for (const rule of def.rules) {
    const m = ruleMatches(rule, facts, numericValue);
    if (m === "unknown") unknownMatch = true;
    if (m === true) {
      matched = rule;
      break;
    }
  }

  const clarifySteps = missing.map((m) => `Confirm: ${m.message}`).concat(blockers.map((b) => `Resolve: ${b}`));

  if (!matched) {
    const missingInfo = unknownMatch || missing.length > 0;
    return result({
      colour: "amber",
      matchedRuleId: missingInfo ? "default.missing_information" : "default.no_matching_rule",
      candidateRuleId: null,
      policyVersion: versionLabel,
      policyVersionId: policy.id,
      explanation: missingInfo
        ? "Key information is missing or uncertain, so no rule can be applied yet."
        : `None of the rules in ${def.title} cover these facts, so the default yellow route applies.`,
      evidence: refs,
      missing,
      blockers,
      permittedActions: ["prepare_parent_response", ...ESCALATION_ACTIONS],
      nextSteps: clarifySteps.length ? clarifySteps : ["Send the request to the owner for a decision."],
      escalation: null,
      suggestedStatus: missing.length || blockers.length ? "needs_clarification" : "review_required",
    });
  }

  const rangeText = config.numeric ? ` (${describeRange(def.category, matched.range).toLowerCase()})` : "";
  const ruleText = `Rule "${matched.label}"${rangeText} in ${def.title}`;
  const hasGaps = missing.length > 0 || blockers.length > 0;

  // 5. Green needs complete facts and no blocking conditions. Otherwise it drops to amber.
  if (matched.colour === "green" && hasGaps) {
    return result({
      colour: "amber",
      matchedRuleId: "default.missing_information",
      candidateRuleId: matched.id,
      policyVersion: versionLabel,
      policyVersionId: policy.id,
      explanation: `${ruleText} would allow this, but some required information is missing, uncertain or conflicting. Green is blocked until it is resolved.`,
      evidence: refs,
      missing,
      blockers,
      permittedActions: ["prepare_parent_response", ...ESCALATION_ACTIONS],
      nextSteps: clarifySteps,
      escalation: null,
      suggestedStatus: "needs_clarification",
    });
  }

  const explanation =
    matched.colour === "green"
      ? `${ruleText} applies and every required check passed.`
      : matched.colour === "amber"
        ? `${ruleText} applies. This needs clarification or owner approval before anything is promised.`
        : `${ruleText} applies. This is outside routine processing and must go to the owner.`;

  return result({
    colour: matched.colour,
    matchedRuleId: matched.id,
    candidateRuleId: null,
    policyVersion: versionLabel,
    policyVersionId: policy.id,
    explanation: hasGaps ? `${explanation} Some information still needs checking.` : explanation,
    evidence: refs,
    missing,
    blockers,
    permittedActions: matched.colour === "green" ? matched.permittedActions : withEscalation(matched.permittedActions),
    nextSteps: [...clarifySteps, ...matched.nextSteps],
    escalation: matched.escalation || null,
    suggestedStatus:
      matched.colour === "green" ? "ready" : matched.colour === "amber" && hasGaps ? "needs_clarification" : "review_required",
  });
}

function withEscalation(actions: ActionKey[]): ActionKey[] {
  const set = new Set<ActionKey>(actions);
  for (const a of ESCALATION_ACTIONS) set.add(a);
  return [...set];
}

export { FACT_LABELS };
