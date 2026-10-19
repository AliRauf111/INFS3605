import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db/supabase";
import { canTeach, course, formatSelection, isYearLevel, validateSelection } from "@/lib/catalogue/hsc";
import { catalogueMissing } from "@/lib/data/catalogue";

// Changes to the HSC catalogue links. Every change is checked here against the catalogue
// in src/lib/catalogue/hsc.ts, and again by the database trigger and foreign keys.
// The owner decides what the business offers and what each tutor teaches. Admins and
// the owner can record students' courses and link bookings to a course.

const Pick = z
  .object({
    year: z.number().int(),
    areaId: z.string().max(40),
    courseId: z.string().max(60),
    level: z.string().max(20).nullable(),
    qualification: z.string().max(120),
  })
  .strict();

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("offer"), courseId: z.string().max(60), year: z.number().int(), offered: z.boolean() }).strict(),
  z.object({ action: z.literal("tutor_add"), tutorId: z.string().max(20), pick: Pick }).strict(),
  z.object({ action: z.literal("tutor_remove"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("student_add"), familyId: z.string().max(20), studentName: z.string().trim().min(1).max(80), pick: Pick }).strict(),
  z.object({ action: z.literal("student_remove"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("booking_set"), bookingId: z.string().max(20), pick: Pick.nullable() }).strict(),
]);

const NOT_SET_UP = "The database needs the subject catalogue update first. Run supabase/migrations/20261019000002_hsc_catalogue.sql and then supabase/catalogue.sql in the Supabase SQL Editor.";

function fail(error: { message?: string; code?: string } | null, what: string): never {
  if (catalogueMissing(error)) throw new ApiError(503, NOT_SET_UP);
  const m = /invalid_input: (.+)$/.exec(error?.message ?? "");
  if (m) throw new ApiError(400, m[1]);
  throw new ApiError(503, `The ${what} couldn't be saved. Try again.`);
}

function valid(pick: z.infer<typeof Pick>) {
  const v = validateSelection({ ...pick, year: isYearLevel(pick.year) ? pick.year : null, areaId: pick.areaId as never, level: pick.level as never });
  if (!v.ok) throw new ApiError(400, v.error);
  return v.value;
}

export const POST = apiRoute(async (req) => {
  const user = await requireUser();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "That change couldn't be read. Reload the page and try again.");
  const body = parsed.data;
  const ownerOnly = body.action === "offer" || body.action === "tutor_add" || body.action === "tutor_remove";
  if (ownerOnly && user.role !== "owner") throw new ApiError(403, "Only the owner can change what the business offers or what a tutor teaches.");

  switch (body.action) {
    case "offer": {
      if (!isYearLevel(body.year) || !course(body.courseId)?.years.includes(body.year)) throw new ApiError(400, "That course doesn't run in that year.");
      const res = await db()
        .from("course_offerings")
        .upsert({ course_id: body.courseId, year_level: body.year, offered: body.offered, updated_by: user.id, updated_at: new Date().toISOString() });
      if (res.error) fail(res.error, "offering");
      return { ok: true };
    }
    case "tutor_add": {
      const v = valid(body.pick);
      const res = await db()
        .from("tutor_courses")
        .upsert(
          { tutor_id: body.tutorId, course_id: v.courseId, year_level: v.year, course_level: v.level ?? "", qualification: v.qualification },
          { onConflict: "tutor_id,course_id,year_level,course_level", ignoreDuplicates: true },
        );
      if (res.error) fail(res.error, "tutor's course");
      return { ok: true, label: formatSelection(v) };
    }
    case "tutor_remove": {
      const res = await db().from("tutor_courses").delete().eq("id", body.id);
      if (res.error) fail(res.error, "tutor's course");
      return { ok: true };
    }
    case "student_add": {
      const v = valid(body.pick);
      const res = await db()
        .from("student_courses")
        .upsert(
          { family_id: body.familyId, student_name: body.studentName, course_id: v.courseId, year_level: v.year, course_level: v.level ?? "", qualification: v.qualification },
          { onConflict: "family_id,student_name,course_id,year_level,course_level", ignoreDuplicates: true },
        );
      if (res.error) fail(res.error, "student's course");
      return { ok: true, label: formatSelection(v) };
    }
    case "student_remove": {
      const res = await db().from("student_courses").delete().eq("id", body.id);
      if (res.error) fail(res.error, "student's course");
      return { ok: true };
    }
    case "booking_set": {
      const booking = await db().from("bookings").select("id, tutor_id").eq("id", body.bookingId).maybeSingle();
      if (booking.error) fail(booking.error, "booking");
      if (!booking.data) throw new ApiError(404, "That booking doesn't exist.");
      if (!body.pick) {
        const res = await db().from("bookings").update({ course_id: null, year_level: null, course_level: "", qualification: "" }).eq("id", body.bookingId);
        if (res.error) fail(res.error, "booking");
        return { ok: true };
      }
      const v = valid(body.pick);
      // A booking can only cover a course the business offers and its tutor teaches, in that exact year.
      const [offer, teaches] = await Promise.all([
        db().from("course_offerings").select("offered").eq("course_id", v.courseId).eq("year_level", v.year).maybeSingle(),
        db().from("tutor_courses").select("course_id, year_level, course_level").eq("tutor_id", booking.data.tutor_id),
      ]);
      if (offer.error) fail(offer.error, "booking");
      if (teaches.error) fail(teaches.error, "booking");
      const label = formatSelection(v);
      if (!offer.data?.offered) throw new ApiError(409, `The business doesn't offer ${label} yet. The owner can switch it on in the catalogue.`);
      const list = (teaches.data ?? []).map((t) => ({ courseId: t.course_id as string, year: t.year_level as 11 | 12, level: t.course_level as string }));
      if (!canTeach(list, { courseId: v.courseId, year: v.year, level: v.level })) {
        throw new ApiError(409, `This booking's tutor isn't recorded as teaching ${label}. Add it to their courses first, or choose a different tutor.`);
      }
      const res = await db()
        .from("bookings")
        .update({ course_id: v.courseId, year_level: v.year, course_level: v.level ?? "", qualification: v.qualification })
        .eq("id", body.bookingId);
      if (res.error) fail(res.error, "booking");
      return { ok: true, label };
    }
  }
});
