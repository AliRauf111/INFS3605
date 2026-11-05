// The one-click accounting scan: five checks in order, each reported as it starts and
// finishes so the page can show progress. The record sources are passed in, so the same
// runner works with the fictional demo records, the live Xero and Gmail connections and
// the tests (which make sources fail on purpose).
//
// Failure rules: if Xero or the student records can't be read, the scan stops and nobody
// is eligible. If Gmail can't be read, the scan finishes as "partial" and every family is
// marked "not checked", because an extension or dispute can't be ruled out.

import { assessFamilies, balanceOf, daysOverdue, money, summarise } from "./logic";
import type { BillingException, Contact, FamilyAssessment, Invoice, LogLine, RecoveryRules, ScanStep, ScanSummary, StepId, Student } from "./types";

export type ScanSources = {
  accounting(): Promise<{ contacts: Contact[]; invoices: Invoice[]; source: string }>;
  students(): Promise<Student[]>;
  exceptions(contacts: Contact[]): Promise<{ exceptions: BillingException[]; source: string; conversations: number }>;
  rules(): Promise<RecoveryRules>;
};

export type ScanEvent = { type: "step"; step: ScanStep } | { type: "log"; line: LogLine };

export type ScanResult = {
  status: "completed" | "partial" | "failed";
  steps: ScanStep[];
  summary: ScanSummary | null;
  assessments: FamilyAssessment[];
  log: LogLine[];
};

export const STEP_ORDER: StepId[] = ["xero", "enrolment", "families", "gmail", "rules"];

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 200) || "Unknown error";
}

export async function runScan(sources: ScanSources, today: string, emit: (e: ScanEvent) => void = () => {}, pause: () => Promise<void> = async () => {}): Promise<ScanResult> {
  const steps: ScanStep[] = STEP_ORDER.map((id) => ({ id, state: "pending", detail: "" }));
  const log: LogLine[] = [];
  const set = (id: StepId, state: ScanStep["state"], detail = "") => {
    const s = steps.find((x) => x.id === id)!;
    s.state = state;
    s.detail = detail;
    emit({ type: "step", step: { ...s } });
  };
  const note = (step: StepId, text: string) => {
    const line = { step, text };
    log.push(line);
    emit({ type: "log", line });
  };
  const stop = (from: number): ScanResult => {
    for (const id of STEP_ORDER.slice(from)) set(id, "skipped", "Not run because an earlier check failed");
    return { status: "failed", steps, summary: null, assessments: [], log };
  };

  // 1. Accounting records
  set("xero", "running");
  await pause();
  let contacts: Contact[];
  let invoices: Invoice[];
  try {
    const r = await sources.accounting();
    contacts = r.contacts;
    invoices = r.invoices;
    const open = invoices.filter((i) => balanceOf(i) > 0);
    set("xero", "completed", `${invoices.length} invoices and ${contacts.length} contacts retrieved from ${r.source}`);
    note("xero", `Read ${invoices.length} invoices (${open.length} with a balance) and ${contacts.length} billing contacts from ${r.source}.`);
  } catch (e) {
    set("xero", "failed", `Couldn't read the accounting records: ${errorText(e)}`);
    note("xero", `Stopped: accounting records unavailable (${errorText(e)}). No family was marked eligible.`);
    return stop(1);
  }

  // 2. Enrolment
  set("enrolment", "running");
  await pause();
  let students: Student[];
  try {
    students = await sources.students();
    const byId = new Map(students.map((s) => [s.id, s]));
    const enrolled = students.filter((s) => s.enrolled);
    const former = invoices.filter((i) => balanceOf(i) > 0 && i.studentId && byId.get(i.studentId) && !byId.get(i.studentId)!.enrolled);
    const unknown = invoices.filter((i) => balanceOf(i) > 0 && (!i.studentId || !byId.get(i.studentId)));
    set("enrolment", "completed", `Checked against ${enrolled.length} enrolled students${former.length ? `. ${former.length} invoice${former.length === 1 ? "" : "s"} for a former student` : ""}`);
    note("enrolment", `${enrolled.length} students are currently enrolled.`);
    for (const i of former) note("enrolment", `${i.id} is for ${byId.get(i.studentId!)!.name}, who is no longer enrolled. Left for the owner to review.`);
    for (const i of unknown) note("enrolment", `${i.id} has no matching student record. Left out until it is matched.`);
  } catch (e) {
    set("enrolment", "failed", `Couldn't read student records: ${errorText(e)}`);
    note("enrolment", "Stopped: student records unavailable. No family was marked eligible.");
    return stop(2);
  }

  // 3. Families
  set("families", "running");
  await pause();
  const contactIds = new Set(contacts.map((c) => c.id));
  const withBalance = invoices.filter((i) => balanceOf(i) > 0 && contactIds.has(i.contactId));
  const familySizes = new Map<string, Set<string>>();
  for (const i of withBalance) {
    if (!familySizes.has(i.contactId)) familySizes.set(i.contactId, new Set());
    if (i.studentId) familySizes.get(i.contactId)!.add(i.studentId);
  }
  const multi = [...familySizes.entries()].filter(([, s]) => s.size > 1);
  const nameOf = new Map(contacts.map((c) => [c.id, c.name]));
  set("families", "completed", `${familySizes.size} billing contacts with a balance${multi.length ? `, ${multi.length} paying for more than one student` : ""}`);
  for (const [cid, s] of multi) note("families", `${nameOf.get(cid)} pays for ${s.size} students, so their invoices are grouped into one family account.`);
  const orphan = invoices.filter((i) => balanceOf(i) > 0 && !contactIds.has(i.contactId));
  for (const i of orphan) note("families", `${i.id} has no billing contact. Left out.`);

  // 4. Gmail
  set("gmail", "running");
  await pause();
  let exceptions: BillingException[] = [];
  let gmailChecked = true;
  try {
    const r = await sources.exceptions(contacts.filter((c) => familySizes.has(c.id)));
    exceptions = r.exceptions;
    set("gmail", "completed", `${r.conversations} conversations checked in ${r.source}. ${exceptions.length} arrangement${exceptions.length === 1 ? "" : "s"} or dispute${exceptions.length === 1 ? "" : "s"} found`);
    for (const e of exceptions) note("gmail", `${nameOf.get(e.contactId) ?? e.contactId}: ${e.kind.replace("_", " ")} found. ${e.summary}`);
  } catch (e) {
    gmailChecked = false;
    set("gmail", "failed", `Couldn't check Gmail: ${errorText(e)}. Families can't be cleared for reminders`);
    note("gmail", "Gmail check failed, so every family is marked 'not checked' and none is eligible.");
  }

  // 5. Rules
  set("rules", "running");
  await pause();
  let rules: RecoveryRules;
  try {
    rules = await sources.rules();
  } catch (e) {
    set("rules", "failed", `Couldn't read your recovery rules: ${errorText(e)}`);
    return { status: "failed", steps, summary: null, assessments: [], log };
  }
  const assessments = assessFamilies({ contacts, students, invoices: invoices.filter((i) => contactIds.has(i.contactId)), exceptions, rules, today, gmailChecked });
  const summary = summarise(assessments, invoices, familySizes.size, today);
  set("rules", "completed", `${summary.eligibleFamilies} famil${summary.eligibleFamilies === 1 ? "y" : "ies"} eligible, ${money(summary.eligibleCents)} overdue`);
  note("rules", `Rules used: at least ${rules.minDaysOverdue} days overdue, at least ${money(rules.minBalanceCents)} owing, no active extension, dispute or plan.`);
  for (const a of assessments) note("rules", `${a.contactName}: ${a.reason} (${money(a.totalCents)}, up to ${a.maxDaysOverdue} days overdue).`);
  const overdueCount = invoices.filter((i) => balanceOf(i) > 0 && daysOverdue(i, today) > 0).length;
  note("rules", `${overdueCount} overdue invoices in total.`);

  return { status: gmailChecked ? "completed" : "partial", steps, summary, assessments, log };
}
