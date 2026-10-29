import "server-only";
import { db } from "@/lib/db/supabase";
import { addDays } from "@/lib/workflows/dates";
import type { AbsenceLite } from "@/lib/insights/logic";
import type { LessonState } from "./calendar";

// Reads the lessons the Schedule page shows: every lesson on the days the month grid covers,
// with its subject, student and tutor, plus the tutor absences in that time.

export type ScheduleLesson = {
  id: string;
  booking_id: string;
  tutor_id: string;
  starts_at: string;
  ends_at: string;
  status: LessonState;
  bookings: { subject: string; families: { student_name: string } | null } | null;
  tutors: { name: string } | null;
};

const SELECT = "id, booking_id, tutor_id, starts_at, ends_at, status, bookings(subject, families(student_name)), tutors(name)";

/** Sydney midnight at the start of a day, as an instant. Sydney is UTC+10 or +11, so a day early and a filter after is safe. */
const roughStart = (day: string) => `${addDays(day, -1)}T00:00:00Z`;

/**
 * Lessons from the first to the last day (inclusive, Sydney). Null when the timetable tables
 * aren't set up in this database yet.
 */
export async function lessonsBetween(first: string, last: string): Promise<{ lessons: ScheduleLesson[]; absences: AbsenceLite[] } | null> {
  const [lessons, absences] = await Promise.all([
    db().from("lessons").select(SELECT).gte("starts_at", roughStart(first)).lt("starts_at", roughStart(addDays(last, 2))).order("starts_at"),
    db().from("tutor_absences").select("tutor_id, starts_on, ends_on").eq("status", "recorded").lte("starts_on", last).gte("ends_on", first),
  ]);
  if (lessons.error) return null;
  return {
    lessons: (lessons.data ?? []) as unknown as ScheduleLesson[],
    absences: absences.error ? [] : ((absences.data ?? []) as AbsenceLite[]),
  };
}

/** The next scheduled lesson from now, for the booking card. */
export async function nextLesson(now: Date): Promise<ScheduleLesson | null> {
  const res = await db().from("lessons").select(SELECT).eq("status", "scheduled").gt("starts_at", now.toISOString()).order("starts_at").limit(1);
  if (res.error) return null;
  return ((res.data ?? [])[0] as unknown as ScheduleLesson) ?? null;
}
