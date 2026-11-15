// Dates for the Compass workflows: reading the dates people type, working out a revised
// due date and the reminder schedule. Dates are plain calendar days in Sydney, written
// YYYY-MM-DD. Nothing here reads the clock: callers pass "today", so it is unit tested.

const TZ = "Australia/Sydney";
const DAY_MS = 86_400_000;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Today's date in Sydney. */
export function sydneyToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The Sydney calendar day of an instant. */
export function sydneyDate(iso: string): string {
  return sydneyToday(new Date(iso));
}

const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

function weekday(iso: string): number {
  return new Date(toUtc(iso)).getUTCDay();
}

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return fromUtc(toUtc(iso)) === iso ? iso : null;
}

/** A day and month with no year: this year, unless that is more than a week ago. */
function withYear(m: number, d: number, today: string): string | null {
  const y = Number(today.slice(0, 4));
  const iso = valid(y, m, d);
  if (!iso) return null;
  return daysBetween(today, iso) < -7 ? valid(y + 1, m, d) : iso;
}

/** Every date mentioned in the text, in the order written. */
export function parseDates(text: string, today: string): string[] {
  const found: Array<{ at: number; iso: string }> = [];
  const add = (at: number, iso: string | null) => {
    if (iso && !found.some((f) => f.at === at)) found.push({ at, iso });
  };
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(m.index!, valid(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of lower.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    add(m.index!, y ? valid(y, Number(m[2]), Number(m[1])) : withYear(Number(m[2]), Number(m[1]), today));
  }
  const monthNames = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
  for (const m of lower.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\b\\.?(?:,?\\s+(\\d{4}))?`, "g"))) {
    add(m.index!, m[3] ? valid(Number(m[3]), MONTHS[m[2]], Number(m[1])) : withYear(MONTHS[m[2]], Number(m[1]), today));
  }
  // "24 to 26 October": the first day takes the month written after the second.
  for (const m of lower.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|-|–|until|till|and)\\s*\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\b`, "g"))) {
    add(m.index!, withYear(MONTHS[m[2]], Number(m[1]), today));
  }
  for (const m of lower.matchAll(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "g"))) {
    add(m.index!, m[3] ? valid(Number(m[3]), MONTHS[m[1]], Number(m[2])) : withYear(MONTHS[m[1]], Number(m[2]), today));
  }
  for (const m of lower.matchAll(/\b(today|tomorrow|day after tomorrow)\b/g)) {
    add(m.index!, addDays(today, m[1] === "today" ? 0 : m[1] === "tomorrow" ? 1 : 2));
  }
  for (const m of lower.matchAll(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thur?s?|fri|sat)\b/g)) {
    const i = WEEKDAYS.findIndex((w) => w.startsWith(m[2].slice(0, 3)));
    if (i < 0) continue;
    let ahead = (i - weekday(today) + 7) % 7;
    if (ahead === 0 || m[1]) ahead = ahead === 0 ? 7 : ahead;
    add(m.index!, addDays(today, ahead));
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.iso);
}

/** A period such as "24 to 26 October", "Monday", "until Friday" or "next week". */
export function parseRange(text: string, today: string): { start: string; end: string } | null {
  const lower = text.toLowerCase();
  if (/\bnext week\b/.test(lower)) {
    const monday = addDays(today, ((8 - weekday(today)) % 7) || 7);
    return { start: monday, end: addDays(monday, 6) };
  }
  if (/\bthis week\b/.test(lower)) return { start: today, end: addDays(today, (7 - weekday(today)) % 7) };
  const dates = parseDates(text, today);
  if (dates.length === 0) return null;
  if (dates.length === 1) {
    if (/\b(until|till|til|through to|up to)\b/.test(lower)) return dates[0] >= today ? { start: today, end: dates[0] } : null;
    return { start: dates[0], end: dates[0] };
  }
  const sorted = [...dates].sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

/** "7 days", "2 weeks", "a fortnight" (number words already turned into digits by the caller) or a new date, as extra days. */
export function parseExtension(text: string, dueDate: string | null, today: string): number | null {
  const days = /(\d{1,3})\s*(?:more\s+|extra\s+|additional\s+)?(?:business\s+)?days?\b/i.exec(text) ?? /^\s*(\d{1,3})\s*\.?\s*$/.exec(text);
  if (days) return Number(days[1]);
  const weeks = /(\d{1,2})\s*(?:more\s+|extra\s+|additional\s+)?weeks?\b/i.exec(text);
  if (weeks) return Number(weeks[1]) * 7;
  if (/\bfortnight\b/i.test(text)) return 14;
  if (/\b(a|one|another|an extra|one more)\s+week\b/i.test(text)) return 7;
  if (!dueDate) return null;
  const dates = parseDates(text, today);
  if (!dates.length) return null;
  const diff = daysBetween(dueDate, dates[dates.length - 1]);
  return diff > 0 ? diff : null;
}

export type ReminderKind = "before_due" | "due_today" | "overdue";
export type Reminder = { date: string; kind: ReminderKind };

export const REMINDER_LABELS: Record<ReminderKind, string> = {
  before_due: "Reminder before the due date",
  due_today: "Due today reminder",
  overdue: "Overdue reminder",
};

/** Three days before (if still ahead), on the day (if not past) and three days after. */
export function reminderSchedule(newDue: string, today: string): Reminder[] {
  const out: Reminder[] = [];
  const before = addDays(newDue, -3);
  if (before > today) out.push({ date: before, kind: "before_due" });
  if (newDue >= today) out.push({ date: newDue, kind: "due_today" });
  out.push({ date: addDays(newDue, 3), kind: "overdue" });
  return out;
}

/** "Fri 24 Oct 2026". */
export function formatDay(iso: string): string {
  return new Date(toUtc(iso)).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** "24 to 26 Oct 2026", or one day. */
export function formatRange(start: string, end: string): string {
  return start === end ? formatDay(start) : `${formatDay(start)} to ${formatDay(end)}`;
}

/** "Thu 23 Oct, 4:00 pm" in Sydney time. */
export function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Hours from now until the instant. Negative once it has passed. */
export function hoursUntil(iso: string, now: Date): number {
  return (new Date(iso).getTime() - now.getTime()) / 3_600_000;
}
