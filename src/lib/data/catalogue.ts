import "server-only";
import { db } from "@/lib/db/supabase";
import { categoryCode, course, isYearLevel, levelName, type YearLevel } from "@/lib/catalogue/hsc";

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

/** The class a request is about. */
export type RequestClass = { code: string; subject: string; year: YearLevel };

type CourseCols = { course_id: string | null; year_level: number | null; course_level: string | null; category_code: string | null };

function toClass(c: CourseCols): RequestClass | null {
  const crs = c.course_id ? course(c.course_id) : undefined;
  if (!crs || !isYearLevel(c.year_level)) return null;
  const subject = [crs.name, crs.kind === "language" ? levelName(c.course_level) : ""].filter(Boolean).join(" ");
  return { code: c.category_code ?? categoryCode(crs.areaId, c.year_level) ?? "", subject, year: c.year_level };
}

const COURSE_COLS = "course_id, year_level, course_level, category_code";

/**
 * The class for each request, keyed by request id. A class saved on the request itself
 * comes first. Otherwise the class of its booking (or of its reference, when that is a
 * booking number) is used. Requests with neither are left out and show "No class linked".
 * Everything is read fresh on each page load, so a saved change shows after a refresh.
 */
export async function classesForRequests(rows: Array<{ id: string; booking_id: string | null; reference_id: string | null }>): Promise<Map<string, RequestClass>> {
  const out = new Map<string, RequestClass>();
  if (rows.length === 0) return out;

  const own = await db().from("requests").select(`id, ${COURSE_COLS}`).in("id", rows.map((r) => r.id));
  if (!catalogueMissing(own.error)) {
    for (const r of check(own, "request classes") as Array<CourseCols & { id: string }>) {
      const c = toClass(r);
      if (c) out.set(r.id, c);
    }
  }

  const bookingOf = (r: (typeof rows)[number]) => r.booking_id ?? (r.reference_id && /^BK-\d+$/.test(r.reference_id) ? r.reference_id : null);
  const rest = rows.filter((r) => !out.has(r.id));
  const ids = [...new Set(rest.map(bookingOf).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return out;
  const res = await db().from("bookings").select(`id, ${COURSE_COLS}`).in("id", ids);
  if (catalogueMissing(res.error)) return out; // the catalogue update hasn't been run yet
  const byBooking = new Map<string, RequestClass>();
  for (const b of check(res, "booking classes") as Array<CourseCols & { id: string }>) {
    const c = toClass(b);
    if (c) byBooking.set(b.id, c);
  }
  for (const r of rest) {
    const c = byBooking.get(bookingOf(r) ?? "");
    if (c) out.set(r.id, c);
  }
  return out;
}

/** The class saved on one request, for its own page. "not_set_up" until the database update is run. */
export async function savedRequestClass(id: string): Promise<{ courseId: string; year: YearLevel; level: string; qualification: string; label: RequestClass } | null | "not_set_up"> {
  const res = await db().from("requests").select(`${COURSE_COLS}, qualification`).eq("id", id).maybeSingle();
  if (catalogueMissing(res.error)) return "not_set_up";
  const row = check(res, "request class") as (CourseCols & { qualification: string }) | null;
  const label = row ? toClass(row) : null;
  if (!row || !label) return null;
  return { courseId: row.course_id!, year: label.year, level: row.course_level ?? "", qualification: row.qualification ?? "", label };
}
