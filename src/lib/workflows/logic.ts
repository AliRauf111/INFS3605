import { z } from "zod";
import { TRI_STATES, type RequestStatus, type Role, type TriState } from "@/lib/domain/types";
import { PROPOSAL_ACTIONS, type ProposalAction } from "@/lib/agent/permissions";
import { allowedTransitions, OWNER_REVIEW_STATUSES } from "@/lib/workflow/next-step";
import { WORKFLOW_IDS, type WorkflowId } from "@/lib/assistant/shortcuts";
import { addDays, hoursUntil, parseDates, parseExtension, parseRange, sydneyDate } from "./dates";
import type { Command } from "@/lib/assistant/logic";

// The three Compass workflows as pure state machines: Lesson Change, Payment Extension
// and Tutor Absence. Each turn, the server reads the records, then asks these functions
// what is still missing. They never decide a colour or an approval: the rule engine and
// the shared next-step rules do that, and the database checks everything again.

const tri = z.enum(TRI_STATES).nullable();
const ref = z.string().max(40);

/** The approval-and-apply part every workflow shares. */
export const PipelineSchema = z
  .object({
    requestId: z.uuid().nullable(),
    pendingProposalId: z.uuid().nullable(),
    pendingAction: z.enum(PROPOSAL_ACTIONS).nullable(),
    applied: z.boolean(),
    /** True when the request was declined or closed outside the workflow, so nothing will be applied. */
    stopped: z.boolean(),
    /** What the records showed after the change, read back from the database. */
    verified: z.string().max(800).nullable(),
    /** Why the last confirmation did not go through, if it didn't. */
    failure: z.string().max(400).nullable(),
  })
  .strict();
export type Pipeline = z.infer<typeof PipelineSchema>;

export const emptyPipeline = (): Pipeline => ({ requestId: null, pendingProposalId: null, pendingAction: null, applied: false, stopped: false, verified: null, failure: null });

const Part = z.enum(["morning", "afternoon", "evening"]).nullable();

export const LessonDataSchema = z
  .object({
    kind: z.literal("lesson_change"),
    reference: ref,
    bookingId: ref,
    studentHint: z.string().max(60),
    dayHint: z.number().int().min(0).max(6).nullable(),
    partHint: Part,
    lessonId: ref,
    complaint: tri,
    welfare: tri,
    financialImpact: tri,
    slotId: ref,
    /** "waiting" once the family has been offered times but hasn't chosen. */
    parentChoice: z.enum(["chosen", "waiting"]).nullable(),
    context: z.string().max(500),
    pipeline: PipelineSchema,
  })
  .strict();
export type LessonData = z.infer<typeof LessonDataSchema>;

export const PaymentDataSchema = z
  .object({
    kind: z.literal("payment_extension"),
    reference: ref,
    paymentId: ref,
    extensionDays: z.number().int().min(1).max(120).nullable(),
    /** A date the family asked for, kept until the due date is known. */
    requestedDate: z.string().max(10).nullable(),
    complaint: tri,
    welfare: tri,
    context: z.string().max(500),
    pipeline: PipelineSchema,
  })
  .strict();
export type PaymentData = z.infer<typeof PaymentDataSchema>;

export const CoverOptionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cover"), tutorId: ref, slotId: ref }).strict(),
  z.object({ kind: z.literal("move"), slotId: ref }).strict(),
  z.object({ kind: z.literal("skip") }).strict(),
]);
export type CoverOption = z.infer<typeof CoverOptionSchema>;

export const AbsenceItemSchema = z
  .object({
    lessonId: ref,
    bookingId: ref,
    option: CoverOptionSchema.nullable(),
    familyAgreed: z.boolean().nullable(),
    tutorAgreed: z.boolean().nullable(),
    pipeline: PipelineSchema,
  })
  .strict();
export type AbsenceItem = z.infer<typeof AbsenceItemSchema>;

export const AbsenceDataSchema = z
  .object({
    kind: z.literal("tutor_absence"),
    tutorId: ref,
    tutorHint: z.string().max(200),
    startsOn: z.string().max(10),
    endsOn: z.string().max(10),
    complaint: tri,
    welfare: tri,
    /** True once Compass has looked for the lessons in the period. */
    lessonsChecked: z.boolean(),
    items: z.array(AbsenceItemSchema).max(20),
    absenceId: z.string().max(40),
    absenceProposalId: z.uuid().nullable(),
    context: z.string().max(500),
  })
  .strict();
export type AbsenceData = z.infer<typeof AbsenceDataSchema>;

export const WorkflowDataSchema = z.discriminatedUnion("kind", [LessonDataSchema, PaymentDataSchema, AbsenceDataSchema]);
export type WorkflowData = z.infer<typeof WorkflowDataSchema>;

export const RunStateSchema = z
  .object({
    data: WorkflowDataSchema,
    /** What Compass asked last, so a short typed reply goes to the right place. */
    awaiting: z.string().max(40).nullable(),
  })
  .strict();
export type RunState = z.infer<typeof RunStateSchema>;

/** What the chat session remembers about the workflow it is running. */
export const ActiveRunSchema = z.object({ id: z.uuid(), workflow: z.enum(WORKFLOW_IDS) }).strict();
export type ActiveRun = z.infer<typeof ActiveRunSchema>;

export function emptyData(id: WorkflowId): WorkflowData {
  switch (id) {
    case "lesson_change":
      return {
        kind: "lesson_change", reference: "", bookingId: "", studentHint: "", dayHint: null, partHint: null, lessonId: "",
        complaint: null, welfare: null, financialImpact: null, slotId: "", parentChoice: null, context: "", pipeline: emptyPipeline(),
      };
    case "payment_extension":
      return { kind: "payment_extension", reference: "", paymentId: "", extensionDays: null, requestedDate: null, complaint: null, welfare: null, context: "", pipeline: emptyPipeline() };
    case "tutor_absence":
      return {
        kind: "tutor_absence", tutorId: "", tutorHint: "", startsOn: "", endsOn: "", complaint: null, welfare: null, lessonsChecked: false,
        items: [], absenceId: "", absenceProposalId: null, context: "",
      };
  }
}

// ---------------------------------------------------------------------------
// What is still missing

export type LessonNeed = "reference" | "lesson" | "complaint" | "welfare" | "slot" | "financialImpact" | "pipeline";
export type PaymentNeed = "invoice" | "days" | "complaint" | "welfare" | "pipeline";
export type AbsenceNeed = "tutor" | "period" | "lessons" | "complaint" | "welfare" | "option" | "agreement" | "record" | "pipeline" | "done";

export function lessonNeed(d: LessonData): LessonNeed {
  if (!d.bookingId) return "reference";
  if (!d.lessonId) return "lesson";
  if (!d.complaint) return "complaint";
  if (!d.welfare) return "welfare";
  if (!d.slotId) return "slot";
  if (!d.financialImpact) return "financialImpact";
  return "pipeline";
}

export function paymentNeed(d: PaymentData): PaymentNeed {
  if (!d.paymentId) return "invoice";
  if (!d.extensionDays) return "days";
  if (!d.complaint) return "complaint";
  if (!d.welfare) return "welfare";
  return "pipeline";
}

/** The lesson the absence workflow is working on: the first one not finished. */
export function currentItem(d: AbsenceData): number {
  return d.items.findIndex((i) => i.option?.kind !== "skip" && !i.pipeline.applied && !i.pipeline.stopped);
}

export function absenceNeed(d: AbsenceData): AbsenceNeed {
  if (!d.tutorId) return "tutor";
  if (!d.startsOn || !d.endsOn) return "period";
  if (!d.lessonsChecked) return "lessons";
  if (d.items.length > 0) {
    if (!d.complaint) return "complaint";
    if (!d.welfare) return "welfare";
  }
  if (d.items.some((i) => !i.option)) return "option";
  if (d.items.some((i) => needsAgreement(i))) return "agreement";
  if (!d.absenceId) return "record";
  return currentItem(d) >= 0 ? "pipeline" : "done";
}

/** A family must agree to any change, and a cover tutor must agree to cover. */
export function needsAgreement(i: AbsenceItem): "family" | "tutor" | null {
  if (!i.option || i.option.kind === "skip") return null;
  if (i.familyAgreed !== true) return "family";
  if (i.option.kind === "cover" && i.tutorAgreed !== true) return "tutor";
  return null;
}

// ---------------------------------------------------------------------------
// Approval and apply, shared by every workflow. The request's status and the shared
// next-step rules decide what comes next; this only names the step.

export type PipelineNeed =
  | "save"
  | "confirm"
  | "owner_decision"
  | "send_to_owner"
  | "waiting_owner"
  | "complete_details"
  | "apply"
  | "declined"
  | "closed_elsewhere"
  | "done";

export const APPLY_ACTION: Record<WorkflowId, ProposalAction> = {
  lesson_change: "booking.reschedule",
  payment_extension: "invoice.extend_due_date",
  tutor_absence: "booking.reschedule",
};

export function pipelineNeed(p: Pipeline, req: { status: RequestStatus; missing: number } | null, role: Role): PipelineNeed {
  if (p.applied || p.stopped) return "done";
  if (p.pendingProposalId) return "confirm";
  if (!p.requestId || !req) return "save";
  const { status, missing } = req;
  if (status === "ready" || status === "approved") return "apply";
  if (status === "declined") return "declined";
  if (status === "closed") return "closed_elsewhere";
  const allowed = allowedTransitions({ role, status, missing });
  if (role === "owner" && (allowed.has("approve") || allowed.has("decline"))) return allowed.has("approve") ? "owner_decision" : "complete_details";
  if (allowed.has("send_to_owner")) return "send_to_owner";
  if (status === "awaiting_owner" && missing === 0) return "waiting_owner";
  if (OWNER_REVIEW_STATUSES.includes(status) && missing > 0) return "complete_details";
  return "waiting_owner";
}

// ---------------------------------------------------------------------------
// Reading what the person typed or tapped

const TRI_WORDS: Array<[RegExp, TriState]> = [
  [/^(yes|yeah|yep|y|correct|true|they have|they did)\b/i, "yes"],
  [/^(no|nope|n|none|not really|they haven'?t|no complaint|no concern)\b/i, "no"],
  [/^(not sure|unsure|don'?t know|i don'?t know|maybe|unknown)\b/i, "unsure"],
];

export function parseTriWord(text: string): TriState | null {
  const t = text.trim().replace(/[.!]+$/, "");
  for (const [re, v] of TRI_WORDS) if (re.test(t)) return v;
  return null;
}

/** BK-1042, FAM-07, PAY-2004 or INV-503, with or without the dash. */
export function parseAnyReference(text: string): string | null {
  const m = /\b(BK|FAM|PAY|INV|LSN)[-\s]?(\d{2,8})\b/i.exec(text);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function dayHintOf(text: string): number | null {
  const lower = text.toLowerCase();
  const i = WEEKDAY_NAMES.findIndex((d) => new RegExp(`\\b${d}\\b|\\b${d.slice(0, 3)}\\b`).test(lower));
  return i >= 0 ? i : null;
}

export function partHintOf(text: string): LessonData["partHint"] {
  const lower = text.toLowerCase();
  if (/\bmorning\b/.test(lower)) return "morning";
  if (/\bafternoon|after school\b/.test(lower)) return "afternoon";
  if (/\bevening|night\b/.test(lower)) return "evening";
  return null;
}

const STOP_NAMES = new Set(["sarah", "owner", "admin", "compass", "the", "and", "can", "please", "hi", "hello", "dear", "thanks", "move", "change"]);

export function studentHintOf(text: string): string {
  const m = /\b([A-Z][a-z]{1,20})['’]s\s+(?:lesson|lessons|class|session|tutoring)/.exec(text) ?? /\b(?:move|reschedule|for)\s+([A-Z][a-z]{1,20})\b/.exec(text);
  if (!m) return "";
  return STOP_NAMES.has(m[1].toLowerCase()) || WEEKDAY_NAMES.includes(m[1].toLowerCase()) ? "" : m[1];
}

const WELFARE = /\b(unsafe|scared|frightened|afraid|hurt|bullied|bullying|abuse|self-harm|harm)\b/i;
const COMPLAINT = /\b(complain|complaint|unacceptable|very unhappy|not happy with|disappointed with)\b/i;

/**
 * Take what a pasted message or a first reply says. Complaint and welfare only ever go
 * up to "yes" from free text. A "no" must come from the person answering the question.
 */
export function absorbMessage<T extends WorkflowData>(d: T, text: string, today: string): T {
  const next = { ...d } as WorkflowData;
  const reference = parseAnyReference(text);
  if (WELFARE.test(text)) next.welfare = "yes";
  if (COMPLAINT.test(text)) next.complaint = "yes";
  if (!next.context && text.trim().length > 20) next.context = text.trim().slice(0, 500);
  if (next.kind === "lesson_change") {
    if (reference && reference !== next.reference) {
      Object.assign(next, { reference, bookingId: "", lessonId: "", slotId: "", parentChoice: null });
    }
    const student = studentHintOf(text);
    if (student) next.studentHint = student;
    const day = dayHintOf(text);
    if (day !== null) next.dayHint = day;
    const part = partHintOf(text);
    if (part) next.partHint = part;
  } else if (next.kind === "payment_extension") {
    if (reference && reference !== next.reference) Object.assign(next, { reference, paymentId: "" });
    const days = parseExtension(text, null, today);
    if (days && days >= 1 && days <= 120) next.extensionDays = days;
    else {
      const dates = parseDates(text, today);
      if (dates.length) next.requestedDate = dates[dates.length - 1];
    }
  } else {
    const range = parseRange(text, today);
    if (range && !next.startsOn) {
      next.startsOn = range.start;
      next.endsOn = range.end;
    }
    // The server matches tutor names and IDs in these words against the tutor records.
    if (!next.tutorId) next.tutorHint = text.slice(0, 200);
  }
  return next as T;
}

// ---------------------------------------------------------------------------
// Picks from the buttons Compass shows, in the form "field:value".

export function applyPick(d: WorkflowData, value: string): WorkflowData | null {
  const [field, ...rest] = value.split(":");
  const v = rest.join(":");
  const triv = (TRI_STATES as readonly string[]).includes(v) ? (v as TriState) : null;
  switch (d.kind) {
    case "lesson_change":
      switch (field) {
        case "booking":
          return /^BK-\d{3,8}$/.test(v) ? { ...d, bookingId: v, lessonId: "", slotId: "", parentChoice: null } : null;
        case "lesson":
          return /^LSN-\d{3,8}$/.test(v) ? { ...d, lessonId: v, slotId: "", parentChoice: null } : null;
        case "complaint":
        case "welfare":
          return triv ? { ...d, [field]: triv } : null;
        case "fee":
          return triv ? { ...d, financialImpact: triv } : null;
        case "slot":
          if (v === "waiting") return { ...d, parentChoice: "waiting" };
          return /^SLOT-\d{3,8}$/.test(v) ? { ...d, slotId: v, parentChoice: "chosen" } : null;
      }
      return null;
    case "payment_extension":
      switch (field) {
        case "invoice":
          return /^PAY-\d{3,8}$/.test(v) ? { ...d, paymentId: v } : null;
        case "days": {
          const n = Number(v);
          return Number.isInteger(n) && n >= 1 && n <= 120 ? { ...d, extensionDays: n } : null;
        }
        case "complaint":
        case "welfare":
          return triv ? { ...d, [field]: triv } : null;
      }
      return null;
    case "tutor_absence": {
      switch (field) {
        case "tutor":
          return /^T-\d{2,6}$/.test(v) ? { ...d, tutorId: v, lessonsChecked: false, items: [] } : null;
        case "complaint":
        case "welfare":
          return triv ? { ...d, [field]: triv } : null;
      }
      const i = currentOptionIndex(d, field);
      if (i < 0) return null;
      const items = [...d.items];
      if (field === "option") {
        const parts = v.split(":");
        const option: CoverOption | null =
          parts[0] === "cover" && /^T-\d{2,6}$/.test(parts[1] ?? "") && /^SLOT-\d{3,8}$/.test(parts[2] ?? "")
            ? { kind: "cover", tutorId: parts[1], slotId: parts[2] }
            : parts[0] === "move" && /^SLOT-\d{3,8}$/.test(parts[1] ?? "")
              ? { kind: "move", slotId: parts[1] }
              : parts[0] === "skip"
                ? { kind: "skip" }
                : null;
        if (!option) return null;
        items[i] = { ...items[i], option, familyAgreed: null, tutorAgreed: null };
        return { ...d, items };
      }
      if (field === "family" || field === "tutorok") {
        if (v !== "yes" && v !== "later") return null;
        const key = field === "family" ? "familyAgreed" : "tutorAgreed";
        items[i] = { ...items[i], [key]: v === "yes" ? true : false };
        return { ...d, items };
      }
      return null;
    }
  }
}

/** Which absence item a pick is for: the first without an option, or the first needing an agreement. */
function currentOptionIndex(d: AbsenceData, field: string): number {
  if (field === "option") return d.items.findIndex((i) => !i.option);
  if (field === "family") return d.items.findIndex((i) => needsAgreement(i) === "family");
  if (field === "tutorok") return d.items.findIndex((i) => needsAgreement(i) === "tutor");
  return -1;
}

// ---------------------------------------------------------------------------
// Alternatives and cover options

export type SlotLite = { id: string; tutorId: string; startsAt: string; endsAt: string; status: "free" | "booked" };
export type Busy = { startsAt: string; endsAt: string };
export type Absence = { tutorId: string; startsOn: string; endsOn: string };

export const NOTICE_HOURS = 24;

const overlaps = (a: Busy, b: Busy) => a.startsAt < b.endsAt && a.endsAt > b.startsAt;
const minutes = (s: Busy) => Math.round((new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 60_000);

export function isAbsent(tutorId: string, at: string, absences: Absence[]): boolean {
  const day = sydneyDate(at);
  return absences.some((a) => a.tutorId === tutorId && day >= a.startsOn && day <= a.endsOn);
}

function sydneyParts(iso: string) {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "long" }).format(d).toLowerCase();
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(d));
  return { day: WEEKDAY_NAMES.indexOf(wd), hour };
}

/**
 * Free times that suit: the tutor's free slots at least 24 hours away (the rescheduling
 * procedure asks for that much notice), not while the tutor is away, not clashing with
 * the family's other lessons, and the same length as the lesson so fees don't change.
 * Times on the day and time of day the parent asked for come first.
 */
export function pickAlternatives(
  slots: SlotLite[],
  opts: { now: Date; lesson: Busy; busy: Busy[]; absences: Absence[]; dayHint: number | null; partHint: LessonData["partHint"]; limit?: number; after?: string },
): SlotLite[] {
  const length = minutes(opts.lesson);
  const fit = slots.filter(
    (s) =>
      s.status === "free" &&
      hoursUntil(s.startsAt, opts.now) >= NOTICE_HOURS &&
      (!opts.after || sydneyDate(s.startsAt) > opts.after) &&
      minutes(s) === length &&
      !isAbsent(s.tutorId, s.startsAt, opts.absences) &&
      !opts.busy.some((b) => overlaps(b, s)),
  );
  const score = (s: SlotLite) => {
    const p = sydneyParts(s.startsAt);
    let n = 0;
    if (opts.dayHint !== null && p.day === opts.dayHint) n -= 2;
    if (opts.partHint === "morning" && p.hour < 12) n -= 1;
    if (opts.partHint === "afternoon" && p.hour >= 12 && p.hour < 17) n -= 1;
    if (opts.partHint === "evening" && p.hour >= 17) n -= 1;
    return n;
  };
  return [...fit].sort((a, b) => score(a) - score(b) || a.startsAt.localeCompare(b.startsAt)).slice(0, opts.limit ?? 4);
}

export type TutorLite = { id: string; name: string; subjects: string[]; courses: Array<{ courseId: string; yearLevel: number }> };
export type LessonLite = Busy & { id: string; tutorId: string; subject: string; courseId: string | null; yearLevel: number | null };

/** Does this tutor teach what the lesson is for? Exact course and year when the booking has one, otherwise the subject. */
export function teaches(t: TutorLite, lesson: Pick<LessonLite, "subject" | "courseId" | "yearLevel">): boolean {
  if (lesson.courseId && lesson.yearLevel) return t.courses.some((c) => c.courseId === lesson.courseId && c.yearLevel === lesson.yearLevel);
  const subject = lesson.subject.toLowerCase();
  return t.subjects.some((s) => subject.includes(s.toLowerCase()));
}

/** Cover tutors free at exactly the lesson's time, who teach it and aren't away. */
export function coverCandidates(lesson: LessonLite, tutors: TutorLite[], slots: SlotLite[], absences: Absence[], busy: Busy[]): Array<{ tutor: TutorLite; slot: SlotLite }> {
  const out: Array<{ tutor: TutorLite; slot: SlotLite }> = [];
  for (const t of tutors) {
    if (t.id === lesson.tutorId || !teaches(t, lesson)) continue;
    const slot = slots.find((s) => s.tutorId === t.id && s.status === "free" && s.startsAt === lesson.startsAt && s.endsAt === lesson.endsAt);
    if (!slot || isAbsent(t.id, slot.startsAt, absences) || busy.some((b) => overlaps(b, slot))) continue;
    out.push({ tutor: t, slot });
  }
  return out;
}

/** The revised due date for an extension. */
export function revisedDueDate(dueDate: string, days: number): string {
  return addDays(dueDate, days);
}

/**
 * Which workflow a typed request belongs to, from keywords only. Lesson changes and
 * payment extensions typed in the chat use the same workflow as the shortcut, so there is
 * only ever one way each is handled.
 */
export function detectWorkflow(text: string): "lesson_change" | "payment_extension" | "tutor_absence" | null {
  const t = text.toLowerCase();
  if (/\brefund|money back|reimburse/.test(t)) return null;
  if (/\btutor\b.*\b(sick|ill|unwell|unavailable|away|absent|absence|on leave|can'?t (make|teach|come))\b|\b(sick|unavailable|away|absent) tutor\b|\btutor absence\b/.test(t)) return "tutor_absence";
  if (/\b(extension|more time to pay|pay later|extra time to pay|days to pay|time to pay|extend (the )?(invoice|due date|payment))\b|\bpayment extension\b/.test(t)) return "payment_extension";
  if (/\b(reschedul\w*|lesson change)\b|\b(move|change|swap|shift)\b.{0,30}\blesson\b|\blesson\b.{0,30}\b(moved|changed|another time|different time|new time)\b|\b(change the time|different time)\b/.test(t)) return "lesson_change";
  return null;
}

// ---------------------------------------------------------------------------
// Choices at guided questions

export type OptionList = Array<{ label: string; command: Command }>;

/** The minimum number of choices offered at a guided question. */
export const MIN_CHOICES = 3;

/**
 * Every guided question offers a way out and, when the question itself has fewer than three
 * answers, a way to check the rules first. Nothing is invented to fill the list: the extras
 * only stop the workflow or show the owner's rules, and typing an answer always works too.
 */
export function withChoices(runId: string, list: OptionList, workflow?: WorkflowId): OptionList {
  const out = [...list];
  const stop = (c: Command) => c.type === "workflow" && c.op === "cancel";
  if (out.length + (out.some((o) => stop(o.command)) ? 0 : 1) < MIN_CHOICES) {
    const requestType = workflow === "lesson_change" || workflow === "payment_extension" ? workflow : undefined;
    out.push({ label: "Show the Rules", command: { type: "policy_overview", ...(requestType ? { requestType } : {}) } });
  }
  if (!out.some((o) => stop(o.command))) out.push({ label: "Stop Workflow", command: { type: "workflow", runId, op: "cancel" } });
  return out;
}
