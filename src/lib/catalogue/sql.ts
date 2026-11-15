// Builds supabase/catalogue.sql from the catalogue in hsc.ts. Every statement is safe to
// run again: catalogue rows are updated in place, and the business's own choices (which
// courses it offers, which tutors teach what) are only added when missing, never reset.

import { COURSES, SUBJECT_AREAS, type YearLevel } from "./hsc";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Demo data so the Subjects page has something to show. Fictional, like the rest of the seed. */
export const DEMO_TUTOR_COURSES: Array<[tutor: string, course: string, year: YearLevel]> = [
  ["T-01", "maths_standard", 11],
  ["T-01", "maths_standard_2", 12],
  ["T-01", "maths_advanced", 11],
  ["T-01", "maths_advanced", 12],
  ["T-01", "maths_extension_1", 11],
  ["T-01", "maths_extension_1", 12],
  ["T-02", "english_standard", 11],
  ["T-02", "english_standard", 12],
  ["T-02", "english_advanced", 11],
  ["T-02", "english_advanced", 12],
  ["T-02", "english_extension", 11],
  ["T-02", "english_extension_1", 12],
  ["T-03", "biology", 11],
  ["T-03", "biology", 12],
  ["T-03", "chemistry", 11],
  ["T-03", "chemistry", 12],
  ["T-03", "physics", 11],
];

export const DEMO_STUDENT_COURSES: Array<[family: string, student: string, course: string, year: YearLevel]> = [
  ["FAM-02", "Amara Okafor", "english_standard", 11],
  ["FAM-04", "Ravi Patel", "maths_advanced", 12],
];

export const DEMO_BOOKING_COURSES: Array<[booking: string, course: string, year: YearLevel]> = [
  ["BK-1043", "english_standard", 11],
  ["BK-1045", "maths_advanced", 12],
];

export function catalogueSql(): string {
  const lines: string[] = [
    "-- Generated from src/lib/catalogue/hsc.ts by npm run catalogue:generate. Do not edit by hand.",
    "-- NSW HSC subject catalogue for Years 11 and 12. Safe to run more than once.",
    "",
    "-- Subject areas and their Tutor Compass category codes (not NESA course numbers).",
  ];
  SUBJECT_AREAS.forEach((a, i) => {
    lines.push(
      `insert into public.hsc_subject_areas (id, name, year11_code, year12_code, sort_order) values (${q(a.id)}, ${q(a.name)}, ${q(a.codes[11])}, ${q(a.codes[12])}, ${i + 1}) on conflict (id) do update set name = excluded.name, year11_code = excluded.year11_code, year12_code = excluded.year12_code, sort_order = excluded.sort_order;`,
    );
  });
  lines.push("", "-- Courses. Each keeps its own id, separate from the shared category code.");
  COURSES.forEach((crs, i) => {
    lines.push(
      `insert into public.hsc_courses (id, area_id, name, kind, note, sort_order) values (${q(crs.id)}, ${q(crs.areaId)}, ${q(crs.name)}, ${q(crs.kind)}, ${q(crs.note ?? "")}, ${i + 1}) on conflict (id) do update set area_id = excluded.area_id, name = excluded.name, kind = excluded.kind, note = excluded.note, sort_order = excluded.sort_order;`,
    );
  });
  lines.push("", "-- The years each course runs in.");
  for (const crs of COURSES) {
    for (const y of crs.years) {
      lines.push(`insert into public.hsc_course_years (course_id, year_level) values (${q(crs.id)}, ${y}) on conflict do nothing;`);
    }
  }
  const valid = COURSES.flatMap((crs) => crs.years.map((y) => `(${q(crs.id)}, ${y})`));
  lines.push(
    "-- Remove year pairs the catalogue no longer has, unless something still uses them.",
    `delete from public.hsc_course_years y where (y.course_id, y.year_level) not in (values ${valid.join(", ")})`,
    "  and not exists (select 1 from public.course_offerings o where o.course_id = y.course_id and o.year_level = y.year_level and o.offered)",
    "  and not exists (select 1 from public.tutor_courses t where t.course_id = y.course_id and t.year_level = y.year_level)",
    "  and not exists (select 1 from public.student_courses s where s.course_id = y.course_id and s.year_level = y.year_level)",
    "  and not exists (select 1 from public.bookings b where b.course_id = y.course_id and b.year_level = y.year_level);",
    "delete from public.course_offerings o where not exists (select 1 from public.hsc_course_years y where y.course_id = o.course_id and y.year_level = o.year_level);",
  );

  const offered = new Set(DEMO_TUTOR_COURSES.map(([, c, y]) => `${c}|${y}`));
  lines.push("", "-- What the business offers. Existing choices are kept; new courses start switched off.");
  lines.push(
    `insert into public.course_offerings (course_id, year_level, offered) select course_id, year_level, (course_id || '|' || year_level) in (${[...offered].map(q).join(", ")}) from public.hsc_course_years on conflict do nothing;`,
  );

  lines.push("", "-- Demo tutors' exact courses and years. Added only if the tutor exists and doesn't have it yet.");
  for (const [t, c, y] of DEMO_TUTOR_COURSES) {
    lines.push(
      `insert into public.tutor_courses (tutor_id, course_id, year_level) select ${q(t)}, ${q(c)}, ${y} where exists (select 1 from public.tutors where id = ${q(t)}) on conflict do nothing;`,
    );
  }
  lines.push("", "-- Demo students' courses.");
  for (const [f, s, c, y] of DEMO_STUDENT_COURSES) {
    lines.push(
      `insert into public.student_courses (family_id, student_name, course_id, year_level) select ${q(f)}, ${q(s)}, ${q(c)}, ${y} where exists (select 1 from public.families where id = ${q(f)}) on conflict do nothing;`,
    );
  }
  lines.push("", "-- Link the demo Year 11 and 12 bookings to an exact course, only if not set already.");
  for (const [b, c, y] of DEMO_BOOKING_COURSES) {
    lines.push(`update public.bookings set course_id = ${q(c)}, year_level = ${y} where id = ${q(b)} and course_id is null;`);
  }
  return lines.join("\n") + "\n";
}
