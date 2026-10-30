import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { freeSlotsForBooking, resolveBooking } from "@/lib/context/retrieve";
import { db } from "@/lib/db/supabase";
import { DATA_LABELS, type DataLabel } from "@/lib/domain/types";
import { getI18n } from "@/lib/i18n/server";

const PAYMENT_STATUSES = ["paid", "pending", "overdue", "refunded", "disputed"] as const;
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const Lookup = z.object({ reference: z.string().trim().min(2).max(40), bookingId: z.string().trim().max(40).nullable().optional() }).strict();

// Lets the wizard show which records a reference matches, so the admin can pick the
// right booking before submitting. Read-only.
export const POST = apiRoute(async (req) => {
  await requireUser();
  const { t, fmt } = await getI18n();
  const parsed = Lookup.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, t("wizard.lookup.enterReference"));
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
      label: t("wizard.lookup.bookingLabel", { subject: b.subject, student: b.families?.student_name ?? t("wizard.lookup.unknownStudent"), tutor: b.tutors?.name ?? b.tutor_id }),
      lessons: t("wizard.lookup.lessonsUsed", { used: b.lessons_used, purchased: b.lessons_purchased }),
      source: (DATA_LABELS as readonly string[]).includes(b.data_label) ? t(`domain.dataLabel.${b.data_label as DataLabel}`) : b.data_label,
    },
    payments: (payments ?? []).map((p) => t("wizard.lookup.payment", {
      id: p.id,
      invoice: p.invoice_ref,
      amount: fmt.money(p.amount_cents),
      status: (PAYMENT_STATUSES as readonly string[]).includes(p.status) ? t(`wizard.lookup.paymentStatus.${p.status as PaymentStatus}`) : p.status,
    })),
    slots: slots.map((s) => ({ id: s.id, startsAt: s.startsAt, status: s.status })),
  };
});
