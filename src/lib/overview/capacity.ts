import { addDays, sydneyDate } from "@/lib/workflows/dates";
import { isAway, type AbsenceLite, type SlotLite } from "@/lib/insights/logic";

// The Overview capacity chart: booked hours against offered hours (booked plus free) from
// the tutor calendar, for each day of a week or each week of a month. Free time on a day a
// tutor is recorded as away isn't offered. Pure, so it can be tested.

export type CapacitySeries = { labels: string[]; booked: number[]; offered: number[]; percent: number | null };

const hours = (s: { starts_at: string; ends_at: string }) => Math.max(0, (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3_600_000);
const round1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Booked and offered hours on each day in `days`. */
export function hoursByDay(slots: SlotLite[], absences: AbsenceLite[], days: string[]): { booked: number[]; offered: number[] } {
  const index = new Map(days.map((d, i) => [d, i]));
  const booked = days.map(() => 0);
  const offered = days.map(() => 0);
  for (const s of slots) {
    const day = sydneyDate(s.starts_at);
    const i = index.get(day);
    if (i === undefined) continue;
    if (s.status === "booked") {
      booked[i] += hours(s);
      offered[i] += hours(s);
    } else if (!isAway(absences, s.tutor_id, day)) {
      offered[i] += hours(s);
    }
  }
  return { booked: booked.map(round1), offered: offered.map(round1) };
}

/** Share of offered hours that are booked, or null when nothing is offered. */
export function bookedPercent(booked: number[], offered: number[]): number | null {
  const o = sum(offered);
  return o > 0 ? Math.round((sum(booked) / o) * 100) : null;
}

/** One week, Monday to Sunday. */
export function weekSeries(slots: SlotLite[], absences: AbsenceLite[], weekStart: string): CapacitySeries {
  const { booked, offered } = hoursByDay(slots, absences, weekDays(weekStart));
  return { labels: DAY_LABELS, booked, offered, percent: bookedPercent(booked, offered) };
}

/** The Mondays of every week that has a day in the month holding `today` (YYYY-MM-DD). */
export function monthWeekStarts(today: string): string[] {
  const first = `${today.slice(0, 8)}01`;
  const [y, m] = today.split("-").map(Number);
  const last = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1);
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const starts: string[] = [];
  for (let d = addDays(first, -dow); d <= last; d = addDays(d, 7)) starts.push(d);
  return starts;
}

/** Each week of this month, days outside the month left out. */
export function monthSeries(slots: SlotLite[], absences: AbsenceLite[], today: string): CapacitySeries {
  const month = today.slice(0, 7);
  const starts = monthWeekStarts(today);
  const booked: number[] = [];
  const offered: number[] = [];
  for (const start of starts) {
    const days = weekDays(start).filter((d) => d.startsWith(month));
    const h = hoursByDay(slots, absences, days);
    booked.push(round1(sum(h.booked)));
    offered.push(round1(sum(h.offered)));
  }
  return { labels: starts.map((_, i) => `Wk ${i + 1}`), booked, offered, percent: bookedPercent(booked, offered) };
}

/** Percentage points between two periods, or null when either has nothing offered. */
export function pointsChange(now: number | null, before: number | null): number | null {
  return now === null || before === null ? null : now - before;
}

/** A round top for the chart's scale that splits into three even steps (the chart has four gridlines). */
export function niceMax(n: number): number {
  const steps = [1, 2, 3, 4, 5, 10, 15, 20, 25, 50, 100, 200, 500];
  const step = steps.find((s) => s * 3 >= n) ?? Math.ceil(n / 3 / 100) * 100;
  return Math.max(3, step * 3);
}
