import { formatAud } from "@/lib/domain/money";
import { REQUEST_TYPE_LABELS, TRI_STATE_LABELS, type RequestType, type TriState } from "@/lib/domain/types";
import type { DecisionResult } from "@/lib/engine/evaluate";
import type { BookingRecord, EvidenceSnapshot, PaymentRecord } from "@/lib/engine/evidence";
import { policyVersionLabel, type PolicySnapshot } from "@/lib/engine/policy";
import type { ConfirmedFacts } from "@/lib/validation/facts";
import type { ProposalAction } from "./permissions";

// Pure logic behind a decision-ready review: money figures, checks of written procedures
// against the executable rules, what is known and what is missing, and what has changed
// since the rule check ran. Nothing here decides anything. It only lays the evidence out
// so the owner can decide, and says plainly when the evidence isn't enough.

export type Figure = { label: string; value: string; source: "record" | "request" | "calculated" };

export type Procedure = { id: string; title: string; category: string; body: string; version: number; owner_approved: boolean };

export type Finding = { kind: "conflict" | "not_enforced"; articleId: string; text: string };

const sum = (ps: PaymentRecord[], status: PaymentRecord["status"]) => ps.filter((p) => p.status === status).reduce((t, p) => t + p.amountCents, 0);

/**
 * Money and lesson figures from the records. Every total is a plain sum of payment
 * records with a given status, the same arithmetic the engine uses for its refund check.
 */
export function financialFigures(opts: {
  requestType: RequestType;
  amountCents: number | null;
  extensionDays: number | null;
  booking: BookingRecord | null;
  payments: PaymentRecord[] | null;
}): { figures: Figure[]; note: string | null } {
  const { requestType, amountCents, booking, payments } = opts;
  const figures: Figure[] = [];
  if (requestType === "refund") figures.push({ label: "Refund requested", value: amountCents === null ? "Not recorded" : formatAud(amountCents), source: "request" });
  if (requestType === "payment_extension") figures.push({ label: "Extra days requested", value: opts.extensionDays ? `${opts.extensionDays} days` : "Not recorded", source: "request" });
  if (payments) {
    const paid = sum(payments, "paid");
    const refunded = sum(payments, "refunded");
    figures.push({ label: "Paid on this booking", value: formatAud(paid), source: "calculated" });
    if (refunded) figures.push({ label: "Already refunded", value: formatAud(refunded), source: "calculated" });
    if (requestType === "refund") figures.push({ label: "Paid and not yet refunded", value: formatAud(Math.max(0, paid - refunded)), source: "calculated" });
    const unpaid = payments.filter((p) => p.status === "pending" || p.status === "overdue");
    if (unpaid.length) {
      figures.push({
        label: "Unpaid invoices",
        value: unpaid.map((p) => `${p.invoiceRef} ${formatAud(p.amountCents)} ${p.status}${p.dueDate ? `, due ${p.dueDate}` : ""}`).join("; "),
        source: "record",
      });
    }
    const disputed = payments.filter((p) => p.status === "disputed");
    if (disputed.length) figures.push({ label: "Disputed", value: disputed.map((p) => `${p.id} ${formatAud(p.amountCents)}`).join(", "), source: "record" });
  }
  if (booking) {
    figures.push({ label: "Package price", value: formatAud(booking.priceCents), source: "record" });
    figures.push({
      label: "Lessons",
      value: `${booking.lessonsUsed} of ${booking.lessonsPurchased} used, ${booking.lessonsPurchased - booking.lessonsUsed} left`,
      source: "record",
    });
  }
  const note = requestType === "refund"
    ? "No unused-lesson refund figure is shown. The written procedure says refunds are based on unused lessons, but the owner's rules don't define that calculation (for example, how part-used packages or fees are treated). The rules only check the amount against what was paid."
    : null;
  return { figures, note };
}

// ---------------------------------------------------------------------------
// Written procedures against the executable rules

function boundaries(policy: PolicySnapshot): number[] {
  const out: number[] = [];
  for (const r of policy.definition.rules) {
    if (!r.range) continue;
    if (r.range.min !== null) out.push(r.range.min);
    if (r.range.max !== null) out.push(r.range.max);
  }
  return out;
}

function numbersIn(category: PolicySnapshot["category"], body: string): number[] {
  if (category === "refund") {
    return [...body.matchAll(/\$\s?(\d{1,6}(?:\.\d{1,2})?)/g)].map((m) => Math.round(Number(m[1]) * 100));
  }
  if (category === "payment_extension") return [...body.matchAll(/(\d{1,3})\s*days?\b/gi)].map((m) => Number(m[1]));
  return [];
}

/**
 * Compare approved procedures with the active policy for the same category. A number in
 * the procedure that matches no band edge in the policy (or a band edge the procedure
 * never mentions) is a conflict that someone must clarify. Rules the procedure states but
 * the engine does not check are reported so staff check them by hand.
 */
export function procedureChecks(policy: PolicySnapshot | null, articles: Procedure[]): Finding[] {
  if (!policy) return [];
  const found: Finding[] = [];
  const label = policyVersionLabel(policy);
  for (const a of articles.filter((x) => x.owner_approved && x.category === policy.category)) {
    const nums = numbersIn(policy.category, a.body);
    const edges = boundaries(policy);
    if (nums.length && edges.length) {
      const near = (x: number, list: number[]) => list.some((y) => Math.abs(x - y) <= 1);
      const fmt = (v: number) => (policy.category === "refund" ? formatAud(v) : `${v} days`);
      const unmatched = [...new Set(nums.filter((n) => !near(n, edges)))];
      const unmentioned = [...new Set(edges.filter((e) => e > 0 && !near(e, nums)))];
      if (unmatched.length || unmentioned.length) {
        found.push({
          kind: "conflict",
          articleId: a.id,
          text: `${a.id} ${a.title} (version ${a.version}) and ${label} disagree: the procedure ${unmatched.length ? `mentions ${unmatched.map(fmt).join(", ")}` : "uses different limits"}${unmentioned.length ? ` but the rules change at ${unmentioned.map(fmt).join(", ")}` : ""}. The owner needs to say which is right.`,
        });
      }
    }
    if (policy.category === "refund" && /unused lessons?/i.test(a.body)) {
      found.push({ kind: "not_enforced", articleId: a.id, text: `${a.id} says refunds are calculated on unused lessons. ${label} doesn't calculate this, so check the amount against the lessons left by hand.` });
    }
    const notice = /(\d{1,3})\s*hours?'?\s*notice/i.exec(a.body);
    if (policy.category === "lesson_change" && notice) {
      found.push({ kind: "not_enforced", articleId: a.id, text: `${a.id} requires ${notice[1]} hours' notice for a free reschedule. ${label} doesn't check notice, so confirm it by hand.` });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// What is known, who said it and what is missing

export type FactSources = { retrieved: string[]; supplied: string[]; missing: string[] };

const tri = (v: TriState | null) => (v ? TRI_STATE_LABELS[v] : "Not answered");

export function factSources(facts: ConfirmedFacts, evidence: EvidenceSnapshot | null, result: Pick<DecisionResult, "missing" | "blockers"> | null, policy: { label: string } | null): FactSources {
  const retrieved: string[] = [];
  if (evidence?.booking.status === "found") {
    const b = evidence.booking.record;
    retrieved.push(`Booking ${b.id}: ${b.subject} for ${b.studentName} with ${b.tutorName} (${b.status})${b.stale ? ", may be out of date" : ""}`);
  } else if (evidence?.booking.status === "multiple") {
    retrieved.push(`${evidence.booking.candidates.length} bookings match ${evidence.booking.reference}`);
  }
  if (evidence?.payments.status === "checked") {
    retrieved.push(
      evidence.payments.records.length
        ? `Payments: ${evidence.payments.records.map((p) => `${p.id} ${formatAud(p.amountCents)} ${p.status}`).join(", ")}`
        : "Payments: none on record",
    );
  }
  if (evidence?.availability.status === "found") retrieved.push(`Time slot ${evidence.availability.record.id} (${evidence.availability.record.status})`);
  if (policy) retrieved.push(`Policy: ${policy.label}`);

  const supplied: string[] = [`Request type: ${REQUEST_TYPE_LABELS[facts.requestType]}`];
  if (facts.referenceId) supplied.push(`Reference: ${facts.referenceId}`);
  if (facts.requestType === "refund") supplied.push(`Amount: ${facts.amountCents === null ? "Not given" : formatAud(facts.amountCents)}`);
  if (facts.requestType === "payment_extension") supplied.push(`Extra days: ${facts.extensionDays ?? "Not given"}`);
  if (facts.requestType === "lesson_change") supplied.push(`Fees affected: ${tri(facts.financialImpact)}`);
  supplied.push(`Complaint: ${tri(facts.complaint)}`, `Welfare concern: ${tri(facts.welfare)}`);

  const missing = result ? [...result.missing.map((m) => m.message), ...result.blockers] : [];
  return { retrieved, supplied, missing };
}

// ---------------------------------------------------------------------------
// What changed since the rule check ran

export function recordChanges(snapshot: EvidenceSnapshot | null, live: { booking: BookingRecord | null; payments: PaymentRecord[] | null }): string[] {
  if (!snapshot) return ["There is no evidence snapshot for the latest rule check."];
  const changes: string[] = [];
  const then = snapshot.booking.status === "found" ? snapshot.booking.record : null;
  if (then && !live.booking) changes.push(`Booking ${then.id} can no longer be found.`);
  if (then && live.booking) {
    if (then.status !== live.booking.status) changes.push(`Booking ${then.id} is now ${live.booking.status} (it was ${then.status}).`);
    if (then.lessonsUsed !== live.booking.lessonsUsed) changes.push(`Booking ${then.id} now shows ${live.booking.lessonsUsed} lessons used (it was ${then.lessonsUsed}).`);
    if (then.priceCents !== live.booking.priceCents) changes.push(`Booking ${then.id} price is now ${formatAud(live.booking.priceCents)} (it was ${formatAud(then.priceCents)}).`);
  }
  if (live.booking?.stale) changes.push(`Booking ${live.booking.id} hasn't been synced for over 30 days, so it may be out of date.`);
  if (snapshot.payments.status === "checked" && live.payments) {
    const before = new Map(snapshot.payments.records.map((p) => [p.id, p]));
    for (const p of live.payments) {
      const old = before.get(p.id);
      if (!old) changes.push(`Payment ${p.id} (${formatAud(p.amountCents)} ${p.status}) has appeared since the rule check.`);
      else if (old.status !== p.status || old.amountCents !== p.amountCents) {
        changes.push(`Payment ${p.id} is now ${formatAud(p.amountCents)} ${p.status} (it was ${formatAud(old.amountCents)} ${old.status}).`);
      }
      before.delete(p.id);
    }
    for (const gone of before.values()) changes.push(`Payment ${gone.id} is no longer on record.`);
    const stale = live.payments.filter((p) => p.stale);
    if (stale.length) changes.push(`Payment ${stale.map((p) => p.id).join(", ")} hasn't been synced for over 30 days.`);
  }
  return changes;
}

/** Was the request checked under the policy version that is active now? */
export function policyCurrency(usedVersionId: string | null, usedLabel: string, active: PolicySnapshot | null): string | null {
  if (!usedVersionId) return null; // system rules (welfare, complaint, unsupported) don't depend on a version
  if (!active) return `Checked under ${usedLabel}, but there is no active policy for this type now.`;
  if (active.id !== usedVersionId) return `Checked under ${usedLabel}, but ${policyVersionLabel(active)} is active now. The result may be different under the current rules.`;
  return null;
}

export type Readiness = { ready: boolean; reasons: string[] };

/**
 * Is the evidence complete enough to decide? This never says which way to decide. It
 * only lists what prevents a decision: missing facts, conflicts, changed or stale
 * records, an outdated policy version or a procedure that disagrees with the rules.
 */
export function readiness(opts: { missing: string[]; changes: string[]; policyNote: string | null; findings: Finding[] }): Readiness {
  const reasons = [
    ...opts.missing,
    ...opts.changes,
    ...(opts.policyNote ? [opts.policyNote] : []),
    ...opts.findings.filter((f) => f.kind === "conflict").map((f) => f.text),
  ];
  return { ready: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Wording

export function parentWants(opts: { requestType: RequestType; amountCents: number | null; extensionDays: number | null; reference: string; context: string; restricted: boolean }): string {
  const base =
    opts.requestType === "refund"
      ? `A refund${opts.amountCents !== null ? ` of ${formatAud(opts.amountCents)}` : ""} on ${opts.reference}.`
      : opts.requestType === "payment_extension"
        ? `${opts.extensionDays ? `${opts.extensionDays} extra days` : "More time"} to pay on ${opts.reference}.`
        : opts.requestType === "lesson_change"
          ? `To move a lesson on ${opts.reference}.`
          : `Something not covered by the rules, on ${opts.reference}.`;
  if (opts.restricted) return `${base} Details are restricted because a welfare concern is recorded.`;
  const first = opts.context.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return first ? `${base} Staff noted: "${first.slice(0, 220)}"` : base;
}

/** A targeted information request listing exactly what prevents a decision. */
export function infoRequestNote(reference: string, reasons: string[]): string {
  const list = reasons.length ? reasons.map((r) => `- ${r}`).join("\n") : "- (list what you need)";
  return `Before I can decide on ${reference}, please confirm:\n${list}`;
}

export function defaultNote(action: ProposalAction, opts: { reference: string; typeLabel: string; amountCents: number | null; policyLabel: string; ruleLabel: string; missing: string[] }): string {
  const what = `${opts.typeLabel}${opts.amountCents !== null ? ` of ${formatAud(opts.amountCents)}` : ""} on ${opts.reference}`;
  switch (action) {
    case "request.approve":
      return `Approved: ${what}, under ${opts.policyLabel} (${opts.ruleLabel}). Admin to carry this out in the relevant system and record the outcome.`;
    case "request.decline":
      return `Declined: ${what}. Admin to let the family know and record the outcome.`;
    case "request.request_info":
      return infoRequestNote(opts.reference, opts.missing);
    case "request.send_to_owner":
      return `Please review: ${what}. Rule result under ${opts.policyLabel}: ${opts.ruleLabel}.${opts.missing.length ? ` Still unconfirmed: ${opts.missing.join("; ")}` : ""}`;
    case "request.record_outcome":
      return "";
    default:
      return "";
  }
}
