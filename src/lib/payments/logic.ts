// The recovery agent's decisions, as pure functions so they can be tested without a
// database: who is eligible for a reminder, how invoices group into families, what each
// message says, which messages are duplicates and how the impact figures are worked out.
// The database checks the important parts again before anything is sent or counted.

import type {
  BillingException,
  Channel,
  Contact,
  DraftMessage,
  ExceptionKind,
  FamilyAssessment,
  FamilyInvoice,
  Invoice,
  MessageStatus,
  RecoveredPayment,
  RecoveryRules,
  ScanSummary,
  Student,
} from "./types";

export const DEFAULT_RULES: RecoveryRules = {
  minDaysOverdue: 7,
  minBalanceCents: 5000,
  escalateAfterDays: 28,
  maxReminders: 2,
  manualMinutesPerFamily: 12,
  manualMinutesPerInvoice: 3,
  adminHourlyRateCents: 3800,
};

/** Whole days from a to b (both YYYY-MM-DD). Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function balanceOf(inv: Pick<Invoice, "amountCents" | "paidCents" | "status">): number {
  return inv.status === "authorised" ? Math.max(0, inv.amountCents - inv.paidCents) : 0;
}

export function daysOverdue(inv: Pick<Invoice, "dueDate">, today: string): number {
  return Math.max(0, daysBetween(inv.dueDate, today));
}

/** Is this exception still in force today? */
export function exceptionActive(e: Pick<BillingException, "activeUntil">, today: string): boolean {
  return !e.activeUntil || e.activeUntil >= today;
}

export type InvoiceState = "paid" | "current" | "overdue" | "protected" | "voided";

/** The status shown in the Invoices table. */
export function invoiceState(inv: Invoice, today: string, protectedContacts: ReadonlySet<string>): InvoiceState {
  if (inv.status === "voided") return "voided";
  if (balanceOf(inv) === 0) return "paid";
  if (daysOverdue(inv, today) === 0) return "current";
  return protectedContacts.has(inv.contactId) ? "protected" : "overdue";
}

export function protectedContactIds(exceptions: BillingException[], today: string): Set<string> {
  return new Set(exceptions.filter((e) => exceptionActive(e, today)).map((e) => e.contactId));
}

const EXCEPTION_REASON: Record<ExceptionKind, string> = {
  extension: "Payment extension agreed",
  dispute: "Invoice in dispute",
  payment_plan: "On a payment plan",
  hardship: "Hardship arrangement",
};

export type AssessInput = {
  contacts: Contact[];
  students: Student[];
  invoices: Invoice[];
  exceptions: BillingException[];
  rules: RecoveryRules;
  today: string;
  /** False when the Gmail check failed: nobody can then be cleared for a reminder. */
  gmailChecked: boolean;
};

/**
 * One row per billing contact with an overdue balance, grouped by family (the person who
 * pays) rather than by student, with the reason they are or aren't in the batch.
 */
export function assessFamilies(input: AssessInput): FamilyAssessment[] {
  const { contacts, students, invoices, exceptions, rules, today, gmailChecked } = input;
  const studentById = new Map(students.map((s) => [s.id, s]));
  const out: FamilyAssessment[] = [];
  for (const c of contacts) {
    const open = invoices.filter((i) => i.contactId === c.id && balanceOf(i) > 0 && daysOverdue(i, today) > 0);
    if (!open.length) continue;
    const toRow = (i: Invoice): FamilyInvoice => ({
      id: i.id,
      studentName: (i.studentId && studentById.get(i.studentId)?.name) || "Student not matched",
      description: i.description,
      balanceCents: balanceOf(i),
      dueDate: i.dueDate,
      daysOverdue: daysOverdue(i, today),
    });
    const enrolledOpen = open.filter((i) => i.studentId && studentById.get(i.studentId)?.enrolled);
    const rows = (enrolledOpen.length ? enrolledOpen : open).map(toRow).sort((a, b) => b.daysOverdue - a.daysOverdue || a.id.localeCompare(b.id));
    const students_ = [...new Set(rows.map((r) => r.studentName))];
    const total = rows.reduce((s, r) => s + r.balanceCents, 0);
    const maxDays = Math.max(...rows.map((r) => r.daysOverdue));
    const base = { contactId: c.id, contactName: c.name, students: students_, invoices: rows, totalCents: total, maxDaysOverdue: maxDays, exception: null as ExceptionKind | null };

    if (!enrolledOpen.length) {
      out.push({ ...base, state: "not_enrolled", reason: "Student no longer enrolled. Review separately" });
      continue;
    }
    const active = exceptions.find((e) => e.contactId === c.id && exceptionActive(e, today));
    if (active) {
      out.push({ ...base, state: "protected", reason: EXCEPTION_REASON[active.kind], exception: active.kind });
      continue;
    }
    if (!gmailChecked) {
      out.push({ ...base, state: "unchecked", reason: "Gmail not checked, so an extension or dispute can't be ruled out" });
      continue;
    }
    const due = rows.filter((r) => r.daysOverdue >= rules.minDaysOverdue);
    const dueTotal = due.reduce((s, r) => s + r.balanceCents, 0);
    if (!due.length) {
      out.push({ ...base, state: "not_yet", reason: `Less than ${rules.minDaysOverdue} days overdue` });
      continue;
    }
    if (dueTotal < rules.minBalanceCents) {
      out.push({ ...base, state: "not_yet", reason: "Balance below your minimum for reminders" });
      continue;
    }
    // Only invoices past the rule's threshold go in the reminder.
    out.push({ ...base, invoices: due, totalCents: dueTotal, maxDaysOverdue: Math.max(...due.map((r) => r.daysOverdue)), state: "eligible", reason: "Eligible for a reminder" });
  }
  const order = { eligible: 0, unchecked: 1, protected: 2, not_yet: 3, not_enrolled: 4 } as const;
  return out.sort((a, b) => order[a.state] - order[b.state] || b.totalCents - a.totalCents);
}

export function summarise(assessments: FamilyAssessment[], invoices: Invoice[], contactsChecked: number, today: string): ScanSummary {
  const eligible = assessments.filter((a) => a.state === "eligible");
  return {
    accountsChecked: contactsChecked,
    invoicesChecked: invoices.length,
    overdueInvoices: invoices.filter((i) => balanceOf(i) > 0 && daysOverdue(i, today) > 0).length,
    eligibleFamilies: eligible.length,
    eligibleInvoices: eligible.reduce((s, a) => s + a.invoices.length, 0),
    eligibleCents: eligible.reduce((s, a) => s + a.totalCents, 0),
    protectedFamilies: assessments.filter((a) => a.state === "protected").length,
    outstandingCents: invoices.reduce((s, i) => s + balanceOf(i), 0),
  };
}

// Money, names and addresses ------------------------------------------------------------

export function money(cents: number, locale = "en-AU"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "AUD", currencyDisplay: "narrowSymbol" }).format(cents / 100);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "Aarav", "Aarav and Anika", "Aarav, Anika and Ravi" (no Oxford comma). */
export function joinNames(names: string[]): string {
  const n = names.map(firstName);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** Australian mobile numbers as +614XXXXXXXX, or null when it isn't one. */
export function normaliseAuMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+61")) d = `0${d.slice(3)}`;
  else if (d.startsWith("61") && d.length === 11) d = `0${d.slice(2)}`;
  return /^04\d{8}$/.test(d) ? `+61${d.slice(1)}` : null;
}

export function normaliseEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** The key used to stop two messages going to the same place in one batch. */
export function addressKey(channel: Channel, address: string): string {
  return channel === "sms" ? `sms:${normaliseAuMobile(address) ?? address.replace(/\D/g, "")}` : `email:${address.trim().toLowerCase()}`;
}

// Drafting ------------------------------------------------------------------------------------

export type DraftOptions = {
  channels: { email: boolean; sms: boolean };
  includeStudents: boolean;
  businessName: string;
  locale?: string;
  /** Reminders each family has already had for these invoices. */
  priorReminders?: Record<string, number>;
  maxReminders?: number;
};

export type DraftSkip = { contactId: string; name: string; channel: Channel; reason: string };

function shortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

export function parentEmail(a: FamilyAssessment, businessName: string, locale = "en-AU"): { subject: string; body: string } {
  const ids = a.invoices.map((i) => i.id);
  const lines = a.invoices.map((i) => `• ${i.id} for ${firstName(i.studentName)}, ${i.description}: ${money(i.balanceCents, locale)} (due ${shortDate(i.dueDate, locale)})`);
  return {
    subject: `Friendly reminder: ${ids.length === 1 ? `invoice ${ids[0]}` : `${ids.length} invoices`} for ${joinNames(a.students)}`,
    body: [
      `Hi ${firstName(a.contactName)},`,
      "",
      `I hope you're well. This is a friendly reminder that the following ${ids.length === 1 ? "invoice is" : "invoices are"} now overdue:`,
      "",
      ...lines,
      "",
      `Total outstanding: ${money(a.totalCents, locale)}`,
      "",
      "If you've already paid, thank you, and please ignore this message. If you'd like more time or a payment plan, just reply to this email and we'll work something out.",
      "",
      "Kind regards,",
      businessName,
    ].join("\n"),
  };
}

export function parentSms(a: FamilyAssessment, businessName: string, locale = "en-AU"): string {
  const ids = a.invoices.map((i) => i.id).join(", ");
  return `${businessName}: Hi ${firstName(a.contactName)}, a friendly reminder that ${money(a.totalCents, locale)} is overdue for ${joinNames(a.students)}'s tutoring (${ids}). Already paid? Thank you. Need more time? Just reply. Reply STOP to opt out.`;
}

/** For students: age-appropriate, and never any amount, invoice or billing detail. */
export function studentMessage(studentName: string, businessName: string): string {
  return `Hi ${firstName(studentName)}, it's ${businessName}. We've sent your family a quick update about your tutoring account, so there's nothing you need to do. See you at your next lesson!`;
}

/**
 * Personalised drafts for the chosen families, one per person and channel, with duplicate
 * addresses removed. Returns what was skipped and why, so the owner sees every gap.
 */
export function buildDrafts(families: FamilyAssessment[], contacts: Contact[], students: Student[], opts: DraftOptions): { messages: DraftMessage[]; skipped: DraftSkip[] } {
  const locale = opts.locale ?? "en-AU";
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const messages: DraftMessage[] = [];
  const skipped: DraftSkip[] = [];
  const seen = new Map<string, string>();
  const push = (m: DraftMessage) => {
    const key = addressKey(m.channel, m.address);
    const first = seen.get(key);
    if (first) {
      skipped.push({ contactId: m.contactId, name: m.recipientName, channel: m.channel, reason: `Same ${m.channel === "sms" ? "number" : "email"} as the message to ${first}` });
      return;
    }
    seen.set(key, m.recipientName);
    messages.push(m);
  };

  for (const a of families) {
    if (a.state !== "eligible") continue;
    const c = contactById.get(a.contactId);
    if (!c) continue;
    const prior = opts.priorReminders?.[a.contactId] ?? 0;
    if (opts.maxReminders !== undefined && prior >= opts.maxReminders) {
      for (const ch of (["email", "sms"] as const).filter((x) => opts.channels[x])) {
        skipped.push({ contactId: c.id, name: c.name, channel: ch, reason: `Already reminded ${prior} times. Escalate to the owner instead` });
      }
      continue;
    }
    const invoiceIds = a.invoices.map((i) => i.id);
    if (opts.channels.email) {
      const email = normaliseEmail(c.email);
      if (!email) skipped.push({ contactId: c.id, name: c.name, channel: "email", reason: "No valid email address" });
      else if (!c.emailPermitted) skipped.push({ contactId: c.id, name: c.name, channel: "email", reason: "Email not permitted" });
      else {
        const e = parentEmail(a, opts.businessName, locale);
        push({ contactId: c.id, studentId: null, recipientKind: "parent", recipientName: c.name, channel: "email", address: email, subject: e.subject, body: e.body, invoiceIds, amountCents: a.totalCents });
      }
    }
    if (opts.channels.sms) {
      if (!c.phone) skipped.push({ contactId: c.id, name: c.name, channel: "sms", reason: "No mobile number" });
      else if (!c.smsPermitted) skipped.push({ contactId: c.id, name: c.name, channel: "sms", reason: "SMS not permitted" });
      else push({ contactId: c.id, studentId: null, recipientKind: "parent", recipientName: c.name, channel: "sms", address: normaliseAuMobile(c.phone) ?? c.phone.trim(), subject: null, body: parentSms(a, opts.businessName, locale), invoiceIds, amountCents: a.totalCents });
    }
    if (opts.includeStudents) {
      for (const s of students.filter((s) => s.contactId === c.id && a.students.includes(s.name))) {
        if (!s.contactVerified) continue; // never message a student without verified permission
        const body = studentMessage(s.name, opts.businessName);
        if (opts.channels.sms && s.phone) push({ contactId: c.id, studentId: s.id, recipientKind: "student", recipientName: s.name, channel: "sms", address: normaliseAuMobile(s.phone) ?? s.phone.trim(), subject: null, body, invoiceIds, amountCents: 0 });
        if (opts.channels.email && normaliseEmail(s.email)) push({ contactId: c.id, studentId: s.id, recipientKind: "student", recipientName: s.name, channel: "email", address: normaliseEmail(s.email)!, subject: `A quick note from ${opts.businessName}`, body, invoiceIds, amountCents: 0 });
      }
    }
  }
  return { messages, skipped };
}

/** Problems the owner should see before approving. */
export function messageWarnings(m: Pick<DraftMessage, "channel" | "address" | "recipientKind" | "body">): string[] {
  const w: string[] = [];
  if (m.channel === "sms" && !normaliseAuMobile(m.address)) w.push("Not a valid Australian mobile number, so this SMS will fail");
  if (m.channel === "sms" && m.body.length > 320) w.push("Longer than two SMS parts");
  if (m.channel === "sms" && !/STOP/i.test(m.body)) w.push("No opt-out wording");
  if (m.recipientKind === "student" && /\$\s?\d|INV-/i.test(m.body)) w.push("Mentions billing details to a student");
  return w;
}

/** Student drafts must stay free of money and invoice details, even after editing. */
export function studentBodyAllowed(body: string): boolean {
  return !/\$\s?\d|INV-|invoice|overdue|owe|balance|debt/i.test(body);
}

// Delivery (demo) ------------------------------------------------------------------------------

/**
 * What happens to an approved message in demo mode. Nothing is sent: a message that would
 * be accepted is 'simulated'; a number that no provider would accept is 'failed'.
 */
export function simulatedDelivery(m: Pick<DraftMessage, "channel" | "address">): { status: MessageStatus; reason: string } {
  if (m.channel === "sms" && !normaliseAuMobile(m.address)) return { status: "failed", reason: "Not a valid Australian mobile number" };
  if (m.channel === "email" && !normaliseEmail(m.address)) return { status: "failed", reason: "Not a valid email address" };
  return { status: "simulated", reason: "Demo mode: simulated, not sent" };
}

// Replies ---------------------------------------------------------------------------------------

export type ReplyKind = "paid" | "promise" | "extension" | "dispute" | "opt_out" | "other";

/** Sorts a reply from a family into what Compass should do next. Keyword rules only. */
export function classifyReply(text: string): ReplyKind {
  const t = text.toLowerCase();
  if (/^\s*stop\b|unsubscribe|opt out/.test(t)) return "opt_out";
  if (/dispute|wrong|incorrect|didn'?t (attend|happen)|cancel+ed|not (be )?charged|overcharg/.test(t)) return "dispute";
  if (/(more time|extension|extend|payment plan|instal+ments?|can'?t pay|hardship)/.test(t)) return "extension";
  if (/(already paid|have paid|just paid|paid (it|this|today|yesterday)|transferred|payment (sent|made))/.test(t)) return "paid";
  if (/(will pay|pay (on|by|this|next)|friday|monday|tomorrow|end of (the )?week|payday)/.test(t)) return "promise";
  return "other";
}

// Impact ----------------------------------------------------------------------------------------

/** Payments Recovered: verified payments credited to a reminder, each payment counted once. */
export function recoveredTotal(payments: Pick<RecoveredPayment, "paymentRef" | "amountCents" | "attributed">[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const p of payments) {
    if (!p.attributed || seen.has(p.paymentRef)) continue;
    seen.add(p.paymentRef);
    total += p.amountCents;
  }
  return total;
}

export type ImpactInput = {
  invoicesReviewed: number;
  messages: (Pick<DraftMessage, "contactId"> & { status: MessageStatus })[];
  payments: Pick<RecoveredPayment, "paymentRef" | "amountCents" | "attributed">[];
  stillOutstandingCents: number;
  ownerApprovalsWaiting: number;
  exceptions: number;
  rules: Pick<RecoveryRules, "manualMinutesPerFamily" | "manualMinutesPerInvoice" | "adminHourlyRateCents">;
};

export type Impact = {
  measured: {
    invoicesReviewed: number;
    familiesContacted: number;
    delivered: number;
    simulated: number;
    failed: number;
    recoveredCents: number;
    stillOutstandingCents: number;
    ownerApprovalsWaiting: number;
    exceptions: number;
  };
  estimated: { minutesSaved: number; valueCents: number };
};

const REACHED: ReadonlySet<MessageStatus> = new Set(["simulated", "sent", "delivered"]);

export function impact(input: ImpactInput): Impact {
  const reached = input.messages.filter((m) => REACHED.has(m.status));
  const families = new Set(reached.map((m) => m.contactId)).size;
  const minutes = input.invoicesReviewed * input.rules.manualMinutesPerInvoice + families * input.rules.manualMinutesPerFamily;
  return {
    measured: {
      invoicesReviewed: input.invoicesReviewed,
      familiesContacted: families,
      delivered: input.messages.filter((m) => m.status === "sent" || m.status === "delivered").length,
      simulated: input.messages.filter((m) => m.status === "simulated").length,
      failed: input.messages.filter((m) => m.status === "failed").length,
      recoveredCents: recoveredTotal(input.payments),
      stillOutstandingCents: input.stillOutstandingCents,
      ownerApprovalsWaiting: input.ownerApprovalsWaiting,
      exceptions: input.exceptions,
    },
    estimated: { minutesSaved: minutes, valueCents: Math.round((minutes / 60) * input.rules.adminHourlyRateCents) },
  };
}
