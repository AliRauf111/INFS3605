import "server-only";
import { classifyReply, normaliseAuMobile, normaliseEmail } from "./logic";
import type { BillingException, Contact, Invoice, PaymentsMode } from "./types";

// Connections to Xero, Gmail and an SMS provider (Twilio). Credentials are read from the
// server's environment only and never reach the browser. The Payments module uses these
// only when PAYMENTS_MODE=live and Xero and Gmail are both configured. Otherwise it runs
// in demo mode on fictional records and says so on every screen.
//
// These clients follow each provider's published API. They have not been run against
// real accounts in this project, so test them with a Xero demo company and a test Gmail
// account before using them with real families.

const TIMEOUT = 15_000;

export type ProviderStatus = { xero: boolean; gmail: boolean; sms: boolean; liveRequested: boolean };

export function providerStatus(env: NodeJS.ProcessEnv = process.env): ProviderStatus {
  return {
    xero: Boolean(env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET),
    gmail: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_SENDER),
    sms: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM),
    liveRequested: /^live$/i.test((env.PAYMENTS_MODE ?? "").trim()),
  };
}

/** Live only when the owner asked for it and the two systems the scan needs are connected. */
export function paymentsMode(env: NodeJS.ProcessEnv = process.env): PaymentsMode {
  const s = providerStatus(env);
  return s.liveRequested && s.xero && s.gmail ? "live" : "demo";
}

async function call(url: string, init: RequestInit, what: string): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) throw new Error(`${what} answered ${res.status}`);
  return res;
}

// Xero ----------------------------------------------------------------------------------------
// A Xero "custom connection" (client credentials) for one organisation, read-only scopes:
// accounting.transactions.read accounting.contacts.read.

async function xeroToken(): Promise<string> {
  const id = process.env.XERO_CLIENT_ID!;
  const secret = process.env.XERO_CLIENT_SECRET!;
  const res = await call("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "accounting.transactions.read accounting.contacts.read" }),
  }, "Xero sign-in");
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Xero sends dates as "/Date(1730764800000+0000)/". */
function xeroDate(v: string | undefined): string {
  const ms = Number(/\/Date\((\d+)/.exec(v ?? "")?.[1]);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "";
}

type XeroInvoice = {
  InvoiceID: string; InvoiceNumber: string; Reference?: string; Status: string; Total: number; AmountPaid: number;
  DueDate?: string; Date?: string; Contact: { ContactID: string; Name: string; EmailAddress?: string; Phones?: { PhoneType: string; PhoneNumber?: string; PhoneAreaCode?: string; PhoneCountryCode?: string }[] };
};

/**
 * Accounts-receivable invoices that are authorised or paid, with their contacts. Contacts
 * are matched to Tutor Compass billing contacts by Xero contact ID, and invoices to students
 * by the student ID or name in the invoice reference.
 */
export async function xeroInvoices(known: { contacts: { id: string; xeroId: string | null; emailPermitted: boolean; smsPermitted: boolean }[]; students: { id: string; name: string; contactId: string }[] }): Promise<{ contacts: Contact[]; invoices: Invoice[] }> {
  const token = await xeroToken();
  const where = encodeURIComponent('Type=="ACCREC"');
  const res = await call(`https://api.xero.com/api.xro/2.0/Invoices?where=${where}&Statuses=AUTHORISED,PAID&page=1&pageSize=200`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }, "Xero invoices");
  const rows = ((await res.json()) as { Invoices?: XeroInvoice[] }).Invoices ?? [];
  const byXero = new Map(known.contacts.filter((c) => c.xeroId).map((c) => [c.xeroId!, c]));
  const contacts = new Map<string, Contact>();
  const invoices: Invoice[] = [];
  for (const x of rows) {
    const k = byXero.get(x.Contact.ContactID);
    const contactId = k?.id ?? `BC-X-${x.Contact.ContactID.slice(0, 8)}`;
    const mobile = x.Contact.Phones?.find((p) => p.PhoneType === "MOBILE");
    contacts.set(contactId, {
      id: contactId,
      name: x.Contact.Name,
      email: normaliseEmail(x.Contact.EmailAddress),
      phone: mobile ? normaliseAuMobile(`${mobile.PhoneCountryCode ?? ""}${mobile.PhoneAreaCode ?? ""}${mobile.PhoneNumber ?? ""}`) : null,
      // Permission comes from Tutor Compass, never from Xero. Unknown contacts get none.
      emailPermitted: k?.emailPermitted ?? false,
      smsPermitted: k?.smsPermitted ?? false,
    });
    const ref = (x.Reference ?? "").toLowerCase();
    const student = known.students.find((s) => s.contactId === contactId && (ref.includes(s.id.toLowerCase()) || ref.includes(s.name.toLowerCase())));
    invoices.push({
      id: x.InvoiceNumber.startsWith("INV-") ? x.InvoiceNumber : `INV-${x.InvoiceNumber}`,
      studentId: student?.id ?? null,
      contactId,
      description: x.Reference ?? "",
      amountCents: Math.round(x.Total * 100),
      paidCents: Math.round(x.AmountPaid * 100),
      issuedOn: xeroDate(x.Date),
      dueDate: xeroDate(x.DueDate),
      status: x.Status === "PAID" ? "paid" : "authorised",
    });
  }
  return { contacts: [...contacts.values()], invoices };
}

/** Payments recorded in Xero since a date, by invoice number. */
export async function xeroPaymentsSince(sinceIso: string): Promise<{ invoiceNumber: string; paymentId: string; amountCents: number; date: string }[]> {
  const token = await xeroToken();
  const [y, m, d] = sinceIso.split("-").map(Number);
  const where = encodeURIComponent(`Date>=DateTime(${y},${m},${d})`);
  const res = await call(`https://api.xero.com/api.xro/2.0/Payments?where=${where}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, "Xero payments");
  const rows = ((await res.json()) as { Payments?: { PaymentID: string; Amount: number; Date?: string; Status?: string; Invoice?: { InvoiceNumber?: string } }[] }).Payments ?? [];
  return rows
    .filter((p) => p.Status !== "DELETED" && p.Invoice?.InvoiceNumber)
    .map((p) => ({ invoiceNumber: p.Invoice!.InvoiceNumber!, paymentId: p.PaymentID, amountCents: Math.round(p.Amount * 100), date: xeroDate(p.Date) }));
}

// Gmail ------------------------------------------------------------------------------------------
// OAuth with the gmail.readonly and gmail.send scopes for the business's own mailbox.

async function googleToken(): Promise<string> {
  const res = await call("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  }, "Google sign-in");
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Recent email with each family, sorted by keyword into extensions, plans and disputes. */
export async function gmailArrangements(contacts: Contact[], today: string): Promise<{ exceptions: BillingException[]; conversations: number }> {
  const token = await googleToken();
  const auth = { Authorization: `Bearer ${token}` };
  const exceptions: BillingException[] = [];
  let conversations = 0;
  for (const c of contacts) {
    if (!c.email) continue;
    const q = encodeURIComponent(`(from:${c.email} OR to:${c.email}) newer_than:60d`);
    const list = (await (await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=10`, { headers: auth }, "Gmail search")).json()) as { messages?: { id: string }[] };
    for (const m of list.messages ?? []) {
      conversations++;
      const msg = (await (await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject`, { headers: auth }, "Gmail message")).json()) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
      const subject = msg.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "";
      const kind = classifyReply(`${subject} ${msg.snippet ?? ""}`);
      if (kind === "extension" || kind === "dispute") {
        exceptions.push({ contactId: c.id, kind, source: "gmail", summary: `Email: "${subject || (msg.snippet ?? "").slice(0, 80)}"`, activeUntil: kind === "extension" ? addDays(today, 14) : null });
        break;
      }
    }
  }
  return { exceptions, conversations };
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function base64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function gmailSend(to: string, subject: string, body: string): Promise<string> {
  const token = await googleToken();
  const from = process.env.GMAIL_SENDER!;
  const mime = [`From: ${from}`, `To: ${to}`, `Subject: ${subject.replace(/[\r\n]/g, " ")}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n");
  const res = await call("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64url(mime) }),
  }, "Gmail send");
  return ((await res.json()) as { id: string }).id;
}

/** Replies received from these addresses since a date: subject and snippet only. */
export async function gmailReplies(addresses: string[], sinceIso: string): Promise<{ from: string; text: string; id: string }[]> {
  if (!addresses.length) return [];
  const token = await googleToken();
  const auth = { Authorization: `Bearer ${token}` };
  const q = encodeURIComponent(`(${addresses.map((a) => `from:${a}`).join(" OR ")}) after:${sinceIso.replace(/-/g, "/")}`);
  const list = (await (await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=25`, { headers: auth }, "Gmail search")).json()) as { messages?: { id: string }[] };
  const out: { from: string; text: string; id: string }[] = [];
  for (const m of list.messages ?? []) {
    const msg = (await (await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers: auth }, "Gmail message")).json()) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
    const from = /<([^>]+)>/.exec(msg.payload?.headers?.find((h) => h.name === "From")?.value ?? "")?.[1] ?? msg.payload?.headers?.find((h) => h.name === "From")?.value ?? "";
    out.push({ from: from.toLowerCase(), text: `${msg.payload?.headers?.find((h) => h.name === "Subject")?.value ?? ""} ${msg.snippet ?? ""}`, id: m.id });
  }
  return out;
}

// SMS (Twilio) -----------------------------------------------------------------------------------

function twilioAuth(): string {
  return `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

export async function smsSend(to: string, body: string): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await call(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: twilioAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body }),
  }, "Twilio");
  return ((await res.json()) as { sid: string }).sid;
}

/** Delivery status for a sent SMS: queued, sent, delivered, undelivered or failed. */
export async function smsStatus(messageSid: string): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await call(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages/${messageSid}.json`, { headers: { Authorization: twilioAuth() } }, "Twilio status");
  return ((await res.json()) as { status: string }).status;
}

/** Texts received on the business number since a date. */
export async function smsReplies(sinceIso: string): Promise<{ from: string; text: string; id: string }[]> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const q = new URLSearchParams({ To: process.env.TWILIO_FROM!, "DateSent>": sinceIso, PageSize: "50" });
  const res = await call(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?${q}`, { headers: { Authorization: twilioAuth() } }, "Twilio replies");
  const rows = ((await res.json()) as { messages?: { sid: string; from: string; body: string; direction: string }[] }).messages ?? [];
  return rows.filter((r) => r.direction === "inbound").map((r) => ({ from: normaliseAuMobile(r.from) ?? r.from, text: r.body, id: r.sid }));
}
