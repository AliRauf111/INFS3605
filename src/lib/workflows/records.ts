import "server-only";
import { db } from "@/lib/db/supabase";
import type { RequestStatus } from "@/lib/domain/types";
import type { ProposalAction } from "@/lib/agent/permissions";
import { countMissing } from "@/lib/workflow/next-step";
import type { Absence, Busy, SlotLite, TutorLite } from "./logic";

// Read tools for the Compass workflows. Each is an ordinary query with its own checks,
// so the workflows never scrape a page or guess at a record.

export class WorkflowsNotSetUp extends Error {}

function missingSchema(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || /lessons|tutor_absences|agent_workflows|payment_reminders|updated_at/.test(error.message ?? "")));
}

function rows<T>(res: { data: unknown; error: { message: string; code?: string } | null }, what: string): T {
  if (missingSchema(res.error)) throw new WorkflowsNotSetUp(what);
  if (res.error) throw new Error(`Could not read ${what}: ${res.error.message}`);
  return res.data as T;
}

export type LessonRow = {
  id: string;
  booking_id: string;
  tutor_id: string;
  slot_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  updated_at: string;
  tutors: { name: string } | null;
  bookings: { id: string; family_id: string; tutor_id: string; subject: string; course_id: string | null; year_level: number | null; families: { student_name: string; parent_name: string } | null } | null;
};

const LESSON_SELECT =
  "id, booking_id, tutor_id, slot_id, starts_at, ends_at, status, updated_at, tutors(name), bookings(id, family_id, tutor_id, subject, course_id, year_level, families(student_name, parent_name))";

export async function upcomingLessons(bookingId: string, now: Date): Promise<LessonRow[]> {
  return rows<LessonRow[]>(
    await db().from("lessons").select(LESSON_SELECT).eq("booking_id", bookingId).eq("status", "scheduled").gt("starts_at", now.toISOString()).order("starts_at"),
    "the lessons",
  ) ?? [];
}

export async function lessonById(id: string): Promise<LessonRow | null> {
  return rows<LessonRow | null>(await db().from("lessons").select(LESSON_SELECT).eq("id", id).maybeSingle(), "the lesson");
}

export async function tutorLessons(tutorId: string, now: Date): Promise<LessonRow[]> {
  return rows<LessonRow[]>(
    await db().from("lessons").select(LESSON_SELECT).eq("tutor_id", tutorId).eq("status", "scheduled").gt("starts_at", now.toISOString()).order("starts_at").limit(200),
    "the tutor's lessons",
  ) ?? [];
}

/** The family's other scheduled lessons, so a new time never clashes with one. */
export async function familyBusy(familyId: string, exceptLessonId: string): Promise<Busy[]> {
  const bookings = rows<Array<{ id: string }>>(await db().from("bookings").select("id").eq("family_id", familyId), "the family's bookings") ?? [];
  if (!bookings.length) return [];
  const list = rows<Array<{ id: string; starts_at: string; ends_at: string }>>(
    await db().from("lessons").select("id, starts_at, ends_at").in("booking_id", bookings.map((b) => b.id)).eq("status", "scheduled"),
    "the family's lessons",
  ) ?? [];
  return list.filter((l) => l.id !== exceptLessonId).map((l) => ({ startsAt: l.starts_at, endsAt: l.ends_at }));
}

export async function freeSlots(tutorIds: string[], from: Date): Promise<SlotLite[]> {
  if (!tutorIds.length) return [];
  const list = rows<Array<{ id: string; tutor_id: string; starts_at: string; ends_at: string; status: "free" | "booked" }>>(
    await db().from("tutor_availability").select("id, tutor_id, starts_at, ends_at, status").in("tutor_id", tutorIds).eq("status", "free").gt("starts_at", from.toISOString()).order("starts_at").limit(300),
    "tutor availability",
  ) ?? [];
  return list.map((s) => ({ id: s.id, tutorId: s.tutor_id, startsAt: new Date(s.starts_at).toISOString(), endsAt: new Date(s.ends_at).toISOString(), status: s.status }));
}

export async function slotById(id: string): Promise<(SlotLite & { tutorName: string }) | null> {
  const s = rows<{ id: string; tutor_id: string; starts_at: string; ends_at: string; status: "free" | "booked"; tutors: { name: string } | null } | null>(
    await db().from("tutor_availability").select("id, tutor_id, starts_at, ends_at, status, tutors(name)").eq("id", id).maybeSingle(),
    "the time slot",
  );
  return s ? { id: s.id, tutorId: s.tutor_id, startsAt: new Date(s.starts_at).toISOString(), endsAt: new Date(s.ends_at).toISOString(), status: s.status, tutorName: s.tutors?.name ?? s.tutor_id } : null;
}

export async function absences(tutorIds: string[]): Promise<Absence[]> {
  if (!tutorIds.length) return [];
  const list = rows<Array<{ tutor_id: string; starts_on: string; ends_on: string }>>(
    await db().from("tutor_absences").select("tutor_id, starts_on, ends_on").in("tutor_id", tutorIds).eq("status", "recorded"),
    "tutor absences",
  ) ?? [];
  return list.map((a) => ({ tutorId: a.tutor_id, startsOn: a.starts_on, endsOn: a.ends_on }));
}

export async function allTutors(): Promise<TutorLite[]> {
  const [t, c] = await Promise.all([db().from("tutors").select("id, name, subjects").order("id"), db().from("tutor_courses").select("tutor_id, course_id, year_level")]);
  const tutors = rows<Array<{ id: string; name: string; subjects: string[] }>>(t, "tutors") ?? [];
  const courses = (c.error ? [] : (c.data ?? [])) as Array<{ tutor_id: string; course_id: string; year_level: number }>;
  return tutors.map((x) => ({ id: x.id, name: x.name, subjects: x.subjects ?? [], courses: courses.filter((k) => k.tutor_id === x.id).map((k) => ({ courseId: k.course_id, yearLevel: k.year_level })) }));
}

export type InvoiceRow = { id: string; booking_id: string; invoice_ref: string; amount_cents: number; status: string; due_date: string | null; original_due_date: string | null; updated_at: string };
const INVOICE_SELECT = "id, booking_id, invoice_ref, amount_cents, status, due_date, original_due_date, updated_at";

/** Payments that match a PAY, INV, BK or FAM reference. The caller decides which are unpaid. */
export async function invoicesFor(reference: string): Promise<InvoiceRow[]> {
  const q = db().from("payments").select(INVOICE_SELECT).order("id");
  if (reference.startsWith("PAY-")) return rows<InvoiceRow[]>(await q.eq("id", reference), "the invoice") ?? [];
  if (reference.startsWith("INV-")) return rows<InvoiceRow[]>(await q.eq("invoice_ref", reference), "the invoice") ?? [];
  let bookingIds: string[] = [];
  if (reference.startsWith("BK-")) bookingIds = [reference];
  if (reference.startsWith("FAM-")) {
    bookingIds = (rows<Array<{ id: string }>>(await db().from("bookings").select("id").eq("family_id", reference), "the family's bookings") ?? []).map((b) => b.id);
  }
  if (!bookingIds.length) return [];
  return rows<InvoiceRow[]>(await q.in("booking_id", bookingIds), "the invoices") ?? [];
}

export async function invoiceById(id: string): Promise<(InvoiceRow & { bookings: { id: string; families: { student_name: string; parent_name: string } | null } | null }) | null> {
  return rows(await db().from("payments").select(`${INVOICE_SELECT}, bookings(id, families(student_name, parent_name))`).eq("id", id).maybeSingle(), "the invoice");
}

export async function scheduledReminders(paymentId: string): Promise<Array<{ remind_on: string; kind: "before_due" | "due_today" | "overdue" }>> {
  return rows(await db().from("payment_reminders").select("remind_on, kind").eq("payment_id", paymentId).eq("status", "scheduled").order("remind_on"), "the reminders") ?? [];
}

export async function familiesByStudent(): Promise<Array<{ id: string; student_name: string }>> {
  return rows(await db().from("families").select("id, student_name"), "families") ?? [];
}

/** A saved request's status and how many required details are missing. */
export async function requestState(id: string): Promise<{ status: RequestStatus; missing: number; reference: string } | null> {
  const r = rows<{ status: RequestStatus; current_decision_id: string | null; reference_id: string | null; booking_id: string | null } | null>(
    await db().from("requests").select("status, current_decision_id, reference_id, booking_id").eq("id", id).maybeSingle(),
    "the request",
  );
  if (!r) return null;
  let missing = 0;
  if (r.current_decision_id) {
    const d = await db().from("decisions").select("missing:result->missing").eq("id", r.current_decision_id).maybeSingle();
    missing = countMissing((d.data as { missing: Array<{ fact: string }> | null } | null)?.missing);
  }
  return { status: r.status, missing, reference: r.reference_id ?? r.booking_id ?? "" };
}

export type ProposalOutcome = { id: string; status: string; action: ProposalAction; result: Record<string, unknown> | null };

/**
 * Where a proposal ended up. Editing or a records change replaces a proposal with a new
 * one, so follow the chain to the newest, never preparing the same change twice.
 */
export async function followProposal(id: string, userId: string): Promise<ProposalOutcome | null> {
  let current = id;
  for (let i = 0; i < 10; i++) {
    const row = rows<{ id: string; status: string; action_type: ProposalAction; result: Record<string, unknown> | null; created_by: string } | null>(
      await db().from("agent_proposals").select("id, status, action_type, result, created_by").eq("id", current).maybeSingle(),
      "the proposal",
    );
    if (!row || row.created_by !== userId) return null;
    if (row.status === "superseded" || row.status === "stale") {
      const next = rows<Array<{ id: string }>>(await db().from("agent_proposals").select("id").eq("replaces", row.id).order("created_at", { ascending: false }).limit(1), "the proposal") ?? [];
      if (next.length) {
        current = next[0].id;
        continue;
      }
    }
    return { id: row.id, status: row.status, action: row.action_type, result: row.result };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Workflow runs

export type RunRow = {
  id: string;
  workflow: "lesson_change" | "payment_extension" | "tutor_absence";
  created_by: string;
  status: "active" | "waiting" | "completed" | "cancelled";
  stage: string;
  summary: string;
  state: unknown;
  request_id: string | null;
  updated_at: string;
};

export async function createRun(userId: string, sessionKey: string, workflow: RunRow["workflow"], state: unknown): Promise<RunRow> {
  return rows(
    await db().from("agent_workflows").insert({ created_by: userId, session_key: sessionKey, workflow, state, stage: "start" }).select("*").single(),
    "the workflow",
  );
}

export async function loadRun(id: string, userId: string): Promise<RunRow | null> {
  const row = rows<RunRow | null>(await db().from("agent_workflows").select("*").eq("id", id).maybeSingle(), "the workflow");
  return row && row.created_by === userId ? row : null;
}

export async function saveRun(id: string, patch: Partial<Pick<RunRow, "status" | "stage" | "summary" | "state" | "request_id">>): Promise<void> {
  const { error } = await db().from("agent_workflows").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`Could not save the workflow: ${error.message}`);
}

export async function openRuns(userId: string): Promise<RunRow[]> {
  const res = await db().from("agent_workflows").select("*").eq("created_by", userId).in("status", ["active", "waiting"]).order("updated_at", { ascending: false }).limit(50);
  if (missingSchema(res.error)) return [];
  if (res.error) throw new Error(`Could not read workflows: ${res.error.message}`);
  return (res.data ?? []) as RunRow[];
}
