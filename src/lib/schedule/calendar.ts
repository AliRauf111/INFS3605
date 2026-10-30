// The Schedule page's month calendar: which days the grid shows, how a day is described to a
// screen reader, how the arrow keys move between days and how a lesson's time and status
// read. Days are plain Sydney calendar days, written YYYY-MM-DD. Nothing here reads the
// clock: callers pass "today", so it is unit tested.

import { addDays } from "@/lib/workflows/dates";
import { enT, type Translate } from "@/lib/i18n/core";

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const utcDate = (iso: string) => new Date(toUtc(iso));

/** The month a day falls in, written YYYY-MM. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** The month in the address (?month=2026-11), or this month when it is missing or not a real month. */
export function monthFromParam(param: string | undefined, today: string): string {
  if (param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param)) return param;
  return monthOf(today);
}

/** The day in the address (?day=2026-10-30) when it is a real day, otherwise null. */
export function dayFromParam(param: string | undefined): string | null {
  if (!param || !/^\d{4}-\d{2}-\d{2}$/.test(param)) return null;
  return utcDate(param).toISOString().slice(0, 10) === param ? param : null;
}

export function addMonths(month: string, n: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Monday to Sunday weeks covering the whole month, with the days either side filled in. */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const mondayOffset = (utcDate(first).getUTCDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  const next = `${addMonths(month, 1)}-01`;
  const weeks: string[][] = [];
  for (let day = start; day < next; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

/** "October 2026" */
export function monthLabel(month: string, locale = "en-AU"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" }).format(utcDate(`${month}-01`));
}

/** "Friday 30 October" */
export function longDay(day: string, locale = "en-AU"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(utcDate(day));
}

/** What a screen reader hears for a day in the grid: "Friday 30 October, 2 lessons". */
export function dayLabel(day: string, lessons: number, today?: string, t: Translate = enT, locale = "en-AU"): string {
  const count = lessons === 0 ? t("schedule.noLessonsLower") : t("schedule.lessonCountLower", { count: lessons });
  return day === today ? t("schedule.dayLabelToday", { day: longDay(day, locale), lessons: count }) : t("schedule.dayLabel", { day: longDay(day, locale), lessons: count });
}

/**
 * Where the arrow keys, Home and End move to from a day. Null for any other key. In a
 * right-to-left layout the week runs from right to left, so Left and Right swap.
 */
export function moveDay(day: string, key: string, dir: "ltr" | "rtl" = "ltr"): string | null {
  if (dir === "rtl") key = key === "ArrowLeft" ? "ArrowRight" : key === "ArrowRight" ? "ArrowLeft" : key;
  const weekdayIndex = (utcDate(day).getUTCDay() + 6) % 7;
  switch (key) {
    case "ArrowLeft": return addDays(day, -1);
    case "ArrowRight": return addDays(day, 1);
    case "ArrowUp": return addDays(day, -7);
    case "ArrowDown": return addDays(day, 7);
    case "Home": return addDays(day, -weekdayIndex);
    case "End": return addDays(day, 6 - weekdayIndex);
    default: return null;
  }
}

export function daysInRange(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

const clocks = new Map<string, Intl.DateTimeFormat>();

/** "4:00" and "pm", in Sydney. Languages that use the 24-hour clock get an empty period. */
export function timeParts(iso: string, locale = "en-AU"): { time: string; period: string } {
  if (!clocks.has(locale)) clocks.set(locale, new Intl.DateTimeFormat(locale, { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" }));
  const parts = clocks.get(locale)!.formatToParts(new Date(iso));
  const time = parts.filter((p) => p.type === "hour" || p.type === "minute" || p.type === "literal").map((p) => p.value).join("").trim();
  const period = parts.find((p) => p.type === "dayPeriod")?.value.toLowerCase().replace(/\./g, "") ?? "";
  return { time, period };
}

/** The round letter beside a lesson: "Year 9 Maths" shows M in blue, science in pink. */
export function subjectIcon(subject: string): { letter: string; cls: string } {
  const name = subject.replace(/^Year\s+\d+\s+/i, "").trim() || subject;
  const cls = /math/i.test(name) ? "math" : /science|chem|phys|bio/i.test(name) ? "sci" : "";
  return { letter: name[0]?.toUpperCase() ?? "L", cls };
}

export type LessonState = "scheduled" | "completed" | "cancelled";

/** The words beside a lesson. "warn" marks the ones that need someone to act. */
export function lessonStatus(status: LessonState, tutorAway: boolean, t: Translate = enT): { label: string; warn: boolean } {
  if (status === "cancelled") return { label: t("schedule.status.cancelled"), warn: false };
  if (status === "completed") return { label: t("schedule.status.completed"), warn: false };
  return tutorAway ? { label: t("schedule.status.coverNeeded"), warn: true } : { label: t("schedule.status.confirmed"), warn: false };
}
