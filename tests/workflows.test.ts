import { describe, expect, it } from "vitest";
import { OPENING_QUESTIONS, SHORTCUTS, SHORTCUT_IDS, WORKFLOW_IDS, isWorkflowId } from "@/lib/assistant/shortcuts";
import { AssistantStateSchema, CommandSchema, EMPTY_STATE } from "@/lib/assistant/logic";
import { ACTION_RULES, PROPOSAL_ACTIONS, canPrepare } from "@/lib/agent/permissions";
import { numberWordsToDigits } from "@/lib/agent/intents";
import { addDays, daysBetween, parseExtension, parseRange, reminderSchedule } from "@/lib/workflows/dates";
import {
  absenceNeed,
  absorbMessage,
  applyPick,
  coverCandidates,
  currentItem,
  detectWorkflow,
  emptyData,
  emptyPipeline,
  lessonNeed,
  needsAgreement,
  parseAnyReference,
  paymentNeed,
  pickAlternatives,
  pipelineNeed,
  revisedDueDate,
  type AbsenceData,
  type LessonData,
  type PaymentData,
  type SlotLite,
  type TutorLite,
} from "@/lib/workflows/logic";
import { ATTENTION_LIMIT, attentionHeadline, buildAttention, type AttentionRequest } from "@/lib/workflows/attention-logic";

const TODAY = "2026-10-20"; // a Tuesday

describe("welcome shortcuts", () => {
  it("has exactly four shortcuts in the agreed order with stable ids", () => {
    expect(SHORTCUTS.map((s) => s.id)).toEqual(["attention", "lesson_change", "payment_extension", "tutor_absence"]);
    expect(SHORTCUT_IDS).toEqual(["attention", "lesson_change", "payment_extension", "tutor_absence"]);
    expect(SHORTCUTS.map((s) => s.label)).toEqual(["What Needs My Attention?", "Lesson Change", "Payment Extension", "Tutor Absence"]);
  });

  it("puts What Needs My Attention? first and full width, then the three workflows", () => {
    expect(SHORTCUTS[0].layout).toBe("wide");
    expect(SHORTCUTS.slice(1).every((s) => s.layout === "workflow")).toBe(true);
    expect(WORKFLOW_IDS).toEqual(["lesson_change", "payment_extension", "tutor_absence"]);
    expect(isWorkflowId("attention")).toBe(false);
    expect(isWorkflowId("tutor_absence")).toBe(true);
  });

  it("does not include any of the old suggestions", () => {
    const labels = SHORTCUTS.map((s) => s.label.toLowerCase());
    for (const old of ["requests needing my decision", "check a refund", "change a lesson", "find a policy", "current rules"]) expect(labels).not.toContain(old);
  });

  it("uses the agreed opening questions", () => {
    expect(OPENING_QUESTIONS.lesson_change).toBe("Which lesson would you like to change? You can share the booking reference or paste the parent's message.");
    expect(OPENING_QUESTIONS.payment_extension).toBe("Which invoice needs more time? Share the invoice reference or paste the parent's request.");
    expect(OPENING_QUESTIONS.tutor_absence).toBe("Which tutor is unavailable, and when? You can also paste their message.");
  });

  it("writes labels in Title Case and plain British English with no em dashes", () => {
    for (const s of SHORTCUTS) {
      expect(s.label).not.toMatch(/—/);
      expect(s.hint).not.toMatch(/—/);
      for (const word of s.label.replace("?", "").split(" ")) expect(word[0]).toBe(word[0].toUpperCase());
    }
  });

  it("keeps a workflow in the conversation state, and old saved states still load", () => {
    expect(EMPTY_STATE.run).toBeNull();
    const old = AssistantStateSchema.parse({ task: null, awaiting: null });
    expect(old.run).toBeNull();
    expect(CommandSchema.safeParse({ type: "workflow", runId: "6f1c1f9e-5d1c-4f3a-9d43-0b4c1b0f9a11", op: "pick", value: "slot:SLOT-3011" }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "workflow", runId: "x", op: "pick" }).success).toBe(false);
  });
});

describe("dates", () => {
  it("adds days and counts between days", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(daysBetween("2026-10-20", "2026-11-03")).toBe(14);
    expect(revisedDueDate("2026-10-23", 14)).toBe("2026-11-06");
  });

  it("reads an extension as days or as a new date", () => {
    expect(parseExtension("14 more days please", "2026-10-23", TODAY)).toBe(14);
    expect(parseExtension("Could they pay on 30 October?", "2026-10-23", TODAY)).toBe(7);
    expect(parseExtension("2 more weeks", "2026-10-23", TODAY)).toBe(14);
    expect(parseExtension("a fortnight", null, TODAY)).toBe(14);
    expect(parseExtension("no idea", "2026-10-23", TODAY)).toBeNull();
  });

  it("reads an absence period", () => {
    expect(parseRange("24 to 26 October", TODAY)).toEqual({ start: "2026-10-24", end: "2026-10-26" });
    expect(parseRange("next week", TODAY)).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(parseRange("nothing here", TODAY)).toBeNull();
  });

  it("schedules reminders before, on and after the new due date", () => {
    expect(reminderSchedule("2026-11-06", TODAY)).toEqual([
      { date: "2026-11-03", kind: "before_due" },
      { date: "2026-11-06", kind: "due_today" },
      { date: "2026-11-09", kind: "overdue" },
    ]);
    // A reminder date already passed is never scheduled.
    expect(reminderSchedule("2026-10-21", TODAY).map((r) => r.kind)).toEqual(["due_today", "overdue"]);
  });
});

describe("routing typed requests to one workflow each", () => {
  it("sends lesson changes, extensions and absences to their workflow and leaves refunds alone", () => {
    expect(detectWorkflow("Can we move Mia's lesson to Thursday?")).toBe("lesson_change");
    expect(detectWorkflow("Please reschedule BK-1042")).toBe("lesson_change");
    expect(detectWorkflow("The family needs more time to pay INV-503")).toBe("payment_extension");
    expect(detectWorkflow("Our tutor Tom is sick on Thursday")).toBe("tutor_absence");
    expect(detectWorkflow("They want a refund for the lesson change")).toBeNull();
    expect(detectWorkflow("What needs my attention?")).toBeNull();
  });

  it("reads references with or without a dash", () => {
    expect(parseAnyReference("invoice inv 503")).toBe("INV-503");
    expect(parseAnyReference("BK-1042")).toBe("BK-1042");
    expect(parseAnyReference("lsn4003")).toBe("LSN-4003");
  });
});

describe("Lesson Change state machine", () => {
  const start = () => emptyData("lesson_change") as LessonData;

  it("asks only for what is missing, in order", () => {
    let d = start();
    expect(lessonNeed(d)).toBe("reference");
    d = absorbMessage(d, "Hi, can Mia's Thursday afternoon lesson on BK-1042 move? She's not well.", TODAY);
    expect(d.reference).toBe("BK-1042");
    expect(d.dayHint).toBe(4);
    expect(d.partHint).toBe("afternoon");
    d = { ...d, bookingId: "BK-1042" };
    expect(lessonNeed(d)).toBe("lesson");
    d = applyPick(d, "lesson:LSN-4001") as LessonData;
    expect(lessonNeed(d)).toBe("complaint");
    d = applyPick(d, "complaint:no") as LessonData;
    d = applyPick(d, "welfare:no") as LessonData;
    expect(lessonNeed(d)).toBe("slot");
    d = applyPick(d, "slot:SLOT-3014") as LessonData;
    expect(d.parentChoice).toBe("chosen");
    expect(lessonNeed(d)).toBe("financialImpact");
    d = applyPick(d, "fee:no") as LessonData;
    expect(lessonNeed(d)).toBe("pipeline");
  });

  it("never turns a complaint or welfare concern into no from free text", () => {
    const d = absorbMessage(start(), "No complaint here and no worries", TODAY);
    expect(d.complaint).toBe("yes"); // the word "complaint" is a flag, never a no
    const e = absorbMessage(start(), "She felt unsafe after the lesson", TODAY);
    expect(e.welfare).toBe("yes");
    const f = absorbMessage(start(), "Just a time change", TODAY);
    expect(f.welfare).toBeNull();
  });

  it("records that the family hasn't chosen yet without picking a time", () => {
    const d = applyPick(start(), "slot:waiting") as LessonData;
    expect(d.parentChoice).toBe("waiting");
    expect(d.slotId).toBe("");
  });

  it("refuses picks that don't fit", () => {
    expect(applyPick(start(), "slot:DROP TABLE")).toBeNull();
    expect(applyPick(start(), "lesson:BK-1042")).toBeNull();
    expect(applyPick(start(), "invoice:PAY-2004")).toBeNull();
  });

  const now = new Date("2026-10-20T00:00:00Z"); // 11am in Sydney
  const lesson = { startsAt: "2026-10-26T06:00:00.000Z", endsAt: "2026-10-26T07:00:00.000Z" };
  const slot = (id: string, startsAt: string, minutes = 60, tutorId = "T-01"): SlotLite => ({
    id, tutorId, startsAt, endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(), status: "free",
  });

  it("offers only free times with 24 hours' notice, the same length, no clash and no absence", () => {
    const slots = [
      slot("SLOT-1", "2026-10-20T10:00:00.000Z"), // under 24 hours away
      slot("SLOT-2", "2026-10-22T06:00:00.000Z"), // fine, Thursday 5pm
      slot("SLOT-3", "2026-10-23T06:00:00.000Z", 90), // longer lesson
      slot("SLOT-4", "2026-10-24T00:00:00.000Z"), // clashes with the family
      slot("SLOT-5", "2026-10-28T06:00:00.000Z"), // tutor away
      slot("SLOT-6", "2026-10-27T06:00:00.000Z"),
    ];
    const alts = pickAlternatives(slots, {
      now, lesson, busy: [{ startsAt: "2026-10-24T00:00:00.000Z", endsAt: "2026-10-24T01:00:00.000Z" }],
      absences: [{ tutorId: "T-01", startsOn: "2026-10-28", endsOn: "2026-10-28" }], dayHint: null, partHint: null,
    });
    expect(alts.map((s) => s.id)).toEqual(["SLOT-2", "SLOT-6"]);
  });

  it("puts the day the parent asked for first", () => {
    const slots = [slot("SLOT-2", "2026-10-22T06:00:00.000Z"), slot("SLOT-6", "2026-10-27T06:00:00.000Z")];
    const alts = pickAlternatives(slots, { now, lesson, busy: [], absences: [], dayHint: 2, partHint: null }); // SLOT-6 is Tuesday 5pm in Sydney
    expect(alts[0].id).toBe("SLOT-6");
  });
});

describe("Payment Extension state machine", () => {
  it("asks for the invoice, then the days, then complaint and welfare", () => {
    let d = emptyData("payment_extension") as PaymentData;
    expect(paymentNeed(d)).toBe("invoice");
    d = absorbMessage(d, "INV-503: can they have 14 more days?", TODAY);
    expect(d.reference).toBe("INV-503");
    expect(d.extensionDays).toBe(14);
    d = applyPick(d, "invoice:PAY-2004") as PaymentData;
    expect(paymentNeed(d)).toBe("complaint");
    d = applyPick(d, "complaint:no") as PaymentData;
    d = applyPick(d, "welfare:unsure") as PaymentData;
    expect(paymentNeed(d)).toBe("pipeline");
  });

  it("keeps a requested date for the server to turn into days", () => {
    const d = absorbMessage(emptyData("payment_extension") as PaymentData, "Could INV-507 be due on 6 November instead?", TODAY);
    expect(d.extensionDays).toBeNull();
    expect(d.requestedDate).toBe("2026-11-06");
  });

  it("only accepts 1 to 120 extra days", () => {
    const d = emptyData("payment_extension") as PaymentData;
    expect(applyPick(d, "days:0")).toBeNull();
    expect(applyPick(d, "days:121")).toBeNull();
    expect((applyPick(d, "days:30") as PaymentData).extensionDays).toBe(30);
  });
});

describe("Tutor Absence state machine", () => {
  const tutors: TutorLite[] = [
    { id: "T-02", name: "Tom Nguyen", subjects: ["English"], courses: [{ courseId: "ENG-ADV", yearLevel: 11 }] },
    { id: "T-04", name: "Nadia Hassan", subjects: ["English"], courses: [{ courseId: "ENG-ADV", yearLevel: 11 }] },
    { id: "T-05", name: "Daniel Kim", subjects: ["Maths"], courses: [] },
  ];
  const item = (id: string) => ({ lessonId: id, bookingId: "BK-1043", option: null, familyAgreed: null, tutorAgreed: null, pipeline: emptyPipeline() });

  it("moves through tutor, period, lessons, options, agreements, record and each change", () => {
    let d = emptyData("tutor_absence") as AbsenceData;
    expect(absenceNeed(d)).toBe("tutor");
    d = absorbMessage(d, "Tom is sick 22 to 23 October", TODAY);
    expect(d.tutorHint).toContain("Tom");
    expect(d.startsOn).toBe("2026-10-22");
    d = { ...d, tutorId: "T-02" };
    expect(absenceNeed(d)).toBe("lessons");
    d = { ...d, lessonsChecked: true, items: [item("LSN-4003"), item("LSN-4004")] };
    expect(absenceNeed(d)).toBe("complaint");
    d = applyPick(d, "complaint:no") as AbsenceData;
    d = applyPick(d, "welfare:no") as AbsenceData;
    expect(absenceNeed(d)).toBe("option");
    d = applyPick(d, "option:cover:T-04:SLOT-3011") as AbsenceData;
    d = applyPick(d, "option:skip") as AbsenceData;
    expect(absenceNeed(d)).toBe("agreement");
    expect(needsAgreement(d.items[0])).toBe("family");
    d = applyPick(d, "family:yes") as AbsenceData;
    expect(needsAgreement(d.items[0])).toBe("tutor");
    d = applyPick(d, "tutorok:later") as AbsenceData;
    expect(d.items[0].tutorAgreed).toBe(false);
    expect(absenceNeed(d)).toBe("agreement");
    d = applyPick(d, "tutorok:yes") as AbsenceData;
    expect(absenceNeed(d)).toBe("record");
    d = { ...d, absenceId: "6f1c1f9e-5d1c-4f3a-9d43-0b4c1b0f9a11" };
    expect(absenceNeed(d)).toBe("pipeline");
    expect(currentItem(d)).toBe(0); // the skipped lesson is never changed
    d.items[0].pipeline.applied = true;
    expect(absenceNeed(d)).toBe("done");
  });

  it("records an absence with no affected lessons straight away", () => {
    const d: AbsenceData = { ...(emptyData("tutor_absence") as AbsenceData), tutorId: "T-05", startsOn: "2026-10-22", endsOn: "2026-10-22", lessonsChecked: true };
    expect(absenceNeed(d)).toBe("record");
  });

  it("offers only cover tutors who teach the course, are free at that exact time and aren't away", () => {
    const lesson = { id: "LSN-4003", tutorId: "T-02", startsAt: "2026-10-22T05:00:00.000Z", endsAt: "2026-10-22T06:00:00.000Z", subject: "English", courseId: "ENG-ADV", yearLevel: 11 };
    const slots: SlotLite[] = [
      { id: "SLOT-3011", tutorId: "T-04", startsAt: lesson.startsAt, endsAt: lesson.endsAt, status: "free" },
      { id: "SLOT-3013", tutorId: "T-05", startsAt: lesson.startsAt, endsAt: lesson.endsAt, status: "free" },
    ];
    expect(coverCandidates(lesson, tutors, slots, [], []).map((c) => c.tutor.id)).toEqual(["T-04"]);
    expect(coverCandidates(lesson, tutors, slots, [{ tutorId: "T-04", startsOn: "2026-10-22", endsOn: "2026-10-22" }], [])).toEqual([]);
  });
});

describe("approval and apply steps, by role", () => {
  const p = (patch: Partial<ReturnType<typeof emptyPipeline>> = {}) => ({ ...emptyPipeline(), ...patch });
  const saved = p({ requestId: "6f1c1f9e-5d1c-4f3a-9d43-0b4c1b0f9a11" });

  it("saves the request first, then waits for any open preview", () => {
    expect(pipelineNeed(p(), null, "admin")).toBe("save");
    expect(pipelineNeed(p({ pendingProposalId: "x" }), null, "admin")).toBe("confirm");
  });

  it("applies the change when the rules allow it or the owner approved it", () => {
    expect(pipelineNeed(saved, { status: "ready", missing: 0 }, "admin")).toBe("apply");
    expect(pipelineNeed(saved, { status: "approved", missing: 0 }, "admin")).toBe("apply");
    expect(pipelineNeed(saved, { status: "ready", missing: 0 }, "owner")).toBe("apply");
  });

  it("has an admin send owner-only items to the owner and then wait", () => {
    expect(pipelineNeed(saved, { status: "review_required", missing: 0 }, "admin")).toBe("send_to_owner");
    expect(pipelineNeed(saved, { status: "needs_clarification", missing: 0 }, "admin")).toBe("send_to_owner");
    expect(pipelineNeed(saved, { status: "awaiting_owner", missing: 0 }, "admin")).toBe("waiting_owner");
  });

  it("lets the owner decide directly, never sending to themselves", () => {
    for (const status of ["review_required", "needs_clarification", "awaiting_owner", "more_info_requested"] as const) {
      expect(pipelineNeed(saved, { status, missing: 0 }, "owner")).toBe("owner_decision");
    }
  });

  it("blocks on missing details for both roles", () => {
    expect(pipelineNeed(saved, { status: "needs_clarification", missing: 2 }, "admin")).toBe("complete_details");
    expect(pipelineNeed(saved, { status: "needs_clarification", missing: 2 }, "owner")).toBe("complete_details");
    expect(pipelineNeed(saved, { status: "review_required", missing: 1 }, "owner")).toBe("complete_details");
  });

  it("stops when declined or closed elsewhere, and never applies twice", () => {
    expect(pipelineNeed(saved, { status: "declined", missing: 0 }, "admin")).toBe("declined");
    expect(pipelineNeed(saved, { status: "closed", missing: 0 }, "admin")).toBe("closed_elsewhere");
    expect(pipelineNeed({ ...saved, applied: true }, { status: "ready", missing: 0 }, "admin")).toBe("done");
  });

  it("lets staff apply only ready or approved requests, and record absences", () => {
    expect(PROPOSAL_ACTIONS).toEqual(expect.arrayContaining(["booking.reschedule", "invoice.extend_due_date", "tutor.record_absence"]));
    for (const a of ["booking.reschedule", "invoice.extend_due_date"] as const) {
      expect(ACTION_RULES[a].confirm).toBe("staff");
      expect(canPrepare(a, "admin", "ready").ok).toBe(true);
      expect(canPrepare(a, "admin", "approved").ok).toBe(true);
      expect(canPrepare(a, "admin", "awaiting_owner").ok).toBe(false);
      expect(canPrepare(a, "owner", "review_required").ok).toBe(false);
    }
    expect(canPrepare("tutor.record_absence", "admin", null).ok).toBe(true);
  });
});

describe("What Needs My Attention?", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const req = (id: string, status: AttentionRequest["status"], decision: AttentionRequest["decision"], extra: Partial<AttentionRequest> = {}): AttentionRequest => ({
    id: `00000000-0000-4000-8000-00000000000${id}`, request_type: "lesson_change", status, decision, amount_cents: null, reference_id: `BK-104${id}`, booking_id: `BK-104${id}`,
    welfare_status: "no", complaint_status: "no", confirmed_facts: null, created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-19T00:00:00Z",
    missing: 0, owner_review_started_at: null, ...extra,
  });
  const requests = [
    req("1", "awaiting_owner", "amber"),
    req("2", "review_required", "red"),
    req("3", "needs_clarification", "amber", { missing: 2 }),
    req("4", "ready", "green"),
  ];

  it("gives the owner decision controls and the admin send controls for the same requests", () => {
    const owner = buildAttention({ role: "owner", now, requests, runs: [], pending: [], failed: [] });
    const admin = buildAttention({ role: "admin", now, requests, runs: [], pending: [], failed: [] });
    expect(owner.counts.find((c) => c.key === "approval")?.count).toBe(2);
    expect(owner.items.filter((i) => i.category === "approval").every((i) => i.action.label === "Review and Decide")).toBe(true);
    // The admin can't act on the request already with the owner, so it's a note, not an item.
    expect(admin.counts.find((c) => c.key === "approval")?.count).toBe(1);
    expect(admin.items.find((i) => i.category === "approval")?.action.label).toBe("Review and Send");
    expect(admin.notes[0]).toMatch(/1 request is with the owner/);
  });

  it("orders failed actions first, then approvals, workflows, clarifications and outcomes", () => {
    const block = buildAttention({
      role: "admin", now, requests,
      runs: [{ id: "6f1c1f9e-5d1c-4f3a-9d43-0b4c1b0f9a11", workflow: "payment_extension", status: "waiting", stage: "waiting_owner", summary: "PAY-2008 · 14 extra days", updated_at: "2026-10-19T00:00:00Z", request: null }],
      pending: [],
      failed: [{ id: "f1", action: "booking.reschedule", created_at: "2026-10-19T23:00:00Z", error: "slot_taken: That time is no longer free.", targetId: null, mine: true, runId: null }],
    });
    expect(block.items.map((i) => i.category)).toEqual(["failed", "approval", "workflows", "clarification", "outcomes"]);
    expect(block.items[0].reason).toBe("That time is no longer free. Nothing was changed.");
    expect(block.items[2].action.command).toEqual({ type: "workflow", runId: "6f1c1f9e-5d1c-4f3a-9d43-0b4c1b0f9a11", op: "continue" });
    expect(attentionHeadline(block)).toBe("5 items need your attention: 1 failed action, 1 decision awaiting approval, 1 workflow waiting or blocked, 1 request needing clarification and 1 outcome to record.");
  });

  it("puts a workflow the owner has approved at the top of the workflows, ready to continue", () => {
    const runs = [
      { id: "a", workflow: "lesson_change" as const, status: "waiting" as const, stage: "waiting_family", summary: "BK-1042", updated_at: "2026-10-19T10:00:00Z", request: null },
      { id: "b", workflow: "payment_extension" as const, status: "waiting" as const, stage: "waiting_owner", summary: "PAY-2008", updated_at: "2026-10-18T10:00:00Z", request: { id: requests[3].id, status: "approved" as const, missing: 0 } },
    ];
    const block = buildAttention({ role: "admin", now, requests: [], runs, pending: [], failed: [] });
    expect(block.items[0].key).toBe("workflow:b");
    expect(block.items[0].reason).toMatch(/approved/);
  });

  it("doesn't list a request twice when a workflow is already handling it", () => {
    const runs = [{ id: "r", workflow: "lesson_change" as const, status: "waiting" as const, stage: "waiting_owner", summary: "BK-1041", updated_at: "2026-10-19T10:00:00Z", request: { id: requests[0].id, status: "awaiting_owner" as const, missing: 0 } }];
    const block = buildAttention({ role: "owner", now, requests, runs, pending: [], failed: [] });
    expect(block.items.filter((i) => i.key.includes(requests[0].id))).toHaveLength(0);
    expect(block.items.find((i) => i.key === "workflow:r")?.reason).toMatch(/your decision/);
  });

  it("counts exactly but lists at most eight", () => {
    const many = Array.from({ length: 12 }, (_, n) => req(String(n % 10), "needs_clarification", "amber", { id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, missing: 1 }));
    const block = buildAttention({ role: "admin", now, requests: many, runs: [], pending: [], failed: [] });
    expect(block.total).toBe(12);
    expect(block.items).toHaveLength(ATTENTION_LIMIT);
    expect(block.counts.find((c) => c.key === "clarification")?.count).toBe(12);
  });

  it("says clearly when nothing is outstanding", () => {
    const block = buildAttention({ role: "owner", now, requests: [], runs: [], pending: [], failed: [] });
    expect(block.total).toBe(0);
    expect(attentionHeadline(block)).toMatch(/^Nothing needs your attention right now/);
  });
});

describe("number words in extension requests", () => {
  it("reads two more weeks as 14 days", () => {
    expect(parseExtension(numberWordsToDigits("could we please have two more weeks to pay"), null, TODAY)).toBe(14);
  });
});
