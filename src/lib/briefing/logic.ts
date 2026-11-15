import { addDays, daysBetween, sydneyDate, sydneyToday } from "@/lib/workflows/dates";
import { assessFamilies, balanceOf, daysOverdue } from "@/lib/payments/logic";
import type { BillingException, Contact, Invoice, RecoveryRules, Student } from "@/lib/payments/types";
import { GROUP_STATUSES } from "@/lib/overview/status-cards";
import {
  DEFAULT_THRESHOLDS,
  SECTION_IDS,
  type AbsenceIn,
  type ActivityIn,
  type Briefing,
  type BriefingDetail,
  type BriefingMode,
  type BriefingSettings,
  type BriefingView,
  type CommIn,
  type CommItem,
  type CommMetrics,
  type CompareKey,
  type Comparison,
  type CompletedMetrics,
  type Coverage,
  type Evidence,
  type FamilyOverdue,
  type FinanceMetrics,
  type Headline,
  type LessonIn,
  type LessonMetrics,
  type Overall,
  type PaidIn,
  type Period,
  type Priority,
  type ProposalIn,
  type Recommendation,
  type RequestEventIn,
  type RequestIn,
  type SectionId,
  type Source,
  type TaskIn,
  type Thresholds,
  type Warning,
  type WorkflowIn,
} from "./types";

// The Weekly Owner Briefing, worked out from records. Pure functions: callers pass the
// records and the time, so every count, total, percentage and comparison is tested on its
// own. Nothing here guesses. A figure that can't be worked out is null and shown as such.
// Recommendations come from fixed rules over these figures and always carry the records
// they are based on.

const TZ = "Australia/Sydney";
const HOUR = 3_600_000;

// Time -------------------------------------------------------------------------------------------

function sydneyOffsetMinutes(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The instant a Sydney wall-clock time happens, as ISO. Handles daylight saving. */
export function sydneyInstant(day: string, time = "00:00"): string {
  const [h, m] = time.split(":").map(Number);
  const wall = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h || 0, m || 0);
  let guess = wall - 10 * 60 * 60000;
  for (let i = 0; i < 3; i++) {
    const next = wall - sydneyOffsetMinutes(new Date(guess)) * 60000;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess).toISOString();
}

/** ISO weekday of a Sydney day: 1 Monday to 7 Sunday. */
export function isoWeekday(day: string): number {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * This week is the seven Sydney days ending today, up to now. Last week is the seven days
 * before that. On a Monday morning that is the whole of last week plus the morning.
 */
export function reportingPeriods(now: Date): { current: Period; previous: Period; key: string } {
  const today = sydneyToday(now);
  const startDay = addDays(today, -6);
  const prevStartDay = addDays(today, -13);
  const current: Period = { start: sydneyInstant(startDay), end: now.toISOString(), startDay, endDay: today };
  const previous: Period = { start: sydneyInstant(prevStartDay), end: current.start, startDay: prevStartDay, endDay: addDays(today, -7) };
  return { current, previous, key: today };
}

const inPeriod = (iso: string | null | undefined, p: Period) => Boolean(iso) && iso! >= p.start && iso! < p.end;
const hoursBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / HOUR;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A source reaches back far enough to compare with last week. */
export function covers(earliest: string | null | undefined, previous: Period): boolean {
  return Boolean(earliest) && sydneyDate(earliest!) <= previous.startDay;
}

// Schedule ---------------------------------------------------------------------------------------

export type Slot = { key: string; day: string; at: string };

/** The most recent scheduled time at or before now. */
export function latestSlot(s: Pick<BriefingSettings, "sendDay" | "sendTime">, now: Date): Slot {
  const today = sydneyToday(now);
  let day = addDays(today, -((isoWeekday(today) - s.sendDay + 7) % 7));
  let at = sydneyInstant(day, s.sendTime);
  if (at > now.toISOString()) {
    day = addDays(day, -7);
    at = sydneyInstant(day, s.sendTime);
  }
  return { key: `weekly:${day}`, day, at };
}

/** The next scheduled time after now. */
export function nextSlot(s: Pick<BriefingSettings, "sendDay" | "sendTime">, now: Date): Slot {
  const last = latestSlot(s, now);
  const day = addDays(last.day, 7);
  return { key: `weekly:${day}`, day, at: sydneyInstant(day, s.sendTime) };
}

/**
 * The slot a scheduled job should send now, or null. A slot stays due for 30 hours, so a
 * job that runs once a day still catches it, and an old week is never sent late.
 */
export function dueSlot(s: Pick<BriefingSettings, "enabled" | "sendDay" | "sendTime">, now: Date, windowHours = 30): Slot | null {
  if (!s.enabled) return null;
  const slot = latestSlot(s, now);
  return hoursBetween(slot.at, now.toISOString()) <= windowHours ? slot : null;
}

// Settings -----------------------------------------------------------------------------------------

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normaliseThresholds(raw: unknown): Thresholds {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const amber = clampInt(r.enquiryAmberHours, 1, 336, DEFAULT_THRESHOLDS.enquiryAmberHours);
  return {
    overdueRedDays: clampInt(r.overdueRedDays, 1, 120, DEFAULT_THRESHOLDS.overdueRedDays),
    overdueRedCount: clampInt(r.overdueRedCount, 1, 50, DEFAULT_THRESHOLDS.overdueRedCount),
    enquiryAmberHours: amber,
    enquiryRedHours: Math.max(amber + 1, clampInt(r.enquiryRedHours, 2, 720, DEFAULT_THRESHOLDS.enquiryRedHours)),
    coverRedHours: clampInt(r.coverRedHours, 1, 336, DEFAULT_THRESHOLDS.coverRedHours),
  };
}

export function normaliseSections(raw: unknown): SectionId[] {
  const list = Array.isArray(raw) ? raw : [];
  return SECTION_IDS.filter((s) => list.includes(s));
}

export function validTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

// Finance ---------------------------------------------------------------------------------------------

export type PaymentRecords = { contacts: Contact[]; students: Student[]; invoices: Invoice[]; exceptions: BillingException[]; rules: RecoveryRules };

export function financeMetrics(r: PaymentRecords, today: string, paid: PaidIn[], period: Period, t: Thresholds): FinanceMetrics {
  const open = r.invoices.filter((i) => i.status === "authorised" && balanceOf(i) > 0);
  const overdue = open.filter((i) => daysOverdue(i, today) > 0);
  const over = overdue.filter((i) => daysOverdue(i, today) > t.overdueRedDays);
  const families = assessFamilies({ ...r, today, gmailChecked: true });
  const protectedIds = new Set(families.filter((f) => f.state === "protected").map((f) => f.contactId));
  const eligible = families.filter((f) => f.state === "eligible");
  const received = paid.filter((p) => inPeriod(p.at, period));
  const sum = (xs: Invoice[]) => xs.reduce((s, i) => s + balanceOf(i), 0);
  return {
    outstandingCents: sum(open),
    outstandingInvoices: open.length,
    overdueInvoices: overdue.length,
    overdueCents: sum(overdue),
    over14Invoices: over.length,
    over14Cents: sum(over),
    protectedInvoices: overdue.filter((i) => protectedIds.has(i.contactId)).length,
    eligibleFamilies: eligible.length,
    eligibleCents: eligible.reduce((s, f) => s + f.totalCents, 0),
    paymentsReceivedCents: received.reduce((s, p) => s + p.amountCents, 0),
    paymentsReceivedCount: received.length,
    families: families.map<FamilyOverdue>((f) => ({
      contactId: f.contactId, name: f.contactName, students: f.students, cents: f.totalCents, maxDays: f.maxDaysOverdue, state: f.state,
      invoices: f.invoices.map((i) => ({ id: i.id, cents: i.balanceCents, days: i.daysOverdue })),
    })),
  };
}

// Communications ------------------------------------------------------------------------------------

function urgency(ageHours: number, status: CommIn["status"], t: Thresholds): Priority {
  if (ageHours > t.enquiryRedHours) return "red";
  if (ageHours > t.enquiryAmberHours || status === "awaiting_owner") return "amber";
  return "green";
}

/** Enquiries received in a period, and how long replies took (answered ones only). */
export function commFlow(comms: CommIn[], p: Period): { received: number; avgResponseHours: number | null } {
  const inbound = comms.filter((c) => c.direction === "inbound");
  const received = inbound.filter((c) => inPeriod(c.receivedAt, p)).length;
  const answered = inbound.filter((c) => c.answeredAt && inPeriod(c.answeredAt, p));
  const avg = answered.length ? round1(answered.reduce((s, c) => s + hoursBetween(c.receivedAt, c.answeredAt!), 0) / answered.length) : null;
  return { received, avgResponseHours: avg };
}

export function commMetrics(comms: CommIn[], now: Date, period: Period, t: Thresholds): CommMetrics {
  const nowIso = now.toISOString();
  const open: CommItem[] = comms
    .filter((c) => c.direction === "inbound" && (c.status === "unanswered" || c.status === "awaiting_owner"))
    .map((c) => {
      const ageHours = Math.max(0, Math.floor(hoursBetween(c.receivedAt, nowIso)));
      return {
        id: c.id, channel: c.channel, contactName: c.contactName, studentName: c.studentName, senderKind: c.senderKind, category: c.category,
        subject: c.subject, receivedAt: c.receivedAt, ageHours, urgency: urgency(ageHours, c.status, t), status: c.status, requestId: c.requestId,
      };
    })
    .sort((a, b) => b.ageHours - a.ageHours);
  const flow = commFlow(comms, period);
  const answered = comms.filter((c) => c.direction === "inbound" && c.answeredAt && inPeriod(c.answeredAt, period)).length;
  return {
    open,
    unanswered: open.filter((c) => c.status === "unanswered").length,
    awaitingOwner: open.filter((c) => c.status === "awaiting_owner").length,
    lessonChanges: open.filter((c) => c.category === "lesson_change").length,
    billing: open.filter((c) => c.category === "billing").length,
    enrolment: open.filter((c) => c.category === "enrolment").length,
    tutorMessages: open.filter((c) => c.category === "tutor_absence").length,
    failedTexts: comms.filter((c) => c.direction === "outbound" && c.deliveryStatus === "failed" && inPeriod(c.receivedAt, period)).map((c) => ({ id: c.id, contactName: c.contactName, at: c.receivedAt })),
    received: flow.received,
    answered,
    avgResponseHours: flow.avgResponseHours,
    oldestHours: open.length ? open[0].ageHours : null,
  };
}

// Lessons and operations -------------------------------------------------------------------------------

const OPEN_STATUSES = new Set<string>([...GROUP_STATUSES.owner, ...GROUP_STATUSES.info, ...GROUP_STATUSES.ready]);

export function lessonMetrics(input: {
  lessons: LessonIn[]; absences: AbsenceIn[]; requests: RequestIn[]; workflows: WorkflowIn[]; tasks: TaskIn[]; now: Date; period: Period;
}): LessonMetrics {
  const { lessons, absences, requests, workflows, tasks, now, period } = input;
  const nowIso = now.toISOString();
  const today = sydneyToday(now);
  const week = new Date(now.getTime() + 7 * 24 * HOUR).toISOString();
  const fortnight = new Date(now.getTime() + 14 * 24 * HOUR).toISOString();
  const away = (tutorId: string, day: string) => absences.some((a) => a.tutorId === tutorId && a.startsOn <= day && a.endsOn >= day);
  const owner = new Set<string>(GROUP_STATUSES.owner);
  const info = new Set<string>(GROUP_STATUSES.info);
  return {
    held: lessons.filter((l) => l.status !== "cancelled" && inPeriod(l.startsAt, period) && l.startsAt < nowIso).length,
    cancelled: lessons.filter((l) => l.status === "cancelled" && inPeriod(l.startsAt, period)).length,
    upcoming: lessons.filter((l) => l.status === "scheduled" && l.startsAt >= nowIso && l.startsAt < week).length,
    needCover: lessons
      .filter((l) => l.status === "scheduled" && l.startsAt >= nowIso && l.startsAt < fortnight && away(l.tutorId, sydneyDate(l.startsAt)))
      .map((l) => ({ id: l.id, tutorName: l.tutorName, student: l.student, subject: l.subject, startsAt: l.startsAt, hoursAway: Math.floor(hoursBetween(nowIso, l.startsAt)) })),
    absences: absences
      .filter((a) => a.endsOn >= addDays(today, -6) && a.startsOn <= addDays(today, 14))
      .map((a) => ({ tutorName: a.tutorName, startsOn: a.startsOn, endsOn: a.endsOn })),
    pendingChanges:
      requests.filter((r) => r.type === "lesson_change" && OPEN_STATUSES.has(r.status)).length +
      workflows.filter((w) => w.workflow === "lesson_change" && (w.status === "active" || w.status === "waiting")).length,
    waitingWorkflows: workflows.filter((w) => w.status === "active" || w.status === "waiting").length,
    ownerDecisions: requests
      .filter((r) => owner.has(r.status))
      .map((r) => ({ id: r.id, reference: r.reference, type: r.type, welfare: r.welfare, createdAt: r.createdAt }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    clarifications: requests.filter((r) => info.has(r.status)).length,
    openTasks: tasks.filter((x) => x.status === "open").length,
  };
}

// What Compass completed ----------------------------------------------------------------------------

const ADMIN_EVENTS = new Set(["admin_replied", "admin_recorded", "closed", "sent_to_owner", "reevaluated"]);
const OWNER_EVENTS = new Set(["owner_approved", "owner_declined", "owner_requested_info"]);
const RULE_EVENTS = new Set(["sent_to_owner", "reevaluated", "closed"]);

/**
 * Verified work in a period, from saved records only. Checks and drafts are counted
 * separately and never as completed actions. Compass-assisted means Compass prepared it and
 * a person confirmed it; request decisions confirmed through Compass already appear as the
 * owner's or admin's event, so they aren't counted twice.
 */
export function completedMetrics(input: { events: RequestEventIn[]; requests: RequestIn[]; proposals: ProposalIn[]; workflows: WorkflowIn[]; activity: ActivityIn[]; draftsAt: string[]; period: Period }): CompletedMetrics {
  const { events, requests, proposals, activity, draftsAt, period } = input;
  const ev = events.filter((e) => inPeriod(e.at, period));
  const done = proposals.filter((p) => p.status === "succeeded" && inPeriod(p.confirmedAt, period));
  const rules = ev.filter((e) => e.actorRole === "system" && RULE_EVENTS.has(e.type)).length;
  const admin = ev.filter((e) => e.actorRole === "admin" && ADMIN_EVENTS.has(e.type)).length;
  const owner = ev.filter((e) => e.actorRole === "owner" && (OWNER_EVENTS.has(e.type) || e.type === "closed")).length;
  const compass = done.filter((p) => !p.action.startsWith("request.")).length;
  return {
    requestsReceived: requests.filter((r) => inPeriod(r.createdAt, period)).length,
    requestsClosed: ev.filter((e) => e.type === "closed").length,
    lessonChanges: done.filter((p) => p.action === "booking.reschedule").length,
    availabilityChecks: activity.filter((a) => a.type === "availability_checked" && inPeriod(a.at, period)).length,
    drafted: activity.filter((a) => a.type === "draft_prepared" && inPeriod(a.at, period)).length + draftsAt.filter((d) => inPeriod(d, period)).length,
    adminTasks: admin,
    ownerApprovals: ev.filter((e) => e.actorRole === "owner" && OWNER_EVENTS.has(e.type)).length,
    byWho: { rules, admin, owner, compass },
    total: rules + admin + owner + compass,
  };
}

// Comparison ------------------------------------------------------------------------------------------

export const COMPARE_BETTER: Record<CompareKey, Comparison["better"]> = {
  outstandingCents: "lower",
  overdueInvoices: "lower",
  unanswered: "lower",
  tasksCompleted: "higher",
  cancellations: "lower",
  upcomingLessons: "neutral",
  avgResponseHours: "lower",
  enquiriesReceived: "neutral",
};

export function compare(key: CompareKey, current: number | null, previous: number | null, basis: Comparison["basis"]): Comparison {
  const better = COMPARE_BETTER[key];
  if (current === null || previous === null) return { key, current, previous, better, basis, change: null, percent: null, verdict: "insufficient" };
  const change = round1(current - previous);
  const percent = previous === 0 ? null : Math.round((change / previous) * 100);
  const verdict: Comparison["verdict"] =
    change === 0 ? "same" : better === "neutral" ? "neutral" : (better === "lower") === change < 0 ? "better" : "worse";
  return { key, current, previous, better, basis, change, percent, verdict };
}

// Recommendations ------------------------------------------------------------------------------------

const RANK: Record<Priority, number> = { red: 0, amber: 1, green: 2 };

export function overallOf(recs: Pick<Recommendation, "priority" | "kind">[]): Overall {
  if (recs.some((r) => r.priority === "red")) return "action_required";
  if (recs.some((r) => r.priority === "amber")) return "attention";
  return "up_to_date";
}

export function recommendations(input: {
  finance: FinanceMetrics | null; comms: CommMetrics | null; lessons: LessonMetrics; retention: BriefingDetail["retention"]; t: Thresholds;
}): Recommendation[] {
  const { finance, comms, lessons, retention, t } = input;
  const out: Recommendation[] = [];

  if (finance && finance.overdueInvoices > 0) {
    const eligible = finance.families.filter((f) => f.state === "eligible");
    const serious = eligible.flatMap((f) => f.invoices).filter((i) => i.days > t.overdueRedDays).length;
    const evidence: Evidence[] = finance.families.slice(0, 8).map((f) => ({
      source: "xero", kind: "family", ref: f.invoices.map((i) => i.id).join(", "), name: f.name, cents: f.cents, days: f.maxDays, text: f.state,
    }));
    out.push({
      id: "overdue", kind: "overdue", finance: true,
      priority: serious >= t.overdueRedCount ? "red" : eligible.length ? "amber" : "green",
      params: { count: finance.overdueInvoices, overdueCents: finance.overdueCents, over: finance.over14Invoices, days: t.overdueRedDays, families: eligible.length, eligibleCents: finance.eligibleCents, held: finance.families.length - eligible.length },
      evidence,
      actions: [
        { kind: "link", href: "/payments?tab=recovery", label: "prepareReminders" },
        { kind: "records", label: "viewRecords" },
        { kind: "link", href: "/payments?tab=invoices", label: "reviewRecommendation" },
      ],
      impact: eligible.length ? { cents: finance.eligibleCents, count: eligible.length } : null,
    });
  }

  if (comms && comms.open.length > 0) {
    const worst = comms.open.reduce<Priority>((p, c) => (RANK[c.urgency] < RANK[p] ? c.urgency : p), "green");
    const parentOpen = comms.open.filter((c) => c.category !== "tutor_absence");
    if (parentOpen.length) {
      const linked = parentOpen.find((c) => c.requestId);
      out.push({
        id: "enquiries", kind: "enquiries", finance: false, priority: parentOpen.some((c) => c.urgency === "red") ? "red" : worst === "green" ? "green" : "amber",
        params: { count: parentOpen.length, lessonChanges: comms.lessonChanges, billing: comms.billing, enrolment: comms.enrolment, oldest: parentOpen[0].ageHours, red: parentOpen.filter((c) => c.urgency === "red").length, hours: t.enquiryRedHours },
        evidence: parentOpen.slice(0, 8).map((c) => ({ source: c.channel === "sms" ? "sms" : "gmail", kind: "message", ref: c.id, name: c.contactName, hours: c.ageHours, text: c.subject })),
        actions: [
          linked ? { kind: "link", href: `/requests/${linked.requestId}`, label: "openRequest" } : { kind: "link", href: "/requests", label: "openRequests" },
          { kind: "records", label: "viewRecords" },
        ],
        impact: null,
      });
    }
  }

  if (lessons.needCover.length) {
    const soonest = lessons.needCover.reduce((a, b) => (a.hoursAway < b.hoursAway ? a : b));
    out.push({
      id: "cover", kind: "cover", finance: false, priority: soonest.hoursAway <= t.coverRedHours ? "red" : "amber",
      params: { count: lessons.needCover.length, hours: soonest.hoursAway, tutor: soonest.tutorName },
      evidence: lessons.needCover.slice(0, 8).map((l) => ({ source: "compass", kind: "lesson", ref: l.id, name: l.tutorName, at: l.startsAt, text: [l.subject, l.student].filter(Boolean).join(", ") })),
      actions: [{ kind: "compass", shortcut: "tutor_absence", label: "startTutorAbsence" }, { kind: "link", href: "/schedule", label: "openSchedule" }],
      impact: { count: lessons.needCover.length },
    });
  }

  const tutorMsgs = comms?.open.filter((c) => c.category === "tutor_absence") ?? [];
  if (tutorMsgs.length) {
    out.push({
      id: "tutor_message", kind: "tutor_message", finance: false, priority: "amber",
      params: { count: tutorMsgs.length, tutor: tutorMsgs[0].contactName },
      evidence: tutorMsgs.map((c) => ({ source: c.channel === "sms" ? "sms" : "gmail", kind: "message", ref: c.id, name: c.contactName, hours: c.ageHours, text: c.subject })),
      actions: [{ kind: "compass", shortcut: "tutor_absence", label: "startTutorAbsence" }, { kind: "records", label: "viewRecords" }],
      impact: null,
    });
  }

  if (lessons.ownerDecisions.length) {
    out.push({
      id: "decisions", kind: "decisions", finance: false, priority: lessons.ownerDecisions.some((d) => d.welfare) ? "red" : "amber",
      params: { count: lessons.ownerDecisions.length, welfare: lessons.ownerDecisions.filter((d) => d.welfare).length },
      // Only the reference and type. Welfare details never leave the request page.
      evidence: lessons.ownerDecisions.slice(0, 8).map((d) => ({ source: "compass", kind: "request", ref: d.reference ?? d.id.slice(0, 8), at: d.createdAt, text: d.type })),
      actions: [{ kind: "link", href: "/owner", label: "openApprovalAlley" }, { kind: "records", label: "viewRecords" }],
      impact: null,
    });
  }

  if (comms && comms.lessonChanges + lessons.pendingChanges > 0) {
    out.push({
      id: "lesson_changes", kind: "lesson_changes", finance: false, priority: "amber",
      params: { count: comms.lessonChanges + lessons.pendingChanges, messages: comms.lessonChanges, requests: lessons.pendingChanges },
      evidence: comms.open.filter((c) => c.category === "lesson_change").map((c) => ({ source: c.channel === "sms" ? "sms" : "gmail", kind: "message", ref: c.id, name: c.contactName, hours: c.ageHours, text: c.subject })),
      actions: [{ kind: "compass", shortcut: "lesson_change", label: "startLessonChange" }, { kind: "records", label: "viewRecords" }],
      impact: null,
    });
  }

  if (retention && retention.high + retention.medium > 0) {
    out.push({
      id: "retention", kind: "retention", finance: false, priority: retention.high ? "amber" : "green",
      params: { count: retention.high + retention.medium, high: retention.high, medium: retention.medium, monitored: retention.monitored },
      evidence: [{ source: "compass", kind: "retention", ref: "Student Retention", text: `${retention.high}/${retention.medium}` }],
      actions: [{ kind: "link", href: "/insights?retention=open#retention", label: "openRetention" }],
      impact: null,
    });
  }

  if (comms && comms.failedTexts.length) {
    out.push({
      id: "failed_texts", kind: "failed_texts", finance: false, priority: "green",
      params: { count: comms.failedTexts.length, name: comms.failedTexts[0].contactName },
      evidence: comms.failedTexts.map((f) => ({ source: "sms", kind: "message", ref: f.id, name: f.contactName, at: f.at })),
      actions: [{ kind: "records", label: "viewRecords" }],
      impact: null,
    });
  }

  const ranked = out.sort((a, b) => RANK[a.priority] - RANK[b.priority]).slice(0, 5);
  if (!ranked.some((r) => r.priority !== "green") && ranked.length < 3) {
    ranked.push({ id: "all_clear", kind: "all_clear", finance: false, priority: "green", params: {}, evidence: [], actions: [{ kind: "link", href: "/", label: "openRequests" }], impact: null });
  }
  return ranked;
}

// The whole briefing ------------------------------------------------------------------------------------

export type BuildInput = {
  now: Date;
  mode: BriefingMode;
  thresholds: Thresholds;
  payments: PaymentRecords | null;
  paid: PaidIn[];
  comms: CommIn[] | null;
  requests: RequestIn[];
  events: RequestEventIn[];
  lessons: LessonIn[];
  absences: AbsenceIn[];
  workflows: WorkflowIn[];
  proposals: ProposalIn[];
  activity: ActivityIn[];
  draftsAt: string[];
  tasks: TaskIn[];
  retention: BriefingDetail["retention"];
  coverage: Coverage;
  sources: Source[];
  warnings: Warning[];
  /** The stored briefing from about a week ago, for figures that are a snapshot in time. */
  previousSnapshot: { id: string; periodKey: string; generatedAt: string; headline: Headline } | null;
};

export type Built = Omit<Briefing, "id" | "trigger" | "generatedAt">;

export function buildBriefing(i: BuildInput): Built {
  const { current, previous, key } = reportingPeriods(i.now);
  const today = sydneyToday(i.now);
  const finance = i.payments ? financeMetrics(i.payments, today, i.paid, current, i.thresholds) : null;
  const comms = i.comms ? commMetrics(i.comms, i.now, current, i.thresholds) : null;
  const lessons = lessonMetrics({ lessons: i.lessons, absences: i.absences, requests: i.requests, workflows: i.workflows, tasks: i.tasks, now: i.now, period: current });
  const shared = { events: i.events, requests: i.requests, proposals: i.proposals, workflows: i.workflows, activity: i.activity, draftsAt: i.draftsAt };
  const completed = completedMetrics({ ...shared, period: current });
  const eventsCovered = covers(i.coverage.events, previous);
  const previousCompleted = eventsCovered ? completedMetrics({ ...shared, period: previous }) : null;
  const recs = recommendations({ finance, comms, lessons, retention: i.retention, t: i.thresholds });

  const headline: Headline = {
    activeStudents: i.payments ? i.payments.students.filter((s) => s.enrolled).length : 0,
    overdueInvoices: finance?.overdueInvoices ?? 0,
    overdueCents: finance?.overdueCents ?? 0,
    outstandingCents: finance?.outstandingCents ?? 0,
    over14Invoices: finance?.over14Invoices ?? 0,
    unanswered: comms?.unanswered ?? 0,
    awaitingOwner: comms?.awaitingOwner ?? 0,
    upcomingLessons: lessons.upcoming,
    tasksCompleted: completed.total,
    cancellations: lessons.cancelled,
    enquiriesReceived: comms?.received ?? 0,
    avgResponseHours: comms?.avgResponseHours ?? null,
    recommendations: recs.filter((r) => r.kind !== "all_clear").length,
  };

  // Snapshot figures compare with the briefing from about a week ago (5 to 9 days). Flow
  // figures are counted again from the records for last week, when the records go back that far.
  const snap = i.previousSnapshot;
  const snapOk = snap && Math.abs(daysBetween(snap.periodKey, key) - 7) <= 2 ? snap.headline : null;
  const commsCovered = Boolean(i.comms) && covers(i.coverage.comms, previous);
  const prevFlow = i.comms && commsCovered ? commFlow(i.comms, previous) : null;
  const lessonsCovered = covers(i.coverage.lessons, previous);
  const prevLessons = lessonsCovered ? lessonMetrics({ lessons: i.lessons, absences: [], requests: [], workflows: [], tasks: [], now: new Date(previous.end), period: previous }) : null;
  const comparisons: Comparison[] = [
    compare("outstandingCents", finance ? headline.outstandingCents : null, finance ? snapOk?.outstandingCents ?? null : null, "snapshot"),
    compare("overdueInvoices", finance ? headline.overdueInvoices : null, finance ? snapOk?.overdueInvoices ?? null : null, "snapshot"),
    compare("unanswered", comms ? headline.unanswered : null, comms ? snapOk?.unanswered ?? null : null, "snapshot"),
    compare("tasksCompleted", headline.tasksCompleted, previousCompleted?.total ?? null, "records"),
    compare("cancellations", headline.cancellations, prevLessons?.cancelled ?? null, "records"),
    compare("upcomingLessons", headline.upcomingLessons, snapOk?.upcomingLessons ?? null, "snapshot"),
    compare("avgResponseHours", headline.avgResponseHours, prevFlow?.avgResponseHours ?? null, "records"),
    compare("enquiriesReceived", comms ? headline.enquiriesReceived : null, prevFlow?.received ?? null, "records"),
  ];

  const warnings = [...i.warnings];
  if (!lessonsCovered && i.lessons.length) warnings.push({ kind: "partial", source: "compass" });

  return {
    periodKey: key,
    period: current,
    previous,
    overall: overallOf(recs),
    headline,
    detail: {
      version: 1, finance, comms, lessons, completed, previousCompleted, comparisons, retention: i.retention,
      previousBriefing: snap ? { id: snap.id, periodKey: snap.periodKey, generatedAt: snap.generatedAt } : null,
    },
    recommendations: recs,
    sources: i.sources,
    warnings,
    mode: i.mode,
  };
}

// Permissions -------------------------------------------------------------------------------------------

const MONEY_COMPARISONS = new Set<CompareKey>(["outstandingCents", "overdueInvoices"]);

/**
 * What one person may see. The owner sees everything. Admins don't see invoices, balances,
 * overdue families or payment recommendations unless the owner has turned that on.
 */
export function viewFor(b: Briefing, role: "owner" | "admin", adminFinance: boolean): BriefingView {
  if (role === "owner" || adminFinance) return { ...b, financeHidden: false };
  return {
    ...b,
    financeHidden: true,
    headline: { ...b.headline, overdueInvoices: 0, overdueCents: 0, outstandingCents: 0, over14Invoices: 0, recommendations: b.recommendations.filter((r) => !r.finance && r.kind !== "all_clear").length },
    recommendations: b.recommendations.filter((r) => !r.finance),
    detail: b.detail ? { ...b.detail, finance: null, comparisons: b.detail.comparisons.filter((c) => !MONEY_COMPARISONS.has(c.key)) } : null,
  };
}

/** The status shown on the Overview card. */
export function cardStatus(b: Pick<Briefing, "overall"> | null, generating: boolean): "generating" | "action_required" | "ready" | "up_to_date" {
  if (generating || !b) return "generating";
  return b.overall === "action_required" ? "action_required" : b.overall === "attention" ? "ready" : "up_to_date";
}
