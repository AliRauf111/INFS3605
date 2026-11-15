import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/api/handler";
import { db, toDbError } from "@/lib/db/supabase";
import type { RequestStatus, RequestType } from "@/lib/domain/types";
import { tr } from "@/lib/i18n/reply";
import type { Change, Preconditions } from "@/lib/agent/proposal-logic";
import { addDays, formatDay, formatRange, formatSlot, formatStamp, reminderLabel, reminderSchedule, sydneyToday, type Reminder } from "./dates";
import { isAbsent } from "./logic";

// Previews for the three workflow actions. Each one reads the records as they are now,
// checks them, and says exactly what will change. confirmProposal calls this again at
// confirm time and compares the result, and the database checks once more under a lock.

const LESSON = /^LSN-\d{3,8}$/;
const SLOT = /^SLOT-\d{3,8}$/;
const PAY = /^PAY-\d{3,8}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const RescheduleInputs = z.object({ lessonId: z.string().regex(LESSON), newSlotId: z.string().regex(SLOT), agreement: z.string().max(300).default("") });
export const ExtensionInputs = z.object({ paymentId: z.string().regex(PAY), extensionDays: z.number().int().min(1).max(120) });
export const AbsenceInputs = z.object({ tutorId: z.string().regex(/^T-\d{2,6}$/), startsOn: z.string().regex(DAY), endsOn: z.string().regex(DAY), note: z.string().max(500).default("") });

export type WorkflowRequest = {
  id: string;
  request_type: RequestType;
  status: RequestStatus;
  booking_id: string | null;
  reference_id: string | null;
  confirmed_facts: { proposedSlotId?: string | null; extensionDays?: number | null } | null;
};

export type WorkflowPlanPart = {
  inputs: Record<string, unknown>;
  workflow: NonNullable<Preconditions["workflow"]>;
  title: string;
  changes: Change[];
  warnings: string[];
  versions: string[];
  target?: { reference: string; typeLabel: string };
};

function read<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T | null {
  if (res.error) throw toDbError(res.error);
  return res.data;
}

// Previews are read by the person who prepared them, so they follow that person's language.
// The inputs, which the database acts on, never contain translated text.
const fmtTime = (iso: string) => formatStamp(iso);
const status = (s: RequestStatus) => tr(`domain.status.${s}`);
const reminderLine = (date: string, kind: Reminder["kind"]) => tr("reply.pay.reminderItem", { date: formatDay(date), kind: reminderLabel(kind).toLowerCase() });

async function absencesFor(tutorIds: string[]) {
  const rows = read(await db().from("tutor_absences").select("tutor_id, starts_on, ends_on").in("tutor_id", tutorIds).eq("status", "recorded")) ?? [];
  return (rows as Array<{ tutor_id: string; starts_on: string; ends_on: string }>).map((a) => ({ tutorId: a.tutor_id, startsOn: a.starts_on, endsOn: a.ends_on }));
}

/** Move Lesson: the lesson on the request's booking goes to the request's new time. */
export async function reschedulePlan(req: WorkflowRequest, raw: unknown): Promise<WorkflowPlanPart> {
  const parsed = RescheduleInputs.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, tr("reply.plan.chooseLesson"));
  const i = parsed.data;
  if (req.request_type !== "lesson_change") throw new ApiError(400, tr("reply.plan.notLessonChange"));
  if (req.confirmed_facts?.proposedSlotId !== i.newSlotId) throw new ApiError(409, tr("reply.plan.timeMismatch"));
  const lesson = read(await db().from("lessons").select("id, booking_id, tutor_id, slot_id, starts_at, ends_at, status, updated_at").eq("id", i.lessonId).maybeSingle()) as
    | { id: string; booking_id: string; tutor_id: string; slot_id: string | null; starts_at: string; ends_at: string; status: string; updated_at: string }
    | null;
  if (!lesson) throw new ApiError(404, tr("reply.plan.lessonNotFound"));
  if (lesson.booking_id !== req.booking_id) throw new ApiError(409, tr("reply.plan.lessonNotOnBooking"));
  if (lesson.status !== "scheduled") throw new ApiError(409, tr("reply.plan.lessonStatus", { status: lesson.status }));
  const slot = read(await db().from("tutor_availability").select("id, tutor_id, starts_at, ends_at, status, tutors(name)").eq("id", i.newSlotId).maybeSingle()) as
    | { id: string; tutor_id: string; starts_at: string; ends_at: string; status: string; tutors: { name: string } | null }
    | null;
  if (!slot) throw new ApiError(404, tr("reply.plan.slotNotFound"));
  if (slot.status !== "free") throw new ApiError(409, tr("reply.lesson.slotGone"));
  if (new Date(slot.starts_at).getTime() <= Date.now()) throw new ApiError(409, tr("reply.plan.slotPassed"));
  const booking = read(await db().from("bookings").select("id, tutor_id, family_id, tutors(name), families(student_name)").eq("id", lesson.booking_id).maybeSingle()) as
    | { id: string; tutor_id: string; family_id: string; tutors: { name: string } | null; families: { student_name: string } | null }
    | null;
  if (!booking) throw new ApiError(404, tr("reply.plan.bookingNotFound"));
  const cover = slot.tutor_id !== booking.tutor_id;
  if (cover && req.status !== "approved") throw new ApiError(409, tr("reply.plan.coverNeedsApproval"));
  if (isAbsent(slot.tutor_id, slot.starts_at, await absencesFor([slot.tutor_id]))) throw new ApiError(409, tr("reply.plan.tutorAway"));
  const currentTutor = read(await db().from("tutors").select("name").eq("id", lesson.tutor_id).maybeSingle()) as { name: string } | null;
  const newTutor = slot.tutors?.name ?? slot.tutor_id;
  const changes: Change[] = [
    { field: tr("reply.lesson.rowTime"), current: formatSlot(lesson.starts_at), proposed: formatSlot(slot.starts_at) },
    { field: tr("reply.lesson.rowTutor"), current: currentTutor?.name ?? lesson.tutor_id, proposed: cover ? tr("reply.plan.covering", { tutor: newTutor }) : newTutor },
    { field: tr("reply.plan.slots"), current: tr("reply.plan.held", { slot: lesson.slot_id ?? tr("reply.wf.none") }), proposed: lesson.slot_id ? tr("reply.plan.heldFreed", { slot: slot.id, freed: lesson.slot_id }) : tr("reply.plan.held", { slot: slot.id }) },
    { field: tr("reply.plan.request"), current: status(req.status), proposed: status("closed") },
  ];
  return {
    inputs: { lessonId: lesson.id, newSlotId: slot.id, agreement: i.agreement },
    workflow: { lessonUpdatedAt: lesson.updated_at, slotStartsAt: slot.starts_at, slotStatus: slot.status },
    title: `${tr("reply.action.booking_reschedule.label")}: ${booking.families?.student_name ?? booking.id}`,
    changes,
    warnings: [
      tr("reply.plan.tellThemYourself"),
      ...(i.agreement ? [i.agreement] : []),
    ],
    versions: [tr("reply.plan.lessonChanged", { time: fmtTime(lesson.updated_at) })],
    target: { reference: `${booking.id} · ${lesson.id}`, typeLabel: tr("domain.requestType.lesson_change") },
  };
}

/** Extend Due Date: the invoice gets the request's extra days and a new reminder schedule. */
export async function extensionPlan(req: WorkflowRequest, raw: unknown, now = new Date()): Promise<WorkflowPlanPart> {
  const parsed = ExtensionInputs.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, tr("reply.plan.chooseInvoice"));
  const i = parsed.data;
  if (req.request_type !== "payment_extension") throw new ApiError(400, tr("reply.plan.notExtension"));
  if (req.confirmed_facts?.extensionDays !== i.extensionDays) throw new ApiError(409, tr("reply.plan.daysMismatch"));
  const pay = read(await db().from("payments").select("id, booking_id, invoice_ref, amount_cents, status, due_date, updated_at").eq("id", i.paymentId).maybeSingle()) as
    | { id: string; booking_id: string; invoice_ref: string; amount_cents: number; status: string; due_date: string | null; updated_at: string }
    | null;
  if (!pay) throw new ApiError(404, tr("reply.plan.invoiceNotFound"));
  if (pay.booking_id !== req.booking_id) throw new ApiError(409, tr("reply.plan.invoiceNotOnBooking"));
  if (pay.status !== "pending" && pay.status !== "overdue") throw new ApiError(409, tr("reply.plan.invoiceStatus", { status: pay.status }));
  if (!pay.due_date) throw new ApiError(409, tr("reply.plan.noDueDate"));
  const today = sydneyToday(now);
  const newDue = addDays(pay.due_date, i.extensionDays);
  const reminders: Reminder[] = reminderSchedule(newDue, today);
  const current = (read(await db().from("payment_reminders").select("remind_on, kind").eq("payment_id", pay.id).eq("status", "scheduled").order("remind_on")) ?? []) as Array<{ remind_on: string; kind: Reminder["kind"] }>;
  const newStatus = newDue >= today ? "pending" : pay.status;
  const payStatus = (s: string) => tr(s === "overdue" ? "reply.plan.overdue" : "reply.plan.pending");
  return {
    inputs: { paymentId: pay.id, extensionDays: i.extensionDays, newDueDate: newDue, reminders },
    workflow: { dueDate: pay.due_date, paymentStatus: pay.status, paymentUpdatedAt: pay.updated_at },
    title: `${tr("reply.action.invoice_extend_due_date.label")}: ${pay.invoice_ref}`,
    changes: [
      { field: tr("reply.pay.rowDue"), current: formatDay(pay.due_date), proposed: tr("reply.plan.extraDays", { date: formatDay(newDue), count: i.extensionDays }) },
      { field: tr("reply.pay.rowStatus"), current: payStatus(pay.status), proposed: payStatus(newStatus) },
      {
        field: tr("reply.pay.rowReminders"),
        current: current.length ? current.map((r) => reminderLine(r.remind_on, r.kind)).join("; ") : tr("reply.plan.noneScheduled"),
        proposed: reminders.map((r) => reminderLine(r.date, r.kind)).join("; "),
      },
      { field: tr("reply.plan.request"), current: status(req.status), proposed: status("closed") },
    ],
    warnings: [
      tr("reply.plan.noInvoicing"),
      tr("reply.plan.remindersOnly"),
    ],
    versions: [tr("reply.plan.invoiceChanged", { time: fmtTime(pay.updated_at) })],
    target: { reference: `${pay.invoice_ref} · ${pay.id}`, typeLabel: tr("domain.requestType.payment_extension") },
  };
}

/** Record Absence: the tutor is away for these days. */
export async function absencePlan(raw: unknown, now = new Date()): Promise<WorkflowPlanPart> {
  const parsed = AbsenceInputs.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, tr("reply.plan.chooseTutor"));
  const i = parsed.data;
  if (i.endsOn < i.startsOn) throw new ApiError(400, tr("reply.plan.endsBeforeStart"));
  if (i.endsOn < sydneyToday(now)) throw new ApiError(400, tr("reply.plan.datesPassed"));
  const tutor = read(await db().from("tutors").select("id, name").eq("id", i.tutorId).maybeSingle()) as { id: string; name: string } | null;
  if (!tutor) throw new ApiError(404, tr("reply.plan.tutorNotFound"));
  const overlaps = (await absencesFor([tutor.id])).filter((a) => a.startsOn <= i.endsOn && a.endsOn >= i.startsOn).length;
  if (overlaps > 0) throw new ApiError(409, tr("reply.plan.overlap", { tutor: tutor.name }));
  const lessons = (read(await db().from("lessons").select("id, starts_at").eq("tutor_id", tutor.id).eq("status", "scheduled").gte("starts_at", now.toISOString())) ?? []) as Array<{ id: string; starts_at: string }>;
  const inPeriod = lessons.filter((l) => isAbsent(tutor.id, l.starts_at, [{ tutorId: tutor.id, startsOn: i.startsOn, endsOn: i.endsOn }]));
  return {
    inputs: { tutorId: tutor.id, startsOn: i.startsOn, endsOn: i.endsOn, note: i.note },
    workflow: { absenceOverlaps: overlaps },
    title: `${tr("reply.action.tutor_record_absence.label")}: ${tutor.name}`,
    changes: [
      { field: tr("reply.plan.absence"), current: tr("reply.plan.noneRecorded"), proposed: formatRange(i.startsOn, i.endsOn) },
      { field: tr("reply.plan.lessonsInPeriod"), current: `${inPeriod.length}`, proposed: tr("reply.plan.unchangedUntil", { count: inPeriod.length }) },
    ],
    warnings: [tr("reply.plan.nothingToTutor")],
    versions: [tr("reply.plan.read", { time: fmtTime(now.toISOString()) })],
    target: { reference: `${tutor.name} (${tutor.id})`, typeLabel: tr("reply.workflow.tutor_absence") },
  };
}
