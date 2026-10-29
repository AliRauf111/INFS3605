import "server-only";
import { db } from "@/lib/db/supabase";
import { listRequests, withWorkflowState } from "@/lib/data/queries";
import { addDays } from "@/lib/workflows/dates";
import { queryWindow, type AbsenceLite, type LessonLite, type Period, type SlotLite } from "./logic";

// Reads the records Insights works from. Every figure on the page is calculated from these
// rows by src/lib/insights/logic.ts.

function rows<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

export async function insightsRecords(p: Period) {
  const w = queryWindow(p);
  const [tutors, slots, lessons, absences, requests] = await Promise.all([
    db().from("tutors").select("id, name").order("id"),
    db().from("tutor_availability").select("tutor_id, starts_at, ends_at, status").gte("starts_at", w.from).lt("starts_at", w.to),
    db().from("lessons").select("id, tutor_id, starts_at, ends_at, status").gte("starts_at", w.from).lt("starts_at", w.to).order("starts_at"),
    db().from("tutor_absences").select("tutor_id, starts_on, ends_on").eq("status", "recorded").lte("starts_on", addDays(p.weekEnd, 7)).gte("ends_on", p.weekStart),
    listRequests({ limit: 500 }).then(withWorkflowState),
  ]);
  return {
    tutors: rows<{ id: string; name: string }>(tutors, "tutors"),
    slots: rows<SlotLite>(slots, "tutor availability"),
    // Older databases without the timetable tables show "not available" rather than failing.
    lessons: lessons.error ? null : rows<LessonLite>(lessons, "lessons"),
    absences: absences.error ? [] : rows<AbsenceLite>(absences, "tutor absences"),
    requests,
  };
}

/** The next lessons on the timetable, for the Overview. Null when the timetable isn't set up. */
export async function upcomingLessons(now: Date, limit = 5) {
  const res = await db()
    .from("lessons")
    .select("id, tutor_id, starts_at, ends_at, status, bookings(subject, families(student_name)), tutors(name)")
    .eq("status", "scheduled")
    .gt("ends_at", now.toISOString())
    .order("starts_at")
    .limit(limit);
  if (res.error) return null;
  const absences = await db().from("tutor_absences").select("tutor_id, starts_on, ends_on").eq("status", "recorded").gte("ends_on", now.toISOString().slice(0, 10));
  return {
    lessons: (res.data ?? []) as unknown as Array<{
      id: string;
      tutor_id: string;
      starts_at: string;
      ends_at: string;
      bookings: { subject: string; families: { student_name: string } | null } | null;
      tutors: { name: string } | null;
    }>,
    absences: (absences.error ? [] : absences.data ?? []) as AbsenceLite[],
  };
}
