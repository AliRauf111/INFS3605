import "server-only";
import { db } from "@/lib/db/supabase";
import { addDays } from "@/lib/workflows/dates";
import type { AbsenceLite, SlotLite } from "@/lib/insights/logic";
import type { PolicyLite } from "@/lib/overview/rules";

// Extra records the Overview reads beside the request list: tutor calendar weeks for the
// capacity chart, student names for the request cards and the latest request events.

/** Tutor availability and absences from Monday `from` up to (not including) Monday `to`. */
export async function calendarWeeks(from: string, to: string): Promise<{ slots: SlotLite[]; absences: AbsenceLite[] }> {
  const [slots, absences] = await Promise.all([
    db().from("tutor_availability").select("tutor_id, starts_at, ends_at, status").gte("starts_at", `${addDays(from, -1)}T00:00:00Z`).lt("starts_at", `${addDays(to, 1)}T00:00:00Z`),
    db().from("tutor_absences").select("tutor_id, starts_on, ends_on").eq("status", "recorded").lt("starts_on", to).gte("ends_on", from),
  ]);
  if (slots.error) throw new Error(`Could not load tutor availability: ${slots.error.message}`);
  return { slots: (slots.data ?? []) as SlotLite[], absences: absences.error ? [] : ((absences.data ?? []) as AbsenceLite[]) };
}

/** The student on each booking, for the initials on request cards. */
export async function studentsByBooking(bookingIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(bookingIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const res = await db().from("bookings").select("id, families(student_name)").in("id", ids);
  if (res.error) return new Map();
  const out = new Map<string, string>();
  for (const b of (res.data ?? []) as unknown as Array<{ id: string; families: { student_name: string | null } | null }>) {
    if (b.families?.student_name) out.set(b.id, b.families.student_name);
  }
  return out;
}

export type RecentEvent = { id: string; request_id: string; event_type: string; created_at: string };

/** The latest things that happened to requests, newest first. Saving a request isn't counted. */
export async function recentEvents(limit = 3): Promise<RecentEvent[]> {
  const res = await db()
    .from("request_events")
    .select("id, request_id, event_type, created_at")
    .in("event_type", ["sent_to_owner", "owner_approved", "owner_declined", "owner_requested_info", "admin_replied", "closed", "reevaluated"])
    .order("created_at", { ascending: false })
    .limit(limit);
  return res.error ? [] : ((res.data ?? []) as RecentEvent[]);
}

/** The owner's active rule sets, for the rules card. */
export async function activePolicies(): Promise<PolicyLite[]> {
  const res = await db().from("policy_versions").select("category, definition").eq("status", "active");
  return res.error ? [] : ((res.data ?? []) as PolicyLite[]);
}
