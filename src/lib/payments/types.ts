// Shapes shared by the Payments page, its API routes and the recovery agent. Money is
// always whole cents. Dates are calendar days (YYYY-MM-DD) in Sydney.

export type PaymentsMode = "demo" | "live";

export type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  emailPermitted: boolean;
  smsPermitted: boolean;
};

export type Student = {
  id: string;
  name: string;
  yearLevel: number | null;
  contactId: string;
  enrolled: boolean;
  /** Only true when the family agreed and the date they agreed is recorded. */
  contactVerified: boolean;
  email: string | null;
  phone: string | null;
};

export type InvoiceStatus = "authorised" | "paid" | "voided";

export type Invoice = {
  id: string;
  studentId: string | null;
  contactId: string;
  description: string;
  amountCents: number;
  paidCents: number;
  issuedOn: string;
  dueDate: string;
  status: InvoiceStatus;
};

export type ExceptionKind = "extension" | "dispute" | "payment_plan" | "hardship";

export type BillingException = {
  contactId: string;
  kind: ExceptionKind;
  source: "gmail" | "owner" | "sms";
  summary: string;
  activeUntil: string | null;
};

export type RecoveryRules = {
  minDaysOverdue: number;
  minBalanceCents: number;
  escalateAfterDays: number;
  maxReminders: number;
  manualMinutesPerFamily: number;
  manualMinutesPerInvoice: number;
  adminHourlyRateCents: number;
};

export type StepId = "xero" | "enrolment" | "families" | "gmail" | "rules";
export type StepState = "pending" | "running" | "completed" | "failed" | "skipped";
export type ScanStep = { id: StepId; state: StepState; detail: string };
export type LogLine = { step: StepId; text: string };

/** Why a family is or isn't in the recovery batch. */
export type FamilyState = "eligible" | "protected" | "not_yet" | "not_enrolled" | "unchecked";

export type FamilyInvoice = { id: string; studentName: string; description: string; balanceCents: number; dueDate: string; daysOverdue: number };

export type FamilyAssessment = {
  contactId: string;
  contactName: string;
  students: string[];
  invoices: FamilyInvoice[];
  totalCents: number;
  maxDaysOverdue: number;
  state: FamilyState;
  reason: string;
  exception: ExceptionKind | null;
};

export type ScanSummary = {
  accountsChecked: number;
  invoicesChecked: number;
  overdueInvoices: number;
  eligibleFamilies: number;
  eligibleInvoices: number;
  eligibleCents: number;
  protectedFamilies: number;
  outstandingCents: number;
};

export type Channel = "email" | "sms";
export type RecipientKind = "parent" | "student";

export type DraftMessage = {
  contactId: string;
  studentId: string | null;
  recipientKind: RecipientKind;
  recipientName: string;
  channel: Channel;
  address: string;
  subject: string | null;
  body: string;
  invoiceIds: string[];
  amountCents: number;
};

export type MessageStatus = "draft" | "excluded" | "simulated" | "queued" | "sent" | "delivered" | "failed" | "blocked";

export type SavedMessage = DraftMessage & {
  id: string;
  included: boolean;
  edited: boolean;
  status: MessageStatus;
  statusReason: string | null;
  sentAt: string | null;
};

export type RecoveredPayment = {
  invoiceId: string;
  contactId: string;
  paymentRef: string;
  amountCents: number;
  attributed: boolean;
  source: "xero" | "demo_simulated";
  verifiedAt: string;
};
