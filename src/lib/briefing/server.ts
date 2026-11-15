import "server-only";
import { db, toDbError } from "@/lib/db/supabase";
import type { SessionUser } from "@/lib/auth/session";
import { addDays, sydneyToday } from "@/lib/workflows/dates";
import { enT } from "@/lib/i18n/core";
import { makeFormat } from "@/lib/i18n/format";
import { isMissingTable, readRecords as readPaymentRecords } from "@/lib/payments/server";
import { gmailSendHtml, providerStatus } from "@/lib/payments/providers";
import { readRecords as readRetentionRecords, retentionMode } from "@/lib/retention/server";
import { assessAll } from "@/lib/retention/logic";
import { briefingEmail, type BriefingEmail } from "./email";
import {
  buildBriefing,
  dueSlot,
  nextSlot,
  normaliseSections,
  normaliseThresholds,
  reportingPeriods,
  sydneyInstant,
  validTime,
  viewFor,
  type BuildInput,
  type PaymentRecords,
} from "./logic";
import {
  DEFAULT_SETTINGS,
  type Briefing,
  type BriefingMode,
  type BriefingSettings,
  type BriefingView,
  type CommIn,
  type Delivery,
  type Headline,
  type HistoryItem,
  type Source,
  type Warning,
} from "./types";

// Reads the records for the Weekly Owner Briefing, saves each briefing and sends the email.
// Everything runs on the server with the secret key. Demo mode reads and writes only rows
// labelled 'fictional_demo'; live mode only the others, so demo and real data never mix.
// Figures are worked out by the pure functions in logic.ts; nothing here makes one up.

export const BUSINESS_NAME = process.env.BUSINESS_NAME?.trim() || "Tutor Compass";

/** Demo unless the deployment sets BRIEFING_MODE=live. */
export function briefingMode(env: NodeJS.ProcessEnv = process.env): BriefingMode {
  return /^live$/i.test((env.BRIEFING_MODE ?? "").trim()) ? "live" : "demo";
}

const labels = (mode: BriefingMode) => (mode === "demo" ? ["fictional_demo"] : ["live_connected", "imported"]);
const label = (mode: BriefingMode) => (mode === "demo" ? "fictional_demo" : "live_connected");

function check<T>(r: { data: T | null; error: { message?: string; code?: string } | null }): T {
  if (r.error) throw toDbError(r.error);
  return r.data as T;
}
/** Rows from an optional table: an older database without it reads as no rows. */
function rowsOr(r: { data: unknown; error: { message?: string; code?: string } | null }): Record<string, unknown>[] {
  return r.error ? [] : ((r.data as Record<string, unknown>[]) ?? []);
}

/** True when the briefing tables haven't been added to this database yet. */
export function isMissingBriefing(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /briefing_|owner_briefings|PGRST205|PGRST202|42P01|42883|schema cache/i.test(m);
}

/** The address the email links back to. */
export function appUrl(env: NodeJS.ProcessEnv = process.env): string {
  const given = env.APP_URL?.trim() || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "") || "https://tutorcompass.app";
  return given.replace(/\/+$/, "");
}

async function event(mode: BriefingMode, kind: string, detail: string, extra: { actor?: string | null; briefing?: string | null } = {}) {
  await db().from("briefing_events").insert({ kind, detail: detail.slice(0, 1000), actor_id: extra.actor ?? null, briefing_id: extra.briefing ?? null, data_label: label(mode) });
}

// Settings ---------------------------------------------------------------------------------------

export async function readSettings(mode: BriefingMode): Promise<BriefingSettings> {
  const r = await db().from("briefing_settings").select("*").eq("id", label(mode)).maybeSingle();
  const x = check(r) as Record<string, unknown> | null;
  if (!x) return DEFAULT_SETTINGS;
  return {
    enabled: Boolean(x.enabled),
    sendDay: Number(x.send_day) || 1,
    sendTime: String(x.send_time ?? "08:00").slice(0, 5),
    sections: normaliseSections(x.sections),
    recipientId: (x.recipient_id as string) ?? null,
    adminFinance: Boolean(x.admin_finance),
    thresholds: normaliseThresholds(x.thresholds),
    updatedAt: (x.updated_at as string) ?? null,
  };
}

export type Recipient = { id: string; name: string; email: string };

/** Owner accounts with a confirmed email address: the only people a briefing can go to. */
export async function ownerRecipients(): Promise<Recipient[]> {
  const owners = check(await db().from("app_users").select("id, display_name").eq("role", "owner").order("created_at")) as { id: string; display_name: string }[];
  const out: Recipient[] = [];
  for (const o of owners.slice(0, 10)) {
    const { data, error } = await db().auth.admin.getUserById(o.id);
    const u = data?.user;
    if (error || !u?.email || !u.email_confirmed_at) continue;
    out.push({ id: o.id, name: o.display_name, email: u.email });
  }
  return out;
}

export async function saveSettings(user: SessionUser, s: BriefingSettings): Promise<BriefingSettings> {
  if (user.role !== "owner") throw toDbError({ message: "forbidden: only the owner can change the briefing settings" });
  if (!validTime(s.sendTime) || s.sendDay < 1 || s.sendDay > 7) throw toDbError({ message: "invalid_input: choose a day and a time" });
  const mode = briefingMode();
  if (s.recipientId && !(await ownerRecipients()).some((r) => r.id === s.recipientId)) {
    throw toDbError({ message: "invalid_input: the briefing can only go to an owner with a confirmed email address" });
  }
  const row = {
    id: label(mode), enabled: s.enabled, send_day: s.sendDay, send_time: s.sendTime, sections: normaliseSections(s.sections),
    recipient_id: s.recipientId, admin_finance: s.adminFinance, thresholds: normaliseThresholds(s.thresholds), updated_by: user.id, updated_at: new Date().toISOString(),
  };
  check(await db().from("briefing_settings").upsert(row));
  await event(mode, "settings_saved", `${user.displayName} changed the briefing settings. Scheduled email ${s.enabled ? "on" : "off"}.`, { actor: user.id });
  return readSettings(mode);
}

// Reading the records -----------------------------------------------------------------------------

async function previousSnapshot(mode: BriefingMode, key: string) {
  const r = await db().from("owner_briefings").select("id, period_key, generated_at, headline").in("data_label", labels(mode))
    .gte("period_key", addDays(key, -9)).lte("period_key", addDays(key, -5)).order("period_key", { ascending: false }).limit(1);
  const x = (check(r) as Record<string, unknown>[])[0];
  return x ? { id: x.id as string, periodKey: x.period_key as string, generatedAt: x.generated_at as string, headline: x.headline as Headline } : null;
}

function toComm(x: Record<string, unknown>): CommIn {
  return {
    id: x.id as string, channel: x.channel as CommIn["channel"], direction: x.direction as CommIn["direction"], senderKind: x.sender_kind as CommIn["senderKind"],
    contactName: x.contact_name as string, studentName: (x.student_name as string) ?? null, category: x.category as CommIn["category"], subject: x.subject as string,
    receivedAt: x.received_at as string, status: x.status as CommIn["status"], answeredAt: (x.answered_at as string) ?? null,
    deliveryStatus: (x.delivery_status as CommIn["deliveryStatus"]) ?? null, requestId: (x.request_id as string) ?? null,
  };
}

export async function readInput(mode: BriefingMode, thresholds: BriefingSettings["thresholds"], now: Date): Promise<BuildInput> {
  const { previous, key } = reportingPeriods(now);
  const since = previous.start;
  const today = sydneyToday(now);
  const l = labels(mode);
  const sources: Source[] = [];
  const warnings: Warning[] = [];
  const horizon = new Date(now.getTime() + 15 * 86_400_000).toISOString();

  const [reqR, evR, firstEvR, lesR, firstLesR, absR, wfR, propR, actR, draftR, commR, snap] = await Promise.all([
    db().from("requests").select("id, request_type, status, reference_id, created_at, welfare_status").order("created_at", { ascending: false }).limit(500),
    db().from("request_events").select("request_id, event_type, actor_role, created_at").gte("created_at", since).limit(2000),
    db().from("request_events").select("created_at").order("created_at").limit(1),
    db().from("lessons").select("id, tutor_id, starts_at, status, bookings(subject, families(student_name)), tutors(name)").gte("starts_at", since).lt("starts_at", horizon).order("starts_at").limit(2000),
    db().from("lessons").select("starts_at").order("starts_at").limit(1),
    db().from("tutor_absences").select("tutor_id, starts_on, ends_on, tutors(name)").eq("status", "recorded").gte("ends_on", addDays(today, -13)),
    db().from("agent_workflows").select("id, workflow, status, updated_at").or(`status.in.(active,waiting),updated_at.gte.${since}`).limit(500),
    db().from("agent_proposals").select("action_type, status, confirmed_at").gte("confirmed_at", since).limit(1000),
    db().from("ai_activity").select("event_type, created_at").in("event_type", ["availability_checked", "draft_prepared"]).gte("created_at", since).limit(2000),
    db().from("drafts").select("created_at").gte("created_at", since).limit(1000),
    db().from("briefing_communications").select("*").in("data_label", l).order("received_at").limit(2000),
    previousSnapshot(mode, key),
  ]);
  const requests = (check(reqR) as Record<string, unknown>[]).map((x) => ({
    id: x.id as string, type: x.request_type as string, status: x.status as string, reference: (x.reference_id as string) ?? null, createdAt: x.created_at as string, welfare: x.welfare_status === "yes",
  }));
  sources.push({ id: "compass", state: mode === "demo" ? "demo" : "live", records: requests.length, syncedAt: now.toISOString() });

  // Xero, through the Payments module's records.
  let payments: PaymentRecords | null = null;
  let paid: BuildInput["paid"] = [];
  let tasks: BuildInput["tasks"] = [];
  try {
    const r = await readPaymentRecords(mode);
    payments = { contacts: r.contacts, students: r.students, invoices: r.invoices, exceptions: r.exceptions, rules: r.rules };
    const [payR, runR, taskR] = await Promise.all([
      db().from("recovered_payments").select("invoice_id, amount_cents, verified_at").in("data_label", l).gte("verified_at", since),
      db().from("recovery_runs").select("created_at").in("data_label", l).order("created_at", { ascending: false }).limit(1),
      db().from("recovery_tasks").select("status, needs_owner, created_at").in("data_label", l).limit(500),
    ]);
    paid = rowsOr(payR).map((x) => ({ invoiceId: x.invoice_id as string, amountCents: x.amount_cents as number, at: x.verified_at as string }));
    tasks = rowsOr(taskR).map((x) => ({ status: x.status as string, needsOwner: Boolean(x.needs_owner), createdAt: x.created_at as string }));
    const synced = (rowsOr(runR)[0]?.created_at as string) ?? null;
    if (mode === "live" && (!synced || now.getTime() - Date.parse(synced) > 2 * 86_400_000)) warnings.push({ kind: "stale", source: "xero", at: synced ?? undefined });
    sources.push({ id: "xero", state: mode === "demo" ? "demo" : r.invoices.length ? "live" : "not_connected", records: r.invoices.length, syncedAt: mode === "demo" ? now.toISOString() : synced });
    if (mode === "live" && !r.invoices.length) payments = null;
  } catch (e) {
    sources.push({ id: "xero", state: isMissingTable(e) ? "not_connected" : "error", records: 0, syncedAt: null });
    warnings.push({ kind: isMissingTable(e) ? "not_connected" : "unavailable", source: "xero" });
  }
  if (!payments && !warnings.some((w) => w.source === "xero")) warnings.push({ kind: "not_connected", source: "xero" });

  // Gmail and SMS. Demo mode reads the fictional messages. Live mode reads only rows a
  // connected inbox has saved; there is no live inbox reader yet, so it says not connected.
  let comms: CommIn[] | null = null;
  if (commR.error) {
    for (const id of ["gmail", "sms"] as const) sources.push({ id, state: "error", records: 0, syncedAt: null });
    warnings.push({ kind: "unavailable", source: "gmail" });
  } else {
    const list = (commR.data as Record<string, unknown>[]).map(toComm);
    if (mode === "live" && !list.length) {
      for (const id of ["gmail", "sms"] as const) {
        sources.push({ id, state: "not_connected", records: 0, syncedAt: null });
        warnings.push({ kind: "not_connected", source: id });
      }
    } else {
      comms = list;
      for (const id of ["gmail", "sms"] as const) sources.push({ id, state: mode === "demo" ? "demo" : "live", records: list.filter((c) => c.channel === id).length, syncedAt: mode === "demo" ? now.toISOString() : null });
    }
  }

  // Student Retention, if it's set up. Its own page has the detail.
  let retention: BuildInput["retention"] = null;
  try {
    const r = await readRetentionRecords(retentionMode());
    const list = assessAll({ ...r, today }).filter((a) => !a.dismissed);
    retention = { high: list.filter((a) => a.level === "high").length, medium: list.filter((a) => a.level === "medium").length, monitored: list.length };
  } catch {
    retention = null;
  }

  if (mode === "demo") warnings.unshift({ kind: "demo", source: "compass" });
  const name = (x: unknown) => ((x as { name?: string } | null)?.name ?? null);
  return {
    now, mode, thresholds, payments, paid, comms, requests, tasks, retention, sources, warnings,
    events: (check(evR) as Record<string, unknown>[]).map((x) => ({ requestId: x.request_id as string, type: x.event_type as string, actorRole: (x.actor_role as "admin") ?? null, at: x.created_at as string })),
    lessons: rowsOr(lesR).map((x) => {
      const b = x.bookings as { subject?: string; families?: { student_name?: string } | null } | null;
      return { id: x.id as string, tutorId: x.tutor_id as string, tutorName: name(x.tutors) ?? (x.tutor_id as string), student: b?.families?.student_name ?? null, subject: b?.subject ?? null, startsAt: x.starts_at as string, status: x.status as "scheduled" };
    }),
    absences: rowsOr(absR).map((x) => ({ tutorId: x.tutor_id as string, tutorName: name(x.tutors) ?? (x.tutor_id as string), startsOn: x.starts_on as string, endsOn: x.ends_on as string })),
    workflows: rowsOr(wfR).map((x) => ({ id: x.id as string, workflow: x.workflow as "lesson_change", status: x.status as "active", updatedAt: x.updated_at as string })),
    proposals: rowsOr(propR).map((x) => ({ action: x.action_type as string, status: x.status as string, confirmedAt: (x.confirmed_at as string) ?? null })),
    activity: rowsOr(actR).map((x) => ({ type: x.event_type as string, at: x.created_at as string })),
    draftsAt: rowsOr(draftR).map((x) => x.created_at as string),
    coverage: {
      events: (rowsOr(firstEvR)[0]?.created_at as string) ?? null,
      lessons: (rowsOr(firstLesR)[0]?.starts_at as string) ?? null,
      comms: comms?.[0]?.receivedAt ?? null,
    },
    previousSnapshot: snap,
  };
}

// Saving and loading briefings ----------------------------------------------------------------------

function toBriefing(x: Record<string, unknown>): Briefing {
  const start = x.period_start as string;
  const end = x.period_end as string;
  const key = x.period_key as string;
  const period = { start, end, startDay: addDays(key, -6), endDay: key };
  return {
    id: x.id as string, periodKey: key, period, previous: { start: sydneyInstant(addDays(key, -13)), end: start, startDay: addDays(key, -13), endDay: addDays(key, -7) },
    generatedAt: x.generated_at as string, trigger: x.trigger as Briefing["trigger"], overall: x.overall as Briefing["overall"],
    headline: x.headline as Headline, detail: (x.detail && (x.detail as { version?: number }).version === 1 ? x.detail : null) as Briefing["detail"],
    recommendations: (x.recommendations as Briefing["recommendations"]) ?? [], sources: (x.sources as Source[]) ?? [], warnings: (x.warnings as Warning[]) ?? [], mode: x.mode as BriefingMode,
  };
}

/** Works the briefing out from the records now and saves it as this week's briefing. */
export async function generate(user: SessionUser | null, trigger: Briefing["trigger"], now = new Date()): Promise<Briefing> {
  const mode = briefingMode();
  const settings = await readSettings(mode);
  const input = await readInput(mode, settings.thresholds, now);
  const b = buildBriefing(input);
  const row = {
    period_key: b.periodKey, period_start: b.period.start, period_end: b.period.end, generated_at: now.toISOString(), generated_by: user?.id ?? null,
    trigger, status: "ready", overall: b.overall, headline: b.headline, detail: b.detail, recommendations: b.recommendations, sources: b.sources,
    warnings: b.warnings, mode, data_label: label(mode),
  };
  const saved = check(await db().from("owner_briefings").upsert(row, { onConflict: "data_label,period_key" }).select("*").single()) as Record<string, unknown>;
  await event(mode, "generated", `Briefing for the week to ${b.periodKey} worked out from the records (${trigger}).`, { actor: user?.id ?? null, briefing: saved.id as string });
  return { ...toBriefing(saved), previous: b.previous, period: b.period };
}

/** This week's briefing. Worked out again when there is none yet or it is over 30 minutes old. */
export async function currentBriefing(user: SessionUser | null, now = new Date(), trigger: Briefing["trigger"] = "page"): Promise<Briefing> {
  const mode = briefingMode();
  const { key } = reportingPeriods(now);
  const r = check(await db().from("owner_briefings").select("*").in("data_label", labels(mode)).eq("period_key", key).maybeSingle()) as Record<string, unknown> | null;
  if (r && r.detail && now.getTime() - Date.parse(r.generated_at as string) < 30 * 60_000) return toBriefing(r);
  return generate(user, trigger, now);
}

/** The latest saved briefing without working anything out. Used by the Overview card. */
export async function latestBriefing(): Promise<Briefing | null> {
  const mode = briefingMode();
  const { key } = reportingPeriods(new Date());
  const r = check(await db().from("owner_briefings").select("*").in("data_label", labels(mode)).eq("period_key", key).maybeSingle()) as Record<string, unknown> | null;
  return r && r.detail ? toBriefing(r) : null;
}

export async function briefingById(id: string): Promise<Briefing | null> {
  const r = check(await db().from("owner_briefings").select("*").in("data_label", labels(briefingMode())).eq("id", id).maybeSingle()) as Record<string, unknown> | null;
  return r ? toBriefing(r) : null;
}

export async function history(limit = 12): Promise<HistoryItem[]> {
  const r = check(await db().from("owner_briefings").select("id, period_key, generated_at, trigger, overall, headline, recommendations").in("data_label", labels(briefingMode())).order("period_key", { ascending: false }).limit(limit)) as Record<string, unknown>[];
  return r.map((x) => ({
    id: x.id as string, periodKey: x.period_key as string, generatedAt: x.generated_at as string, trigger: x.trigger as HistoryItem["trigger"], overall: x.overall as HistoryItem["overall"],
    headline: x.headline as Headline, kinds: ((x.recommendations as Array<{ kind: HistoryItem["kinds"][number]["kind"]; priority: HistoryItem["kinds"][number]["priority"] }>) ?? []).map((k) => ({ kind: k.kind, priority: k.priority })),
  }));
}

export async function deliveries(limit = 20): Promise<Delivery[]> {
  const r = check(await db().from("briefing_deliveries").select("*").in("data_label", labels(briefingMode())).order("created_at", { ascending: false }).limit(limit)) as Record<string, unknown>[];
  return r.map((x) => ({
    id: x.id as string, slotKey: x.slot_key as string, kind: x.kind as Delivery["kind"], recipient: x.recipient as string, status: x.status as Delivery["status"],
    detail: (x.detail as string) ?? "", attempts: (x.attempts as number) ?? 1, createdAt: x.created_at as string, updatedAt: x.updated_at as string, briefingId: (x.briefing_id as string) ?? null,
  }));
}

/** The briefing as this person may see it. */
export async function viewForUser(user: SessionUser, b: Briefing): Promise<BriefingView> {
  const s = await readSettings(briefingMode());
  return viewFor(b, user.role, s.adminFinance);
}

// Page data -----------------------------------------------------------------------------------------

export type BriefingPageData = {
  mode: BriefingMode;
  view: BriefingView;
  viewingPast: boolean;
  history: HistoryItem[];
  /** Owner only. */
  settings: BriefingSettings | null;
  recipients: Recipient[];
  deliveries: Delivery[];
  gmailReady: boolean;
  nextSendAt: string | null;
};

export async function briefingPageData(user: SessionUser, opts: { id?: string } = {}): Promise<BriefingPageData> {
  const mode = briefingMode();
  const now = new Date();
  const current = await currentBriefing(user, now);
  const past = opts.id && opts.id !== current.id ? await briefingById(opts.id) : null;
  const settings = await readSettings(mode);
  const owner = user.role === "owner";
  const [hist, recips, dels] = await Promise.all([history(), owner ? ownerRecipients() : Promise.resolve([]), owner ? deliveries() : Promise.resolve([])]);
  return {
    mode,
    view: viewFor(past ?? current, user.role, settings.adminFinance),
    viewingPast: Boolean(past),
    history: hist,
    settings: owner ? settings : null,
    recipients: recips,
    deliveries: dels,
    gmailReady: mode === "demo" ? true : providerStatus().gmail,
    nextSendAt: settings.enabled ? nextSlot(settings, now).at : null,
  };
}

// Email -------------------------------------------------------------------------------------------------

async function emailFor(b: Briefing, settings: BriefingSettings, mode: BriefingMode): Promise<BriefingEmail> {
  // The email goes to the owner, so it holds the owner's view. It is written in English,
  // like other saved records.
  return briefingEmail(viewFor(b, "owner", true), { t: enT, fmt: makeFormat("en", enT), link: `${appUrl()}/briefing`, sections: settings.sections, businessName: BUSINESS_NAME, demo: mode === "demo" });
}

async function recipientFor(settings: BriefingSettings): Promise<Recipient | null> {
  const list = await ownerRecipients();
  return list.find((r) => r.id === settings.recipientId) ?? null;
}

export async function emailPreview(user: SessionUser): Promise<{ subject: string; html: string; to: string | null }> {
  if (user.role !== "owner") throw toDbError({ message: "forbidden: only the owner can preview the briefing email" });
  const mode = briefingMode();
  const settings = await readSettings(mode);
  const b = await currentBriefing(user);
  const e = await emailFor(b, settings, mode);
  return { subject: e.subject, html: e.html, to: (await recipientFor(settings))?.email ?? null };
}

export type SendOutcome = { status: Delivery["status"] | "already_sent"; to: string; detail: string };

/**
 * Sends one briefing email, at most once per slot and recipient. In demo mode it is always
 * simulated. In live mode Gmail must be connected, and "accepted" means Gmail took it,
 * not that it reached the inbox.
 */
async function deliver(mode: BriefingMode, b: Briefing, settings: BriefingSettings, slotKey: string, kind: "scheduled" | "manual", actor: string | null): Promise<SendOutcome> {
  const to = await recipientFor(settings);
  if (!to) {
    await event(mode, "email_skipped", "No confirmed owner email is chosen for the briefing.", { actor, briefing: b.id });
    return { status: "skipped", to: "", detail: "no_recipient" };
  }
  const { data: claim, error } = await db().rpc("claim_briefing_delivery", { p_label: label(mode), p_slot: slotKey, p_kind: kind, p_recipient: to.email, p_briefing: b.id, p_actor: actor });
  if (error) throw toDbError(error);
  if (!claim) return { status: "already_sent", to: to.email, detail: "already_sent" };
  const finish = async (status: Delivery["status"], detail: string, providerId: string | null = null) => {
    await db().from("briefing_deliveries").update({ status, detail: detail.slice(0, 500), provider_id: providerId, updated_at: new Date().toISOString() }).eq("id", claim as string);
    await event(mode, `email_${status}`, `${kind === "scheduled" ? "Scheduled" : "Manual"} briefing email to ${to.email}: ${detail}`, { actor, briefing: b.id });
    return { status, to: to.email, detail };
  };
  if (mode === "demo") return finish("simulated", "Demo mode: the email was simulated. Nothing was sent.");
  if (!providerStatus().gmail) return finish("skipped", "Gmail isn't connected, so nothing was sent.");
  try {
    const e = await emailFor(b, settings, mode);
    const id = await gmailSendHtml(to.email, e.subject, e.html, e.text);
    return finish("accepted", "Gmail accepted the email. Gmail doesn't confirm when it reaches the inbox.", id);
  } catch (err) {
    return finish("failed", `Gmail didn't accept the email: ${err instanceof Error ? err.message : "unknown error"}. It can be retried.`);
  }
}

export async function sendNow(user: SessionUser): Promise<SendOutcome> {
  if (user.role !== "owner") throw toDbError({ message: "forbidden: only the owner can send the briefing email" });
  const mode = briefingMode();
  const settings = await readSettings(mode);
  const b = await currentBriefing(user);
  // One manual send per briefing version, so a double click can't send twice.
  return deliver(mode, b, settings, `manual:${b.id}:${b.generatedAt}`, "manual", user.id);
}

/**
 * The scheduled job. Safe to run as often as you like: it sends only when a slot is due,
 * and the database lets each slot go to each recipient once.
 */
export async function runSchedule(now = new Date()): Promise<{ due: boolean; slot: string | null; outcome: SendOutcome | null }> {
  const mode = briefingMode();
  const settings = await readSettings(mode);
  const slot = dueSlot(settings, now);
  if (!slot) return { due: false, slot: null, outcome: null };
  const b = await generate(null, "schedule", now);
  return { due: true, slot: slot.key, outcome: await deliver(mode, b, settings, slot.key, "scheduled", null) };
}

export async function resetBriefingDemo(user: SessionUser): Promise<void> {
  if (briefingMode() !== "demo") throw toDbError({ message: "forbidden: Reset Demo only works in demo mode" });
  const { error } = await db().rpc("reset_briefing_demo");
  if (error) throw toDbError(error);
  await event("demo", "reset", `${user.displayName} reset the briefing demo.`, { actor: user.id });
}
