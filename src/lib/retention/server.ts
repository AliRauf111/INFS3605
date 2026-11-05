import "server-only";
import { z } from "zod";
import { db, DbError, toDbError } from "@/lib/db/supabase";
import type { SessionUser } from "@/lib/auth/session";
import { sydneyToday } from "@/lib/workflows/dates";
import { aiConfigured, callStructured } from "@/lib/ai/client";
import { gmailSend, providerStatus, smsSend, smsStatus } from "@/lib/payments/providers";
import { normaliseAuMobile, normaliseEmail } from "@/lib/payments/logic";
import {
  DEFAULT_SETTINGS,
  SMS_LIMIT,
  alertKeyFor,
  assessAll,
  draftCheckIn,
  firstName,
  internalWording,
  outcomes,
  overviewCounts,
  summaryText,
  validateSettings,
  type OutcomeSummary,
  type Overview,
} from "./logic";
import type {
  Assessment,
  Channel,
  ConcernCategory,
  Dismissal,
  DraftText,
  RetentionConcern,
  RetentionContact,
  RetentionLesson,
  RetentionMessage,
  RetentionMode,
  RetentionSettings,
  RetentionStudent,
} from "./types";

// Reads and changes the Student Retention Agent's records. Everything here runs on the
// server with the secret key. Demo mode only reads and writes rows labelled
// 'fictional_demo'; live mode only the others, so demo activity never mixes with genuine
// communication records. The database checks approval and sending again under a lock.

export const BUSINESS_NAME = process.env.BUSINESS_NAME?.trim() || "Tutor Compass";

/** Demo unless the deployment sets RETENTION_MODE=live. */
export function retentionMode(env: NodeJS.ProcessEnv = process.env): RetentionMode {
  return /^live$/i.test((env.RETENTION_MODE ?? "").trim()) ? "live" : "demo";
}

/** Can this channel really send? In demo mode every send is simulated, so both are "ready". */
export function channelsReady(mode: RetentionMode, env: NodeJS.ProcessEnv = process.env): { email: boolean; sms: boolean } {
  if (mode === "demo") return { email: true, sms: true };
  const p = providerStatus(env);
  return { email: p.gmail, sms: p.sms };
}

function labels(mode: RetentionMode): string[] {
  return mode === "demo" ? ["fictional_demo"] : ["live_connected", "imported"];
}
function label(mode: RetentionMode): string {
  return mode === "demo" ? "fictional_demo" : "live_connected";
}

function check<T>(r: { data: T | null; error: { message?: string; code?: string } | null }): T {
  if (r.error) throw toDbError(r.error);
  return r.data as T;
}

/** True when the retention tables haven't been added to this database yet. */
export function isMissingRetention(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /retention_|billing_|PGRST205|42P01|schema cache/i.test(m);
}

async function event(mode: RetentionMode, kind: string, detail: string, extra: { student?: string; message?: string; actor?: string } = {}) {
  await db().from("retention_events").insert({
    kind, detail: detail.slice(0, 1000), mode, student_id: extra.student ?? null, message_id: extra.message ?? null, actor_id: extra.actor ?? null, data_label: label(mode),
  });
}

// Records -----------------------------------------------------------------------------------------

export type Records = {
  students: RetentionStudent[];
  contacts: RetentionContact[];
  lessons: RetentionLesson[];
  concerns: RetentionConcern[];
  settings: RetentionSettings;
  dismissals: Dismissal[];
  messages: RetentionMessage[];
};

function toMessage(x: Record<string, unknown>): RetentionMessage {
  return {
    id: x.id as string, studentId: x.student_id as string, contactId: x.contact_id as string, channel: x.channel as Channel,
    recipientName: x.recipient_name as string, address: (x.address as string) ?? "", subject: (x.subject as string) ?? null, body: x.body as string,
    source: x.source as RetentionMessage["source"], variant: (x.variant as number) ?? 0, status: x.status as RetentionMessage["status"], version: x.version as number,
    preparedBy: (x.prepared_by as string) ?? null, approvedBy: (x.approved_by as string) ?? null, approvedAt: (x.approved_at as string) ?? null,
    rejectedReason: (x.rejected_reason as string) ?? null, sentBy: (x.sent_by as string) ?? null, sentAt: (x.sent_at as string) ?? null,
    deliveryStatus: x.delivery_status as RetentionMessage["deliveryStatus"], deliveryDetail: (x.delivery_detail as string) ?? null,
    responseStatus: x.response_status as RetentionMessage["responseStatus"], responseAt: (x.response_at as string) ?? null, responseNote: (x.response_note as string) ?? null,
    followUp: x.follow_up as RetentionMessage["followUp"], followUpOn: (x.follow_up_on as string) ?? null, mode: x.mode as RetentionMode,
    createdAt: x.created_at as string, updatedAt: x.updated_at as string,
  };
}

export async function readRecords(mode: RetentionMode): Promise<Records> {
  const l = labels(mode);
  const [st, co, le, cn, se, di, me] = await Promise.all([
    db().from("billing_students").select("id, name, year_level, enrolled, billing_contact_id").in("data_label", l).order("id"),
    db().from("billing_contacts").select("id, name, email, phone, email_permitted, sms_permitted").in("data_label", l).order("id"),
    db().from("retention_lessons").select("id, student_id, lesson_date, subject, tutor_name, outcome, note").in("data_label", l).order("lesson_date").limit(5000),
    db().from("retention_concerns").select("*").in("data_label", l).order("raised_on", { ascending: false }),
    db().from("retention_settings").select("*").eq("id", 1).maybeSingle(),
    db().from("retention_dismissals").select("student_id, reason, score_at, level_at, created_at, dismissed_by").eq("active", true).in("data_label", l),
    db().from("retention_messages").select("*").in("data_label", l).order("created_at", { ascending: false }).limit(500),
  ]);
  const s = check(se) as Record<string, number> | null;
  return {
    students: (check(st) as Record<string, unknown>[]).map((x) => ({ id: x.id as string, name: x.name as string, yearLevel: (x.year_level as number) ?? null, enrolled: Boolean(x.enrolled), contactId: x.billing_contact_id as string })),
    contacts: (check(co) as Record<string, unknown>[]).map((x) => ({ id: x.id as string, name: x.name as string, email: (x.email as string) ?? null, phone: (x.phone as string) ?? null, emailPermitted: Boolean(x.email_permitted), smsPermitted: Boolean(x.sms_permitted) })),
    lessons: (check(le) as Record<string, unknown>[]).map((x) => ({ id: x.id as string, studentId: x.student_id as string, date: x.lesson_date as string, subject: x.subject as string, tutorName: (x.tutor_name as string) ?? null, outcome: x.outcome as RetentionLesson["outcome"], note: (x.note as string) ?? null })),
    concerns: (check(cn) as Record<string, unknown>[]).map((x) => ({ id: x.id as string, studentId: x.student_id as string, raisedOn: x.raised_on as string, category: x.category as ConcernCategory, summary: x.summary as string, status: x.status as "open" | "resolved", confidential: Boolean(x.confidential), resolvedOn: (x.resolved_on as string) ?? null })),
    settings: s ? { highThreshold: s.high_threshold, mediumThreshold: s.medium_threshold, windowDays: s.window_days, baselineDays: s.baseline_days, minLessons: s.min_lessons, cooldownDays: s.cooldown_days } : DEFAULT_SETTINGS,
    dismissals: (check(di) as Record<string, unknown>[]).map((x) => ({ studentId: x.student_id as string, reason: x.reason as string, scoreAt: x.score_at as number, levelAt: x.level_at as Dismissal["levelAt"], createdAt: x.created_at as string, by: (x.dismissed_by as string) ?? null })),
    messages: (check(me) as Record<string, unknown>[]).map(toMessage),
  };
}

// Page data ---------------------------------------------------------------------------------------

export type EventView = { id: string; kind: string; detail: string; mode: string; createdAt: string; studentId: string | null };
export type AlertView = { key: string; state: "open" | "reviewed" | "dismissed" | "snoozed"; until: string | null };

export type RetentionData = {
  mode: RetentionMode;
  ready: { email: boolean; sms: boolean };
  aiDrafts: boolean;
  role: SessionUser["role"];
  today: string;
  latestRunAt: string | null;
  settings: RetentionSettings;
  overview: Overview;
  summary: string;
  assessments: Assessment[];
  /** Recent lessons and concerns behind each student's assessment, so the owner can check them. */
  records: Record<string, { lessons: RetentionLesson[]; concerns: RetentionConcern[] }>;
  messages: RetentionMessage[];
  names: Record<string, string>;
  users: Record<string, string>;
  events: EventView[];
  alert: AlertView | null;
  outcomes: { d14: OutcomeSummary; d30: OutcomeSummary };
  business: string;
};

/** Hide owner-only notes from anyone else. They still see that a note exists. */
function forViewer(c: RetentionConcern, role: SessionUser["role"]): RetentionConcern {
  return c.confidential && role !== "owner" ? { ...c, summary: "Confidential note. Only the owner can read it." } : c;
}

export async function readRetentionData(user: SessionUser, now = new Date()): Promise<RetentionData> {
  const mode = retentionMode();
  const l = labels(mode);
  const today = sydneyToday(now);
  const r = await readRecords(mode);
  const assessments = assessAll({ ...r, today }).map((a) => ({ ...a, openConcerns: a.openConcerns.map((c) => forViewer(c, user.role)) }));
  const overview = overviewCounts(assessments, r.messages, r.settings, now);

  let runs = check(await db().from("retention_runs").select("created_at").in("data_label", l).order("created_at", { ascending: false }).limit(1)) as { created_at: string }[];
  if (!runs.length) {
    // The first look after a reset or set-up counts as the first analysis.
    const ins = await db().from("retention_runs").insert({ created_by: user.id, monitored: overview.monitored, high: overview.high, medium: overview.medium, low: overview.low, mode, data_label: label(mode) }).select("created_at");
    runs = ins.error ? [] : (ins.data as { created_at: string }[]);
  }
  const [ev, us] = await Promise.all([
    db().from("retention_events").select("id, kind, detail, mode, created_at, student_id").in("data_label", l).order("created_at", { ascending: false }).limit(60),
    db().from("app_users").select("id, display_name"),
  ]);
  const since = new Date(now.getTime() - 120 * 86_400_000).toISOString().slice(0, 10);
  const records: RetentionData["records"] = {};
  for (const a of assessments) {
    records[a.studentId] = {
      lessons: r.lessons.filter((x) => x.studentId === a.studentId && x.date >= since).reverse(),
      concerns: r.concerns.filter((x) => x.studentId === a.studentId).map((c) => forViewer(c, user.role)),
    };
  }
  const alert = await readAlert(mode, assessments, now);
  return {
    mode,
    ready: channelsReady(mode),
    aiDrafts: aiConfigured(),
    role: user.role,
    today,
    latestRunAt: runs[0]?.created_at ?? null,
    settings: r.settings,
    overview,
    summary: summaryText(assessments, overview),
    assessments,
    records,
    messages: r.messages,
    names: Object.fromEntries(r.students.map((s) => [s.id, s.name])),
    users: Object.fromEntries(((us.data ?? []) as { id: string; display_name: string }[]).map((u) => [u.id, u.display_name])),
    events: ((check(ev) as Record<string, unknown>[]) ?? []).map((x) => ({ id: x.id as string, kind: x.kind as string, detail: x.detail as string, mode: x.mode as string, createdAt: x.created_at as string, studentId: (x.student_id as string) ?? null })),
    alert,
    outcomes: {
      d14: outcomes({ days: 14, messages: r.messages, lessons: r.lessons, students: r.students, today }),
      d30: outcomes({ days: 30, messages: r.messages, lessons: r.lessons, students: r.students, today }),
    },
    business: BUSINESS_NAME,
  };
}

// Alerts in What Needs My Attention ---------------------------------------------------------------

async function readAlert(mode: RetentionMode, list: Assessment[], now: Date): Promise<AlertView | null> {
  const high = list.filter((a) => a.flagged && a.level === "high");
  if (!high.length) return null;
  const key = alertKeyFor(high.map((a) => a.studentId));
  const row = check(await db().from("retention_alert_state").select("state, until").eq("alert_key", key).in("data_label", labels(mode)).maybeSingle()) as { state: AlertView["state"]; until: string | null } | null;
  if (!row) return { key, state: "open", until: null };
  if (row.state === "snoozed" && row.until && new Date(row.until) <= now) return { key, state: "open", until: null };
  return { key, state: row.state, until: row.until };
}

export type RetentionAlert = { key: string; students: Array<{ id: string; name: string; reason: string }> };

/** The one retention alert for What Needs My Attention, or null when nothing needs the owner or they set it aside. */
export async function retentionAlert(user: SessionUser, now: Date): Promise<RetentionAlert | null> {
  if (user.role !== "owner") return null;
  const mode = retentionMode();
  const r = await readRecords(mode);
  const list = assessAll({ ...r, today: sydneyToday(now) });
  const overview = overviewCounts(list, r.messages, r.settings, now);
  if (!overview.ownerReview) return null;
  const alert = await readAlert(mode, list, now);
  if (!alert || alert.state !== "open") return null;
  const busy = new Set(r.messages.filter((m) => !["sent", "failed", "rejected"].includes(m.status)).map((m) => m.studentId));
  const high = list.filter((a) => a.flagged && a.level === "high" && !busy.has(a.studentId));
  return { key: alert.key, students: high.map((a) => ({ id: a.studentId, name: a.name, reason: a.reasons.slice(0, 2).join(" and ").toLowerCase() })) };
}

export async function setAlertState(user: SessionUser, key: string, state: "reviewed" | "dismissed" | "snoozed" | "open"): Promise<void> {
  const mode = retentionMode();
  if (state === "open") {
    check(await db().from("retention_alert_state").delete().eq("alert_key", key).in("data_label", labels(mode)));
  } else {
    const until = state === "snoozed" ? new Date(Date.now() + 86_400_000).toISOString() : null;
    check(await db().from("retention_alert_state").upsert({ alert_key: key, state, until, actor_id: user.id, created_at: new Date().toISOString(), data_label: label(mode) }, { onConflict: "alert_key" }));
  }
  const words = { reviewed: "marked the retention alert as reviewed", dismissed: "dismissed the retention alert", snoozed: "asked to be reminded about the retention alert tomorrow", open: "brought the retention alert back" };
  await event(mode, "alert", `${user.displayName} ${words[state]}.`, { actor: user.id });
}

// Analysis ----------------------------------------------------------------------------------------

export async function runAnalysis(user: SessionUser, now = new Date()): Promise<Overview> {
  const mode = retentionMode();
  const r = await readRecords(mode);
  const list = assessAll({ ...r, today: sydneyToday(now) });
  const o = overviewCounts(list, r.messages, r.settings, now);
  check(await db().from("retention_runs").insert({ created_by: user.id, monitored: o.monitored, high: o.high, medium: o.medium, low: o.low, mode, data_label: label(mode) }));
  await event(mode, "analysis", `${user.displayName} ran the retention analysis: ${o.monitored} students checked, ${o.high} high, ${o.medium} medium, ${o.low} with no current flags.`, { actor: user.id });
  return o;
}

export async function updateSettings(user: SessionUser, s: RetentionSettings): Promise<void> {
  const problem = validateSettings(s);
  if (problem) throw new DbError(problem, "invalid_input");
  check(await db().from("retention_settings").upsert({
    id: 1, high_threshold: s.highThreshold, medium_threshold: s.mediumThreshold, window_days: s.windowDays, baseline_days: s.baselineDays,
    min_lessons: s.minLessons, cooldown_days: s.cooldownDays, updated_by: user.id, updated_at: new Date().toISOString(),
  }));
  await event(retentionMode(), "settings", `${user.displayName} changed the retention settings: high from ${s.highThreshold}, medium from ${s.mediumThreshold}, recent period ${s.windowDays} days compared with the ${s.baselineDays} days before, ${s.cooldownDays} days between check-ins.`, { actor: user.id });
}

export async function dismissFlag(user: SessionUser, studentId: string, reason: string): Promise<void> {
  const mode = retentionMode();
  const r = await readRecords(mode);
  const a = assessAll({ ...r, today: sydneyToday(new Date()) }).find((x) => x.studentId === studentId);
  if (!a) throw new DbError("That student isn't being monitored.", "not_found");
  if (a.level === "low") throw new DbError("This student has no flag to dismiss.", "invalid_transition");
  const text = reason.trim();
  if (text.length < 5) throw new DbError("Say briefly why the flag is wrong, so the record shows it.", "reason_required");
  check(await db().from("retention_dismissals").update({ active: false }).eq("student_id", studentId).eq("active", true).in("data_label", labels(mode)));
  check(await db().from("retention_dismissals").insert({ student_id: studentId, reason: text.slice(0, 300), score_at: a.score, level_at: a.level, dismissed_by: user.id, data_label: label(mode) }));
  await event(mode, "flag_dismissed", `${user.displayName} dismissed the ${a.level} flag for ${a.name} (score ${a.score}): ${text.slice(0, 300)}`, { student: studentId, actor: user.id });
}

export async function restoreFlag(user: SessionUser, studentId: string): Promise<void> {
  const mode = retentionMode();
  check(await db().from("retention_dismissals").update({ active: false }).eq("student_id", studentId).eq("active", true).in("data_label", labels(mode)));
  await event(mode, "flag_restored", `${user.displayName} restored the retention flag for ${studentId}.`, { student: studentId, actor: user.id });
}

export async function resolveConcern(user: SessionUser, id: string): Promise<void> {
  const mode = retentionMode();
  const row = check(await db().from("retention_concerns").select("id, student_id, status").eq("id", id).in("data_label", labels(mode)).maybeSingle()) as { id: string; student_id: string; status: string } | null;
  if (!row) throw new DbError("That concern no longer exists.", "not_found");
  if (row.status === "resolved") return;
  check(await db().from("retention_concerns").update({ status: "resolved", resolved_on: sydneyToday(new Date()), resolved_by: user.id }).eq("id", id));
  await event(mode, "concern_resolved", `${user.displayName} marked a parent concern as resolved.`, { student: row.student_id, actor: user.id });
}

// Drafting ----------------------------------------------------------------------------------------

/** Which channel to start with: email when allowed, otherwise SMS to a full mobile number. */
export function defaultChannel(c: RetentionContact | null): Channel {
  if (c?.emailPermitted && normaliseEmail(c.email)) return "email";
  if (c?.smsPermitted && normaliseAuMobile(c.phone)) return "sms";
  return "email";
}

/** Why a channel can't be used for this family, or null when it can. */
export function channelProblem(c: RetentionContact | null, channel: Channel): string | null {
  if (!c) return "There is no parent or guardian record for this student.";
  if (channel === "email") {
    if (!c.emailPermitted) return `${firstName(c.name)} hasn't agreed to email.`;
    if (!normaliseEmail(c.email)) return "There is no valid email address on file.";
    return null;
  }
  if (!c.smsPermitted) return `${firstName(c.name)} hasn't agreed to SMS.`;
  if (!normaliseAuMobile(c.phone)) return "The mobile number on file looks incomplete.";
  return null;
}

const AiDraft = z.object({ subject: z.string().max(120).nullable(), body: z.string().min(20).max(1500) });

/**
 * Writes the check-in. With live AI, only first names, the subject, the tutor's first name,
 * the business name and the general topic go to the AI service: never scores, attendance,
 * notes or contact details. The result is checked, and the template is used if anything
 * is off.
 */
async function writeDraft(a: Assessment, channel: Channel, variant: number, signoff: string): Promise<DraftText & { source: "template" | "ai" }> {
  const input = {
    channel, parentName: a.contact?.name ?? "there", studentName: a.name, subject: a.subject, tutorName: a.tutorName, business: BUSINESS_NAME, signoff,
    topics: a.openConcerns.filter((c) => !c.confidential).map((c) => c.category), variant,
  };
  const template = draftCheckIn(input);
  if (!aiConfigured()) return { ...template, source: "template" };
  const res = await callStructured({
    schema: AiDraft,
    maxTokens: 800,
    system: "You write short, warm check-in messages from a small tutoring business to a parent. Never mention attendance, cancellations, missed lessons, scores, risk, leaving or anything that could feel like blame or pressure. Offer help (other lesson times, a chat with the tutor, a change of approach) and ask for an easy reply. British English. No em dashes.",
    user: JSON.stringify({
      channel: channel === "sms" ? "SMS under 300 characters, no subject" : "email with a subject line, a greeting, one short paragraph of context, an offer of support, a clear next step and a closing",
      parentFirstName: firstName(input.parentName), studentFirstName: firstName(a.name), subject: a.subject, tutorFirstName: a.tutorName ? firstName(a.tutorName) : null,
      business: BUSINESS_NAME, signoff, topics: input.topics, example: template,
    }),
  });
  if (!res.ok) return { ...template, source: "template" };
  const body = res.data.body.replace(/—/g, ", ").trim();
  const subject = channel === "email" ? (res.data.subject ?? template.subject) : null;
  if (internalWording(`${subject ?? ""} ${body}`).length || (channel === "sms" && body.length > SMS_LIMIT)) return { ...template, source: "template" };
  return { subject, body, source: "ai" };
}

function addressFor(c: RetentionContact | null, channel: Channel): string {
  return (channel === "email" ? c?.email : c?.phone) ?? "";
}

async function assessmentFor(mode: RetentionMode, studentId: string): Promise<Assessment> {
  const r = await readRecords(mode);
  const a = assessAll({ ...r, today: sydneyToday(new Date()) }).find((x) => x.studentId === studentId);
  if (!a) throw new DbError("That student isn't being monitored.", "not_found");
  return a;
}

/** Prepares one personalised check-in per student. Students who already have one in progress keep it. */
export async function prepareDrafts(user: SessionUser, studentIds: string[], channel?: Channel): Promise<{ prepared: number; existing: number; skipped: Array<{ id: string; reason: string }> }> {
  const mode = retentionMode();
  const r = await readRecords(mode);
  const list = assessAll({ ...r, today: sydneyToday(new Date()) });
  let prepared = 0, existing = 0;
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const id of [...new Set(studentIds)].slice(0, 25)) {
    const a = list.find((x) => x.studentId === id);
    if (!a) { skipped.push({ id, reason: "Not a monitored student" }); continue; }
    if (r.messages.some((m) => m.studentId === id && ["draft", "awaiting_approval", "approved", "rejected", "sending"].includes(m.status))) { existing++; continue; }
    if (!a.contact) { skipped.push({ id, reason: "No parent or guardian on file" }); continue; }
    const recent = r.messages.find((m) => m.studentId === id && m.status === "sent" && m.sentAt && Date.now() - new Date(m.sentAt).getTime() < r.settings.cooldownDays * 86_400_000);
    if (recent) { skipped.push({ id, reason: `Contacted in the last ${r.settings.cooldownDays} days` }); continue; }
    const ch = channel && !channelProblem(a.contact, channel) ? channel : defaultChannel(a.contact);
    const text = await writeDraft(a, ch, 0, user.displayName);
    const ins = await db().from("retention_messages").insert({
      student_id: id, contact_id: a.contact.id, channel: ch, recipient_name: a.contact.name, address: addressFor(a.contact, ch), subject: text.subject, body: text.body,
      source: text.source, variant: 0, status: user.role === "owner" ? "draft" : "awaiting_approval", prepared_by: user.id, mode, data_label: label(mode),
    }).select("id").single();
    if (ins.error) {
      if (ins.error.code === "23505") { existing++; continue; }
      throw toDbError(ins.error);
    }
    prepared++;
    await event(mode, "draft_prepared", `Compass prepared a personalised ${ch === "sms" ? "SMS" : "email"} check-in for ${a.contact.name} (${a.name})${user.role === "owner" ? "" : ` at ${user.displayName}'s request, for the owner to approve`}.`, { student: id, message: (ins.data as { id: string }).id, actor: user.id });
  }
  return { prepared, existing, skipped };
}

async function messageRow(mode: RetentionMode, id: string): Promise<RetentionMessage> {
  const row = check(await db().from("retention_messages").select("*").eq("id", id).in("data_label", labels(mode)).maybeSingle()) as Record<string, unknown> | null;
  if (!row) throw new DbError("That message no longer exists.", "not_found");
  return toMessage(row);
}

const EDITABLE = ["draft", "awaiting_approval", "approved", "rejected"];

export type DraftPatch = { version: number; subject?: string | null; body?: string; channel?: Channel; regenerate?: boolean };

/**
 * Edits, switches channel or rewrites a draft. Any change clears an earlier approval, so
 * the owner approves exactly what will be sent. The update only applies to the version the
 * person was looking at, so two people can't overwrite each other.
 */
export async function updateDraft(user: SessionUser, id: string, patch: DraftPatch): Promise<RetentionMessage> {
  const mode = retentionMode();
  const m = await messageRow(mode, id);
  if (!EDITABLE.includes(m.status)) throw new DbError("This message has already been sent, so it can't change.", "invalid_transition");
  if (m.version !== patch.version) throw new DbError("Someone changed this draft while you were looking at it. Read it again.", "stale_update");
  const update: Record<string, unknown> = {};
  const channel = patch.channel ?? m.channel;
  if (patch.channel || patch.regenerate) {
    const a = await assessmentFor(mode, m.studentId);
    if (patch.channel && patch.channel !== m.channel) {
      const problem = channelProblem(a.contact, patch.channel);
      if (problem) throw new DbError(problem, "invalid_input");
    }
    const variant = patch.regenerate ? m.variant + 1 : m.variant;
    const text = await writeDraft(a, channel, variant, user.displayName);
    Object.assign(update, { channel, address: addressFor(a.contact, channel), recipient_name: a.contact?.name ?? m.recipientName, subject: text.subject, body: text.body, source: text.source, variant });
  }
  if (patch.body !== undefined) {
    const body = patch.body.trim();
    if (!body) throw new DbError("A message can't be empty.", "invalid_input");
    if (channel === "sms" && body.length > SMS_LIMIT) throw new DbError(`Keep an SMS under ${SMS_LIMIT} characters.`, "invalid_input");
    update.body = body;
    update.source = "owner";
  }
  if (patch.subject !== undefined && channel === "email") update.subject = (patch.subject ?? "").trim().slice(0, 200) || null;
  if (!Object.keys(update).length) return m;
  const wasApproved = m.status === "approved";
  Object.assign(update, {
    status: user.role === "owner" ? "draft" : "awaiting_approval",
    approved_by: null, approved_at: null, approved_hash: null, rejected_reason: null,
    version: m.version + 1, updated_at: new Date().toISOString(),
  });
  const res = check(await db().from("retention_messages").update(update).eq("id", id).eq("version", m.version).in("status", EDITABLE).select("*")) as Record<string, unknown>[];
  if (!res.length) throw new DbError("Someone changed this draft while you were looking at it. Read it again.", "stale_update");
  const what = patch.regenerate ? "asked Compass for a new wording of" : patch.channel && patch.channel !== m.channel ? `switched to ${patch.channel === "sms" ? "SMS" : "email"} for` : "edited";
  await event(mode, wasApproved ? "approval_cleared" : "draft_edited", `${user.displayName} ${what} the check-in to ${m.recipientName}.${wasApproved ? " The earlier approval was cleared, so it needs approving again." : ""}`, { student: m.studentId, message: id, actor: user.id });
  return toMessage(res[0]);
}

/** An admin passes a draft to the owner. */
export async function submitForApproval(user: SessionUser, id: string, version: number): Promise<void> {
  const mode = retentionMode();
  const m = await messageRow(mode, id);
  if (m.status !== "draft") throw new DbError("Only a prepared draft can be sent for approval.", "invalid_transition");
  const res = check(await db().from("retention_messages").update({ status: "awaiting_approval", version: m.version + 1, updated_at: new Date().toISOString() }).eq("id", id).eq("version", version).eq("status", "draft").select("id")) as unknown[];
  if (!res.length) throw new DbError("Someone changed this draft while you were looking at it. Read it again.", "stale_update");
  await event(mode, "submitted", `${user.displayName} sent the check-in to ${m.recipientName} to the owner for approval.`, { student: m.studentId, message: id, actor: user.id });
}

export async function approveDraft(user: SessionUser, id: string, version: number): Promise<{ version: number; approvedAt: string }> {
  const mode = retentionMode();
  const m = await messageRow(mode, id);
  const words = internalWording(`${m.subject ?? ""}\n${m.body}`);
  if (words.length) throw new DbError(`Take out internal wording before approving (${words.join(", ")}). Families shouldn't see assessments or notes.`, "invalid_input");
  const a = await assessmentFor(mode, m.studentId);
  const problem = channelProblem(a.contact, m.channel);
  if (problem) throw new DbError(problem, "invalid_input");
  const r = await db().rpc("approve_retention_message", { p_id: id, p_actor: user.id, p_version: version });
  if (r.error) throw toDbError(r.error);
  return r.data as { version: number; approvedAt: string };
}

export async function rejectDraft(user: SessionUser, id: string, version: number, reason: string): Promise<void> {
  const mode = retentionMode();
  const m = await messageRow(mode, id);
  if (!["draft", "awaiting_approval", "approved"].includes(m.status)) throw new DbError("This message can't be rejected now.", "invalid_transition");
  const res = check(await db().from("retention_messages").update({
    status: "rejected", rejected_reason: reason.trim().slice(0, 300) || null, approved_by: null, approved_at: null, approved_hash: null, version: m.version + 1, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("version", version).select("id")) as unknown[];
  if (!res.length) throw new DbError("Someone changed this draft while you were looking at it. Read it again.", "stale_update");
  await event(mode, "rejected", `${user.displayName} rejected the check-in to ${m.recipientName}${reason.trim() ? `: ${reason.trim().slice(0, 200)}` : "."}`, { student: m.studentId, message: id, actor: user.id });
}

/** Withdraws a draft that isn't needed. Sent messages are kept for the record. */
export async function discardDraft(user: SessionUser, id: string): Promise<void> {
  const mode = retentionMode();
  const m = await messageRow(mode, id);
  if (!EDITABLE.includes(m.status)) throw new DbError("A sent message is kept for the record and can't be removed.", "invalid_transition");
  check(await db().from("retention_messages").delete().eq("id", id).in("status", EDITABLE));
  await event(mode, "discarded", `${user.displayName} removed the unsent check-in to ${m.recipientName}.`, { student: m.studentId, actor: user.id });
}

export type SendResult = { status: "sent" | "failed"; simulated: boolean; channel: Channel; to: string; detail: string };

/** Sends one approved message after the owner confirms. The database refuses repeats and anything changed since approval. */
export async function sendApproved(user: SessionUser, id: string, channel: Channel): Promise<SendResult> {
  const mode = retentionMode();
  const ready = channelsReady(mode);
  if (!ready[channel]) throw new DbError(channel === "email" ? "Gmail isn't connected yet, so emails can't be sent. Ask your developer to add the Gmail settings." : "No SMS provider is connected yet, so texts can't be sent.", "invalid_input");
  const simulated = mode === "demo";
  const r = await db().rpc("send_retention_message", { p_id: id, p_actor: user.id, p_channel: channel, p_simulated: simulated });
  if (r.error) throw toDbError(r.error);
  const sent = r.data as { address: string; subject: string | null; body: string };
  if (simulated) return { status: "sent", simulated: true, channel, to: sent.address, detail: "Demo mode: simulated. Nothing was sent." };
  try {
    const ref = channel === "email" ? await gmailSend(sent.address, sent.subject ?? `A note from ${BUSINESS_NAME}`, sent.body) : await smsSend(sent.address, sent.body);
    check(await db().from("retention_messages").update({ status: "sent", delivery_status: "accepted", delivery_detail: channel === "email" ? "Accepted by Gmail" : "Accepted by the SMS provider", provider_ref: ref, updated_at: new Date().toISOString() }).eq("id", id));
    await event(mode, "sent", `${channel === "sms" ? "SMS" : "Email"} to ${sent.address} handed to ${channel === "sms" ? "the SMS provider" : "Gmail"}.`, { message: id, actor: user.id });
    return { status: "sent", simulated: false, channel, to: sent.address, detail: channel === "email" ? "Accepted by Gmail. Gmail doesn't confirm delivery." : "Accepted by the SMS provider. Use Check Delivery for confirmation." };
  } catch (e) {
    const reason = (e instanceof Error ? e.message : "Provider error").slice(0, 280);
    check(await db().from("retention_messages").update({ status: "failed", delivery_status: "failed", delivery_detail: reason, updated_at: new Date().toISOString() }).eq("id", id));
    await event(mode, "send_failed", `Sending to ${sent.address} failed: ${reason}`, { message: id, actor: user.id });
    return { status: "failed", simulated: false, channel, to: sent.address, detail: reason };
  }
}

/** Live SMS only: asks the provider whether the text was delivered. */
export async function checkDelivery(user: SessionUser, id: string): Promise<string> {
  const mode = retentionMode();
  const m = await messageRow(mode, id);
  if (mode === "demo" || m.mode === "demo") return "Demo messages aren't sent, so there is no delivery to check.";
  const row = check(await db().from("retention_messages").select("provider_ref").eq("id", id).single()) as { provider_ref: string | null };
  if (m.channel !== "sms" || !row.provider_ref) return "Gmail doesn't report delivery. Look for a reply instead.";
  const status = await smsStatus(row.provider_ref);
  const delivered = status === "delivered";
  const failed = status === "failed" || status === "undelivered";
  if (delivered || failed) {
    check(await db().from("retention_messages").update({ delivery_status: delivered ? "delivered" : "failed", delivery_detail: `Provider status: ${status}`, updated_at: new Date().toISOString() }).eq("id", id));
    await event(mode, delivered ? "delivered" : "delivery_failed", `The SMS provider reports the text to ${m.recipientName} as ${status}.`, { message: id, actor: user.id });
  }
  return `The provider reports: ${status}.`;
}

/** Records what happened after a check-in: a reply, a follow-up needed, or the case resolved. */
export async function updateTracking(user: SessionUser, id: string, change: { response?: string; followUp?: "required" | "resolved" }): Promise<void> {
  const mode = retentionMode();
  const m = await messageRow(mode, id);
  if (m.status !== "sent") throw new DbError("Only a sent check-in can be tracked.", "invalid_transition");
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (change.response !== undefined) {
    const note = change.response.trim();
    if (note.length < 3) throw new DbError("Add a short note about the reply.", "reason_required");
    Object.assign(update, { response_status: "received", response_at: new Date().toISOString(), response_note: note.slice(0, 500) });
  }
  if (change.followUp) Object.assign(update, { follow_up: change.followUp, ...(change.followUp === "required" ? { follow_up_on: sydneyToday(new Date()) } : {}) });
  check(await db().from("retention_messages").update(update).eq("id", id));
  const what = change.response !== undefined ? "recorded a reply from" : change.followUp === "resolved" ? "marked as resolved the check-in with" : "marked a follow-up as needed for";
  await event(mode, "tracking", `${user.displayName} ${what} ${m.recipientName}.`, { student: m.studentId, message: id, actor: user.id });
}

/** Demo mode only: puts the fictional retention records back. Genuine records are never touched. */
export async function resetRetentionDemo(user: SessionUser): Promise<void> {
  if (retentionMode() !== "demo") throw new DbError("Reset Demo is only available in demo mode.", "forbidden");
  const r = await db().rpc("reset_retention_demo");
  if (r.error) throw toDbError(r.error);
  await event("demo", "demo_reset", `${user.displayName} reset the Student Retention demo. Only fictional demo records were restored.`, { actor: user.id });
}
