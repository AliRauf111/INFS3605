import "server-only";
import { randomUUID } from "node:crypto";
import { db, DbError, toDbError } from "@/lib/db/supabase";
import type { SessionUser } from "@/lib/auth/session";
import { sydneyToday } from "@/lib/workflows/dates";
import {
  DEFAULT_RULES,
  balanceOf,
  buildDrafts,
  classifyReply,
  daysOverdue,
  exceptionActive,
  impact,
  money,
  normaliseAuMobile,
  recoveredTotal,
  simulatedDelivery,
  studentBodyAllowed,
  assessFamilies,
  type Impact,
} from "./logic";
import { runScan, type ScanEvent, type ScanResult, type ScanSources } from "./scan";
import {
  gmailArrangements,
  gmailReplies,
  gmailSend,
  paymentsMode,
  providerStatus,
  smsReplies,
  smsSend,
  xeroInvoices,
  xeroPaymentsSince,
  type ProviderStatus,
} from "./providers";
import type {
  BillingException,
  Channel,
  Contact,
  FamilyAssessment,
  Invoice,
  LogLine,
  PaymentsMode,
  RecoveredPayment,
  RecoveryRules,
  SavedMessage,
  ScanStep,
  ScanSummary,
  Student,
} from "./types";

// Reads and changes the Payments records. Every function here runs on the server with the
// secret key. Demo mode only ever reads and writes rows labelled 'fictional_demo'; live
// mode only ever reads and writes the others, so the two never mix.

export const BUSINESS_NAME = "Tutor Compass";

function labels(mode: PaymentsMode): string[] {
  return mode === "demo" ? ["fictional_demo"] : ["live_connected", "imported"];
}
function label(mode: PaymentsMode): string {
  return mode === "demo" ? "fictional_demo" : "live_connected";
}

function check<T>(r: { data: T | null; error: { message?: string; code?: string } | null }): T {
  if (r.error) throw toDbError(r.error);
  return r.data as T;
}

/** True when the Payments tables haven't been added to this database yet. */
export function isMissingTable(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /billing_|recovery_|PGRST205|42P01|schema cache/i.test(m);
}

// Records -------------------------------------------------------------------------------------

type Records = { contacts: (Contact & { xeroId: string | null })[]; students: Student[]; invoices: Invoice[]; exceptions: BillingException[]; rules: RecoveryRules };

export async function readRecords(mode: PaymentsMode): Promise<Records> {
  const l = labels(mode);
  const [c, s, i, e, r] = await Promise.all([
    db().from("billing_contacts").select("*").in("data_label", l).order("id"),
    db().from("billing_students").select("*").in("data_label", l).order("id"),
    db().from("billing_invoices").select("*").in("data_label", l).order("due_date"),
    db().from("billing_exceptions").select("*").in("data_label", l).eq("active", true),
    db().from("recovery_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const settings = check(r) as Record<string, number> | null;
  return {
    contacts: (check(c) as Record<string, unknown>[]).map((x) => ({
      id: x.id as string, name: x.name as string, email: (x.email as string) ?? null, phone: (x.phone as string) ?? null,
      emailPermitted: Boolean(x.email_permitted), smsPermitted: Boolean(x.sms_permitted), xeroId: (x.xero_contact_id as string) ?? null,
    })),
    students: (check(s) as Record<string, unknown>[]).map((x) => ({
      id: x.id as string, name: x.name as string, yearLevel: (x.year_level as number) ?? null, contactId: x.billing_contact_id as string,
      enrolled: Boolean(x.enrolled), contactVerified: Boolean(x.student_contact_permitted && x.student_contact_verified_on),
      email: (x.student_email as string) ?? null, phone: (x.student_phone as string) ?? null,
    })),
    invoices: (check(i) as Record<string, unknown>[]).map((x) => ({
      id: x.id as string, studentId: (x.student_id as string) ?? null, contactId: x.contact_id as string, description: (x.description as string) ?? "",
      amountCents: x.amount_cents as number, paidCents: x.amount_paid_cents as number, issuedOn: x.issued_on as string, dueDate: x.due_date as string,
      status: x.status as Invoice["status"],
    })),
    exceptions: (check(e) as Record<string, unknown>[]).map((x) => ({
      contactId: x.contact_id as string, kind: x.kind as BillingException["kind"], source: x.source as BillingException["source"],
      summary: x.summary as string, activeUntil: (x.active_until as string) ?? null,
    })),
    rules: settings ? {
      minDaysOverdue: settings.min_days_overdue, minBalanceCents: settings.min_balance_cents, escalateAfterDays: settings.escalate_after_days,
      maxReminders: settings.max_reminders, manualMinutesPerFamily: settings.manual_minutes_per_family,
      manualMinutesPerInvoice: settings.manual_minutes_per_invoice, adminHourlyRateCents: settings.admin_hourly_rate_cents,
    } : DEFAULT_RULES,
  };
}

async function event(mode: PaymentsMode | "system", kind: string, detail: string, extra: { run?: string; batch?: string; contact?: string; invoice?: string; actor?: string; demo?: boolean } = {}) {
  await db().from("recovery_events").insert({
    kind, detail: detail.slice(0, 1000), mode,
    run_id: extra.run ?? null, batch_id: extra.batch ?? null, contact_id: extra.contact ?? null, invoice_id: extra.invoice ?? null, actor_id: extra.actor ?? null,
    data_label: extra.demo === false ? "live_connected" : mode === "live" ? "live_connected" : "fictional_demo",
  });
}

// Page data -------------------------------------------------------------------------------------

export type RunView = { id: string; status: ScanResult["status"] | "running"; steps: ScanStep[]; summary: ScanSummary | null; assessments: FamilyAssessment[]; log: LogLine[]; createdAt: string };
export type BatchView = { id: string; runId: string; status: "draft" | "sent" | "cancelled"; version: number; contactIds: string[]; excluded: { contactId: string; name: string; channel: Channel; reason: string }[]; approvedAt: string | null; messages: SavedMessage[] };
export type EventView = { id: string; kind: string; detail: string; mode: string; createdAt: string };
export type TaskView = { id: string; contactId: string; contactName: string; kind: string; summary: string; status: string; needsOwner: boolean; createdAt: string };

export type PaymentsData = {
  mode: PaymentsMode;
  providers: ProviderStatus;
  today: string;
  records: Records;
  protectedIds: string[];
  kpis: { students: number; eligibleFamilies: number; recoveredCents: number };
  totals: { outstandingCents: number; overdueCents: number; protectedCents: number; paidThisTermCents: number; overdueInvoices: number };
  run: RunView | null;
  batch: BatchView | null;
  sentMessages: SavedMessage[];
  events: EventView[];
  tasks: TaskView[];
  payments: RecoveredPayment[];
  impact: Impact;
};

function toMessage(x: Record<string, unknown>): SavedMessage {
  return {
    id: x.id as string, contactId: x.contact_id as string, studentId: (x.student_id as string) ?? null, recipientKind: x.recipient_kind as SavedMessage["recipientKind"],
    recipientName: x.recipient_name as string, channel: x.channel as Channel, address: x.address as string, subject: (x.subject as string) ?? null, body: x.body as string,
    invoiceIds: (x.invoice_ids as string[]) ?? [], amountCents: (x.amount_cents as number) ?? 0, included: Boolean(x.included), edited: Boolean(x.edited),
    status: x.status as SavedMessage["status"], statusReason: (x.status_reason as string) ?? null, sentAt: (x.sent_at as string) ?? null,
  };
}

function toRun(x: Record<string, unknown>): RunView {
  return { id: x.id as string, status: x.status as RunView["status"], steps: x.steps as ScanStep[], summary: (x.summary && Object.keys(x.summary as object).length ? x.summary : null) as ScanSummary | null, assessments: x.assessments as FamilyAssessment[], log: x.log as LogLine[], createdAt: x.created_at as string };
}

export async function readPaymentsData(now = new Date()): Promise<PaymentsData> {
  const mode = paymentsMode();
  const l = labels(mode);
  const today = sydneyToday(now);
  const records = await readRecords(mode);
  const [runR, batchR, sentR, eventsR, tasksR, payR] = await Promise.all([
    db().from("recovery_runs").select("*").in("data_label", l).order("created_at", { ascending: false }).limit(1),
    db().from("recovery_batches").select("*").in("data_label", l).order("created_at", { ascending: false }).limit(1),
    db().from("recovery_messages").select("*").in("data_label", l).in("status", ["simulated", "queued", "sent", "delivered", "failed", "blocked", "excluded"]).order("updated_at", { ascending: false }).limit(200),
    db().from("recovery_events").select("id, kind, detail, mode, created_at").in("data_label", l).order("created_at", { ascending: false }).limit(60),
    db().from("recovery_tasks").select("*").in("data_label", l).order("created_at", { ascending: false }).limit(50),
    db().from("recovered_payments").select("*").in("data_label", l).order("verified_at", { ascending: false }),
  ]);
  const runRow = (check(runR) as Record<string, unknown>[])[0];
  const batchRow = (check(batchR) as Record<string, unknown>[])[0];
  let batch: BatchView | null = null;
  if (batchRow) {
    const msgs = check(await db().from("recovery_messages").select("*").eq("batch_id", batchRow.id as string).order("recipient_kind").order("contact_id").order("channel")) as Record<string, unknown>[];
    batch = {
      id: batchRow.id as string, runId: batchRow.run_id as string, status: batchRow.status as BatchView["status"], version: batchRow.version as number,
      contactIds: batchRow.contact_ids as string[], excluded: (batchRow.excluded as BatchView["excluded"]) ?? [], approvedAt: (batchRow.approved_at as string) ?? null,
      messages: msgs.map(toMessage),
    };
  }
  const names = new Map(records.contacts.map((c) => [c.id, c.name]));
  const tasks: TaskView[] = (check(tasksR) as Record<string, unknown>[]).map((x) => ({
    id: x.id as string, contactId: x.contact_id as string, contactName: names.get(x.contact_id as string) ?? (x.contact_id as string), kind: x.kind as string,
    summary: x.summary as string, status: x.status as string, needsOwner: Boolean(x.needs_owner), createdAt: x.created_at as string,
  }));
  const payments: RecoveredPayment[] = (check(payR) as Record<string, unknown>[]).map((x) => ({
    invoiceId: x.invoice_id as string, contactId: x.contact_id as string, paymentRef: x.payment_ref as string, amountCents: x.amount_cents as number,
    attributed: Boolean(x.attributed), source: x.source as RecoveredPayment["source"], verifiedAt: x.verified_at as string,
  }));
  const sentMessages = (check(sentR) as Record<string, unknown>[]).map(toMessage);

  const protectedIds = [...new Set(records.exceptions.filter((e) => exceptionActive(e, today)).map((e) => e.contactId))];
  const prot = new Set(protectedIds);
  const assessments = assessFamilies({ ...records, today, gmailChecked: true });
  const open = records.invoices.filter((i) => balanceOf(i) > 0);
  const overdue = open.filter((i) => daysOverdue(i, today) > 0);
  const contacted = new Set(sentMessages.filter((m) => ["simulated", "sent", "delivered"].includes(m.status)).map((m) => m.contactId));
  const run = runRow ? toRun(runRow) : null;

  return {
    mode, providers: providerStatus(), today, records, protectedIds,
    kpis: {
      students: records.students.filter((s) => s.enrolled).length,
      eligibleFamilies: assessments.filter((a) => a.state === "eligible").length,
      recoveredCents: recoveredTotal(payments),
    },
    totals: {
      outstandingCents: open.reduce((s, i) => s + balanceOf(i), 0),
      overdueCents: overdue.reduce((s, i) => s + balanceOf(i), 0),
      protectedCents: overdue.filter((i) => prot.has(i.contactId)).reduce((s, i) => s + balanceOf(i), 0),
      paidThisTermCents: records.invoices.reduce((s, i) => s + i.paidCents, 0),
      overdueInvoices: overdue.length,
    },
    run, batch, sentMessages,
    events: (check(eventsR) as Record<string, unknown>[]).map((x) => ({ id: x.id as string, kind: x.kind as string, detail: x.detail as string, mode: x.mode as string, createdAt: x.created_at as string })),
    tasks, payments,
    impact: impact({
      invoicesReviewed: run?.summary?.invoicesChecked ?? 0,
      messages: sentMessages,
      payments,
      stillOutstandingCents: records.invoices.filter((i) => contacted.has(i.contactId)).reduce((s, i) => s + balanceOf(i), 0),
      ownerApprovalsWaiting: (batch?.status === "draft" ? 1 : 0) + tasks.filter((t) => t.status === "open" && t.needsOwner).length,
      exceptions: sentMessages.filter((m) => m.status === "failed" || m.status === "blocked").length + tasks.filter((t) => t.status === "open").length,
      rules: records.rules,
    }),
  };
}

// The scan ----------------------------------------------------------------------------------------

function sources(mode: PaymentsMode, records: Records, today: string): ScanSources {
  if (mode === "demo") {
    return {
      accounting: async () => ({ contacts: records.contacts, invoices: records.invoices, source: "Xero (fictional demo records)" }),
      students: async () => records.students,
      exceptions: async (contacts) => {
        const ids = new Set(contacts.map((c) => c.id));
        const found = records.exceptions.filter((e) => ids.has(e.contactId) && exceptionActive(e, today));
        return { exceptions: found, source: "Gmail (fictional demo inbox)", conversations: contacts.length + found.length };
      },
      rules: async () => records.rules,
    };
  }
  return {
    accounting: async () => {
      const r = await xeroInvoices({ contacts: records.contacts, students: records.students });
      // Keep a copy, so the Invoices tab and the database checks see what Xero holds.
      for (const c of r.contacts.filter((c) => !records.contacts.some((k) => k.id === c.id))) {
        await db().from("billing_contacts").upsert({ id: c.id, name: c.name, email: c.email, phone: c.phone, email_permitted: false, sms_permitted: false, data_label: "live_connected" });
      }
      for (const i of r.invoices) {
        await db().from("billing_invoices").upsert({
          id: i.id, student_id: i.studentId, contact_id: i.contactId, description: i.description, amount_cents: i.amountCents, amount_paid_cents: i.paidCents,
          issued_on: i.issuedOn, due_date: i.dueDate, status: i.status, data_label: "live_connected", updated_at: new Date().toISOString(),
        });
      }
      return { contacts: r.contacts, invoices: r.invoices, source: "Xero" };
    },
    students: async () => records.students,
    exceptions: async (contacts) => {
      const r = await gmailArrangements(contacts, today);
      // Owner-recorded and earlier arrangements still count.
      const kept = records.exceptions.filter((e) => exceptionActive(e, today));
      for (const e of r.exceptions) {
        await db().from("billing_exceptions").insert({ contact_id: e.contactId, kind: e.kind, source: "gmail", summary: e.summary, active_until: e.activeUntil, data_label: "live_connected" });
      }
      return { exceptions: [...kept, ...r.exceptions], source: "Gmail", conversations: r.conversations };
    },
    rules: async () => records.rules,
  };
}

export async function startScan(user: SessionUser, emit: (e: ScanEvent) => void, now = new Date()): Promise<{ runId: string; result: ScanResult }> {
  const mode = paymentsMode();
  const today = sydneyToday(now);
  const records = await readRecords(mode);
  const run = check(await db().from("recovery_runs").insert({ started_by: user.id, mode, data_label: label(mode) }).select("id").single()) as { id: string };
  await event(mode, "scan_started", `${user.displayName} started a full accounting scan${mode === "demo" ? " (demo mode, fictional records)" : ""}.`, { run: run.id, actor: user.id });
  const pause = mode === "demo" ? () => new Promise<void>((r) => setTimeout(r, 450)) : async () => {};
  let result: ScanResult;
  try {
    result = await runScan(sources(mode, records, today), today, emit, pause);
  } catch (e) {
    await db().from("recovery_runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", run.id);
    throw e;
  }
  check(await db().from("recovery_runs").update({
    status: result.status, steps: result.steps, summary: result.summary ?? {}, assessments: result.assessments, log: result.log, finished_at: new Date().toISOString(),
  }).eq("id", run.id));
  const s = result.summary;
  await event(mode, `scan_${result.status}`, s
    ? `Scan ${result.status === "partial" ? "finished with a failed check" : "finished"}: ${s.accountsChecked} accounts, ${s.overdueInvoices} overdue invoices, ${s.eligibleFamilies} eligible families (${money(s.eligibleCents)}), ${s.protectedFamilies} protected.`
    : "Scan stopped because a check failed. No family was marked eligible.", { run: run.id });
  return { runId: run.id, result };
}

// Drafts -------------------------------------------------------------------------------------------

export async function createBatch(user: SessionUser, input: { runId: string; contactIds: string[]; channels: { email: boolean; sms: boolean }; includeStudents: boolean }): Promise<string> {
  const mode = paymentsMode();
  const runRow = check(await db().from("recovery_runs").select("*").eq("id", input.runId).in("data_label", labels(mode)).maybeSingle()) as Record<string, unknown> | null;
  if (!runRow) throw new DbError("That scan no longer exists. Run the scan again.", "not_found");
  const run = toRun(runRow);
  if (Date.now() - Date.parse(run.createdAt) > 86_400_000) throw new DbError("That scan is more than a day old. Run the scan again.", "stale_update");
  if (!input.channels.email && !input.channels.sms) throw new DbError("Choose email, SMS or both.", "invalid_input");
  const chosen = run.assessments.filter((a) => input.contactIds.includes(a.contactId));
  const notEligible = chosen.filter((a) => a.state !== "eligible");
  if (notEligible.length) throw new DbError(`${notEligible.map((a) => a.contactName).join(", ")} can't be included: ${notEligible[0].reason.toLowerCase()}.`, "invalid_input");
  if (!chosen.length) throw new DbError("Choose at least one eligible family.", "invalid_input");

  const records = await readRecords(mode);
  // One reminder per family per batch, whichever channels it used.
  const batchesPerContact: Record<string, number> = {};
  const priorBatches = check(await db().from("recovery_messages").select("contact_id, batch_id").in("contact_id", input.contactIds).in("status", ["simulated", "sent", "delivered"]).in("data_label", labels(mode))) as { contact_id: string; batch_id: string }[];
  for (const c of input.contactIds) batchesPerContact[c] = new Set(priorBatches.filter((p) => p.contact_id === c).map((p) => p.batch_id)).size;

  const { messages, skipped } = buildDrafts(chosen, records.contacts, records.students, {
    channels: input.channels, includeStudents: input.includeStudents, businessName: BUSINESS_NAME, priorReminders: batchesPerContact, maxReminders: records.rules.maxReminders,
  });
  const skippedFamilies = run.assessments.filter((a) => a.state === "eligible" && !input.contactIds.includes(a.contactId)).map((a) => ({ contactId: a.contactId, name: a.contactName, channel: "email" as Channel, reason: "Left out by you" }));
  const protectedOnes = run.assessments.filter((a) => a.state !== "eligible").map((a) => ({ contactId: a.contactId, name: a.contactName, channel: "email" as Channel, reason: a.reason }));

  // Only one draft at a time: an older draft is cancelled.
  await db().from("recovery_batches").update({ status: "cancelled" }).eq("status", "draft").in("data_label", labels(mode));
  const batchId = randomUUID();
  check(await db().from("recovery_batches").insert({
    id: batchId, run_id: run.id, mode, contact_ids: input.contactIds, excluded: [...skipped, ...skippedFamilies, ...protectedOnes], created_by: user.id, data_label: label(mode),
  }));
  if (messages.length) {
    check(await db().from("recovery_messages").insert(messages.map((m) => ({
      batch_id: batchId, contact_id: m.contactId, student_id: m.studentId, recipient_kind: m.recipientKind, recipient_name: m.recipientName, channel: m.channel,
      address: m.address, subject: m.subject, body: m.body, invoice_ids: m.invoiceIds, amount_cents: m.amountCents, data_label: label(mode),
    }))));
  }
  await event(mode, "drafts_prepared", `Compass prepared ${messages.length} personalised message(s) for ${chosen.length} famil${chosen.length === 1 ? "y" : "ies"}. ${skipped.length} left out (duplicate address, no permission or no contact detail).`, { run: run.id, batch: batchId, actor: user.id });
  return batchId;
}

export async function updateMessage(user: SessionUser, id: string, patch: { body?: string; subject?: string | null; included?: boolean }): Promise<{ version: number }> {
  const mode = paymentsMode();
  const row = check(await db().from("recovery_messages").select("*, recovery_batches!inner(status, version)").eq("id", id).in("data_label", labels(mode)).maybeSingle()) as (Record<string, unknown> & { recovery_batches: { status: string; version: number } }) | null;
  if (!row) throw new DbError("That message no longer exists.", "not_found");
  if (row.recovery_batches.status !== "draft") throw new DbError("This batch has already been approved, so its messages can't change.", "invalid_transition");
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.body !== undefined) {
    const body = patch.body.trim();
    if (!body) throw new DbError("A message can't be empty.", "invalid_input");
    if (row.recipient_kind === "student" && !studentBodyAllowed(body)) throw new DbError("Messages to students can't mention amounts, invoices or balances.", "invalid_input");
    if (row.channel === "sms" && body.length > 480) throw new DbError("Keep SMS messages under 480 characters.", "invalid_input");
    update.body = body;
    update.edited = true;
  }
  if (patch.subject !== undefined && row.channel === "email") update.subject = (patch.subject ?? "").trim().slice(0, 200) || null;
  if (patch.included !== undefined) update.included = patch.included;
  check(await db().from("recovery_messages").update(update).eq("id", id));
  const version = row.recovery_batches.version + 1;
  check(await db().from("recovery_batches").update({ version }).eq("id", row.batch_id as string).eq("version", row.recovery_batches.version));
  if (patch.body !== undefined) await event(mode, "draft_edited", `${user.displayName} edited the ${row.channel === "sms" ? "SMS" : "email"} to ${row.recipient_name}.`, { batch: row.batch_id as string, contact: row.contact_id as string, actor: user.id });
  return { version };
}

// Approval and sending --------------------------------------------------------------------------------

export async function approveBatch(user: SessionUser, batchId: string, version: number, simulated: boolean): Promise<{ sent: number; simulated: number; failed: number; held: number }> {
  const mode = paymentsMode();
  if (simulated !== (mode === "demo")) throw new DbError(mode === "demo" ? "Live sending isn't set up, so this batch can only be simulated." : "Live sending is set up, so this batch will really be sent.", "invalid_input");
  const r = await db().rpc("approve_recovery_batch", { p_batch: batchId, p_actor: user.id, p_version: version, p_simulated: simulated });
  if (r.error) throw toDbError(r.error);
  const result = r.data as { go: { id: string }[]; held: { id: string; contact: string; reason: string }[] };
  const ids = result.go.map((g) => g.id);
  const rows = ids.length ? (check(await db().from("recovery_messages").select("*").in("id", ids)) as Record<string, unknown>[]).map(toMessage) : [];
  let sent = 0, sim = 0, failed = 0;
  for (const m of rows) {
    if (simulated) {
      const d = simulatedDelivery(m);
      if (d.status === "failed") {
        failed++;
        await db().from("recovery_messages").update({ status: "failed", status_reason: `${d.reason}. Simulated check, nothing sent`, updated_at: new Date().toISOString() }).eq("id", m.id);
        await db().from("recovery_tasks").upsert({ contact_id: m.contactId, kind: "delivery_failed", summary: `${m.channel === "sms" ? "SMS" : "Email"} to ${m.recipientName} would fail: ${d.reason}. Check the contact details.`, source_ref: m.id, data_label: "fictional_demo" }, { onConflict: "contact_id,kind,source_ref" });
        await event("demo", "delivery_failed", `${m.channel === "sms" ? "SMS" : "Email"} to ${m.recipientName} failed the delivery check: ${d.reason}.`, { batch: batchId, contact: m.contactId });
      } else {
        sim++;
      }
      continue;
    }
    try {
      const ref = m.channel === "email" ? await gmailSend(m.address, m.subject ?? "A note from Tutor Compass", m.body) : await smsSend(m.address, m.body);
      sent++;
      await db().from("recovery_messages").update({ status: "sent", provider_ref: ref, sent_at: new Date().toISOString(), status_reason: null, updated_at: new Date().toISOString() }).eq("id", m.id);
    } catch (e) {
      failed++;
      const reason = e instanceof Error ? e.message : "Provider error";
      await db().from("recovery_messages").update({ status: "failed", status_reason: reason.slice(0, 200), updated_at: new Date().toISOString() }).eq("id", m.id);
      await db().from("recovery_tasks").upsert({ contact_id: m.contactId, kind: "delivery_failed", summary: `${m.channel === "sms" ? "SMS" : "Email"} to ${m.recipientName} failed: ${reason}`, source_ref: m.id, data_label: "live_connected" }, { onConflict: "contact_id,kind,source_ref" });
    }
  }
  await event(mode, simulated ? "messages_simulated" : "messages_sent", simulated
    ? `${sim} message(s) simulated in demo mode. Nothing was sent to anyone. ${failed} failed the delivery check.`
    : `${sent} message(s) sent through Gmail and SMS. ${failed} failed.`, { batch: batchId, actor: user.id });
  return { sent, simulated: sim, failed, held: result.held.length };
}

// Monitoring ------------------------------------------------------------------------------------------

/** Fictional replies used in demo mode, so the monitoring step has something to find. */
const DEMO_REPLIES: { contactId: string; channel: Channel; text: string }[] = [
  { contactId: "BC-03", channel: "sms", text: "Thanks for the reminder! I'll pay Chloe's invoice on Friday when I get paid." },
  { contactId: "BC-02", channel: "email", text: "Hi, sorry about that. Quick question: does the invoice include the lesson Liam missed when he was sick?" },
];

export async function monitor(user: SessionUser, now = new Date()): Promise<{ replies: number; tasks: number; payments: number; escalations: number }> {
  const mode = paymentsMode();
  const today = sydneyToday(now);
  const records = await readRecords(mode);
  const reached = (check(await db().from("recovery_messages").select("*").in("status", ["simulated", "sent", "delivered"]).eq("recipient_kind", "parent").in("data_label", labels(mode))) as Record<string, unknown>[]).map(toMessage);
  if (!reached.length) throw new DbError("No reminders have gone out yet, so there's nothing to monitor.", "invalid_transition");
  const contacted = new Set(reached.map((m) => m.contactId));
  const firstSent = reached.map((m) => m.sentAt ?? now.toISOString()).sort()[0].slice(0, 10);
  let replies: { contactId: string; channel: Channel; text: string; ref: string }[] = [];
  let paymentsFound = 0;

  if (mode === "demo") {
    replies = DEMO_REPLIES.filter((r) => contacted.has(r.contactId)).map((r) => ({ ...r, ref: `demo-reply-${r.contactId}` }));
  } else {
    const p = providerStatus();
    const byEmail = new Map(records.contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.id]));
    const byPhone = new Map(records.contacts.filter((c) => c.phone).map((c) => [normaliseAuMobile(c.phone) ?? c.phone!, c.id]));
    const mail = await gmailReplies([...contacted].map((id) => records.contacts.find((c) => c.id === id)?.email).filter(Boolean) as string[], firstSent);
    replies.push(...mail.filter((m) => byEmail.has(m.from)).map((m) => ({ contactId: byEmail.get(m.from)!, channel: "email" as Channel, text: m.text, ref: m.id })));
    if (p.sms) {
      const texts = await smsReplies(firstSent);
      replies.push(...texts.filter((t) => byPhone.has(t.from)).map((t) => ({ contactId: byPhone.get(t.from)!, channel: "sms" as Channel, text: t.text, ref: t.id })));
    }
    const pays = await xeroPaymentsSince(firstSent);
    for (const pay of pays) {
      const id = pay.invoiceNumber.startsWith("INV-") ? pay.invoiceNumber : `INV-${pay.invoiceNumber}`;
      if (!records.invoices.some((i) => i.id === id)) continue;
      const r = await db().rpc("record_recovered_payment", { p_invoice: id, p_amount_cents: pay.amountCents, p_payment_ref: `XERO-${pay.paymentId}`, p_source: "xero", p_paid_at: `${pay.date}T00:00:00Z`, p_actor: user.id });
      if (!r.error && !(r.data as { duplicate: boolean }).duplicate) paymentsFound++;
    }
  }

  let tasks = 0;
  const names = new Map(records.contacts.map((c) => [c.id, c.name]));
  for (const r of replies) {
    const kind = classifyReply(r.text);
    const name = names.get(r.contactId) ?? r.contactId;
    const summary =
      kind === "promise" ? `${name} replied by ${r.channel === "sms" ? "SMS" : "email"} promising to pay: "${r.text}" Reminders paused until then.`
      : kind === "paid" ? `${name} says they have paid: "${r.text}" Check Xero to confirm.`
      : kind === "extension" ? `${name} asked for more time: "${r.text}" Needs an owner decision.`
      : kind === "dispute" ? `${name} questioned the invoice: "${r.text}" Needs an owner decision.`
      : kind === "opt_out" ? `${name} opted out of SMS. SMS turned off for this contact.`
      : `${name} replied: "${r.text}" Reply needed.`;
    const needsOwner = kind === "extension" || kind === "dispute" || kind === "other";
    const ins = await db().from("recovery_tasks").upsert({
      contact_id: r.contactId, kind: kind === "promise" ? "promise_to_pay" : "reply_follow_up", summary: summary.slice(0, 500), needs_owner: needsOwner, source_ref: r.ref, data_label: label(mode),
    }, { onConflict: "contact_id,kind,source_ref", ignoreDuplicates: true }).select("id");
    if ((ins.data ?? []).length) {
      tasks++;
      await event(mode, "reply_detected", `${mode === "demo" ? "Demo reply (fictional): " : ""}${summary}`, { contact: r.contactId });
    }
    if (kind === "opt_out") await db().from("billing_contacts").update({ sms_permitted: false }).eq("id", r.contactId);
    if (kind === "dispute" || kind === "extension") {
      await db().from("billing_exceptions").insert({ contact_id: r.contactId, kind, source: r.channel === "sms" ? "sms" : "gmail", summary: `Reply: ${r.text}`.slice(0, 500), data_label: label(mode) });
    }
  }

  // Escalate families still owing well past the owner's limit with no reply.
  let escalations = 0;
  const replied = new Set(replies.map((r) => r.contactId));
  for (const cid of contacted) {
    const owing = records.invoices.filter((i) => i.contactId === cid && balanceOf(i) > 0);
    const oldest = Math.max(0, ...owing.map((i) => daysOverdue(i, today)));
    if (!owing.length || replied.has(cid) || oldest < records.rules.escalateAfterDays) continue;
    const ins = await db().from("recovery_tasks").upsert({
      contact_id: cid, kind: "escalation", needs_owner: true, source_ref: `escalate-${today}`, data_label: label(mode),
      summary: `${names.get(cid)} is ${oldest} days overdue (${money(owing.reduce((s, i) => s + balanceOf(i), 0))}) with no reply. Your rule escalates after ${records.rules.escalateAfterDays} days: decide whether to call, offer a plan or pause lessons.`,
    }, { onConflict: "contact_id,kind,source_ref", ignoreDuplicates: true }).select("id");
    if ((ins.data ?? []).length) {
      escalations++;
      await event(mode, "escalated", `${names.get(cid)} escalated to the owner: ${oldest} days overdue with no reply.`, { contact: cid });
    }
  }
  await event(mode, "monitoring_checked", `${user.displayName} checked for replies and payments${mode === "demo" ? " (demo mode: fictional replies, Xero not contacted)" : ""}. ${replies.length} repl${replies.length === 1 ? "y" : "ies"}, ${paymentsFound} new payment(s), ${escalations} escalation(s).`, { actor: user.id });
  return { replies: replies.length, tasks, payments: paymentsFound, escalations };
}

/** Demo mode only: record a payment as if Xero had confirmed it. Real accounting data is never touched. */
export async function simulatePayment(user: SessionUser, invoiceId: string, amountCents: number): Promise<{ counted: boolean; fullyPaid: boolean }> {
  if (paymentsMode() !== "demo") throw new DbError("Simulated payments are only available in demo mode.", "forbidden");
  const r = await db().rpc("record_recovered_payment", {
    p_invoice: invoiceId, p_amount_cents: amountCents, p_payment_ref: `DEMO-${invoiceId}-${randomUUID().slice(0, 8)}`, p_source: "demo_simulated", p_paid_at: new Date().toISOString(), p_actor: user.id,
  });
  if (r.error) throw toDbError(r.error);
  const d = r.data as { counted: boolean; fullyPaid: boolean };
  return { counted: d.counted, fullyPaid: d.fullyPaid };
}

export async function completeTask(user: SessionUser, id: string): Promise<void> {
  const mode = paymentsMode();
  const row = check(await db().from("recovery_tasks").select("id, contact_id, summary").eq("id", id).in("data_label", labels(mode)).maybeSingle()) as { id: string; contact_id: string; summary: string } | null;
  if (!row) throw new DbError("That task no longer exists.", "not_found");
  check(await db().from("recovery_tasks").update({ status: "done" }).eq("id", id));
  await event(mode, "task_done", `${user.displayName} marked a follow-up as done.`, { contact: row.contact_id, actor: user.id });
}
