import { addDays, sydneyDate, sydneyToday } from "@/lib/workflows/dates";
import type { Colour, RequestStatus, Role } from "@/lib/domain/types";
import { workflowFor, type Queue } from "@/lib/workflow/next-step";

// Insights: figures worked out from the saved records, never typed in. Every date is a
// calendar day in Sydney. Pure functions, so each calculation is tested on its own and
// the page only reads records and passes them in.

export type Period = {
  /** Today in Sydney, YYYY-MM-DD. */
  today: string;
  /** Monday to Sunday of this week in Sydney. */
  weekStart: string;
  weekEnd: string;
  days: string[];
  /** The last 30 days, today included. */
  recentStart: string;
};

export function sydneyPeriod(now: Date): Period {
  const today = sydneyToday(now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday
  const weekStart = addDays(today, -((dow + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return { today, weekStart, weekEnd: days[6], days, recentStart: addDays(today, -29) };
}

/** The Monday to Sunday after this one. Capacity falls back to it when nothing is offered this week yet. */
export function nextWeek(p: Period): Period {
  const days = p.days.map((d) => addDays(d, 7));
  return { ...p, weekStart: days[0], weekEnd: days[6], days };
}

/** A wide UTC window that surely covers this Sydney week and the next, for the database query. The functions below filter exactly. */
export function queryWindow(p: Period): { from: string; to: string } {
  return { from: `${addDays(p.weekStart, -1)}T00:00:00Z`, to: `${addDays(p.weekEnd, 9)}T00:00:00Z` };
}

export type SlotLite = { tutor_id: string; starts_at: string; ends_at: string; status: "free" | "booked" };
export type LessonLite = { id: string; tutor_id: string; starts_at: string; ends_at: string; status: "scheduled" | "completed" | "cancelled" };
export type AbsenceLite = { tutor_id: string; starts_on: string; ends_on: string };

const hours = (s: { starts_at: string; ends_at: string }) => Math.max(0, (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3_600_000);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function isAway(absences: AbsenceLite[], tutorId: string, day: string): boolean {
  return absences.some((a) => a.tutor_id === tutorId && a.starts_on <= day && day <= a.ends_on);
}

/** Lessons on the timetable today (scheduled or already taught; cancelled ones don't count). */
export function lessonsToday(lessons: LessonLite[], p: Period, now: Date) {
  const today = lessons.filter((l) => l.status !== "cancelled" && sydneyDate(l.starts_at) === p.today).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const next = today.find((l) => l.status === "scheduled" && new Date(l.starts_at) > now) ?? null;
  return { count: today.length, remaining: today.filter((l) => l.status === "scheduled" && new Date(l.starts_at) > now).length, next };
}

/**
 * Tutors with at least one free slot today who aren't recorded as away today, out of all
 * tutors. available is null when no availability at all is recorded for today, because
 * "0 available" would then be a guess.
 */
export function tutorsAvailable(tutorIds: string[], slots: SlotLite[], absences: AbsenceLite[], p: Period) {
  const todays = slots.filter((s) => sydneyDate(s.starts_at) === p.today);
  const away = tutorIds.filter((t) => isAway(absences, t, p.today));
  const free = new Set(todays.filter((s) => s.status === "free" && !isAway(absences, s.tutor_id, p.today)).map((s) => s.tutor_id));
  return { available: todays.length ? [...free].filter((t) => tutorIds.includes(t)).length : null, total: tutorIds.length, away: away.length };
}

export type DayCapacity = { day: string; booked: number; free: number };

/**
 * This week's capacity from the tutor calendar: booked hours against all offered hours
 * (booked plus free). A free slot on a day the tutor is recorded as away isn't offered.
 * percent is null when nothing is offered this week.
 */
export function weeklyCapacity(slots: SlotLite[], absences: AbsenceLite[], p: Period) {
  const byDay: DayCapacity[] = p.days.map((day) => ({ day, booked: 0, free: 0 }));
  for (const s of slots) {
    const day = sydneyDate(s.starts_at);
    const row = byDay.find((d) => d.day === day);
    if (!row) continue;
    if (s.status === "booked") row.booked += hours(s);
    else if (!isAway(absences, s.tutor_id, day)) row.free += hours(s);
  }
  for (const d of byDay) {
    d.booked = round1(d.booked);
    d.free = round1(d.free);
  }
  const booked = round1(byDay.reduce((n, d) => n + d.booked, 0));
  const offered = round1(byDay.reduce((n, d) => n + d.booked + d.free, 0));
  return { booked, offered, percent: offered > 0 ? Math.round((booked / offered) * 100) : null, byDay };
}

export type RequestLite = {
  decision: Colour;
  status: RequestStatus;
  created_at: string;
  missing: number;
  reviewStartedAt?: string | null;
  welfare?: boolean;
};

/** New requests in the last 30 days by the rule result they were given when saved. */
export function recentMix(rows: RequestLite[], p: Period): Record<Colour, number> & { total: number } {
  const out = { red: 0, amber: 0, green: 0, total: 0 };
  for (const r of rows) {
    const day = sydneyDate(r.created_at);
    if (day < p.recentStart || day > p.today) continue;
    out[r.decision] += 1;
    out.total += 1;
  }
  return out;
}

export const QUEUE_ORDER: Queue[] = ["clarify", "send", "review", "owner", "record"];
export const QUEUE_LABELS: Record<Queue, string> = {
  clarify: "Complete Missing Details",
  send: "Send to Owner",
  review: "Requires Your Review",
  owner: "Waiting for Owner",
  record: "Record Outcome",
  done: "Done",
};

/** Open requests by their next step for this person, using the shared next-step rules. */
export function openByNextStep(rows: RequestLite[], role: Role): Array<{ queue: Queue; label: string; count: number }> {
  const counts = new Map<Queue, number>();
  for (const r of rows) {
    const q = workflowFor({ role, status: r.status, missing: r.missing, reviewStartedAt: r.reviewStartedAt ?? null, colour: r.decision, welfare: r.welfare }).queue;
    if (q === "done") continue;
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  return QUEUE_ORDER.filter((q) => counts.has(q) || (role === "owner" ? q !== "send" && q !== "owner" : q !== "review")).map((q) => ({ queue: q, label: QUEUE_LABELS[q], count: counts.get(q) ?? 0 }));
}

/** "Mon 2" style labels for the chart. */
export function dayLabel(day: string): { short: string; long: string } {
  const d = new Date(`${day}T00:00:00Z`);
  return {
    short: d.toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" }),
    long: d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
  };
}
