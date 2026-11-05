// Shapes shared by the Student Retention Agent, its API routes, Compass and the tests.
// Dates are calendar days (YYYY-MM-DD) in Sydney.

export type RetentionMode = "demo" | "live";

export type LessonOutcome = "attended" | "cancelled_family" | "cancelled_tutor" | "no_show" | "rescheduled" | "scheduled";

export type RetentionLesson = { id: string; studentId: string; date: string; subject: string; tutorName: string | null; outcome: LessonOutcome; note: string | null };

export type ConcernCategory = "scheduling" | "tutor_fit" | "progress" | "cost" | "communication" | "other";

export type RetentionConcern = {
  id: string;
  studentId: string;
  raisedOn: string;
  category: ConcernCategory;
  summary: string;
  status: "open" | "resolved";
  /** Owner-only note. Never scored, never sent to the AI and never put in a message. */
  confidential: boolean;
  resolvedOn: string | null;
};

export type RetentionStudent = {
  id: string;
  name: string;
  yearLevel: number | null;
  enrolled: boolean;
  contactId: string;
};

export type RetentionContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  emailPermitted: boolean;
  smsPermitted: boolean;
};

export type RetentionSettings = {
  highThreshold: number;
  mediumThreshold: number;
  windowDays: number;
  baselineDays: number;
  minLessons: number;
  cooldownDays: number;
};

export type RiskLevel = "high" | "medium" | "low";

export type FactorId = "attendance_drop" | "cancellations" | "no_shows" | "reschedules" | "open_concerns" | "frequency_drop" | "no_upcoming";

/** One line of the score: what was found, the points it adds and the records behind it. */
export type RiskFactor = { id: FactorId; points: number; max: number; text: string; evidence: string[] };

export type Dismissal = { studentId: string; reason: string; scoreAt: number; levelAt: RiskLevel; createdAt: string; by: string | null };

export type Assessment = {
  studentId: string;
  name: string;
  yearLevel: number | null;
  subject: string;
  tutorName: string | null;
  contact: RetentionContact | null;
  score: number;
  level: RiskLevel;
  /** Enough lessons in both periods to compare them. */
  enoughData: boolean;
  currentAttendance: number | null;
  previousAttendance: number | null;
  currentLessons: number;
  previousLessons: number;
  cancellations: number;
  noShows: number;
  reschedules: number;
  openConcerns: RetentionConcern[];
  confidentialNotes: number;
  nextLesson: string | null;
  factors: RiskFactor[];
  reasons: string[];
  suggestedAction: string;
  /** The owner said the flag was wrong, and nothing has got worse since. */
  dismissed: Dismissal | null;
  /** High or medium, and not dismissed. */
  flagged: boolean;
};

export type Channel = "email" | "sms";

export type MessageStatus = "draft" | "awaiting_approval" | "approved" | "rejected" | "sending" | "sent" | "failed";
export type DeliveryStatus = "none" | "simulated" | "accepted" | "delivered" | "failed";
export type FollowUp = "none" | "scheduled" | "required" | "resolved";

export type RetentionMessage = {
  id: string;
  studentId: string;
  contactId: string;
  channel: Channel;
  recipientName: string;
  address: string;
  subject: string | null;
  body: string;
  source: "template" | "ai" | "owner";
  variant: number;
  status: MessageStatus;
  version: number;
  preparedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  sentBy: string | null;
  sentAt: string | null;
  deliveryStatus: DeliveryStatus;
  deliveryDetail: string | null;
  responseStatus: "none" | "received";
  responseAt: string | null;
  responseNote: string | null;
  followUp: FollowUp;
  followUpOn: string | null;
  mode: RetentionMode;
  createdAt: string;
  updatedAt: string;
};

/** The single label people see for where a check-in is up to. */
export type Stage =
  | "draft_prepared"
  | "awaiting_owner_approval"
  | "approved_by_owner"
  | "ready_to_send"
  | "rejected"
  | "sending"
  | "sent"
  | "simulated"
  | "delivered"
  | "delivery_failed"
  | "response_received"
  | "follow_up_required"
  | "resolved";

export type DraftText = { subject: string | null; body: string };
