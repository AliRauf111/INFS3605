import type {
  Assessment,
  Channel,
  ConcernCategory,
  Dismissal,
  DraftText,
  RetentionConcern,
  RetentionContact,
  RetentionLesson,
  RetentionMessage,
  RetentionSettings,
  RetentionStudent,
  RiskFactor,
  RiskLevel,
  Stage,
} from "./types";

// The Student Retention Agent's reasoning, kept free of the database so it can be tested.
// Every score is a sum of plain, named points from the records, so the owner can see
// exactly how it was worked out. A score is a prompt to check in, never a prediction that
// a student will leave.

export const DEFAULT_SETTINGS: RetentionSettings = {
  highThreshold: 60,
  mediumThreshold: 30,
  windowDays: 30,
  baselineDays: 60,
  minLessons: 3,
  cooldownDays: 14,
};

/** Points for each kind of warning sign, and the most each can add. */
export const POINTS = {
  attendancePerPoint: 1,
  attendanceMax: 35,
  cancellation: 8,
  cancellationMax: 24,
  noShow: 8,
  noShowMax: 16,
  reschedule: 3,
  rescheduleMax: 9,
  concern: 10,
  concernMax: 20,
  frequencyDrop: 10,
  frequencyDropShare: 0.3,
  noUpcoming: 6,
} as const;

export const LEVEL_ORDER: RiskLevel[] = ["high", "medium", "low"];

// Dates --------------------------------------------------------------------------------------

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

/** "12 Oct" for a calendar day. */
export function shortDay(iso: string): string {
  return new Date(`${iso}T02:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Attendance ---------------------------------------------------------------------------------

/** Lessons that should have happened and were the family's to attend. Tutor cancellations and moved lessons don't count against anyone. */
const COUNTED = new Set(["attended", "no_show", "cancelled_family"]);

export type PeriodStats = { counted: number; /** Lessons booked, including ones the tutor cancelled. */ booked: number; attended: number; cancellations: RetentionLesson[]; noShows: RetentionLesson[]; reschedules: RetentionLesson[]; percent: number | null };

/** Lessons from `from` up to and including `to`. */
export function periodStats(lessons: RetentionLesson[], from: string, to: string): PeriodStats {
  const inside = lessons.filter((l) => l.date >= from && l.date <= to);
  const counted = inside.filter((l) => COUNTED.has(l.outcome));
  const attended = counted.filter((l) => l.outcome === "attended").length;
  return {
    counted: counted.length,
    booked: counted.length + inside.filter((l) => l.outcome === "cancelled_tutor").length,
    attended,
    cancellations: inside.filter((l) => l.outcome === "cancelled_family"),
    noShows: inside.filter((l) => l.outcome === "no_show"),
    reschedules: inside.filter((l) => l.outcome === "rescheduled"),
    percent: counted.length ? Math.round((attended / counted.length) * 100) : null,
  };
}

export function levelFor(score: number, s: RetentionSettings): RiskLevel {
  if (score >= s.highThreshold) return "high";
  if (score >= s.mediumThreshold) return "medium";
  return "low";
}

const CONCERN_LABEL: Record<ConcernCategory, string> = {
  scheduling: "Lesson times",
  tutor_fit: "Tutor fit",
  progress: "Learning progress",
  cost: "Cost or lesson plan",
  communication: "Updates and communication",
  other: "Other",
};
export const concernLabel = (c: ConcernCategory) => CONCERN_LABEL[c];

/** Is a dismissal still standing? Only while the score hasn't climbed by 10 or more, or into a higher level. */
export function dismissalHolds(d: Dismissal | null | undefined, score: number, level: RiskLevel): boolean {
  if (!d) return false;
  if (score >= d.scoreAt + 10) return false;
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(d.levelAt);
}

export type AssessInput = {
  student: RetentionStudent;
  contact: RetentionContact | null;
  lessons: RetentionLesson[];
  concerns: RetentionConcern[];
  settings: RetentionSettings;
  today: string;
  dismissal?: Dismissal | null;
};

export function assessStudent(input: AssessInput): Assessment {
  const { student, contact, settings: s, today } = input;
  const lessons = input.lessons.filter((l) => l.studentId === student.id).sort((a, b) => a.date.localeCompare(b.date));
  const concerns = input.concerns.filter((c) => c.studentId === student.id);
  const curFrom = addDays(today, -s.windowDays);
  const curTo = addDays(today, -1);
  const prevTo = addDays(curFrom, -1);
  const prevFrom = addDays(prevTo, -(s.baselineDays - 1));
  const cur = periodStats(lessons, curFrom, curTo);
  const prev = periodStats(lessons, prevFrom, prevTo);
  const upcoming = lessons.filter((l) => l.outcome === "scheduled" && l.date >= today);
  const recent = [...lessons].reverse().find((l) => l.date <= today && l.outcome !== "scheduled") ?? lessons[0];
  const openConcerns = concerns.filter((c) => c.status === "open" && !c.confidential);
  const factors: RiskFactor[] = [];
  const days = `in the last ${s.windowDays} days`;
  const dates = (ls: RetentionLesson[]) => ls.map((l) => `${shortDay(l.date)}, ${l.subject}`);

  const enoughData = prev.counted >= s.minLessons;
  const anyRecords = cur.counted + prev.counted >= s.minLessons;

  if (anyRecords && student.enrolled) {
    if (enoughData && cur.counted > 0 && prev.percent !== null && cur.percent !== null && cur.percent < prev.percent) {
      const drop = prev.percent - cur.percent;
      factors.push({
        id: "attendance_drop",
        points: Math.min(POINTS.attendanceMax, drop * POINTS.attendancePerPoint),
        max: POINTS.attendanceMax,
        text: `Attendance fell from ${prev.percent}% to ${cur.percent}%`,
        evidence: [
          `Previous ${s.baselineDays} days: attended ${prev.attended} of ${prev.counted} lessons`,
          `Last ${s.windowDays} days: attended ${cur.attended} of ${cur.counted} lessons`,
        ],
      });
    }
    if (cur.cancellations.length) {
      factors.push({
        id: "cancellations",
        points: Math.min(POINTS.cancellationMax, cur.cancellations.length * POINTS.cancellation),
        max: POINTS.cancellationMax,
        text: `${plural(cur.cancellations.length, "lesson", "lessons")} cancelled by the family ${days}`,
        evidence: dates(cur.cancellations),
      });
    }
    if (cur.noShows.length) {
      factors.push({
        id: "no_shows",
        points: Math.min(POINTS.noShowMax, cur.noShows.length * POINTS.noShow),
        max: POINTS.noShowMax,
        text: `${plural(cur.noShows.length, "lesson", "lessons")} missed without notice ${days}`,
        evidence: dates(cur.noShows),
      });
    }
    if (cur.reschedules.length) {
      factors.push({
        id: "reschedules",
        points: Math.min(POINTS.rescheduleMax, cur.reschedules.length * POINTS.reschedule),
        max: POINTS.rescheduleMax,
        text: `${plural(cur.reschedules.length, "lesson", "lessons")} moved to another time ${days}`,
        evidence: dates(cur.reschedules),
      });
    }
    if (enoughData) {
      const prevRate = prev.booked / s.baselineDays;
      const curRate = cur.booked / s.windowDays;
      const share = prevRate > 0 ? 1 - curRate / prevRate : 0;
      if (share >= POINTS.frequencyDropShare) {
        const perMonth = (r: number) => Math.round(r * 30 * 10) / 10;
        factors.push({
          id: "frequency_drop",
          points: POINTS.frequencyDrop,
          max: POINTS.frequencyDrop,
          text: `Fewer lessons: about ${perMonth(curRate)} a month now, down from ${perMonth(prevRate)}`,
          evidence: [`${cur.booked} lessons ${days}`, `${prev.booked} lessons in the ${s.baselineDays} days before that`],
        });
      }
    }
    if (cur.counted > 0 && upcoming.length === 0) {
      factors.push({
        id: "no_upcoming",
        points: POINTS.noUpcoming,
        max: POINTS.noUpcoming,
        text: "No upcoming lesson is booked",
        evidence: [recent ? `Last lesson on record: ${shortDay(recent.date)}` : "No lessons on record"],
      });
    }
  }
  if (student.enrolled && openConcerns.length) {
    factors.push({
      id: "open_concerns",
      points: Math.min(POINTS.concernMax, openConcerns.length * POINTS.concern),
      max: POINTS.concernMax,
      text: `${plural(openConcerns.length, "parent concern", "parent concerns")} not yet resolved`,
      evidence: openConcerns.map((c) => `${shortDay(c.raisedOn)}, ${CONCERN_LABEL[c.category]}: ${c.summary}`),
    });
  }

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  const level = student.enrolled ? levelFor(score, s) : "low";
  const dismissal = input.dismissal && dismissalHolds(input.dismissal, score, level) ? input.dismissal : null;
  const reasons = factors.length ? [...factors].sort((a, b) => b.points - a.points).map((f) => f.text) : [anyRecords ? "No warning signs in the current records" : "Not enough lesson records to compare yet"];

  const base: Assessment = {
    studentId: student.id,
    name: student.name,
    yearLevel: student.yearLevel,
    subject: recent?.subject ?? "",
    tutorName: recent?.tutorName ?? null,
    contact,
    score,
    level,
    enoughData,
    currentAttendance: cur.percent,
    previousAttendance: prev.percent,
    currentLessons: cur.counted,
    previousLessons: prev.counted,
    cancellations: cur.cancellations.length,
    noShows: cur.noShows.length,
    reschedules: cur.reschedules.length,
    openConcerns,
    confidentialNotes: concerns.filter((c) => c.confidential && c.status === "open").length,
    nextLesson: upcoming[0]?.date ?? null,
    factors,
    reasons,
    suggestedAction: "",
    dismissed: dismissal,
    flagged: level !== "low" && !dismissal,
  };
  base.suggestedAction = suggestAction(base);
  return base;
}

/** A practical next step from the records only. It never guesses at a family's circumstances. */
export function suggestAction(a: Pick<Assessment, "level" | "factors" | "openConcerns" | "tutorName" | "name">): string {
  if (a.level === "low") return "No action needed. Compass keeps watching the records.";
  const cats = new Set(a.openConcerns.map((c) => c.category));
  const has = (id: RiskFactor["id"]) => a.factors.some((f) => f.id === id);
  const parts: string[] = [];
  if (a.level === "high") parts.push("Contact the parent to understand whether there are scheduling, tutor suitability or learning support concerns.");
  else parts.push("Send a friendly check-in to ask how lessons are going.");
  if (cats.has("tutor_fit")) parts.push(`Ask how lessons with ${a.tutorName ? firstName(a.tutorName) : "the tutor"} are going and whether a different approach would help.`);
  if (cats.has("scheduling") || has("reschedules") || has("frequency_drop")) parts.push("Offer other lesson times if the current ones no longer suit.");
  if (cats.has("progress")) parts.push("Offer a short progress chat with the tutor.");
  if (has("no_upcoming")) parts.push("Check whether the family would like to book the next lesson.");
  return parts.slice(0, 3).join(" ");
}

export function assessAll(input: { students: RetentionStudent[]; contacts: RetentionContact[]; lessons: RetentionLesson[]; concerns: RetentionConcern[]; settings: RetentionSettings; today: string; dismissals: Dismissal[] }): Assessment[] {
  const contacts = new Map(input.contacts.map((c) => [c.id, c]));
  const dismissals = new Map(input.dismissals.map((d) => [d.studentId, d]));
  return input.students
    .filter((s) => s.enrolled)
    .map((student) => assessStudent({ student, contact: contacts.get(student.contactId) ?? null, lessons: input.lessons, concerns: input.concerns, settings: input.settings, today: input.today, dismissal: dismissals.get(student.id) ?? null }))
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.score - a.score || a.name.localeCompare(b.name));
}

export type Overview = { monitored: number; high: number; medium: number; low: number; flagged: number; ownerReview: number; dismissed: number };

/** Headline counts. "Owner review" is a high-risk student with no check-in already under way or sent within the cooldown. */
export function overviewCounts(list: Assessment[], messages: RetentionMessage[], settings: RetentionSettings, now: Date): Overview {
  const active = list.filter((a) => !a.dismissed);
  const high = active.filter((a) => a.level === "high");
  const recentlySent = (m: RetentionMessage) => m.status === "sent" && m.sentAt !== null && now.getTime() - new Date(m.sentAt).getTime() < settings.cooldownDays * 86_400_000;
  const underWay = (m: RetentionMessage) => m.status !== "sent" && m.status !== "failed" && m.status !== "rejected";
  const busy = new Set(messages.filter((m) => underWay(m) || recentlySent(m)).map((m) => m.studentId));
  return {
    monitored: list.length,
    high: high.length,
    medium: active.filter((a) => a.level === "medium").length,
    low: list.length - high.length - active.filter((a) => a.level === "medium").length,
    flagged: active.filter((a) => a.level !== "low").length,
    ownerReview: high.filter((a) => !busy.has(a.studentId)).length,
    dismissed: list.filter((a) => a.dismissed).length,
  };
}

/** The short written summary on the overview card, from the counts and the strongest reasons. */
export function summaryText(list: Assessment[], o: Overview): string {
  if (!o.monitored) return "There are no enrolled students to monitor yet.";
  if (!o.flagged) return `None of the ${o.monitored} students monitored shows a pattern of disengagement in the current records.`;
  const high = list.filter((a) => a.flagged && a.level === "high");
  const parts: string[] = [];
  if (high.length) {
    parts.push(`${high.map((a) => firstName(a.name)).join(" and ")} ${high.length === 1 ? "shows" : "show"} several warning signs together, mainly ${topThemes(high)}.`);
  }
  const medium = list.filter((a) => a.flagged && a.level === "medium");
  if (medium.length) parts.push(`${plural(medium.length, "student has", "students have")} early signs worth a friendly check-in.`);
  parts.push("These are prompts to talk with families, not predictions that anyone will leave.");
  return parts.join(" ");
}

function topThemes(list: Assessment[]): string {
  const names: Record<RiskFactor["id"], string> = {
    attendance_drop: "lower attendance",
    cancellations: "cancellations",
    no_shows: "missed lessons",
    reschedules: "moved lessons",
    open_concerns: "unresolved concerns",
    frequency_drop: "fewer lessons",
    no_upcoming: "no next lesson booked",
  };
  const totals = new Map<RiskFactor["id"], number>();
  for (const a of list) for (const f of a.factors) totals.set(f.id, (totals.get(f.id) ?? 0) + f.points);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => names[id]);
  return top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top.at(-1)}` : top[0] ?? "a mix of signs";
}

/** Identifies the alert in What Needs My Attention: the high-risk students it is about. */
export function alertKeyFor(highIds: string[]): string {
  return `retention:${[...highIds].sort().join(",")}`;
}

// Messages ------------------------------------------------------------------------------------

/** Words that would share internal assessments with a family. Approval is refused while any is present. */
const INTERNAL: Array<{ test: RegExp; what: string }> = [
  { test: /\brisk\b/i, what: "risk" },
  { test: /\bscor(e|es|ed|ing)\b/i, what: "score" },
  { test: /\bflag(s|ged)?\b/i, what: "flagged" },
  { test: /\d+(\.\d+)?\s?%/, what: "a percentage" },
  { test: /\bdisengag/i, what: "disengagement" },
  { test: /\bconfidential\b/i, what: "confidential" },
  { test: /\b(compass ai|algorithm|automated assessment)\b/i, what: "internal tools" },
  { test: /\b(leav(e|ing)|quit(ting)?|drop(ping)? out)\b/i, what: "leaving" },
];

export function internalWording(text: string): string[] {
  return INTERNAL.filter((i) => i.test.test(text)).map((i) => i.what);
}

/** Words that could make a parent feel blamed. Shown as a gentle warning while editing. */
const BLAMING = /\b(you (missed|cancelled|failed|forgot)|no[- ]show|poor attendance|unacceptable|warning|final notice|must attend)\b/i;
export function soundsBlaming(text: string): boolean {
  return BLAMING.test(text);
}

export const SMS_LIMIT = 320;

export type DraftInput = {
  channel: Channel;
  parentName: string;
  studentName: string;
  subject: string;
  tutorName: string | null;
  business: string;
  signoff: string;
  /** Concern topics the parent raised themselves. Only the topic is used, never their words. */
  topics: ConcernCategory[];
  variant: number;
};

const HOOK: Record<ConcernCategory | "none", (st: string) => string> = {
  scheduling: () => "and whether the lesson times are still working for your family",
  tutor_fit: (st) => `and whether the lessons feel like the right fit for ${st}`,
  progress: (st) => `and how ${st} is feeling about the work at the moment`,
  cost: () => "and whether the current lesson plan still suits you",
  communication: () => "and whether more regular updates from the tutor would help",
  other: () => "and whether there is anything we could do better",
  none: () => "and whether there is anything we could do better",
};
const PRIORITY: ConcernCategory[] = ["tutor_fit", "scheduling", "progress", "communication", "cost", "other"];

/** A warm, personalised check-in. Three wordings, so "Regenerate" gives a fresh one. */
export function draftCheckIn(d: DraftInput): DraftText {
  const parent = firstName(d.parentName);
  const st = firstName(d.studentName);
  const subj = d.subject.replace(/^Year \d+\s+/i, "") || "tutoring";
  // Use the tutor's full name when it shares a first name with the parent, so "Hi Priya ... a catch-up with Priya" never happens.
  const tutor = !d.tutorName ? "the tutor" : firstName(d.tutorName).toLowerCase() === parent.toLowerCase() ? d.tutorName.trim() : firstName(d.tutorName);
  const topic = PRIORITY.find((p) => d.topics.includes(p)) ?? "none";
  const hook = HOOK[topic](st);
  const v = ((d.variant % 3) + 3) % 3;
  const me = firstName(d.signoff);
  if (d.channel === "sms") {
    const sms = [
      `Hi ${parent}, it's ${me} from ${d.business}. Just checking in on how ${st}'s ${subj} lessons are going ${hook}. We're happy to help with times or anything else. Reply here or give us a call anytime.`,
      `Hi ${parent}, ${me} here from ${d.business}. We'd love to hear how ${subj} is going for ${st}. If anything would make lessons easier, such as a different time or a quick chat with ${tutor}, just reply to this message.`,
      `Hi ${parent}, a quick hello from ${me} at ${d.business}. How are ${st}'s ${subj} lessons going? If you'd like to change anything, we're happy to help. Reply anytime.`,
    ];
    return { subject: null, body: sms[v] };
  }
  const subjects = [`Checking in about ${st}'s ${subj} lessons`, `How are ${st}'s lessons going?`, `A quick check-in from ${d.business}`];
  const openers = [
    `I hope you're well. I wanted to check in to see how ${st}'s ${subj} lessons have been going ${hook}.`,
    `I hope things are going well. We like to touch base with families during the term, so I wanted to ask how ${subj} is going for ${st} ${hook}.`,
    `I hope you and ${st} are well. I'm getting in touch to see how ${subj} lessons are going ${hook}.`,
  ];
  const support = [
    `We know the term can get busy, and we're happy to help in whatever way suits you best, whether that's a different lesson time, a short catch-up with ${tutor} or a change to the lesson plan.`,
    `If anything would make lessons easier, such as another time slot, a progress chat with ${tutor} or a different focus for the sessions, we'd be glad to arrange it.`,
    `There's no need to prepare anything. If a different time, a quick chat with ${tutor} or a change in approach would help, we can sort that out together.`,
  ];
  const next = [
    "Would you be open to a quick 10-minute call this week? Just reply with a time that works for you, or let us know if you'd prefer to chat by text.",
    "If you have a moment, reply to this email and let us know a good time for a short call. We'll fit in around you.",
    "Feel free to reply to this email with any thoughts, or suggest a time for a quick phone call.",
  ];
  const body = `Hi ${parent},\n\n${openers[v]}\n\n${support[v]}\n\n${next[v]}\n\nKind regards,\n${d.signoff}\n${d.business}`;
  return { subject: subjects[v], body };
}

// Where a message is up to ------------------------------------------------------------------------

export function stageOf(m: Pick<RetentionMessage, "status" | "deliveryStatus" | "responseStatus" | "followUp" | "followUpOn">, today: string): Stage {
  switch (m.status) {
    case "draft": return "draft_prepared";
    case "awaiting_approval": return "awaiting_owner_approval";
    case "approved": return "ready_to_send";
    case "rejected": return "rejected";
    case "sending": return "sending";
    case "failed": return "delivery_failed";
    case "sent":
      if (m.deliveryStatus === "failed") return "delivery_failed";
      if (m.followUp === "resolved") return "resolved";
      if (m.responseStatus === "received") return "response_received";
      if (m.followUp === "required" || (m.followUp === "scheduled" && m.followUpOn !== null && m.followUpOn <= today)) return "follow_up_required";
      if (m.deliveryStatus === "delivered") return "delivered";
      if (m.deliveryStatus === "simulated") return "simulated";
      return "sent";
  }
}

export const STAGE_LABEL: Record<Stage, string> = {
  draft_prepared: "Draft Prepared",
  awaiting_owner_approval: "Awaiting Owner Approval",
  approved_by_owner: "Approved by Owner",
  ready_to_send: "Ready to Send",
  rejected: "Rejected",
  sending: "Sending",
  sent: "Sent",
  simulated: "Sent (Simulated)",
  delivered: "Delivered",
  delivery_failed: "Delivery Failed",
  response_received: "Response Received",
  follow_up_required: "Follow-up Required",
  resolved: "Resolved",
};

export const STAGE_TONE: Record<Stage, "red" | "amber" | "green" | "lilac" | "info" | "grey"> = {
  draft_prepared: "grey",
  awaiting_owner_approval: "amber",
  approved_by_owner: "green",
  ready_to_send: "green",
  rejected: "grey",
  sending: "info",
  sent: "info",
  simulated: "lilac",
  delivered: "green",
  delivery_failed: "red",
  response_received: "green",
  follow_up_required: "amber",
  resolved: "green",
};

/** The next thing to do about a check-in, in plain words. */
export function nextAction(stage: Stage, followUpOn: string | null): string {
  switch (stage) {
    case "draft_prepared": return "Review and approve the draft";
    case "awaiting_owner_approval": return "Owner to review and approve";
    case "approved_by_owner":
    case "ready_to_send": return "Choose how to send and confirm";
    case "rejected": return "Regenerate or edit the draft";
    case "sending": return "Wait for the provider";
    case "delivery_failed": return "Check the contact details and try again";
    case "response_received": return "Agree next steps, then mark resolved";
    case "follow_up_required": return "Follow up with a call or message";
    case "resolved": return "None";
    default: return followUpOn ? `Follow up on ${shortDay(followUpOn)} if no reply` : "Wait for a reply";
  }
}

// Outcomes ----------------------------------------------------------------------------------------

export type OutcomeRow = {
  messageId: string;
  studentId: string;
  name: string;
  sentOn: string;
  daysSoFar: number;
  complete: boolean;
  before: number | null;
  after: number | null;
  beforeLessons: number;
  afterLessons: number;
  cancellationsAfter: number;
  responded: boolean;
  enrolled: boolean;
  resolved: boolean;
};

export type OutcomeSummary = {
  days: number;
  checkIns: number;
  responseRate: number | null;
  responded: number;
  continued: number;
  discontinued: number;
  resolved: number;
  cancellationsAfter: number;
  /** Average change in attendance, only for check-ins with at least two lessons on each side. */
  averageChange: number | null;
  compared: number;
  rows: OutcomeRow[];
};

// The calendar day in Sydney for a timestamp, so a 10am Sydney send isn't counted as the day before.
export function sydneyDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function outcomes(input: { days: number; messages: RetentionMessage[]; lessons: RetentionLesson[]; students: RetentionStudent[]; today: string }): OutcomeSummary {
  const { days, today } = input;
  const names = new Map(input.students.map((s) => [s.id, s]));
  const sent = input.messages.filter((m) => m.status === "sent" && m.sentAt && m.deliveryStatus !== "failed");
  const rows: OutcomeRow[] = sent.map((m) => {
    const sentOn = sydneyDay(m.sentAt!);
    const own = input.lessons.filter((l) => l.studentId === m.studentId);
    const before = periodStats(own, addDays(sentOn, -days), addDays(sentOn, -1));
    const lastDay = [addDays(sentOn, days), addDays(today, -1)].sort()[0];
    const after = periodStats(own, addDays(sentOn, 1), lastDay);
    const st = names.get(m.studentId);
    return {
      messageId: m.id,
      studentId: m.studentId,
      name: st?.name ?? m.studentId,
      sentOn,
      daysSoFar: Math.max(0, Math.min(days, daysBetween(sentOn, today) - 1)),
      complete: daysBetween(sentOn, today) > days,
      before: before.percent,
      after: after.percent,
      beforeLessons: before.counted,
      afterLessons: after.counted,
      cancellationsAfter: after.cancellations.length,
      responded: m.responseStatus === "received",
      enrolled: st?.enrolled ?? false,
      resolved: m.followUp === "resolved",
    };
  }).sort((a, b) => b.sentOn.localeCompare(a.sentOn));
  const compared = rows.filter((r) => r.before !== null && r.after !== null && r.beforeLessons >= 2 && r.afterLessons >= 2);
  const responded = rows.filter((r) => r.responded).length;
  return {
    days,
    checkIns: rows.length,
    responded,
    responseRate: rows.length ? Math.round((responded / rows.length) * 100) : null,
    continued: rows.filter((r) => r.enrolled).length,
    discontinued: rows.filter((r) => !r.enrolled).length,
    resolved: rows.filter((r) => r.resolved).length,
    cancellationsAfter: rows.reduce((s, r) => s + r.cancellationsAfter, 0),
    averageChange: compared.length ? Math.round(compared.reduce((s, r) => s + (r.after! - r.before!), 0) / compared.length) : null,
    compared: compared.length,
    rows,
  };
}

/** Checks a settings change before it is saved. */
export function validateSettings(s: RetentionSettings): string | null {
  if (!(s.mediumThreshold >= 1 && s.highThreshold <= 100)) return "Thresholds must be between 1 and 100.";
  if (s.mediumThreshold >= s.highThreshold) return "The medium threshold must be lower than the high threshold.";
  if (s.windowDays < 7 || s.windowDays > 90) return "The recent period must be between 7 and 90 days.";
  if (s.baselineDays < 14 || s.baselineDays > 180) return "The comparison period must be between 14 and 180 days.";
  if (s.minLessons < 1 || s.minLessons > 20) return "The minimum number of lessons must be between 1 and 20.";
  if (s.cooldownDays < 1 || s.cooldownDays > 60) return "The gap between check-ins must be between 1 and 60 days.";
  return null;
}
