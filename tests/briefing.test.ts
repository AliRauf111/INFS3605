import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enT, stripIsolates } from "@/lib/i18n/core";
import { makeFormat } from "@/lib/i18n/format";
import {
  buildBriefing,
  cardStatus,
  commMetrics,
  compare,
  dueSlot,
  isoWeekday,
  latestSlot,
  nextSlot,
  normaliseSections,
  normaliseThresholds,
  overallOf,
  recommendations,
  reportingPeriods,
  sydneyInstant,
  validTime,
  viewFor,
  type BuildInput,
} from "@/lib/briefing/logic";
import { briefingEmail } from "@/lib/briefing/email";
import { briefingFollowUp, detectBriefing } from "@/lib/briefing/intents";
import { DEFAULT_THRESHOLDS, SECTION_IDS, type Briefing, type CommIn, type FinanceMetrics, type LessonMetrics } from "@/lib/briefing/types";
import { SHORTCUT_IDS } from "@/lib/assistant/shortcuts";

const fmt = makeFormat("en", enT);
const t = enT;
const NOW = new Date("2026-11-06T01:00:00Z"); // Friday 6 November, 12 pm in Sydney (daylight saving)

describe("Sydney time and reporting periods", () => {
  it("finds the instant of a Sydney wall-clock time either side of daylight saving", () => {
    expect(sydneyInstant("2026-11-09", "08:00")).toBe("2026-11-08T21:00:00.000Z"); // AEDT, UTC+11
    expect(sydneyInstant("2026-06-08", "08:00")).toBe("2026-06-07T22:00:00.000Z"); // AEST, UTC+10
  });

  it("knows the weekday of a Sydney day", () => {
    expect(isoWeekday("2026-11-09")).toBe(1);
    expect(isoWeekday("2026-11-08")).toBe(7);
  });

  it("uses the seven days ending today, and the seven before that", () => {
    const { current, previous, key } = reportingPeriods(NOW);
    expect(key).toBe("2026-11-06");
    expect(current.startDay).toBe("2026-10-31");
    expect(current.end).toBe(NOW.toISOString());
    expect(previous.startDay).toBe("2026-10-24");
    expect(previous.endDay).toBe("2026-10-30");
    expect(previous.end).toBe(current.start);
  });
});

describe("the email schedule", () => {
  const monday8 = { enabled: true, sendDay: 1, sendTime: "08:00" };

  it("finds the last and next Monday 8 am in Sydney", () => {
    expect(latestSlot(monday8, NOW)).toMatchObject({ key: "weekly:2026-11-02", at: "2026-11-01T21:00:00.000Z" });
    expect(nextSlot(monday8, NOW)).toMatchObject({ key: "weekly:2026-11-09", at: "2026-11-08T21:00:00.000Z" });
  });

  it("is due for 30 hours after the slot and never sends an old week late", () => {
    expect(dueSlot(monday8, new Date("2026-11-08T22:00:00Z"))?.key).toBe("weekly:2026-11-09");
    expect(dueSlot(monday8, new Date("2026-11-10T02:00:00Z"))?.key).toBe("weekly:2026-11-09");
    expect(dueSlot(monday8, new Date("2026-11-11T22:00:00Z"))).toBeNull();
    expect(dueSlot(monday8, new Date("2026-11-08T20:00:00Z"))).toBeNull();
  });

  it("never sends when the schedule is off", () => {
    expect(dueSlot({ ...monday8, enabled: false }, new Date("2026-11-08T22:00:00Z"))).toBeNull();
  });

  it("cleans settings values", () => {
    expect(validTime("08:00")).toBe(true);
    expect(validTime("25:00")).toBe(false);
    expect(normaliseThresholds({ overdueRedDays: -3, enquiryRedHours: "abc" })).toMatchObject({ overdueRedDays: 1, enquiryRedHours: DEFAULT_THRESHOLDS.enquiryRedHours });
    expect(normaliseSections(["finance", "nonsense", "summary"])).toEqual(SECTION_IDS.filter((s) => s === "summary" || s === "finance"));
  });
});

const comm = (over: Partial<CommIn>): CommIn => ({
  id: "MSG-1", channel: "gmail", direction: "inbound", senderKind: "parent", contactName: "Priya Mehta", studentName: null, category: "general",
  subject: "Question", receivedAt: "2026-11-05T01:00:00Z", status: "unanswered", answeredAt: null, deliveryStatus: null, requestId: null, ...over,
});

describe("parent communications", () => {
  it("groups waiting messages by age and leaves answered ones out", () => {
    const { current } = reportingPeriods(NOW);
    const m = commMetrics(
      [
        comm({ id: "A", receivedAt: "2026-11-05T21:00:00Z" }), // 4 hours
        comm({ id: "B", receivedAt: "2026-11-05T00:00:00Z", category: "billing" }), // 25 hours
        comm({ id: "C", receivedAt: "2026-11-02T00:00:00Z", category: "lesson_change" }), // 97 hours
        comm({ id: "D", status: "answered", answeredAt: "2026-11-05T03:00:00Z", receivedAt: "2026-11-05T01:00:00Z" }),
        comm({ id: "E", direction: "outbound", deliveryStatus: "failed", receivedAt: "2026-11-04T01:00:00Z", channel: "sms" }),
      ],
      NOW, current, DEFAULT_THRESHOLDS,
    );
    expect(m.open.map((c) => [c.id, c.urgency])).toEqual([["C", "red"], ["B", "amber"], ["A", "green"]]);
    expect(m.unanswered).toBe(3);
    expect(m.lessonChanges).toBe(1);
    expect(m.billing).toBe(1);
    expect(m.answered).toBe(1);
    expect(m.avgResponseHours).toBe(2);
    expect(m.failedTexts.map((f) => f.id)).toEqual(["E"]);
  });
});

describe("week-on-week comparisons", () => {
  it("says there is not enough history instead of inventing a figure", () => {
    expect(compare("tasksCompleted", 12, null, "records")).toMatchObject({ verdict: "insufficient", change: null });
  });

  it("does not treat every increase as good", () => {
    expect(compare("outstandingCents", 150000, 120000, "snapshot").verdict).toBe("worse");
    expect(compare("unanswered", 4, 9, "snapshot").verdict).toBe("better");
    expect(compare("tasksCompleted", 14, 10, "records").verdict).toBe("better");
    expect(compare("upcomingLessons", 18, 15, "snapshot").verdict).toBe("neutral");
    expect(compare("cancellations", 2, 2, "records").verdict).toBe("same");
  });
});

const lessons = (over: Partial<LessonMetrics> = {}): LessonMetrics => ({
  held: 4, cancelled: 0, upcoming: 10, needCover: [], absences: [], pendingChanges: 0, waitingWorkflows: 0, ownerDecisions: [], clarifications: 0, openTasks: 0, ...over,
});

const finance = (over: Partial<FinanceMetrics> = {}): FinanceMetrics => ({
  outstandingCents: 180000, outstandingInvoices: 7, overdueInvoices: 5, overdueCents: 120000, over14Invoices: 4, over14Cents: 100000, protectedInvoices: 1,
  eligibleFamilies: 3, eligibleCents: 90000, paymentsReceivedCents: 0, paymentsReceivedCount: 0,
  families: [
    { contactId: "BC-01", name: "Priya Mehta", students: [], cents: 40000, maxDays: 21, state: "eligible", invoices: [{ id: "INV-1", cents: 20000, days: 21 }, { id: "INV-2", cents: 20000, days: 18 }] },
    { contactId: "BC-02", name: "Sean O'Brien", students: [], cents: 30000, maxDays: 16, state: "eligible", invoices: [{ id: "INV-3", cents: 30000, days: 16 }] },
    { contactId: "BC-03", name: "Grace Wong", students: [], cents: 20000, maxDays: 9, state: "eligible", invoices: [{ id: "INV-4", cents: 20000, days: 9 }] },
    { contactId: "BC-04", name: "Fatima Hassan", students: [], cents: 30000, maxDays: 30, state: "protected", invoices: [{ id: "INV-5", cents: 30000, days: 30 }] },
  ],
  ...over,
});

describe("Compass Recommends", () => {
  it("puts serious overdue invoices first, in red, and never more than five", () => {
    const recs = recommendations({ finance: finance(), comms: null, lessons: lessons({ pendingChanges: 2 }), retention: null, t: DEFAULT_THRESHOLDS });
    expect(recs[0]).toMatchObject({ kind: "overdue", priority: "red", finance: true });
    expect(recs.length).toBeLessThanOrEqual(5);
    // Payment reminders always go through the Payments approval flow, never sent from here.
    expect(recs[0].actions.some((a) => a.kind === "link" && a.href.startsWith("/payments"))).toBe(true);
    expect(overallOf(recs)).toBe("action_required");
  });

  it("does not count protected families as ready for reminders", () => {
    const recs = recommendations({ finance: finance(), comms: null, lessons: lessons(), retention: null, t: DEFAULT_THRESHOLDS });
    expect(recs[0].params.families).toBe(3);
    expect(recs[0].params.held).toBe(1);
  });

  it("says all is clear when nothing needs attention", () => {
    const recs = recommendations({ finance: null, comms: null, lessons: lessons(), retention: null, t: DEFAULT_THRESHOLDS });
    expect(recs.map((r) => r.kind)).toEqual(["all_clear"]);
    expect(overallOf(recs)).toBe("up_to_date");
    expect(cardStatus({ overall: "up_to_date" }, false)).toBe("up_to_date");
    expect(cardStatus(null, false)).toBe("generating");
  });
});

const baseInput = (over: Partial<BuildInput> = {}): BuildInput => ({
  now: NOW, mode: "demo", thresholds: DEFAULT_THRESHOLDS, payments: null, paid: [], comms: [], requests: [], events: [], lessons: [], absences: [], workflows: [],
  proposals: [], activity: [], draftsAt: [], tasks: [], retention: null, coverage: { comms: null, lessons: null, events: null }, sources: [], warnings: [], previousSnapshot: null, ...over,
} as BuildInput);

const asBriefing = (b: ReturnType<typeof buildBriefing>): Briefing => ({ ...b, id: "b1", trigger: "page", generatedAt: NOW.toISOString() });

describe("building a briefing", () => {
  it("leaves comparisons empty when there is no earlier briefing or old enough records", () => {
    const b = buildBriefing(baseInput());
    expect(b.detail!.comparisons.every((c) => c.verdict === "insufficient")).toBe(true);
  });

  it("compares snapshot figures only with a briefing from about a week ago", () => {
    const headline = { ...buildBriefing(baseInput()).headline, unanswered: 5 };
    const near = buildBriefing(baseInput({ comms: [comm({})], previousSnapshot: { id: "p", periodKey: "2026-10-30", generatedAt: "2026-10-30T01:00:00Z", headline } }));
    expect(near.detail!.comparisons.find((c) => c.key === "unanswered")).toMatchObject({ current: 1, previous: 5, verdict: "better" });
    const far = buildBriefing(baseInput({ comms: [comm({})], previousSnapshot: { id: "p", periodKey: "2026-10-16", generatedAt: "2026-10-16T01:00:00Z", headline } }));
    expect(far.detail!.comparisons.find((c) => c.key === "unanswered")?.verdict).toBe("insufficient");
  });

  it("hides owner-only finance from admins unless the owner allows it", () => {
    const b = asBriefing(buildBriefing(baseInput()));
    const withMoney: Briefing = {
      ...b,
      headline: { ...b.headline, overdueInvoices: 5, overdueCents: 120000, outstandingCents: 180000 },
      recommendations: recommendations({ finance: finance(), comms: null, lessons: lessons({ pendingChanges: 2 }), retention: null, t: DEFAULT_THRESHOLDS }),
      detail: { ...b.detail!, finance: finance() },
    };
    const admin = viewFor(withMoney, "admin", false);
    expect(admin.financeHidden).toBe(true);
    expect(admin.detail!.finance).toBeNull();
    expect(admin.headline.outstandingCents).toBe(0);
    expect(admin.recommendations.some((r) => r.finance)).toBe(false);
    expect(admin.detail!.comparisons.some((c) => c.key === "outstandingCents" || c.key === "overdueInvoices")).toBe(false);
    expect(JSON.stringify(admin)).not.toContain("Priya Mehta");
    expect(viewFor(withMoney, "admin", true).financeHidden).toBe(false);
    expect(viewFor(withMoney, "owner", false).detail!.finance).not.toBeNull();
  });
});

describe("the briefing email", () => {
  it("escapes every value and labels demo emails", () => {
    const b = asBriefing(buildBriefing(baseInput({ comms: [comm({ contactName: "<script>alert(1)</script>", subject: "<img src=x onerror=alert(1)>" })] })));
    const mail = briefingEmail(viewFor(b, "owner", false), { t, fmt, link: "https://tutorcompass.app/briefing", sections: [...SECTION_IDS], businessName: "Bright <Tutoring>", demo: true });
    expect(mail.html).not.toMatch(/<script|<img/i);
    expect(mail.html).toContain("Bright &lt;Tutoring&gt;");
    expect(mail.subject).toContain("[demo]");
    expect(mail.html).toContain("https://tutorcompass.app/briefing");
    expect(stripIsolates(mail.text)).toContain("https://tutorcompass.app/briefing");
  });
});

describe("Compass questions", () => {
  it("recognises the weekly briefing questions", () => {
    expect(detectBriefing("Prepare my weekly business briefing")?.kind).toBe("prepare");
    expect(detectBriefing("What happened in my business last week?")?.kind).toBe("last_week");
    expect(detectBriefing("What are my biggest administrative problems?")?.kind).toBe("problems");
    expect(detectBriefing("Which parents have overdue payments?")?.kind).toBe("overdue");
    expect(detectBriefing("What has Compass completed this week?")?.kind).toBe("completed");
    expect(detectBriefing("How is my business doing compared with last week?")?.kind).toBe("compare");
  });

  it("leaves other questions to their own tools", () => {
    expect(detectBriefing("What needs my attention?")).toBeNull();
    expect(detectBriefing("Can the Mehta family have an extension on their overdue invoice?")).toBeNull();
    expect(detectBriefing("Move Mia's lesson to Friday")).toBeNull();
  });

  it("understands short follow-ups", () => {
    expect(briefingFollowUp("Why?")?.kind).toBe("why");
    expect(briefingFollowUp("What should I do first?")?.kind).toBe("first");
    expect(briefingFollowUp("And the enquiries?")?.kind).toBe("comms");
    expect(briefingFollowUp("x".repeat(200))).toBeNull();
  });

  it("keeps the four Compass welcome shortcuts exactly as they were", () => {
    expect([...SHORTCUT_IDS]).toEqual(["attention", "lesson_change", "payment_extension", "tutor_absence"]);
  });
});

describe("the database migration", () => {
  const sql = readFileSync("supabase/migrations/20261106000001_weekly_briefing.sql", "utf8");
  it("stops the same email going out twice", () => {
    expect(sql).toMatch(/unique index[^;]*briefing_deliveries[^;]*slot_key/i);
    expect(sql).toMatch(/claim_briefing_delivery/);
  });
  it("keeps demo rows labelled and server-only", () => {
    expect(sql).toMatch(/fictional_demo/);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).not.toMatch(/create policy/i);
  });
});
