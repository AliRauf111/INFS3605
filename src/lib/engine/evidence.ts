import type { DataLabel } from "@/lib/domain/types";

// Evidence is a frozen copy of the records the context retriever found. The engine
// only ever reads this snapshot, never the live database, so the same snapshot always
// gives the same decision. Staleness is worked out when the snapshot is taken.

export type BookingRecord = {
  id: string;
  familyId: string;
  studentName: string;
  tutorId: string;
  tutorName: string;
  subject: string;
  lessonsPurchased: number;
  lessonsUsed: number;
  priceCents: number;
  status: "active" | "completed" | "cancelled";
  dataLabel: DataLabel;
  lastSyncedAt: string;
  stale: boolean;
};

export type PaymentRecord = {
  id: string;
  bookingId: string;
  invoiceRef: string;
  amountCents: number;
  status: "paid" | "pending" | "overdue" | "refunded" | "disputed";
  paidAt: string | null;
  dueDate: string | null;
  dataLabel: DataLabel;
  lastSyncedAt: string;
  stale: boolean;
};

export type SlotRecord = {
  id: string;
  tutorId: string;
  tutorName: string;
  startsAt: string;
  endsAt: string;
  status: "free" | "booked";
  dataLabel: DataLabel;
  lastSyncedAt: string;
  stale: boolean;
};

export type EvidenceSnapshot = {
  retrievedAt: string;
  booking:
    | { status: "not_checked" }
    | { status: "not_found"; reference: string }
    | { status: "multiple"; reference: string; candidates: Array<{ id: string; label: string }> }
    | { status: "found"; record: BookingRecord };
  payments: { status: "not_checked" } | { status: "checked"; records: PaymentRecord[] };
  availability:
    | { status: "not_checked" }
    | { status: "not_found"; slotId: string }
    | { status: "found"; record: SlotRecord };
};

export const EMPTY_EVIDENCE: EvidenceSnapshot = {
  retrievedAt: "1970-01-01T00:00:00.000Z",
  booking: { status: "not_checked" },
  payments: { status: "not_checked" },
  availability: { status: "not_checked" },
};
