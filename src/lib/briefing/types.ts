import type { ShortcutId } from "@/lib/assistant/shortcuts";

// Shapes shared by the Weekly Owner Briefing page, the Overview card, Compass and the email.
// Money is always whole cents. Every figure is worked out from records; nothing is typed in.

export type BriefingMode = "demo" | "live";
export type Priority = "red" | "amber" | "green";
export type Overall = "action_required" | "attention" | "up_to_date";

export type SourceId = "xero" | "gmail" | "sms" | "compass";
/** demo: fictional records. live: a connected system. not_connected: nothing to read yet. error: the read failed. */
export type SourceState = "demo" | "live" | "not_connected" | "error";
export type Source = { id: SourceId; state: SourceState; records: number; syncedAt: string | null };

export const SECTION_IDS = ["summary", "finance", "communications", "lessons", "completed", "recommendations"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export type Thresholds = {
  /** An eligible invoice this many days overdue or more counts as seriously overdue. */
  overdueRedDays: number;
  /** This many seriously overdue invoices make the finance recommendation red. */
  overdueRedCount: number;
  /** An unanswered enquiry older than this is amber. */
  enquiryAmberHours: number;
  /** An unanswered enquiry older than this is red. */
  enquiryRedHours: number;
  /** A lesson that needs cover and starts within this many hours is red. */
  coverRedHours: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = { overdueRedDays: 14, overdueRedCount: 3, enquiryAmberHours: 24, enquiryRedHours: 72, coverRedHours: 48 };

export type BriefingSettings = {
  enabled: boolean;
  /** ISO weekday: 1 Monday to 7 Sunday. */
  sendDay: number;
  /** "08:00", Sydney time. */
  sendTime: string;
  sections: SectionId[];
  recipientId: string | null;
  /** Owner's explicit choice to let admins see the financial figures. Off by default. */
  adminFinance: boolean;
  thresholds: Thresholds;
  updatedAt: string | null;
};

export const DEFAULT_SETTINGS: BriefingSettings = {
  enabled: false, sendDay: 1, sendTime: "08:00", sections: [...SECTION_IDS], recipientId: null, adminFinance: false, thresholds: DEFAULT_THRESHOLDS, updatedAt: null,
};

/** A reporting period. start and end are instants; the days are Sydney calendar days. */
export type Period = { start: string; end: string; startDay: string; endDay: string };

// Inputs, normalised from every source -------------------------------------------------------------

export type CommCategory = "lesson_change" | "billing" | "enrolment" | "tutor_absence" | "general" | "reminder";
export type CommIn = {
  id: string;
  channel: "gmail" | "sms";
  direction: "inbound" | "outbound";
  senderKind: "parent" | "tutor" | "new_family" | "business";
  contactName: string;
  studentName: string | null;
  category: CommCategory;
  subject: string;
  receivedAt: string;
  status: "unanswered" | "awaiting_owner" | "answered" | "resolved";
  answeredAt: string | null;
  deliveryStatus: "delivered" | "failed" | "pending" | null;
  requestId: string | null;
};

export type RequestIn = { id: string; type: string; status: string; reference: string | null; createdAt: string; welfare: boolean };
export type RequestEventIn = { requestId: string; type: string; actorRole: "admin" | "owner" | "system" | null; at: string };
export type LessonIn = { id: string; tutorId: string; tutorName: string; student: string | null; subject: string | null; startsAt: string; status: "scheduled" | "completed" | "cancelled" };
export type AbsenceIn = { tutorId: string; tutorName: string; startsOn: string; endsOn: string };
export type WorkflowIn = { id: string; workflow: "lesson_change" | "payment_extension" | "tutor_absence"; status: "active" | "waiting" | "completed" | "cancelled"; updatedAt: string };
export type ProposalIn = { action: string; status: string; confirmedAt: string | null };
export type ActivityIn = { type: string; at: string };
export type TaskIn = { status: string; needsOwner: boolean; createdAt: string };
export type PaidIn = { invoiceId: string; amountCents: number; at: string };

export type Coverage = { events: string | null; lessons: string | null; comms: string | null };

// Results ---------------------------------------------------------------------------------------------

export type FamilyOverdue = {
  contactId: string;
  name: string;
  students: string[];
  invoices: Array<{ id: string; cents: number; days: number }>;
  cents: number;
  maxDays: number;
  /** "eligible" can get a payment reminder now; anything else is held back by the Payments rules. */
  state: "eligible" | "protected" | "not_yet" | "not_enrolled" | "unchecked";
};

export type FinanceMetrics = {
  outstandingCents: number;
  outstandingInvoices: number;
  overdueInvoices: number;
  overdueCents: number;
  over14Invoices: number;
  over14Cents: number;
  protectedInvoices: number;
  eligibleFamilies: number;
  eligibleCents: number;
  paymentsReceivedCents: number;
  paymentsReceivedCount: number;
  families: FamilyOverdue[];
};

export type CommItem = {
  id: string;
  channel: "gmail" | "sms";
  contactName: string;
  studentName: string | null;
  senderKind: CommIn["senderKind"];
  category: CommCategory;
  subject: string;
  receivedAt: string;
  ageHours: number;
  urgency: Priority;
  status: CommIn["status"];
  requestId: string | null;
};

export type CommMetrics = {
  /** Waiting on the business: unanswered, or waiting for the owner. Oldest first. */
  open: CommItem[];
  unanswered: number;
  awaitingOwner: number;
  lessonChanges: number;
  billing: number;
  enrolment: number;
  tutorMessages: number;
  failedTexts: Array<{ id: string; contactName: string; at: string }>;
  received: number;
  answered: number;
  avgResponseHours: number | null;
  oldestHours: number | null;
};

export type LessonItem = { id: string; tutorName: string; student: string | null; subject: string | null; startsAt: string; hoursAway: number };

export type LessonMetrics = {
  held: number;
  cancelled: number;
  upcoming: number;
  needCover: LessonItem[];
  absences: Array<{ tutorName: string; startsOn: string; endsOn: string }>;
  pendingChanges: number;
  waitingWorkflows: number;
  ownerDecisions: Array<{ id: string; reference: string | null; type: string; welfare: boolean; createdAt: string }>;
  clarifications: number;
  openTasks: number;
};

export type CompletedMetrics = {
  requestsReceived: number;
  requestsClosed: number;
  lessonChanges: number;
  availabilityChecks: number;
  drafted: number;
  adminTasks: number;
  ownerApprovals: number;
  /** Who finished each verified action. Drafts and checks are never counted here. */
  byWho: { rules: number; admin: number; owner: number; compass: number };
  /** Every verified completed action in the period. */
  total: number;
};

export type Headline = {
  activeStudents: number;
  overdueInvoices: number;
  overdueCents: number;
  outstandingCents: number;
  over14Invoices: number;
  unanswered: number;
  awaitingOwner: number;
  upcomingLessons: number;
  tasksCompleted: number;
  cancellations: number;
  enquiriesReceived: number;
  avgResponseHours: number | null;
  recommendations: number;
};

export type CompareKey = "outstandingCents" | "overdueInvoices" | "unanswered" | "tasksCompleted" | "cancellations" | "upcomingLessons" | "avgResponseHours" | "enquiriesReceived";
export type Comparison = {
  key: CompareKey;
  current: number | null;
  previous: number | null;
  /** Which way is good. "neutral" never gets a good or bad colour. */
  better: "lower" | "higher" | "neutral";
  basis: "records" | "snapshot";
  /** null when there's nothing to compare against. */
  change: number | null;
  percent: number | null;
  verdict: "better" | "worse" | "same" | "neutral" | "insufficient";
};

export type EvidenceKind = "invoice" | "family" | "message" | "request" | "lesson" | "absence" | "workflow" | "retention";
export type Evidence = { source: SourceId; kind: EvidenceKind; ref: string; name?: string; cents?: number; days?: number; hours?: number; at?: string; text?: string };

export type ActionLabel =
  | "prepareReminders" | "viewRecords" | "reviewRecommendation" | "openApprovalAlley" | "openRequests" | "openRequest"
  | "startLessonChange" | "startTutorAbsence" | "openSchedule" | "openRetention";
export type BriefingAction =
  | { kind: "link"; href: string; label: ActionLabel }
  | { kind: "compass"; shortcut: ShortcutId; label: ActionLabel }
  | { kind: "records"; label: ActionLabel };

export type RecKind = "overdue" | "enquiries" | "decisions" | "cover" | "tutor_message" | "lesson_changes" | "retention" | "failed_texts" | "all_clear";

export type Recommendation = {
  id: string;
  kind: RecKind;
  priority: Priority;
  /** Holds financial figures, so admins only see it when the owner allows. */
  finance: boolean;
  params: Record<string, number | string>;
  evidence: Evidence[];
  actions: BriefingAction[];
  /** Shown only when the records support an estimate. */
  impact: { cents?: number; count?: number } | null;
};

export type Warning = { kind: "demo" | "not_connected" | "stale" | "unavailable" | "conflict" | "partial"; source: SourceId | "retention"; at?: string };

export type BriefingDetail = {
  version: 1;
  finance: FinanceMetrics | null;
  comms: CommMetrics | null;
  lessons: LessonMetrics;
  completed: CompletedMetrics;
  previousCompleted: CompletedMetrics | null;
  comparisons: Comparison[];
  retention: { high: number; medium: number; monitored: number } | null;
  previousBriefing: { id: string; periodKey: string; generatedAt: string } | null;
};

export type Briefing = {
  id: string;
  periodKey: string;
  period: Period;
  previous: Period;
  generatedAt: string;
  trigger: "page" | "manual" | "schedule" | "compass" | "seed";
  overall: Overall;
  headline: Headline;
  detail: BriefingDetail | null;
  recommendations: Recommendation[];
  sources: Source[];
  warnings: Warning[];
  mode: BriefingMode;
};

/** A briefing as one person may see it: finance removed for admins unless the owner allows. */
export type BriefingView = Briefing & { financeHidden: boolean };

export type HistoryItem = { id: string; periodKey: string; generatedAt: string; trigger: Briefing["trigger"]; overall: Overall; headline: Headline; kinds: Array<{ kind: RecKind; priority: Priority }> };

export type DeliveryStatus = "sending" | "simulated" | "accepted" | "failed" | "skipped";
export type Delivery = { id: string; slotKey: string; kind: "scheduled" | "manual"; recipient: string; status: DeliveryStatus; detail: string; attempts: number; createdAt: string; updatedAt: string; briefingId: string | null };
