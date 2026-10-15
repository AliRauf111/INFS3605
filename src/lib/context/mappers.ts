import type { BookingRecord, PaymentRecord, SlotRecord } from "@/lib/engine/evidence";
import type { DataLabel } from "@/lib/domain/types";

// Turns database rows into the frozen records stored in an evidence snapshot.
// Staleness is decided here, at retrieval time, so the engine itself never reads a clock.

export const STALE_AFTER_DAYS = 30;

export function isStale(lastSyncedAt: string, now: Date): boolean {
  const ageMs = now.getTime() - new Date(lastSyncedAt).getTime();
  return ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

export type BookingRow = {
  id: string;
  family_id: string;
  tutor_id: string;
  subject: string;
  lessons_purchased: number;
  lessons_used: number;
  price_cents: number;
  status: BookingRecord["status"];
  data_label: DataLabel;
  last_synced_at: string;
  families?: { student_name: string } | null;
  tutors?: { name: string } | null;
};

export type PaymentRow = {
  id: string;
  booking_id: string;
  invoice_ref: string;
  amount_cents: number;
  status: PaymentRecord["status"];
  paid_at: string | null;
  due_date: string | null;
  data_label: DataLabel;
  last_synced_at: string;
};

export type SlotRow = {
  id: string;
  tutor_id: string;
  starts_at: string;
  ends_at: string;
  status: SlotRecord["status"];
  data_label: DataLabel;
  last_synced_at: string;
  tutors?: { name: string } | null;
};

export function mapBooking(row: BookingRow, now: Date): BookingRecord {
  return {
    id: row.id,
    familyId: row.family_id,
    studentName: row.families?.student_name ?? "Unknown student",
    tutorId: row.tutor_id,
    tutorName: row.tutors?.name ?? row.tutor_id,
    subject: row.subject,
    lessonsPurchased: row.lessons_purchased,
    lessonsUsed: row.lessons_used,
    priceCents: row.price_cents,
    status: row.status,
    dataLabel: row.data_label,
    lastSyncedAt: new Date(row.last_synced_at).toISOString(),
    stale: isStale(row.last_synced_at, now),
  };
}

export function mapPayment(row: PaymentRow, now: Date): PaymentRecord {
  return {
    id: row.id,
    bookingId: row.booking_id,
    invoiceRef: row.invoice_ref,
    amountCents: row.amount_cents,
    status: row.status,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    dueDate: row.due_date,
    dataLabel: row.data_label,
    lastSyncedAt: new Date(row.last_synced_at).toISOString(),
    stale: isStale(row.last_synced_at, now),
  };
}

export function mapSlot(row: SlotRow, now: Date): SlotRecord {
  return {
    id: row.id,
    tutorId: row.tutor_id,
    tutorName: row.tutors?.name ?? row.tutor_id,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    status: row.status,
    dataLabel: row.data_label,
    lastSyncedAt: new Date(row.last_synced_at).toISOString(),
    stale: isStale(row.last_synced_at, now),
  };
}

/** Which kind of identifier Sarah typed. Only confirmed identifiers are looked up. */
export function classifyReference(ref: string): "booking" | "family" | "payment" | "unknown" {
  if (/^BK-\d{3,8}$/.test(ref)) return "booking";
  if (/^FAM-\d{2,6}$/.test(ref)) return "family";
  if (/^PAY-\d{3,8}$/.test(ref)) return "payment";
  return "unknown";
}
