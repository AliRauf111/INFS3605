import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_RULES,
  addressKey,
  assessFamilies,
  buildDrafts,
  classifyReply,
  impact,
  invoiceState,
  joinNames,
  messageWarnings,
  normaliseAuMobile,
  recoveredTotal,
  simulatedDelivery,
  studentBodyAllowed,
  summarise,
} from "@/lib/payments/logic";
import { runScan, type ScanEvent, type ScanSources } from "@/lib/payments/scan";
import { paymentsMode, providerStatus } from "@/lib/payments/providers";
import type { BillingException, Contact, Invoice, Student } from "@/lib/payments/types";

// The Payments module's decisions: eligibility, family grouping, drafting, duplicate
// prevention, the one-click scan (including failures), recovery totals and live versus demo.

const TODAY = "2026-11-05";
const back = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

const contacts: Contact[] = [
  { id: "BC-01", name: "Priya Mehta", email: "priya@example.com", phone: "+61 412 555 101", emailPermitted: true, smsPermitted: true },
  { id: "BC-02", name: "Daniel O'Brien", email: "daniel@example.com", phone: "0412 555 102", emailPermitted: true, smsPermitted: true },
  { id: "BC-03", name: "Mei Lin Wong", email: "meilin@example.com", phone: "+61 412 555 103", emailPermitted: true, smsPermitted: false },
  { id: "BC-04", name: "Fatima Hassan", email: "fatima@example.com", phone: "+61 412 555 10", emailPermitted: true, smsPermitted: true },
  { id: "BC-05", name: "Sarah Chen", email: "sarah@example.com", phone: "+61 412 555 105", emailPermitted: true, smsPermitted: true },
  { id: "BC-06", name: "Tom Nguyen", email: "tom@example.com", phone: null, emailPermitted: true, smsPermitted: false },
  { id: "BC-07", name: "Rachel Brown", email: "rachel@example.com", phone: null, emailPermitted: true, smsPermitted: false },
  { id: "BC-08", name: "Karen Smith", email: "karen@example.com", phone: null, emailPermitted: true, smsPermitted: false },
];
const students: Student[] = [
  { id: "ST-01", name: "Aarav Mehta", yearLevel: 9, contactId: "BC-01", enrolled: true, contactVerified: false, email: null, phone: null },
  { id: "ST-02", name: "Anika Mehta", yearLevel: 7, contactId: "BC-01", enrolled: true, contactVerified: false, email: null, phone: null },
  // Liam may be contacted, but his phone is the family phone.
  { id: "ST-03", name: "Liam O'Brien", yearLevel: 12, contactId: "BC-02", enrolled: true, contactVerified: true, email: "liam@example.com", phone: "+61412555102" },
  // Chloe's family hasn't verified permission, so she is never messaged.
  { id: "ST-04", name: "Chloe Wong", yearLevel: 11, contactId: "BC-03", enrolled: true, contactVerified: false, email: "chloe@example.com", phone: null },
  { id: "ST-05", name: "Omar Hassan", yearLevel: 10, contactId: "BC-04", enrolled: true, contactVerified: false, email: null, phone: null },
  { id: "ST-06", name: "Oliver Chen", yearLevel: 8, contactId: "BC-05", enrolled: true, contactVerified: false, email: null, phone: null },
  { id: "ST-07", name: "Jack Nguyen", yearLevel: 11, contactId: "BC-06", enrolled: true, contactVerified: false, email: null, phone: null },
  { id: "ST-08", name: "Ethan Brown", yearLevel: 6, contactId: "BC-07", enrolled: true, contactVerified: false, email: null, phone: null },
  { id: "ST-10", name: "Noah Smith", yearLevel: 10, contactId: "BC-08", enrolled: false, contactVerified: false, email: null, phone: null },
];
const inv = (id: string, studentId: string, contactId: string, dollars: number, overdue: number, paid = 0): Invoice => ({
  id, studentId, contactId, description: "Tutoring", amountCents: dollars * 100, paidCents: paid * 100, issuedOn: back(overdue + 14), dueDate: back(overdue), status: paid >= dollars ? "paid" : "authorised",
});
const invoices: Invoice[] = [
  inv("INV-2041", "ST-01", "BC-01", 260, 21),
  inv("INV-2042", "ST-02", "BC-01", 240, 21),
  inv("INV-2043", "ST-03", "BC-02", 240, 12),
  inv("INV-2044", "ST-04", "BC-03", 360, 9),
  inv("INV-2050", "ST-04", "BC-03", 120, -12), // not yet due
  inv("INV-2045", "ST-05", "BC-04", 180, 30),
  inv("INV-2046", "ST-06", "BC-05", 180, 5),
  inv("INV-2047", "ST-07", "BC-06", 300, 15),
  inv("INV-2048", "ST-08", "BC-07", 120, 3),
  inv("INV-2039", "ST-10", "BC-08", 240, 56),
];
const exceptions: BillingException[] = [
  { contactId: "BC-05", kind: "extension", source: "gmail", summary: "14 days agreed", activeUntil: "2026-11-15" },
  { contactId: "BC-06", kind: "dispute", source: "gmail", summary: "Lesson cancelled", activeUntil: null },
];
const base = { contacts, students, invoices, exceptions, rules: DEFAULT_RULES, today: TODAY, gmailChecked: true };

describe("eligibility and family grouping", () => {
  const a = assessFamilies(base);
  const by = (id: string) => a.find((x) => x.contactId === id)!;

  it("finds the four eligible families", () => {
    expect(a.filter((x) => x.state === "eligible").map((x) => x.contactId).sort()).toEqual(["BC-01", "BC-02", "BC-03", "BC-04"]);
  });
  it("groups two children under one billing contact", () => {
    expect(by("BC-01").students).toEqual(["Aarav Mehta", "Anika Mehta"]);
    expect(by("BC-01").invoices.map((i) => i.id).sort()).toEqual(["INV-2041", "INV-2042"]);
    expect(by("BC-01").totalCents).toBe(50000);
  });
  it("protects extensions and disputes", () => {
    expect(by("BC-05")).toMatchObject({ state: "protected", exception: "extension" });
    expect(by("BC-06")).toMatchObject({ state: "protected", exception: "dispute" });
  });
  it("an expired extension no longer protects", () => {
    const old = assessFamilies({ ...base, exceptions: [{ ...exceptions[0], activeUntil: back(1) }] });
    expect(old.find((x) => x.contactId === "BC-05")!.state).toBe("not_yet"); // 5 days overdue, under the 7-day rule
  });
  it("leaves out invoices under the rule's day limit and former students", () => {
    expect(by("BC-07").state).toBe("not_yet");
    expect(by("BC-08").state).toBe("not_enrolled");
  });
  it("only counts invoices that are actually overdue", () => {
    expect(by("BC-03").invoices.map((i) => i.id)).toEqual(["INV-2044"]);
  });
  it("a failed Gmail check clears nobody", () => {
    const g = assessFamilies({ ...base, gmailChecked: false });
    expect(g.some((x) => x.state === "eligible")).toBe(false);
    expect(g.find((x) => x.contactId === "BC-01")!.state).toBe("unchecked");
  });
  it("respects a minimum balance", () => {
    const g = assessFamilies({ ...base, rules: { ...DEFAULT_RULES, minBalanceCents: 30000 } });
    expect(g.find((x) => x.contactId === "BC-04")!.state).toBe("not_yet");
  });
  it("summarises the scan", () => {
    const s = summarise(a, invoices, 8, TODAY);
    expect(s).toMatchObject({ eligibleFamilies: 4, eligibleInvoices: 5, eligibleCents: 128000, protectedFamilies: 2, overdueInvoices: 9 });
  });
  it("invoice status for the table", () => {
    const prot = new Set(["BC-05"]);
    expect(invoiceState(invoices[0], TODAY, prot)).toBe("overdue");
    expect(invoiceState(invoices[6], TODAY, prot)).toBe("protected");
    expect(invoiceState(invoices[4], TODAY, prot)).toBe("current");
    expect(invoiceState(inv("INV-1", "ST-01", "BC-01", 100, 10, 100), TODAY, prot)).toBe("paid");
  });
});

describe("drafting", () => {
  const eligible = assessFamilies(base).filter((x) => x.state === "eligible");
  const opts = { channels: { email: true, sms: true }, includeStudents: true, businessName: "Tutor Compass" };
  const { messages, skipped } = buildDrafts(eligible, contacts, students, opts);

  it("personalises parent emails with names, invoices and the total", () => {
    const e = messages.find((m) => m.contactId === "BC-01" && m.channel === "email")!;
    expect(e.body).toContain("Hi Priya,");
    expect(e.body).toContain("INV-2041");
    expect(e.body).toContain("INV-2042");
    expect(e.body).toContain("$500.00");
    expect(e.subject).toContain("Aarav and Anika");
    expect(e.recipientKind).toBe("parent");
  });
  it("SMS names the business and offers an opt-out", () => {
    const s = messages.find((m) => m.contactId === "BC-01" && m.channel === "sms")!;
    expect(s.body.startsWith("Tutor Compass:")).toBe(true);
    expect(s.body).toMatch(/STOP/);
    expect(s.address).toBe("+61412555101");
  });
  it("never sends a duplicate to the same phone number", () => {
    const sms = messages.filter((m) => m.channel === "sms").map((m) => addressKey("sms", m.address));
    expect(new Set(sms).size).toBe(sms.length);
    expect(skipped).toContainEqual(expect.objectContaining({ name: "Liam O'Brien", channel: "sms" }));
  });
  it("respects channel permissions", () => {
    expect(messages.some((m) => m.contactId === "BC-03" && m.channel === "sms" && m.recipientKind === "parent")).toBe(false);
    expect(skipped).toContainEqual(expect.objectContaining({ contactId: "BC-03", channel: "sms", reason: "SMS not permitted" }));
  });
  it("only messages students with verified permission, without billing details", () => {
    const st = messages.filter((m) => m.recipientKind === "student");
    expect(st.map((m) => m.recipientName)).toEqual(["Liam O'Brien"]);
    expect(st.every((m) => studentBodyAllowed(m.body) && m.amountCents === 0)).toBe(true);
  });
  it("leaves students out unless asked", () => {
    const r = buildDrafts(eligible, contacts, students, { ...opts, includeStudents: false });
    expect(r.messages.some((m) => m.recipientKind === "student")).toBe(false);
  });
  it("skips families already reminded the maximum number of times", () => {
    const r = buildDrafts(eligible, contacts, students, { ...opts, priorReminders: { "BC-01": 2 }, maxReminders: 2 });
    expect(r.messages.some((m) => m.contactId === "BC-01")).toBe(false);
    expect(r.skipped.some((s) => s.contactId === "BC-01" && /Escalate/.test(s.reason))).toBe(true);
  });
  it("never drafts for protected families", () => {
    const all = assessFamilies(base);
    const r = buildDrafts(all, contacts, students, opts);
    expect(r.messages.some((m) => ["BC-05", "BC-06", "BC-07", "BC-08"].includes(m.contactId))).toBe(false);
  });
  it("flags numbers that will fail and blocks billing words in student edits", () => {
    const f = messages.find((m) => m.contactId === "BC-04" && m.channel === "sms")!;
    expect(messageWarnings(f)[0]).toMatch(/Australian mobile/);
    expect(simulatedDelivery(f).status).toBe("failed");
    expect(simulatedDelivery(messages[0]).status).toBe("simulated");
    expect(studentBodyAllowed("Your invoice INV-2043 is overdue")).toBe(false);
    expect(studentBodyAllowed("See you on Thursday!")).toBe(true);
  });
  it("normalises Australian mobiles and joins names without an Oxford comma", () => {
    expect(normaliseAuMobile("0412 555 102")).toBe("+61412555102");
    expect(normaliseAuMobile("61412555102")).toBe("+61412555102");
    expect(normaliseAuMobile("+61 2 9999 0000")).toBeNull();
    expect(joinNames(["Aarav Mehta", "Anika Mehta", "Ravi Mehta"])).toBe("Aarav, Anika and Ravi");
  });
});

describe("replies", () => {
  it("sorts replies into next steps", () => {
    expect(classifyReply("I'll pay Chloe's invoice on Friday")).toBe("promise");
    expect(classifyReply("I already paid this yesterday")).toBe("paid");
    expect(classifyReply("Could I get a payment plan please?")).toBe("extension");
    expect(classifyReply("That lesson was cancelled, I shouldn't be charged")).toBe("dispute");
    expect(classifyReply("STOP")).toBe("opt_out");
    expect(classifyReply("Thanks")).toBe("other");
  });
});

describe("Payments Recovered", () => {
  it("counts only attributed payments, each once, including part payments", () => {
    const p = [
      { paymentRef: "A", amountCents: 26000, attributed: true },
      { paymentRef: "B", amountCents: 24000, attributed: true },
      { paymentRef: "B", amountCents: 24000, attributed: true }, // same payment seen twice
      { paymentRef: "C", amountCents: 10000, attributed: false }, // paid before any reminder
      { paymentRef: "D", amountCents: 12000, attributed: true }, // part payment
    ];
    expect(recoveredTotal([])).toBe(0);
    expect(recoveredTotal(p.slice(0, 2))).toBe(50000);
    expect(recoveredTotal(p)).toBe(62000);
  });
  it("keeps measured results apart from estimates", () => {
    const r = impact({
      invoicesReviewed: 10,
      messages: [{ contactId: "BC-01", status: "simulated" }, { contactId: "BC-01", status: "simulated" }, { contactId: "BC-04", status: "failed" }],
      payments: [{ paymentRef: "A", amountCents: 50000, attributed: true }],
      stillOutstandingCents: 18000, ownerApprovalsWaiting: 1, exceptions: 2, rules: DEFAULT_RULES,
    });
    expect(r.measured).toMatchObject({ familiesContacted: 1, simulated: 2, delivered: 0, failed: 1, recoveredCents: 50000 });
    expect(r.estimated.minutesSaved).toBe(10 * 3 + 1 * 12);
    expect(r.estimated.valueCents).toBe(Math.round((42 / 60) * 3800));
  });
});

describe("one-click scan", () => {
  const ok: ScanSources = {
    accounting: async () => ({ contacts, invoices, source: "Xero (test)" }),
    students: async () => students,
    exceptions: async () => ({ exceptions, source: "Gmail (test)", conversations: 12 }),
    rules: async () => DEFAULT_RULES,
  };
  it("runs all five checks in order from one call", async () => {
    const order: string[] = [];
    const r = await runScan(ok, TODAY, (e: ScanEvent) => { if (e.type === "step" && e.step.state === "running") order.push(e.step.id); });
    expect(order).toEqual(["xero", "enrolment", "families", "gmail", "rules"]);
    expect(r.status).toBe("completed");
    expect(r.steps.every((s) => s.state === "completed")).toBe(true);
    expect(r.summary!.eligibleFamilies).toBe(4);
    expect(r.log.some((l) => /Priya Mehta pays for 2 students/.test(l.text))).toBe(true);
  });
  it("stops safely when Xero fails", async () => {
    const r = await runScan({ ...ok, accounting: async () => { throw new Error("Xero answered 503"); } }, TODAY);
    expect(r.status).toBe("failed");
    expect(r.steps[0]).toMatchObject({ state: "failed" });
    expect(r.steps.slice(1).every((s) => s.state === "skipped")).toBe(true);
    expect(r.assessments).toEqual([]);
  });
  it("finishes as partial when Gmail fails, with nobody eligible", async () => {
    const r = await runScan({ ...ok, exceptions: async () => { throw new Error("Gmail answered 401"); } }, TODAY);
    expect(r.status).toBe("partial");
    expect(r.steps.find((s) => s.id === "gmail")!.state).toBe("failed");
    expect(r.summary!.eligibleFamilies).toBe(0);
  });
});

describe("live and demo separation", () => {
  it("stays in demo mode unless live is asked for and Xero and Gmail are both set", () => {
    const full = { XERO_CLIENT_ID: "a", XERO_CLIENT_SECRET: "b", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "d", GMAIL_REFRESH_TOKEN: "e", GMAIL_SENDER: "f@x.com" } as NodeJS.ProcessEnv;
    expect(paymentsMode({} as NodeJS.ProcessEnv)).toBe("demo");
    expect(paymentsMode(full)).toBe("demo");
    expect(paymentsMode({ ...full, PAYMENTS_MODE: "live" })).toBe("live");
    expect(paymentsMode({ ...full, PAYMENTS_MODE: "live", GMAIL_REFRESH_TOKEN: "" })).toBe("demo");
    expect(providerStatus({ TWILIO_ACCOUNT_SID: "x", TWILIO_AUTH_TOKEN: "y", TWILIO_FROM: "z" } as NodeJS.ProcessEnv).sms).toBe(true);
  });
  it("the database refuses simulated payments on real invoices and owner-only approval is enforced", () => {
    const sql = readFileSync("supabase/migrations/20261105000001_payments_recovery.sql", "utf8");
    expect(sql).toMatch(/simulated payments can only be recorded against demo invoices/);
    expect(sql).toMatch(/only the owner can approve and send payment reminders/);
    expect(sql).toMatch(/payment_ref text not null unique/);
  });
});
