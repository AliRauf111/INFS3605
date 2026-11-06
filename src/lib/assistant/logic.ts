import { z } from "zod";
import { REQUEST_TYPES, TRI_STATES, type Colour, type RequestStatus, type RequestType, type Role, type TriState } from "@/lib/domain/types";
import type { FactsForm } from "@/lib/validation/facts";
import { replyIntl, tr } from "@/lib/i18n/reply";
import { BUCKET_KEYS, COLOURS, type BucketKey } from "@/lib/agent/briefing-logic";
import { PROPOSAL_ACTIONS, type ProposalAction } from "@/lib/agent/permissions";
import type { ProposalView } from "@/lib/agent/proposal-logic";
import type { FactSources, Figure, Readiness } from "@/lib/agent/review-logic";
import { ActiveRunSchema } from "@/lib/workflows/logic";

// Pure logic for Compass AI, the chat assistant. It decides what to ask next, merges
// what the person said into the request being built and searches approved procedures.
// Nothing here calls the network, so it is unit tested. The colour always comes from
// the rule engine, never from here.

export const TASK_FIELDS = [
  "requestType",
  "referenceId",
  "bookingId",
  "amount",
  "extensionDays",
  "financialImpact",
  "proposedSlotId",
  "complaint",
  "welfare",
] as const;
export type TaskField = (typeof TASK_FIELDS)[number];
export type AwaitingField = TaskField | "policy_query";

const tri = z.enum(TRI_STATES).nullable();

export const TaskSchema = z
  .object({
    requestType: z.enum(REQUEST_TYPES).nullable(),
    referenceId: z.string().max(40),
    bookingId: z.string().max(40),
    amount: z.string().max(30),
    extensionDays: z.string().max(5),
    financialImpact: tri,
    proposedSlotId: z.string().max(40),
    /** True once the person has seen the slot options, even if they picked none. */
    slotAsked: z.boolean(),
    complaint: tri,
    welfare: tri,
    context: z.string().max(2000),
    studentHint: z.string().max(60),
    dayHint: z.number().int().min(0).max(6).nullable(),
    partHint: z.enum(["morning", "afternoon", "evening"]).nullable(),
  })
  .strict();
export type Task = z.infer<typeof TaskSchema>;

/** The saved request the conversation is about, so "this request" works across turns. */
export const FocusSchema = z
  .object({
    requestId: z.uuid(),
    reference: z.string().max(40),
    bookingId: z.string().max(40).nullable(),
  })
  .strict();
export type Focus = z.infer<typeof FocusSchema>;

export const AssistantStateSchema = z
  .object({
    task: TaskSchema.nullable(),
    awaiting: z.enum([...TASK_FIELDS, "policy_query"]).nullable(),
    focus: FocusSchema.nullable().default(null),
    /** The Lesson Change, Payment Extension or Tutor Absence workflow this chat is running. */
    run: ActiveRunSchema.nullable().default(null),
    /** Set after a Weekly Briefing answer, so short follow-up questions stay on it. */
    topic: z.enum(["weekly_briefing"]).nullable().default(null),
  })
  .strict();
export type AssistantState = z.infer<typeof AssistantStateSchema>;

export const EMPTY_STATE: AssistantState = { task: null, awaiting: null, focus: null, run: null, topic: null };

/** Card buttons that read or prepare, sent back to the server as a structured command. */
export const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("briefing"), bucket: z.enum([...BUCKET_KEYS, ...COLOURS]).optional(), page: z.number().int().min(1).max(500).optional() }).strict(),
  z.object({ type: z.literal("review"), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal("explain"), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal("followup"), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal("decide"), requestId: z.uuid(), action: z.enum(PROPOSAL_ACTIONS) }).strict(),
  z.object({ type: z.literal("requirements"), requestId: z.uuid().optional(), requestType: z.enum(REQUEST_TYPES).optional() }).strict(),
  z.object({ type: z.literal("policy_overview"), requestType: z.enum(REQUEST_TYPES).optional() }).strict(),
  z.object({ type: z.literal("attention") }).strict(),
  z.object({ type: z.literal("proposal"), proposalId: z.uuid() }).strict(),
  z
    .object({
      type: z.literal("workflow"),
      runId: z.uuid(),
      op: z.enum(["continue", "pick", "decide", "cancel"]),
      value: z.string().trim().max(80).optional(),
    })
    .strict(),
]);
export type Command = z.infer<typeof CommandSchema>;

export function emptyTask(): Task {
  return {
    requestType: null,
    referenceId: "",
    bookingId: "",
    amount: "",
    extensionDays: "",
    financialImpact: null,
    proposedSlotId: "",
    slotAsked: false,
    complaint: null,
    welfare: null,
    context: "",
    studentHint: "",
    dayHint: null,
    partHint: null,
  };
}

// ---------------------------------------------------------------------------
// What the server sends back. The browser only renders these blocks.

export type Choice = { label: string; value: string };
export type Step = { label: string; state: "done" | "blocked" | "failed" };
export type Link = { label: string; href: string };

export type Block =
  | { kind: "text"; text: string }
  | { kind: "choices"; field: TaskField; options: Choice[] }
  | { kind: "found"; items: string[]; links: Link[]; note?: string }
  | {
      kind: "decision";
      colour: Colour;
      title: string;
      explanation: string;
      ruleLabel: string;
      policy: Link | null;
      missing: string[];
      nextSteps: string[];
      actionLabel: string;
      requestType: RequestType;
      facts: FactsForm;
      summary: string[];
      sources?: FactSources;
      findings?: string[];
    }
  | { kind: "policy"; title: string; answer: string; details: string; link: Link; approved: boolean }
  | { kind: "notice"; tone: "info" | "warning" | "error"; text: string }
  | { kind: "options"; label: string; options: Array<{ label: string; command: Command }> }
  | ReviewBlock
  | BriefingBlock
  | DraftBlock
  | { kind: "proposal"; proposal: ProposalView; intro: string | null; next?: { label: string; command: Command } }
  | AttentionBlock
  | { kind: "result"; title: string; rows: Array<{ label: string; before: string; after: string }>; notes: string[]; verifiedAt: string }
  | { kind: "simulated"; title: string; to: string; body: string; note: string }
  | { kind: "checklist"; title: string; items: Array<{ label: string; state: "have" | "missing" | "check"; detail?: string }>; refs: string[]; notes: string[]; link?: Link }
  | RulesBlock;

export type ReviewAction = { label: string; action?: ProposalAction; note?: string; command?: Command; href?: string; primary?: boolean };

export type ReviewBlock = {
  kind: "review";
  mode: "review" | "explain";
  request: {
    id: string;
    shortId: string;
    reference: string;
    bookingId: string | null;
    typeLabel: string;
    status: RequestStatus;
    statusLabel: string;
    colour: Colour;
    created: string;
    waiting: string;
    href: string;
    student: string | null;
    tutor: string | null;
    subject: string | null;
    classCode: string | null;
  };
  summary: string;
  summarySource: "live_ai" | "records";
  figures: Figure[];
  figuresNote: string | null;
  rule: { colour: Colour; ruleLabel: string; matchedRuleId: string; explanation: string; escalation: string | null; policyLabel: string; policyHref: string | null; checkedAt: string; activePolicyLabel: string | null };
  sources: FactSources;
  issues: Array<{ tone: "warning" | "error" | "info"; text: string }>;
  procedures: Array<{ id: string; title: string; version: number; href: string }>;
  history: Array<{ when: string; who: string; what: string; note: string }>;
  readiness: Readiness;
  restricted: boolean;
  roleNote: string | null;
  actions: ReviewAction[];
  /** The primary next step from the shared next-step rules, for example Complete Missing Details. */
  nextStep?: string | null;
};

export type BriefingItem = {
  id: string;
  shortId: string;
  reference: string;
  description: string;
  statusLabel: string;
  colour: Colour;
  waiting: string;
  since: string;
  why: string;
  flag: string | null;
  href: string;
  next: { label: string; command: Command };
};

export type BriefingBlock = {
  kind: "briefing";
  generatedAt: string;
  role: Role;
  scope: "all" | BucketKey | Colour;
  ordering: string;
  total: number;
  /** Decided requests still waiting for an outcome, for the Show Pending Outcomes button. */
  pendingOutcomes: number;
  sections: Array<{ key: BucketKey | Colour; title: string; count: number; items: BriefingItem[]; page: number; pageSize: number; orderedAll: boolean }>;
};

export type DraftBlock = {
  kind: "draft";
  requestId: string;
  reference: string;
  draftKind: "parent_response" | "tutor_message" | "escalation_summary" | "reschedule_proposal" | "admin_checklist";
  title: string;
  body: string;
  note: string;
  generatedBy: "template" | "live_ai";
  staffChecks: string[];
  restricted: boolean;
};

export type AttentionKey = "failed" | "approval" | "retention" | "workflows" | "clarification" | "outcomes";

export type AttentionItem = {
  key: string;
  category: AttentionKey;
  title: string;
  reason: string;
  colour: Colour | null;
  meta: string;
  action: { label: string; command?: Command; href?: string };
  href: string | null;
};

export type AttentionBlock = {
  kind: "attention";
  generatedAt: string;
  role: Role;
  total: number;
  counts: Array<{ key: AttentionKey; label: string; count: number }>;
  items: AttentionItem[];
  notes: string[];
};

export type RulesBlock = {
  kind: "rules";
  sections: Array<{ title: string; policyLabel: string; href: string; rules: Array<{ label: string; when: string; colour: Colour; who: string }>; notes: string[] }>;
  systemRules: string[];
};

export type Mood = "neutral" | "success" | "clarify" | "error";

export type TurnResponse = {
  mode: "live_ai" | "demo";
  modeNote: string;
  steps: Step[];
  blocks: Block[];
  state: AssistantState;
  mood: Mood;
  /** The language the reply is written in (a lang attribute value), so the page can mark it. */
  lang?: string;
};

// ---------------------------------------------------------------------------
// Reading what the person typed

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseDayHint(text: string): number | null {
  const lower = text.toLowerCase();
  const i = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(lower) || new RegExp(`\\b${d.slice(0, 3)}\\b`).test(lower));
  return i >= 0 ? i : null;
}

export function parsePartHint(text: string): Task["partHint"] {
  const lower = text.toLowerCase();
  if (/\bmorning\b/.test(lower)) return "morning";
  if (/\bafternoon|after school\b/.test(lower)) return "afternoon";
  if (/\bevening|night\b/.test(lower)) return "evening";
  return null;
}

/** A bare amount such as "30", "$30" or "30.50", used when Compass has just asked for one. */
export function parseBareAmount(text: string): string | null {
  const m = /^\s*(?:aud\s*)?\$?\s*(\d{1,6}(?:\.\d{1,2})?)\s*(?:dollars?|aud)?\s*\.?\s*$/i.exec(text);
  return m ? m[1] : null;
}

export function parseDays(text: string): string | null {
  const m = /^\s*(\d{1,3})\s*(?:more\s+|extra\s+)?(?:days?)?\s*\.?\s*$/i.exec(text) ?? /(\d{1,3})\s*(?:more\s+|extra\s+)?days?/i.exec(text);
  return m ? m[1] : null;
}

export function parseReference(text: string): string | null {
  const m = /\b(BK|FAM|PAY)[-\s]?(\d{2,8})\b/i.exec(text);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

/** Yes, no or not sure, typed instead of tapped. */
export function parseTri(text: string): TriState | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (/^(yes|yeah|yep|y|it is|correct|true)$/.test(t)) return "yes";
  if (/^(no|nope|n|not really|none|it isn'?t|no it isn'?t)$/.test(t)) return "no";
  if (/^(not sure|unsure|don'?t know|i don'?t know|maybe|unknown)$/.test(t)) return "unsure";
  return null;
}

const STOP_NAMES = new Set(["sarah", "owner", "admin", "compass", "friday", "monday", "tuesday", "wednesday", "thursday", "saturday", "sunday", "can", "check", "move", "the", "and", "draft"]);

/** A capitalised first name followed by "'s lesson", or "move <Name>". */
export function parseStudentHint(text: string): string {
  const m = /\b([A-Z][a-z]{1,20})['’]s\s+(?:lesson|lessons|class|session|booking)/.exec(text) ?? /\b(?:move|reschedule|whether)\s+([A-Z][a-z]{1,20})\b/.exec(text);
  if (!m) return "";
  return STOP_NAMES.has(m[1].toLowerCase()) ? "" : m[1];
}

/** Families whose student name contains the first name, e.g. "Ella" matches "Ella and Noah Martin". */
export function matchStudents<T extends { student_name: string }>(families: T[], hint: string): T[] {
  if (!hint) return [];
  const h = hint.toLowerCase();
  return families.filter((f) => f.student_name.toLowerCase().split(/[^a-z]+/).includes(h));
}

const POLICY_WORDS = /\b(polic(y|ies)|procedures?|what(?:'s| is) (our|the) (rule|process)|how do (we|i) (handle|deal)|rules? (for|on|about))\b/i;

export function looksLikePolicyQuestion(text: string): boolean {
  return POLICY_WORDS.test(text) && !parseReference(text) && !/\$\s?\d/.test(text);
}

// ---------------------------------------------------------------------------
// Merging and deciding what to ask next

export type Extracted = {
  requestType: RequestType | null;
  referenceId: string;
  amount: string;
  extensionDays: string;
  complaint: TriState | null;
  welfare: TriState | null;
  financialImpact: TriState | null;
  context: string;
  studentHint: string;
  dayHint: number | null;
  partHint: Task["partHint"];
};

/**
 * Add newly stated facts to the request being built. Complaint and welfare are only
 * ever raised to "yes" from free text: a "no" must come from the person answering the
 * question directly, so a guess can never make a request look safer than it is.
 */
export function mergeTask(task: Task, x: Extracted): Task {
  const next = { ...task };
  if (x.requestType && !next.requestType) next.requestType = x.requestType;
  if (x.referenceId && x.referenceId !== next.referenceId) {
    next.referenceId = x.referenceId;
    next.bookingId = "";
    next.proposedSlotId = "";
    next.slotAsked = false;
  }
  if (x.amount) next.amount = x.amount;
  if (x.extensionDays) next.extensionDays = x.extensionDays;
  if (x.complaint === "yes") next.complaint = "yes";
  if (x.welfare === "yes") next.welfare = "yes";
  if (x.financialImpact === "yes") next.financialImpact = "yes";
  if (x.context && !next.context) next.context = x.context.slice(0, 500);
  if (x.studentHint) next.studentHint = x.studentHint;
  if (x.dayHint !== null) next.dayHint = x.dayHint;
  if (x.partHint) next.partHint = x.partHint;
  return next;
}

/** Apply an answer the person gave to a specific question. */
export function applyAnswer(task: Task, field: TaskField, value: string): Task {
  const next = { ...task };
  switch (field) {
    case "requestType":
      next.requestType = (REQUEST_TYPES as readonly string[]).includes(value) ? (value as RequestType) : next.requestType;
      break;
    case "complaint":
    case "welfare":
    case "financialImpact":
      next[field] = (TRI_STATES as readonly string[]).includes(value) ? (value as TriState) : next[field];
      break;
    case "proposedSlotId":
      next.proposedSlotId = value === "none" ? "" : value;
      next.slotAsked = true;
      break;
    case "referenceId":
      next.referenceId = value.toUpperCase();
      next.bookingId = "";
      next.proposedSlotId = "";
      next.slotAsked = false;
      break;
    default:
      next[field] = value;
  }
  return next;
}

/**
 * The next thing Compass needs, in the same order as the wizard. Booking resolution
 * (one booking, several or none) is handled by the server before this is called.
 */
export function nextField(task: Task): TaskField | null {
  if (!task.requestType) return "requestType";
  if (!task.referenceId && !task.bookingId) return "referenceId";
  if (task.requestType === "refund" && !task.amount) return "amount";
  if (task.requestType === "payment_extension" && !task.extensionDays) return "extensionDays";
  if (task.requestType === "lesson_change") {
    if (!task.slotAsked && !task.proposedSlotId) return "proposedSlotId";
    if (!task.financialImpact) return "financialImpact";
  }
  if (!task.complaint) return "complaint";
  if (!task.welfare) return "welfare";
  return null;
}

const triChoices = (): Choice[] => [
  { label: tr("domain.triState.yes"), value: "yes" },
  { label: tr("domain.triState.no"), value: "no" },
  { label: tr("domain.triState.unsure"), value: "unsure" },
];

export function questionFor(field: TaskField, task: Task): { text: string; choices: Choice[] } {
  switch (field) {
    case "requestType":
      return {
        text: tr("reply.q.requestType"),
        choices: [
          { label: tr("domain.requestType.refund"), value: "refund" },
          { label: tr("domain.requestType.lesson_change"), value: "lesson_change" },
          { label: tr("reply.q.moreTime"), value: "payment_extension" },
          { label: tr("domain.requestType.other"), value: "other" },
        ],
      };
    case "referenceId":
      return {
        text: task.studentHint ? tr("reply.q.noMatch", { student: task.studentHint }) : tr("reply.q.reference"),
        choices: [],
      };
    case "bookingId":
      return { text: tr("reply.q.booking"), choices: [] };
    case "amount":
      return { text: tr("reply.q.amount"), choices: [] };
    case "extensionDays":
      return { text: tr("reply.q.days"), choices: [] };
    case "financialImpact":
      return { text: tr("reply.lesson.feesQ"), choices: triChoices() };
    case "proposedSlotId":
      return { text: tr("reply.q.slot"), choices: [] };
    case "complaint":
      return { text: tr("reply.wf.complaintQ"), choices: triChoices() };
    case "welfare":
      return { text: tr("reply.wf.welfareQ"), choices: triChoices() };
  }
}

export function taskToForm(task: Task): FactsForm {
  const type = task.requestType ?? "other";
  return {
    requestType: type,
    moneyInvolved: type === "refund" ? "yes" : null,
    amount: type === "refund" ? task.amount || null : null,
    complaint: task.complaint,
    welfare: task.welfare,
    referenceId: task.referenceId || null,
    bookingId: task.bookingId || null,
    financialImpact: type === "lesson_change" ? task.financialImpact : null,
    proposedSlotId: type === "lesson_change" ? task.proposedSlotId || null : null,
    extensionDays: type === "payment_extension" ? task.extensionDays || null : null,
    context: task.context,
  };
}

// ---------------------------------------------------------------------------
// Decision wording. The colour and rule come from the engine; this only labels them.

export function decisionTitle(colour: Colour, needsInfo: boolean): string {
  if (colour === "green") return tr("reply.decision.green");
  if (colour === "red") return tr("reply.decision.red");
  return tr(needsInfo ? "reply.decision.needsInfo" : "reply.decision.amber");
}

export function decisionAction(colour: Colour, type: RequestType): string {
  if (colour === "green") {
    if (type === "refund") return tr("reply.decision.prepareRefund");
    if (type === "lesson_change") return tr("reply.decision.prepareLesson");
    if (type === "payment_extension") return tr("reply.decision.prepareExtension");
    return tr("reply.decision.prepareRequest");
  }
  return tr(colour === "red" ? "reply.decision.prepareReview" : "reply.decision.prepareApproval");
}

// ---------------------------------------------------------------------------
// Slots

const TZ = "Australia/Sydney";

function localParts(iso: string) {
  const d = new Date(iso);
  const weekday = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "long" }).format(d).toLowerCase();
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(d));
  return { day: WEEKDAYS.indexOf(weekday), hour };
}

export function slotLabel(iso: string): string {
  return new Date(iso).toLocaleString(replyIntl(), { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Free slots that fit the day and time of day the person mentioned. */
export function filterSlots<T extends { startsAt: string; status: string }>(slots: T[], day: number | null, part: Task["partHint"]): T[] {
  return slots.filter((s) => {
    if (s.status !== "free") return false;
    const p = localParts(s.startsAt);
    if (day !== null && p.day !== day) return false;
    if (part === "morning" && p.hour >= 12) return false;
    if (part === "afternoon" && (p.hour < 12 || p.hour >= 17)) return false;
    if (part === "evening" && p.hour < 17) return false;
    return true;
  });
}

export function dayName(day: number): string {
  // 4 January 2026 was a Sunday, so day 0 to 6 lands on Sunday to Saturday.
  return new Date(Date.UTC(2026, 0, 4 + day)).toLocaleDateString(replyIntl(), { timeZone: "UTC", weekday: "long" });
}

// ---------------------------------------------------------------------------
// Searching approved procedures

export type Article = { id: string; title: string; category: string; body: string; owner_approved: boolean };

const SYNONYMS: Record<string, string[]> = {
  refund: ["refund", "money back", "reimburse"],
  lesson_change: ["reschedul", "move", "lesson change", "swap", "change a lesson", "cancel"],
  payment_extension: ["extension", "pay later", "more time", "invoice", "overdue"],
  complaint: ["complain", "unhappy"],
  welfare: ["welfare", "safety", "wellbeing", "unsafe", "safeguard"],
};

/**
 * Rank procedures by how well they match the question. A topic word scores, and an
 * exact word from the title scores higher. Returns an empty list rather than a guess.
 */
export function searchArticles(articles: Article[], query: string): Article[] {
  const q = query.toLowerCase();
  const scored = articles.map((a) => {
    let score = 0;
    for (const word of (SYNONYMS[a.category] ?? [])) if (q.includes(word)) score += 2;
    for (const word of a.title.toLowerCase().split(/\W+/)) if (word.length > 3 && word !== "procedure" && q.includes(word)) score += 3;
    return { a, score };
  });
  return scored.filter((s) => s.score > 0).sort((x, y) => y.score - x.score).map((s) => s.a);
}

/** Does the question ask for something the matched procedure does not literally cover? */
export function topicMissing(query: string, article: Article): string | null {
  const q = query.toLowerCase();
  if (/cancel/.test(q) && !/cancel/.test(`${article.title} ${article.body}`.toLowerCase())) return "cancellation";
  return null;
}

export function firstSentences(text: string, n = 2): string {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return parts.slice(0, n).join(" ");
}
