import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { freeSlotsForBooking, resolveBooking } from "@/lib/context/retrieve";
import { db } from "@/lib/db/supabase";
import { formatAud } from "@/lib/domain/money";
import { DATA_LABEL_TEXT, type DataLabel } from "@/lib/domain/types";

const Lookup = z.object({ reference: z.string().trim().min(2).max(40), bookingId: z.string().trim().max(40).nullable().optional() }).strict();

// Lets the wizard show which records a reference matches, so the admin can pick the
// right booking before submitting. Read-only.
export const POST = apiRoute(async (req) => {
  await requireUser();
  const parsed = Lookup.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "Enter a booking, family or payment reference.");
  const reference = parsed.data.reference.toUpperCase();
  const res = await resolveBooking(reference, parsed.data.bookingId?.toUpperCase() || null);
  if (res.status !== "found") return { status: res.status, candidates: res.status === "multiple" ? res.candidates : [] };
  const b = res.row;
  const { data: payments } = await db().from("payments").select("id, invoice_ref, amount_cents, status").eq("booking_id", b.id).order("id");
  const slots = await freeSlotsForBooking(b.id);
  return {
    status: "found",
    booking: {
      id: b.id,
      label: `${b.subject} for ${b.families?.student_name ?? "unknown"} with ${b.tutors?.name ?? b.tutor_id}`,
      lessons: `${b.lessons_used} of ${b.lessons_purchased} lessons used`,
      source: DATA_LABEL_TEXT[b.data_label as DataLabel],
    },
    payments: (payments ?? []).map((p) => `${p.id} (${p.invoice_ref}): ${formatAud(p.amount_cents)}, ${p.status}`),
    slots: slots.map((s) => ({ id: s.id, startsAt: s.startsAt, status: s.status })),
  };
});
