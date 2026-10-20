import "server-only";
import { db } from "@/lib/db/supabase";
import type { ConfirmedFacts } from "@/lib/validation/facts";
import type { BookingRecord, EvidenceSnapshot, PaymentRecord } from "@/lib/engine/evidence";
import type { PolicyCategory, PolicyDefinition, PolicySnapshot } from "@/lib/engine/policy";
import { POLICY_CATEGORIES } from "@/lib/engine/policy";
import { classifyReference, mapBooking, mapPayment, mapSlot, type BookingRow, type PaymentRow, type SlotRow } from "./mappers";

// Context retrieval: gathers the records a decision depends on, using only identifiers
// a person has confirmed. It never guesses. If several bookings match, it says so and
// the admin chooses.

const BOOKING_SELECT =
  "id, family_id, tutor_id, subject, lessons_purchased, lessons_used, price_cents, status, data_label, last_synced_at, families(student_name), tutors(name)";

async function bookingById(id: string): Promise<BookingRow | null> {
  const { data, error } = await db().from("bookings").select(BOOKING_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  return (data as unknown as BookingRow) ?? null;
}

async function bookingsForFamily(familyId: string): Promise<BookingRow[]> {
  const { data, error } = await db()
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("family_id", familyId)
    .neq("status", "cancelled")
    .order("id");
  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  return (data ?? []) as unknown as BookingRow[];
}

function bookingLabel(b: BookingRow) {
  return `${b.id}: ${b.subject} for ${b.families?.student_name ?? "unknown"} with ${b.tutors?.name ?? b.tutor_id}`;
}

export type BookingResolution =
  | { status: "not_checked" }
  | { status: "not_found"; reference: string }
  | { status: "multiple"; reference: string; candidates: Array<{ id: string; label: string }> }
  | { status: "found"; row: BookingRow };

/** Find the booking for a confirmed reference. bookingId is the admin's explicit choice. */
export async function resolveBooking(referenceId: string | null, bookingId: string | null): Promise<BookingResolution> {
  const reference = referenceId ?? bookingId;
  if (!reference) return { status: "not_checked" };

  if (bookingId) {
    const row = await bookingById(bookingId);
    if (!row) return { status: "not_found", reference: bookingId };
    // The chosen booking must belong to the reference that was typed.
    const kind = referenceId ? classifyReference(referenceId) : "booking";
    if (kind === "family" && row.family_id !== referenceId) return { status: "not_found", reference: bookingId };
    if (kind === "booking" && referenceId && referenceId !== bookingId) return { status: "not_found", reference: bookingId };
    if (kind === "payment" || kind === "unknown") {
      if (kind === "unknown") return { status: "not_found", reference: referenceId! };
      const { data } = await db().from("payments").select("booking_id").eq("id", referenceId!).maybeSingle();
      if (!data || data.booking_id !== bookingId) return { status: "not_found", reference: bookingId };
    }
    return { status: "found", row };
  }

  switch (classifyReference(reference)) {
    case "booking": {
      const row = await bookingById(reference);
      return row ? { status: "found", row } : { status: "not_found", reference };
    }
    case "family": {
      const rows = await bookingsForFamily(reference);
      if (rows.length === 0) return { status: "not_found", reference };
      if (rows.length === 1) return { status: "found", row: rows[0] };
      return { status: "multiple", reference, candidates: rows.map((r) => ({ id: r.id, label: bookingLabel(r) })) };
    }
    case "payment": {
      const { data } = await db().from("payments").select("booking_id").eq("id", reference).maybeSingle();
      if (!data) return { status: "not_found", reference };
      const row = await bookingById(data.booking_id);
      return row ? { status: "found", row } : { status: "not_found", reference };
    }
    default:
      return { status: "not_found", reference };
  }
}

export async function retrieveEvidence(facts: ConfirmedFacts, now = new Date()): Promise<EvidenceSnapshot> {
  const resolution = await resolveBooking(facts.referenceId, facts.bookingId);
  const evidence: EvidenceSnapshot = {
    retrievedAt: now.toISOString(),
    booking:
      resolution.status === "found"
        ? { status: "found", record: mapBooking(resolution.row, now) }
        : resolution.status === "multiple"
          ? { status: "multiple", reference: resolution.reference, candidates: resolution.candidates }
          : resolution.status === "not_found"
            ? { status: "not_found", reference: resolution.reference }
            : { status: "not_checked" },
    payments: { status: "not_checked" },
    availability: { status: "not_checked" },
  };

  if (resolution.status === "found") {
    const { data, error } = await db()
      .from("payments")
      .select("id, booking_id, invoice_ref, amount_cents, status, paid_at, due_date, data_label, last_synced_at")
      .eq("booking_id", resolution.row.id)
      .order("id");
    if (error) throw new Error(`Payment lookup failed: ${error.message}`);
    evidence.payments = { status: "checked", records: ((data ?? []) as PaymentRow[]).map((p) => mapPayment(p, now)) };
  }

  if (facts.proposedSlotId) {
    const { data, error } = await db()
      .from("tutor_availability")
      .select("id, tutor_id, starts_at, ends_at, status, data_label, last_synced_at, tutors(name)")
      .eq("id", facts.proposedSlotId)
      .maybeSingle();
    if (error) throw new Error(`Availability lookup failed: ${error.message}`);
    evidence.availability = data
      ? { status: "found", record: mapSlot(data as unknown as SlotRow, now) }
      : { status: "not_found", slotId: facts.proposedSlotId };
  }
  return evidence;
}

export async function getActivePolicy(category: string): Promise<PolicySnapshot | null> {
  if (!(POLICY_CATEGORIES as readonly string[]).includes(category)) return null;
  const { data, error } = await db()
    .from("policy_versions")
    .select("id, category, version, status, definition")
    .eq("category", category)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Policy lookup failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    category: data.category as PolicyCategory,
    version: data.version,
    status: "active",
    definition: data.definition as PolicyDefinition,
  };
}

/** Free slots for the tutor on a booking, for the lesson change step. */
export async function freeSlotsForBooking(bookingId: string) {
  const booking = await bookingById(bookingId);
  if (!booking) return [];
  const { data } = await db()
    .from("tutor_availability")
    .select("id, tutor_id, starts_at, ends_at, status, data_label, last_synced_at, tutors(name)")
    .eq("tutor_id", booking.tutor_id)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at");
  return ((data ?? []) as unknown as SlotRow[]).map((s) => mapSlot(s, new Date()));
}

/**
 * The booking and its payments as they are now, for comparing with the evidence a
 * decision used. Read-only, and only for a booking already linked to a request.
 */
export async function liveRecordsForBooking(bookingId: string, now = new Date()): Promise<{ booking: BookingRecord | null; payments: PaymentRecord[] | null }> {
  const row = await bookingById(bookingId);
  if (!row) return { booking: null, payments: null };
  const { data, error } = await db()
    .from("payments")
    .select("id, booking_id, invoice_ref, amount_cents, status, paid_at, due_date, data_label, last_synced_at")
    .eq("booking_id", bookingId)
    .order("id");
  if (error) throw new Error(`Payment lookup failed: ${error.message}`);
  return { booking: mapBooking(row, now), payments: ((data ?? []) as PaymentRow[]).map((p) => mapPayment(p, now)) };
}
