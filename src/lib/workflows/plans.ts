import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/api/handler";
import { db, toDbError } from "@/lib/db/supabase";
import { STATUS_LABELS, type RequestStatus, type RequestType } from "@/lib/domain/types";
import type { Change, Preconditions } from "@/lib/agent/proposal-logic";
import { REMINDER_LABELS, addDays, formatDay, formatRange, formatSlot, reminderSchedule, sydneyToday, type Reminder } from "./dates";
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

const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

async function absencesFor(tutorIds: string[]) {
  const rows = read(await db().from("tutor_absences").select("tutor_id, starts_on, ends_on").in("tutor_id", tutorIds).eq("status", "recorded")) ?? [];
  return (rows as Array<{ tutor_id: string; starts_on: string; ends_on: string }>).map((a) => ({ tutorId: a.tutor_id, startsOn: a.starts_on, endsOn: a.ends_on }));
}

/** Move Lesson: the lesson on the request's booking goes to the request's new time. */
export async function reschedulePlan(req: WorkflowRequest, raw: unknown): Promise<WorkflowPlanPart> {
  const parsed = RescheduleInputs.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "Choose the lesson and the new time first.");
  const i = parsed.data;
  if (req.request_type !== "lesson_change") throw new ApiError(400, "This request isn't a lesson change.");
  if (req.confirmed_facts?.proposedSlotId !== i.newSlotId) throw new ApiError(409, "The new time isn't the one on the request. Start the lesson change again.");
  const lesson = read(await db().from("lessons").select("id, booking_id, tutor_id, slot_id, starts_at, ends_at, status, updated_at").eq("id", i.lessonId).maybeSingle()) as
    | { id: string; booking_id: string; tutor_id: string; slot_id: string | null; starts_at: string; ends_at: string; status: string; updated_at: string }
    | null;
  if (!lesson) throw new ApiError(404, "That lesson could not be found.");
  if (lesson.booking_id !== req.booking_id) throw new ApiError(409, "That lesson isn't on this request's booking.");
  if (lesson.status !== "scheduled") throw new ApiError(409, `That lesson is ${lesson.status}, so it can't be moved.`);
  const slot = read(await db().from("tutor_availability").select("id, tutor_id, starts_at, ends_at, status, tutors(name)").eq("id", i.newSlotId).maybeSingle()) as
    | { id: string; tutor_id: string; starts_at: string; ends_at: string; status: string; tutors: { name: string } | null }
    | null;
  if (!slot) throw new ApiError(404, "That time could not be found.");
  if (slot.status !== "free") throw new ApiError(409, "That time is no longer free. Choose another time.");
  if (new Date(slot.starts_at).getTime() <= Date.now()) throw new ApiError(409, "That time has already passed.");
  const booking = read(await db().from("bookings").select("id, tutor_id, family_id, tutors(name), families(student_name)").eq("id", lesson.booking_id).maybeSingle()) as
    | { id: string; tutor_id: string; family_id: string; tutors: { name: string } | null; families: { student_name: string } | null }
    | null;
  if (!booking) throw new ApiError(404, "The booking could not be found.");
  const cover = slot.tutor_id !== booking.tutor_id;
  if (cover && req.status !== "approved") throw new ApiError(409, "A different tutor needs the owner's approval first.");
  if (isAbsent(slot.tutor_id, slot.starts_at, await absencesFor([slot.tutor_id]))) throw new ApiError(409, "That tutor is recorded as away at that time.");
  const currentTutor = read(await db().from("tutors").select("name").eq("id", lesson.tutor_id).maybeSingle()) as { name: string } | null;
  const newTutor = slot.tutors?.name ?? slot.tutor_id;
  const changes: Change[] = [
    { field: "Lesson time", current: formatSlot(lesson.starts_at), proposed: formatSlot(slot.starts_at) },
    { field: "Tutor", current: currentTutor?.name ?? lesson.tutor_id, proposed: cover ? `${newTutor} (covering)` : newTutor },
    { field: "Time slots", current: `${lesson.slot_id ?? "None"} held`, proposed: `${slot.id} held${lesson.slot_id ? `, ${lesson.slot_id} freed` : ""}` },
    { field: "Request", current: STATUS_LABELS[req.status], proposed: STATUS_LABELS.closed },
  ];
  return {
    inputs: { lessonId: lesson.id, newSlotId: slot.id, agreement: i.agreement },
    workflow: { lessonUpdatedAt: lesson.updated_at, slotStartsAt: slot.starts_at, slotStatus: slot.status },
    title: `Move Lesson: ${booking.families?.student_name ?? booking.id}`,
    changes,
    warnings: [
      "Nothing is sent to the family or the tutor. Let them know yourself once this is done.",
      ...(i.agreement ? [i.agreement] : []),
    ],
    versions: [`Lesson last changed ${fmtTime(lesson.updated_at)}`],
    target: { reference: `${booking.id} · ${lesson.id}`, typeLabel: "Lesson Change" },
  };
}

/** Extend Due Date: the invoice gets the request's extra days and a new reminder schedule. */
export async function extensionPlan(req: WorkflowRequest, raw: unknown, now = new Date()): Promise<WorkflowPlanPart> {
  const parsed = ExtensionInputs.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "Choose the invoice and the extra days first.");
  const i = parsed.data;
  if (req.request_type !== "payment_extension") throw new ApiError(400, "This request isn't a payment extension.");
  if (req.confirmed_facts?.extensionDays !== i.extensionDays) throw new ApiError(409, "The extra days aren't the ones on the request. Start the payment extension again.");
  const pay = read(await db().from("payments").select("id, booking_id, invoice_ref, amount_cents, status, due_date, updated_at").eq("id", i.paymentId).maybeSingle()) as
    | { id: string; booking_id: string; invoice_ref: string; amount_cents: number; status: string; due_date: string | null; updated_at: string }
    | null;
  if (!pay) throw new ApiError(404, "That invoice could not be found.");
  if (pay.booking_id !== req.booking_id) throw new ApiError(409, "That invoice isn't on this request's booking.");
  if (pay.status !== "pending" && pay.status !== "overdue") throw new ApiError(409, `That invoice is ${pay.status}, so there's nothing to extend.`);
  if (!pay.due_date) throw new ApiError(409, "That invoice has no due date on record.");
  const today = sydneyToday(now);
  const newDue = addDays(pay.due_date, i.extensionDays);
  const reminders: Reminder[] = reminderSchedule(newDue, today);
  const current = (read(await db().from("payment_reminders").select("remind_on, kind").eq("payment_id", pay.id).eq("status", "scheduled").order("remind_on")) ?? []) as Array<{ remind_on: string; kind: Reminder["kind"] }>;
  const status = newDue >= today ? "pending" : pay.status;
  return {
    inputs: { paymentId: pay.id, extensionDays: i.extensionDays, newDueDate: newDue, reminders },
    workflow: { dueDate: pay.due_date, paymentStatus: pay.status, paymentUpdatedAt: pay.updated_at },
    title: `Extend Due Date: ${pay.invoice_ref}`,
    changes: [
      { field: "Due date", current: formatDay(pay.due_date), proposed: `${formatDay(newDue)} (${i.extensionDays} extra days)` },
      { field: "Invoice status", current: pay.status === "overdue" ? "Overdue" : "Pending", proposed: status === "overdue" ? "Overdue" : "Pending" },
      {
        field: "Reminders",
        current: current.length ? current.map((r) => `${formatDay(r.remind_on)} (${REMINDER_LABELS[r.kind].toLowerCase()})`).join("; ") : "None scheduled",
        proposed: reminders.map((r) => `${formatDay(r.date)} (${REMINDER_LABELS[r.kind].toLowerCase()})`).join("; "),
      },
      { field: "Request", current: STATUS_LABELS[req.status], proposed: STATUS_LABELS.closed },
    ],
    warnings: [
      "Tutor Compass isn't connected to an invoicing system, so this changes Tutor Compass's record only. Update your invoicing system too.",
      "Reminders are recorded in Tutor Compass only. Email and text aren't connected, so none will be sent.",
    ],
    versions: [`Invoice last changed ${fmtTime(pay.updated_at)}`],
    target: { reference: `${pay.invoice_ref} · ${pay.id}`, typeLabel: "Payment Extension" },
  };
}

/** Record Absence: the tutor is away for these days. */
export async function absencePlan(raw: unknown, now = new Date()): Promise<WorkflowPlanPart> {
  const parsed = AbsenceInputs.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "Choose the tutor and the dates first.");
  const i = parsed.data;
  if (i.endsOn < i.startsOn) throw new ApiError(400, "The absence ends before it starts.");
  if (i.endsOn < sydneyToday(now)) throw new ApiError(400, "Those dates have already passed.");
  const tutor = read(await db().from("tutors").select("id, name").eq("id", i.tutorId).maybeSingle()) as { id: string; name: string } | null;
  if (!tutor) throw new ApiError(404, "That tutor could not be found.");
  const overlaps = (await absencesFor([tutor.id])).filter((a) => a.startsOn <= i.endsOn && a.endsOn >= i.startsOn).length;
  if (overlaps > 0) throw new ApiError(409, `An absence is already recorded for ${tutor.name} on some of these dates.`);
  const lessons = (read(await db().from("lessons").select("id, starts_at").eq("tutor_id", tutor.id).eq("status", "scheduled").gte("starts_at", now.toISOString())) ?? []) as Array<{ id: string; starts_at: string }>;
  const inPeriod = lessons.filter((l) => isAbsent(tutor.id, l.starts_at, [{ tutorId: tutor.id, startsOn: i.startsOn, endsOn: i.endsOn }]));
  return {
    inputs: { tutorId: tutor.id, startsOn: i.startsOn, endsOn: i.endsOn, note: i.note },
    workflow: { absenceOverlaps: overlaps },
    title: `Record Absence: ${tutor.name}`,
    changes: [
      { field: "Absence", current: "None recorded for these dates", proposed: formatRange(i.startsOn, i.endsOn) },
      { field: "Lessons in this period", current: `${inPeriod.length}`, proposed: `${inPeriod.length}, unchanged until you confirm each change` },
    ],
    warnings: ["Nothing is sent to the tutor or any family."],
    versions: [`Read ${fmtTime(now.toISOString())}`],
    target: { reference: `${tutor.name} (${tutor.id})`, typeLabel: "Tutor Absence" },
  };
}
