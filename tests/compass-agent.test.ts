import { describe, expect, it } from "vitest";
import { aiAllowedFor, screenSensitive } from "@/lib/agent/sensitive";
import { ACTION_RULES, OWNER_DECISIONS, availableActions, canConfirm, canPrepare } from "@/lib/agent/permissions";
import {
  BUCKETS,
  attentionFor,
  bucketFor,
  describeRequest,
  formatWaiting,
  priorityTier,
  sortByPriority,
  waitingSince,
  type BriefingRow,
} from "@/lib/agent/briefing-logic";
import { financialFigures, procedureChecks, readiness, recordChanges, policyCurrency, defaultNote, type Procedure } from "@/lib/agent/review-logic";
import { detectIntent, numberWordsToDigits, refersToFocus } from "@/lib/agent/intents";
import { diffPreconditions, describeDbChanges, inputHash, resultMessage } from "@/lib/agent/proposal-logic";
import { AssistantStateSchema, CommandSchema } from "@/lib/assistant/logic";
import { DEFAULT_PAYMENT_EXTENSION_POLICY, DEFAULT_REFUND_POLICY, DEFAULT_LESSON_CHANGE_POLICY } from "@/lib/engine/default-policies";
import type { PolicyDefinition, PolicySnapshot } from "@/lib/engine/policy";
import { STATUS_LABELS, type RequestStatus } from "@/lib/domain/types";
import type { EvidenceSnapshot } from "@/lib/engine/evidence";

const snap = (def: PolicyDefinition, version = 1): PolicySnapshot => ({ id: `pv-${def.category}-${version}`, category: def.category, version, status: "active", definition: def });

// The seeded procedures, as Ali's database has them.
const KB: Procedure[] = [
  { id: "KB-02", title: "Refund Procedure", category: "refund", version: 1, owner_approved: true, body: "Refunds are calculated on unused lessons. Under $50 the admin team may process the refund once the booking and payment are confirmed. From $50 to $200 the owner approves. Above $200 the owner decides personally." },
  { id: "KB-03", title: "Rescheduling Procedure", category: "lesson_change", version: 1, owner_approved: true, body: "A lesson can be moved without a fee when the same tutor is free at the new time and the family gives at least 24 hours notice. Any fee change needs the owner." },
  { id: "KB-05", title: "Payment Extension Procedure", category: "payment_extension", version: 1, owner_approved: true, body: "Admin may agree to extend an unpaid invoice by up to 7 days. Longer extensions need the owner. Extensions over 30 days are payment plans and are handled by the owner." },
];

describe("sensitive screening", () => {
  it("flags welfare language and keeps it away from the AI", () => {
    expect(screenSensitive("Mum says Ava is scared of her tutor").sensitive).toBe(true);
    expect(screenSensitive("He was bullied after class").sensitive).toBe(true);
    expect(screenSensitive("Can they have 7 extra days to pay?").sensitive).toBe(false);
    expect(aiAllowedFor({ welfare: "yes" })).toBe(false);
    expect(aiAllowedFor({ welfare: "unsure" })).toBe(false);
    expect(aiAllowedFor({ welfare: "no", texts: ["she said she feels unsafe"] })).toBe(false);
    expect(aiAllowedFor({ welfare: "no", texts: ["refund for two lessons"] })).toBe(true);
  });
});

describe("permissions", () => {
  it("never lets an admin prepare or confirm an owner decision", () => {
    for (const a of OWNER_DECISIONS) {
      expect(canPrepare(a, "admin", "awaiting_owner").ok).toBe(false);
      expect(ACTION_RULES[a].confirm).toBe("owner");
    }
    expect(canConfirm("owner", "admin")).toBe(false);
    expect(canConfirm("owner", "owner")).toBe(true);
    expect(canConfirm("staff", "admin")).toBe(true);
  });
  it("offers Send to Owner as the admin alternative", () => {
    const p = canPrepare("request.approve", "admin", "review_required");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.alternative).toBe("request.send_to_owner");
  });
  it("only allows actions from the right statuses", () => {
    expect(canPrepare("request.approve", "owner", "ready").ok).toBe(false);
    expect(availableActions("owner", "awaiting_owner")).toEqual(["request.approve", "request.decline", "request.request_info"]);
    expect(availableActions("admin", "awaiting_owner")).toEqual([]);
    expect(availableActions("admin", "approved")).toEqual(["request.record_outcome"]);
    expect(availableActions("admin", "needs_clarification")).toEqual(["request.send_to_owner"]);
  });
  it("says a refund approval records a decision only", () => {
    expect(ACTION_RULES["request.approve"].outcome).toMatch(/does not move money/);
    expect(resultMessage("request.approve", { requestType: "refund" })).toMatch(/No money has been transferred/);
    expect(resultMessage("draft.save", {})).toMatch(/not been sent/);
  });
});

const row = (over: Partial<BriefingRow>): BriefingRow => ({
  id: "00000000-0000-4000-8000-000000000000", request_type: "refund", status: "awaiting_owner", decision: "amber", amount_cents: 12000,
  reference_id: "BK-1046", booking_id: "BK-1046", welfare_status: "no", complaint_status: "no", confirmed_facts: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", ...over,
});

describe("briefing", () => {
  it("puts every unfinished status in exactly one bucket", () => {
    for (const s of Object.keys(STATUS_LABELS) as RequestStatus[]) {
      const n = BUCKETS.filter((b) => b.statuses.includes(s)).length;
      expect(n).toBe(s === "closed" ? 0 : 1);
    }
    expect(bucketFor("approved")).toBe("pending_outcome");
  });
  it("orders welfare, then complaints, then colour, then longest wait", () => {
    const rows = [
      { ...row({ id: "a", decision: "green" }), waitingSince: "2026-10-01T00:00:00Z" },
      { ...row({ id: "b", complaint_status: "yes", decision: "red" }), waitingSince: "2026-10-05T00:00:00Z" },
      { ...row({ id: "c", welfare_status: "yes", decision: "red" }), waitingSince: "2026-10-06T00:00:00Z" },
      { ...row({ id: "d", decision: "amber" }), waitingSince: "2026-10-03T00:00:00Z" },
      { ...row({ id: "e", decision: "amber" }), waitingSince: "2026-10-02T00:00:00Z" },
    ];
    expect(sortByPriority(rows).map((r) => r.id)).toEqual(["c", "b", "e", "d", "a"]);
    expect(priorityTier({ welfare_status: "unsure", complaint_status: "no", decision: "green" })).toBe(2);
  });
  it("puts every red request before amber, and amber before green", () => {
    const rows = [
      { ...row({ id: "g", decision: "green", welfare_status: "unsure" }), waitingSince: "2026-09-01T00:00:00Z" },
      { ...row({ id: "a", decision: "amber", complaint_status: "unsure" }), waitingSince: "2026-09-02T00:00:00Z" },
      { ...row({ id: "r", decision: "red" }), waitingSince: "2026-10-09T00:00:00Z" },
    ];
    expect(sortByPriority(rows).map((x) => x.decision)).toEqual(["red", "amber", "green"]);
  });
  it("measures waiting from the move into the current status", () => {
    const since = waitingSince(row({}), [
      { to_status: "review_required", created_at: "2026-10-01T00:00:00Z" },
      { to_status: "awaiting_owner", created_at: "2026-10-03T09:00:00Z" },
    ]);
    expect(since).toBe("2026-10-03T09:00:00Z");
    expect(formatWaiting("2026-10-03T09:00:00Z", new Date("2026-10-03T12:30:00Z"))).toBe("3 hours");
    expect(formatWaiting("2026-10-01T00:00:00Z", new Date("2026-10-05T00:00:00Z"))).toBe("4 days");
  });
  it("describes items and their next action for each role", () => {
    expect(describeRequest(row({}))).toBe("Refund of $120.00 for BK-1046");
    expect(attentionFor("awaiting_owner", "owner").next.label).toBe("Review Request");
    expect(attentionFor("needs_clarification", "admin").next.label).toBe("Prepare Follow-up");
    expect(attentionFor("approved", "admin").next.label).toBe("Record Outcome");
  });
});

describe("reviews", () => {
  it("shows paid, refunded and unpaid figures without inventing an unused-lesson amount", () => {
    const { figures, note } = financialFigures({
      requestType: "refund", amountCents: 9000, extensionDays: null,
      booking: { id: "BK-1", familyId: "F", studentName: "Ava", tutorName: "Sam", subject: "Maths", status: "active", lessonsPurchased: 10, lessonsUsed: 4, priceCents: 50000, lastSyncedAt: "2026-10-01", stale: false, dataLabel: "fictional_demo" } as never,
      payments: [
        { id: "P1", invoiceRef: "INV-1", amountCents: 50000, status: "paid", dueDate: null, lastSyncedAt: "2026-10-01", stale: false } as never,
        { id: "P2", invoiceRef: "INV-2", amountCents: 2000, status: "refunded", dueDate: null, lastSyncedAt: "2026-10-01", stale: false } as never,
      ],
    });
    const get = (l: string) => figures.find((f) => f.label === l)?.value;
    expect(get("Paid on this booking")).toBe("$500.00");
    expect(get("Paid and not yet refunded")).toBe("$480.00");
    expect(get("Lessons")).toBe("4 of 10 used, 6 left");
    expect(figures.some((f) => /unused/i.test(f.label))).toBe(false);
    expect(note).toBeNull();
  });
  it("agrees with the seeded procedures and flags what the rules don't check", () => {
    const refund = procedureChecks(snap(DEFAULT_REFUND_POLICY), KB);
    expect(refund.filter((f) => f.kind === "conflict")).toEqual([]);
    expect(refund.some((f) => f.kind === "not_enforced" && /unused lessons/.test(f.text))).toBe(true);
    expect(procedureChecks(snap(DEFAULT_PAYMENT_EXTENSION_POLICY), KB).filter((f) => f.kind === "conflict")).toEqual([]);
    expect(procedureChecks(snap(DEFAULT_LESSON_CHANGE_POLICY), KB).some((f) => /24 hours/.test(f.text))).toBe(true);
  });
  it("reports a conflict when the procedure and the rules disagree", () => {
    const changed = KB.map((k) => (k.id === "KB-05" ? { ...k, body: k.body.replace("up to 7 days", "up to 10 days") } : k));
    const found = procedureChecks(snap(DEFAULT_PAYMENT_EXTENSION_POLICY), changed);
    expect(found.some((f) => f.kind === "conflict" && /10 days/.test(f.text))).toBe(true);
    expect(readiness({ missing: [], changes: [], policyNote: null, findings: found }).ready).toBe(false);
  });
  it("is not ready while facts are missing or records changed", () => {
    expect(readiness({ missing: ["Payment record is missing"], changes: [], policyNote: null, findings: [] })).toEqual({ ready: false, reasons: ["Payment record is missing"] });
    expect(readiness({ missing: [], changes: [], policyNote: null, findings: [] }).ready).toBe(true);
    const policy = snap(DEFAULT_REFUND_POLICY, 2);
    expect(policyCurrency("pv-refund-1", "refund-v1", policy)).toMatch(/refund-v2 is active now/);
    expect(policyCurrency("pv-refund-2", "refund-v2", policy)).toBeNull();
  });
  it("notices records that changed after the rule check", () => {
    const snapshot = {
      booking: { status: "found", record: { id: "BK-1", status: "active", lessonsUsed: 4, priceCents: 50000 } },
      payments: { status: "checked", records: [{ id: "P1", amountCents: 50000, status: "paid" }] },
      availability: { status: "not_checked" },
    } as unknown as EvidenceSnapshot;
    const changes = recordChanges(snapshot, {
      booking: { id: "BK-1", status: "active", lessonsUsed: 5, priceCents: 50000, stale: false } as never,
      payments: [{ id: "P1", amountCents: 50000, status: "refunded", stale: false } as never],
    });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatch(/5 lessons used/);
  });
  it("prepares a targeted information request", () => {
    const note = defaultNote("request.request_info", { reference: "BK-1046", typeLabel: "Refund", amountCents: 12000, policyLabel: "refund-v1", ruleLabel: "x", missing: ["Payment record"] });
    expect(note).toContain("Before I can decide on BK-1046");
    expect(note).toContain("- Payment record");
  });
});

describe("intents", () => {
  it("recognises the three capabilities' example prompts", () => {
    expect(detectIntent("What needs my attention?")?.intent).toBe("briefing");
    expect(detectIntent("What requests need my decision?")?.intent).toBe("owner_queue");
    expect(detectIntent("Show pending outcomes")?.intent).toBe("pending_outcomes");
    expect(detectIntent("Prepare this refund for review.")?.intent).toBe("review");
    expect(detectIntent("Explain why this request was escalated.")?.intent).toBe("explain");
    expect(detectIntent("Prepare a reply asking for the missing details.")?.intent).toBe("followup");
    expect(detectIntent("What information do I need for this refund?")?.intent).toBe("requirements");
    expect(detectIntent("What can I do under the current policy?")?.intent).toBe("policy_overview");
    expect(detectIntent("Approve BK-1046")).toEqual({ intent: "decide", decision: "approve" });
    expect(detectIntent("Can this family have seven extra days to pay?")).toBeNull();
  });
  it("turns number words into digits", () => {
    expect(numberWordsToDigits("Can this family have seven extra days to pay?")).toBe("Can this family have 7 extra days to pay?");
    expect(numberWordsToDigits("a fortnight to pay")).toBe("14 days to pay");
    expect(refersToFocus("Can this family have more time?")).toBe(true);
  });
});

describe("proposals", () => {
  it("treats any change in versions as stale", () => {
    const before = { status: "awaiting_owner", currentDecisionId: "d1", updatedAt: "2026-10-01T00:00:00.000Z", archivedAt: null, activePolicyId: "pv1", recordsHash: "h1" };
    expect(diffPreconditions(before, { ...before, updatedAt: "2026-10-01T00:00:00Z" })).toEqual([]);
    expect(diffPreconditions(before, { ...before, status: "approved" })).toEqual(["The request's status changed."]);
    expect(diffPreconditions(before, { ...before, recordsHash: "h2", activePolicyId: "pv2" })).toHaveLength(2);
    expect(describeDbChanges(["status", "draft"])).toHaveLength(2);
  });
  it("hashes inputs stably", () => {
    expect(inputHash("request.approve", "x", { note: "a" })).toBe(inputHash("request.approve", "x", { note: "a" }));
    expect(inputHash("request.approve", "x", { note: "a" })).not.toBe(inputHash("request.approve", "x", { note: "b" }));
  });
  it("accepts old browser state and only known commands", () => {
    expect(AssistantStateSchema.parse({ task: null, awaiting: null }).focus).toBeNull();
    expect(CommandSchema.safeParse({ type: "briefing", bucket: "pending_outcome" }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "delete_everything" }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "decide", requestId: "not-a-uuid", action: "request.approve" }).success).toBe(false);
  });
});
