import { formatAud } from "@/lib/domain/money";
import { REQUEST_TYPE_LABELS, type RequestType, type TriState } from "@/lib/domain/types";
import { tr } from "@/lib/i18n/reply";
import type { DecisionResult } from "@/lib/engine/evaluate";
import type { BookingRecord, EvidenceSnapshot, PaymentRecord } from "@/lib/engine/evidence";
import { policyVersionLabel, type PolicySnapshot } from "@/lib/engine/policy";
import type { ConfirmedFacts } from "@/lib/validation/facts";
import type { ProposalAction } from "./permissions";

// Pure logic behind a decision-ready review: money figures, checks of written procedures
// against the executable rules, what is known and what is missing, and what has changed
// since the rule check ran. Nothing here decides anything. It only lays the evidence out
// so the owner can decide, and says plainly when the evidence isn't enough.
//
// Text shown to the reader uses tr(), so it follows their language. The notes saved with
// a decision (infoRequestNote, defaultNote) stay in English for the audit trail.

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
  if (requestType === "refund") figures.push({ label: tr("reply.review.fig.refund"), value: amountCents === null ? tr("reply.review.notRecorded") : formatAud(amountCents), source: "request" });
  if (requestType === "payment_extension") figures.push({ label: tr("reply.review.fig.days"), value: opts.extensionDays ? tr("reply.review.days", { count: opts.extensionDays }) : tr("reply.review.notRecorded"), source: "request" });
  if (payments) {
    const paid = sum(payments, "paid");
    const refunded = sum(payments, "refunded");
    figures.push({ label: tr("reply.review.fig.paid"), value: formatAud(paid), source: "calculated" });
    if (refunded) figures.push({ label: tr("reply.review.fig.refunded"), value: formatAud(refunded), source: "calculated" });
    if (requestType === "refund") figures.push({ label: tr("reply.review.fig.notRefunded"), value: formatAud(Math.max(0, paid - refunded)), source: "calculated" });
    const unpaid = payments.filter((p) => p.status === "pending" || p.status === "overdue");
    if (unpaid.length) {
      figures.push({
        label: tr("reply.review.fig.unpaid"),
        value: unpaid.map((p) => p.dueDate
          ? tr("reply.review.invoiceDue", { invoice: p.invoiceRef, amount: formatAud(p.amountCents), status: payStatus(p.status), due: p.dueDate })
          : `${p.invoiceRef} ${formatAud(p.amountCents)} ${payStatus(p.status)}`).join("; "),
        source: "record",
      });
    }
    const disputed = payments.filter((p) => p.status === "disputed");
    if (disputed.length) figures.push({ label: tr("reply.review.fig.disputed"), value: disputed.map((p) => `${p.id} ${formatAud(p.amountCents)}`).join(", "), source: "record" });
  }
  if (booking) {
    figures.push({ label: tr("reply.review.fig.price"), value: formatAud(booking.priceCents), source: "record" });
    figures.push({
      label: tr("reply.review.fig.lessons"),
      value: tr("reply.review.lessonsUsed", { used: booking.lessonsUsed, bought: booking.lessonsPurchased, left: booking.lessonsPurchased - booking.lessonsUsed }),
      source: "record",
    });
  }
  const note: string | null = null;
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
      const fmt = (v: number) => (policy.category === "refund" ? formatAud(v) : tr("reply.review.days", { count: v }));
      const unmatched = [...new Set(nums.filter((n) => !near(n, edges)))];
      const unmentioned = [...new Set(edges.filter((e) => e > 0 && !near(e, nums)))];
      if (unmatched.length || unmentioned.length) {
        found.push({
          kind: "conflict",
          articleId: a.id,
          text: tr(unmentioned.length ? "reply.review.conflictEdges" : "reply.review.conflict", {
            article: `${a.id} ${a.title}`,
            version: a.version,
            policy: label,
            what: unmatched.length ? tr("reply.review.mentions", { values: unmatched.map(fmt).join(", ") }) : tr("reply.review.differentLimits"),
            edges: unmentioned.map(fmt).join(", "),
          }),
        });
      }
    }
    const notice = /(\d{1,3})\s*hours?'?\s*notice/i.exec(a.body);
    if (policy.category === "lesson_change" && notice) {
      found.push({ kind: "not_enforced", articleId: a.id, text: tr("reply.review.notice", { article: a.id, hours: notice[1], policy: label }) });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// What is known, who said it and what is missing

export type FactSources = { retrieved: string[]; supplied: string[]; missing: string[] };

const tri = (v: TriState | null) => (v ? tr(`domain.triState.${v}`) : tr("reply.tri.unanswered"));
const payStatus = (s: string) => tr(`reply.pay.status.${s as "pending"}`) || s;

export function factSources(facts: ConfirmedFacts, evidence: EvidenceSnapshot | null, result: Pick<DecisionResult, "missing" | "blockers"> | null, policy: { label: string } | null): FactSources {
  const retrieved: string[] = [];
  if (evidence?.booking.status === "found") {
    const b = evidence.booking.record;
    retrieved.push(tr(b.stale ? "reply.review.src.bookingStale" : "reply.review.src.booking", { booking: b.id, subject: b.subject, student: b.studentName, tutor: b.tutorName, status: b.status }));
  } else if (evidence?.booking.status === "multiple") {
    retrieved.push(tr("reply.review.src.multiple", { count: evidence.booking.candidates.length, reference: evidence.booking.reference }));
  }
  if (evidence?.payments.status === "checked") {
    retrieved.push(
      evidence.payments.records.length
        ? tr("reply.review.src.payments", { list: evidence.payments.records.map((p) => `${p.id} ${formatAud(p.amountCents)} ${payStatus(p.status)}`).join(", ") })
        : tr("reply.review.src.paymentsNone"),
    );
  }
  if (evidence?.availability.status === "found") retrieved.push(tr("reply.review.src.slot", { slot: evidence.availability.record.id, status: tr(`reply.turn.slotStatus.${evidence.availability.record.status as "free"}`) || evidence.availability.record.status }));
  if (policy) retrieved.push(tr("reply.review.src.policy", { policy: policy.label }));

  const supplied: string[] = [tr("reply.review.src.type", { value: tr(`domain.requestType.${facts.requestType}`) })];
  if (facts.referenceId) supplied.push(tr("reply.review.src.reference", { value: facts.referenceId }));
  if (facts.requestType === "refund") supplied.push(tr("reply.turn.sumAmount", { value: facts.amountCents === null ? tr("reply.review.notGiven") : formatAud(facts.amountCents) }));
  if (facts.requestType === "payment_extension") supplied.push(tr("reply.turn.sumDays", { value: facts.extensionDays ?? tr("reply.review.notGiven") }));
  if (facts.requestType === "lesson_change") supplied.push(tr("reply.turn.sumFees", { value: tri(facts.financialImpact) }));
  supplied.push(tr("reply.turn.sumComplaint", { value: tri(facts.complaint) }), tr("reply.turn.sumWelfare", { value: tri(facts.welfare) }));

  const missing = result ? [...result.missing.map((m) => m.message), ...result.blockers] : [];
  return { retrieved, supplied, missing };
}

// ---------------------------------------------------------------------------
// What changed since the rule check ran

export function recordChanges(snapshot: EvidenceSnapshot | null, live: { booking: BookingRecord | null; payments: PaymentRecord[] | null }): string[] {
  if (!snapshot) return [tr("reply.review.chg.noSnapshot")];
  const changes: string[] = [];
  const then = snapshot.booking.status === "found" ? snapshot.booking.record : null;
  if (then && !live.booking) changes.push(tr("reply.review.chg.bookingGone", { booking: then.id }));
  if (then && live.booking) {
    if (then.status !== live.booking.status) changes.push(tr("reply.review.chg.bookingStatus", { booking: then.id, now: live.booking.status, was: then.status }));
    if (then.lessonsUsed !== live.booking.lessonsUsed) changes.push(tr("reply.review.chg.lessonsUsed", { booking: then.id, now: live.booking.lessonsUsed, was: then.lessonsUsed }));
    if (then.priceCents !== live.booking.priceCents) changes.push(tr("reply.review.chg.price", { booking: then.id, now: formatAud(live.booking.priceCents), was: formatAud(then.priceCents) }));
  }
  if (live.booking?.stale) changes.push(tr("reply.review.chg.bookingStale", { booking: live.booking.id }));
  if (snapshot.payments.status === "checked" && live.payments) {
    const before = new Map(snapshot.payments.records.map((p) => [p.id, p]));
    for (const p of live.payments) {
      const old = before.get(p.id);
      if (!old) changes.push(tr("reply.review.chg.paymentNew", { payment: p.id, amount: formatAud(p.amountCents), status: payStatus(p.status) }));
      else if (old.status !== p.status || old.amountCents !== p.amountCents) {
        changes.push(tr("reply.review.chg.paymentChanged", { payment: p.id, now: `${formatAud(p.amountCents)} ${payStatus(p.status)}`, was: `${formatAud(old.amountCents)} ${payStatus(old.status)}` }));
      }
      before.delete(p.id);
    }
    for (const gone of before.values()) changes.push(tr("reply.review.chg.paymentGone", { payment: gone.id }));
    const stale = live.payments.filter((p) => p.stale);
    if (stale.length) changes.push(tr("reply.review.chg.paymentStale", { payment: stale.map((p) => p.id).join(", ") }));
  }
  return changes;
}

/** Was the request checked under the policy version that is active now? */
export function policyCurrency(usedVersionId: string | null, usedLabel: string, active: PolicySnapshot | null): string | null {
  if (!usedVersionId) return null; // system rules (welfare, complaint, unsupported) don't depend on a version
  if (!active) return tr("reply.review.policyGone", { used: usedLabel });
  if (active.id !== usedVersionId) return tr("reply.review.policyNewer", { used: usedLabel, now: policyVersionLabel(active) });
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
  const reference = opts.reference;
  const base =
    opts.requestType === "refund"
      ? opts.amountCents !== null ? tr("reply.review.wants.refundOf", { amount: formatAud(opts.amountCents), reference }) : tr("reply.review.wants.refund", { reference })
      : opts.requestType === "payment_extension"
        ? opts.extensionDays ? tr("reply.review.wants.days", { count: opts.extensionDays, reference }) : tr("reply.review.wants.moreTime", { reference })
        : opts.requestType === "lesson_change"
          ? tr("reply.review.wants.lesson", { reference })
          : tr("reply.review.wants.other", { reference });
  if (opts.restricted) return `${base} ${tr("reply.review.wants.restricted")}`;
  // The staff note is quoted as written.
  const first = opts.context.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return first ? `${base} ${tr("reply.review.wants.staffNoted", { note: first.slice(0, 220) })}` : base;
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
