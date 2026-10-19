import "server-only";
import { db } from "@/lib/db/supabase";
import { isYearLevel, type YearLevel } from "@/lib/catalogue/hsc";

// Server-side reads for the HSC catalogue: what the business offers, what each tutor
// teaches, what each student studies and which course each booking covers. The course
// list itself comes from src/lib/catalogue/hsc.ts, not from here.

export type CourseLink = { id: string; course_id: string; year_level: YearLevel; course_level: string; qualification: string; category_code: string | null };
export type TutorCourse = CourseLink & { tutor_id: string };
export type StudentCourse = CourseLink & { family_id: string; student_name: string };
export type BookingCourse = {
  id: string;
  family_id: string;
  tutor_id: string;
  subject: string;
  status: string;
  course_id: string | null;
  year_level: YearLevel | null;
  course_level: string;
  qualification: string;
};
export type FreeSlot = { id: string; tutor_id: string; starts_at: string };

export type CatalogueData = {
  /** False until the catalogue database update has been run. */
  ready: boolean;
  offered: Record<string, boolean>;
  tutors: Array<{ id: string; name: string }>;
  families: Array<{ id: string; student_name: string; parent_name: string }>;
  tutorCourses: TutorCourse[];
  studentCourses: StudentCourse[];
  bookings: BookingCourse[];
  freeSlots: FreeSlot[];
};

/** True when a table or column from the catalogue update doesn't exist yet. */
export function catalogueMissing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    /hsc_|course_offerings|tutor_courses|student_courses|course_id/.test(error.message ?? "")
  );
}

export const offerKey = (courseId: string, year: number) => `${courseId}|${year}`;

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`);
  return (res.data ?? []) as T;
}

const LINK = "id, course_id, year_level, course_level, qualification, category_code";

export async function catalogueData(): Promise<CatalogueData> {
  const [tutors, families, slots] = await Promise.all([
    db().from("tutors").select("id, name").order("id"),
    db().from("families").select("id, student_name, parent_name").order("id"),
    db().from("tutor_availability").select("id, tutor_id, starts_at").eq("status", "free").gte("starts_at", new Date().toISOString()).order("starts_at").limit(50),
  ]);
  const base = {
    tutors: check(tutors, "tutors") as CatalogueData["tutors"],
    families: check(families, "families") as CatalogueData["families"],
    freeSlots: check(slots, "availability") as FreeSlot[],
  };

  const [offers, tc, sc, bk] = await Promise.all([
    db().from("course_offerings").select("course_id, year_level, offered"),
    db().from("tutor_courses").select(`${LINK}, tutor_id`).order("tutor_id"),
    db().from("student_courses").select(`${LINK}, family_id, student_name`).order("family_id"),
    db().from("bookings").select("id, family_id, tutor_id, subject, status, course_id, year_level, course_level, qualification").order("id"),
  ]);
  const missing = [offers, tc, sc, bk].find((r) => catalogueMissing(r.error));
  if (missing) {
    const plain = await db().from("bookings").select("id, family_id, tutor_id, subject, status").order("id");
    const bookings = (check(plain, "bookings") as Array<Omit<BookingCourse, "course_id" | "year_level" | "course_level" | "qualification">>).map((b) => ({
      ...b,
      course_id: null,
      year_level: null,
      course_level: "",
      qualification: "",
    }));
    return { ready: false, offered: {}, tutorCourses: [], studentCourses: [], bookings, ...base };
  }
  const offered: Record<string, boolean> = {};
  for (const o of check(offers, "course offerings") as Array<{ course_id: string; year_level: number; offered: boolean }>) offered[offerKey(o.course_id, o.year_level)] = o.offered;
  const years = <T extends { year_level: unknown }>(rows: T[]) => rows.filter((r) => isYearLevel(r.year_level));
  return {
    ready: true,
    offered,
    tutorCourses: years(check(tc, "tutor courses") as TutorCourse[]),
    studentCourses: years(check(sc, "student courses") as StudentCourse[]),
    bookings: (check(bk, "bookings") as BookingCourse[]).map((b) => ({ ...b, year_level: isYearLevel(b.year_level) ? b.year_level : null })),
    ...base,
  };
}
