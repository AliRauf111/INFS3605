import { describe, expect, it } from "vitest";
import { evaluate } from "@/lib/engine/evaluate";
import type { EvidenceSnapshot } from "@/lib/engine/evidence";
import { EMPTY_EVIDENCE } from "@/lib/engine/evidence";
import {
  DEFAULT_LESSON_CHANGE_POLICY,
  DEFAULT_PAYMENT_EXTENSION_POLICY,
  DEFAULT_REFUND_POLICY,
} from "@/lib/engine/default-policies";
import type { PolicyDefinition, PolicySnapshot } from "@/lib/engine/policy";
import { sampleEvidence, sampleFacts } from "@/lib/engine/validate-policy";
import { validateFactsForm, type ConfirmedFacts } from "@/lib/validation/facts";

const snap = (def: PolicyDefinition, version = 1): PolicySnapshot => ({
  id: `pv-${def.category}-${version}`,
  category: def.category,
  version,
  status: "active",
  definition: def,
});
const refundPolicy = snap(DEFAULT_REFUND_POLICY);
const lessonPolicy = snap(DEFAULT_LESSON_CHANGE_POLICY);

function refund(amountCents: number | null, overrides: Partial<ConfirmedFacts> = {}) {
  const facts = sampleFacts(DEFAULT_REFUND_POLICY, { amountCents, ...overrides });
  return { facts, evidence: sampleEvidence(DEFAULT_REFUND_POLICY, facts) };
}

function run(amountCents: number | null, overrides: Partial<ConfirmedFacts> = {}) {
  const { facts, evidence } = refund(amountCents, overrides);
  return evaluate({ facts, evidence, policy: refundPolicy });
}

describe("refund thresholds", () => {
  it.each([3000, 4999])("%i cents is green when every check passes", (cents) => {
    const r = run(cents);
    expect(r.colour).toBe("green");
    expect(r.matchedRuleId).toBe("refund.under_50");
    expect(r.policyVersion).toBe("refund-v1");
    expect(r.suggestedStatus).toBe("ready");
  });

  it.each([5000, 7500, 20000])("%i cents is amber", (cents) => {
    const r = run(cents);
    expect(r.colour).toBe("amber");
    expect(r.matchedRuleId).toBe("refund.50_to_200");
  });

  it.each([20001, 25000])("%i cents is red", (cents) => {
    const r = run(cents);
    expect(r.colour).toBe("red");
    expect(r.matchedRuleId).toBe("refund.over_200");
  });
});

describe("safety rules", () => {
  it("a confirmed complaint is red even for a small refund", () => {
    const r = run(1000, { complaint: "yes" });
    expect(r.colour).toBe("red");
    expect(r.matchedRuleId).toBe("safety.complaint");
  });

  it("a confirmed welfare concern is red with no financial impact and missing details", () => {
    const facts: ConfirmedFacts = {
      ...sampleFacts(DEFAULT_LESSON_CHANGE_POLICY),
      welfare: "yes",
      complaint: null,
      referenceId: null,
      bookingId: null,
      proposedSlotId: null,
    };
    const r = evaluate({ facts, evidence: EMPTY_EVIDENCE, policy: lessonPolicy });
    expect(r.colour).toBe("red");
    expect(r.matchedRuleId).toBe("safety.welfare");
    expect(r.permittedActions).not.toContain("prepare_parent_response");
  });
});

describe("missing and uncertain information", () => {
  it.each([
    ["complaint not answered", { complaint: null }],
    ["complaint not sure", { complaint: "unsure" }],
    ["welfare not sure", { welfare: "unsure" }],
    ["money involvement not sure", { moneyInvolved: "unsure" }],
  ] as const)("%s blocks green", (_label, overrides) => {
    const r = run(3000, overrides as Partial<ConfirmedFacts>);
    expect(r.colour).toBe("amber");
    expect(r.matchedRuleId).toBe("default.missing_information");
    expect(r.candidateRuleId).toBe("refund.under_50");
    expect(r.suggestedStatus).toBe("needs_clarification");
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it("a missing amount produces amber, never green", () => {
    const r = run(null);
    expect(r.colour).toBe("amber");
    expect(r.matchedRuleId).toBe("default.missing_information");
  });

  it("a large refund stays red even when other facts are missing", () => {
    const r = run(25000, { complaint: null });
    expect(r.colour).toBe("red");
    expect(r.missing.length).toBe(1);
  });

  it("an unmatched booking reference blocks green", () => {
    const { facts } = refund(3000);
    const evidence: EvidenceSnapshot = {
      ...sampleEvidence(DEFAULT_REFUND_POLICY, facts),
      booking: { status: "not_found", reference: "BK-9999" },
    };
    expect(evaluate({ facts, evidence, policy: refundPolicy }).colour).toBe("amber");
  });

  it("several matching bookings block green until one is chosen", () => {
    const { facts } = refund(3000);
    const evidence: EvidenceSnapshot = {
      ...sampleEvidence(DEFAULT_REFUND_POLICY, facts),
      booking: { status: "multiple", reference: "FAM-07", candidates: [{ id: "A", label: "a" }, { id: "B", label: "b" }] },
    };
    const r = evaluate({ facts, evidence, policy: refundPolicy });
    expect(r.colour).toBe("amber");
    expect(r.missing[0].message).toMatch(/Choose the right one/);
  });

  it("stale records block green", () => {
    const { facts, evidence } = refund(3000);
    if (evidence.booking.status !== "found") throw new Error("setup");
    evidence.booking.record.stale = true;
    expect(evaluate({ facts, evidence, policy: refundPolicy }).colour).toBe("amber");
  });
});

describe("conflicting records", () => {
  it("two paid records with different amounts for one invoice block green", () => {
    const { facts, evidence } = refund(3000);
    if (evidence.payments.status !== "checked") throw new Error("setup");
    const first = evidence.payments.records[0];
    evidence.payments.records.push({ ...first, id: "PAY-2", amountCents: first.amountCents + 500 });
    const r = evaluate({ facts, evidence, policy: refundPolicy });
    expect(r.colour).toBe("amber");
    expect(r.blockers.join(" ")).toMatch(/conflict/);
  });

  it("a disputed payment blocks green", () => {
    const { facts, evidence } = refund(3000);
    if (evidence.payments.status !== "checked") throw new Error("setup");
    evidence.payments.records[0].status = "disputed";
    expect(evaluate({ facts, evidence, policy: refundPolicy }).colour).toBe("amber");
  });

  it("a refund larger than the amount paid blocks green", () => {
    const { facts, evidence } = refund(3000);
    if (evidence.payments.status !== "checked") throw new Error("setup");
    evidence.payments.records[0].amountCents = 2000;
    expect(evaluate({ facts, evidence, policy: refundPolicy }).colour).toBe("amber");
  });
});

describe("unsupported requests and missing policies", () => {
  it("an unsupported request is amber", () => {
    const facts: ConfirmedFacts = { ...sampleFacts(DEFAULT_REFUND_POLICY), requestType: "other" };
    const r = evaluate({ facts, evidence: EMPTY_EVIDENCE, policy: null });
    expect(r.colour).toBe("amber");
    expect(r.matchedRuleId).toBe("default.unsupported");
  });

  it("a request with no active policy is amber", () => {
    const { facts, evidence } = refund(3000);
    const r = evaluate({ facts, evidence, policy: null });
    expect(r.colour).toBe("amber");
    expect(r.matchedRuleId).toBe("default.missing_policy");
  });
});

describe("lesson changes", () => {
  const base = () => {
    const facts = sampleFacts(DEFAULT_LESSON_CHANGE_POLICY);
    return { facts, evidence: sampleEvidence(DEFAULT_LESSON_CHANGE_POLICY, facts) };
  };

  it("is green only with an active rule and a free tutor", () => {
    const { facts, evidence } = base();
    const r = evaluate({ facts, evidence, policy: lessonPolicy });
    expect(r.colour).toBe("green");
    expect(r.matchedRuleId).toBe("lesson_change.no_fee");
  });

  it("is amber when the tutor is not free", () => {
    const { facts, evidence } = base();
    if (evidence.availability.status !== "found") throw new Error("setup");
    evidence.availability.record.status = "booked";
    expect(evaluate({ facts, evidence, policy: lessonPolicy }).colour).toBe("amber");
  });

  it("is amber when availability was not checked", () => {
    const { facts, evidence } = base();
    const r = evaluate({ facts, evidence: { ...evidence, availability: { status: "not_checked" } }, policy: lessonPolicy });
    expect(r.colour).toBe("amber");
  });

  it("is amber without an active lesson change policy", () => {
    const { facts, evidence } = base();
    expect(evaluate({ facts, evidence, policy: null }).colour).toBe("amber");
  });

  it("is amber when fees are affected", () => {
    const { facts, evidence } = base();
    const r = evaluate({ facts: { ...facts, financialImpact: "yes" }, evidence, policy: lessonPolicy });
    expect(r.colour).toBe("amber");
    expect(r.matchedRuleId).toBe("lesson_change.fee_impact");
  });
});

describe("payment extensions", () => {
  const policy = snap(DEFAULT_PAYMENT_EXTENSION_POLICY);
  it.each([
    [7, "green"],
    [8, "amber"],
    [30, "amber"],
    [31, "red"],
  ] as const)("%i days is %s", (days, colour) => {
    const facts = sampleFacts(DEFAULT_PAYMENT_EXTENSION_POLICY, { extensionDays: days });
    const r = evaluate({ facts, evidence: sampleEvidence(DEFAULT_PAYMENT_EXTENSION_POLICY, facts), policy });
    expect(r.colour).toBe(colour);
  });
});

describe("determinism and history", () => {
  it("identical inputs give identical results", () => {
    const a = run(7500);
    const b = run(7500);
    expect(a).toEqual(b);
  });

  it("an old decision keeps its policy version when a new version changes the threshold", () => {
    const old = run(5500);
    const v2: PolicyDefinition = structuredClone(DEFAULT_REFUND_POLICY);
    v2.rules[0].range = { min: null, max: 6000, maxInclusive: false };
    v2.rules[1].range = { min: 6000, max: 20000, maxInclusive: true };
    const { facts, evidence } = refund(5500);
    const fresh = evaluate({ facts, evidence, policy: snap(v2, 2) });
    expect(old.colour).toBe("amber");
    expect(old.policyVersion).toBe("refund-v1");
    expect(fresh.colour).toBe("green");
    expect(fresh.policyVersion).toBe("refund-v2");
  });
});

describe("form validation", () => {
  const form = (amount: string | null, extra: Record<string, unknown> = {}) =>
    validateFactsForm({ requestType: "refund", moneyInvolved: "yes", amount, complaint: "no", welfare: "no", ...extra });

  it("converts dollars to whole cents", () => {
    const r = form("49.99");
    expect(r.ok && r.facts.amountCents).toBe(4999);
    const r2 = form("$1,200.5");
    expect(r2.ok && r2.facts.amountCents).toBe(120050);
  });

  it.each(["-5", "-0.01", "abc", "12.345", "1e3", "50..00"])("rejects %s", (bad) => {
    const r = form(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.amount).toBeTruthy();
  });

  it("keeps a blank amount as missing rather than zero", () => {
    const r = form("");
    expect(r.ok && r.facts.amountCents).toBe(null);
  });

  it("does not turn unanswered questions into no", () => {
    const r = validateFactsForm({ requestType: "refund", amount: "30" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.facts.complaint).toBeNull();
      expect(r.facts.welfare).toBeNull();
    }
  });

  it("rejects unknown fields and unknown request types", () => {
    expect(validateFactsForm({ requestType: "refund", colour: "green" }).ok).toBe(false);
    expect(validateFactsForm({ requestType: "magic" }).ok).toBe(false);
  });

  it("rejects an amount when no money is involved", () => {
    expect(form("20", { moneyInvolved: "no" }).ok).toBe(false);
  });
});
