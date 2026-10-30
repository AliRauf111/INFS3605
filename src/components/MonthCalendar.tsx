"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import { addMonths, dayLabel, longDay, monthLabel, monthOf, moveDay } from "@/lib/schedule/calendar";
import { useI18n } from "@/components/i18n/I18nProvider";
import { textDirection } from "@/lib/i18n/languages";

// The Schedule page's month calendar. A day shows its first two lessons and "+ N more";
// choosing a day lists all its lessons underneath. The grid works like a date picker: one
// day is in the Tab order, the arrow keys, Home and End move between days, and Enter or
// Space chooses one. Moving past the edge of the grid opens the next or previous month.
// The month is in the address (?month=), so the server loads its lessons; the chosen day
// is kept in the address too (?day=) without reloading. On narrow screens the grid becomes
// an agenda list grouped by day.

export type CalendarLesson = {
  id: string;
  day: string;
  time: string;
  period: string;
  subject: string;
  student: string;
  tutor: string;
  letter: string;
  iconClass: string;
  status: string;
  warn: boolean;
};

// 2 November 2026 was a Monday: the seven days from it give the weekday names in any language.
const MONDAY = Date.UTC(2026, 10, 2);
function weekdays(locale: string): Array<[string, string]> {
  const short = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" });
  const long = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" });
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(MONDAY + i * 86_400_000); return [short.format(d), long.format(d)]; });
}
const CHIPS = 2;

function LessonRows({ lessons }: { lessons: CalendarLesson[] }) {
  return (
    <>
      {lessons.map((l) => (
        <div key={l.id} className="schedule-row">
          <div className="time-block"><b>{l.time}</b>{l.period}</div>
          <span className={`subject-icon ${l.iconClass}`} aria-hidden="true">{l.letter}</span>
          <div className="lesson-info">
            <strong>{l.subject}</strong>
            <span><bdi>{l.student}</bdi> · <bdi>{l.tutor}</bdi></span>
          </div>
          <span className={`status-dot${l.warn ? " warn" : ""}`}>{l.status}</span>
        </div>
      ))}
    </>
  );
}

export function MonthCalendar({ month, today, weeks, lessons, initialDay, keyboard }: {
  month: string;
  today: string;
  weeks: string[][];
  lessons: CalendarLesson[];
  initialDay: string;
  keyboard: boolean;
}) {
  const router = useRouter();
  const { t, fmt, lang } = useI18n();
  const loc = fmt.locale;
  const [selected, setSelected] = useState(initialDay);
  const [focusDay, setFocusDay] = useState(initialDay);
  const grid = useRef<HTMLTableElement>(null);
  const days = weeks.flat();
  const byDay = new Map<string, CalendarLesson[]>();
  for (const l of lessons) byDay.set(l.day, [...(byDay.get(l.day) ?? []), l]);

  // A new month from the server starts on its chosen day.
  useEffect(() => {
    setSelected(initialDay);
    setFocusDay(initialDay);
    if (keyboard) grid.current?.querySelector<HTMLElement>(`[data-day="${initialDay}"]`)?.focus();
  }, [month, initialDay, keyboard]);

  const go = (target: string, kb = false) => {
    router.push(`/schedule?month=${monthOf(target)}&day=${target}${kb ? "&kb=1" : ""}`, { scroll: false });
  };

  const choose = (day: string) => {
    setSelected(day);
    setFocusDay(day);
    const url = new URL(window.location.href);
    url.searchParams.set("month", month);
    url.searchParams.set("day", day);
    url.searchParams.delete("kb");
    window.history.replaceState(window.history.state, "", url);
  };

  const onKeyDown = (e: React.KeyboardEvent, day: string) => {
    const next = moveDay(day, e.key, textDirection(lang));
    if (!next) return;
    e.preventDefault();
    if (days.includes(next)) {
      setFocusDay(next);
      grid.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus();
    } else {
      go(next, true);
    }
  };

  const chosen = byDay.get(selected) ?? [];
  const inMonth = days.filter((d) => monthOf(d) === month && byDay.has(d));
  // In this month the agenda starts at today, with the earlier days a tap away.
  const [showEarlier, setShowEarlier] = useState(false);
  const earlier = inMonth.filter((d) => d < today);
  const agenda = showEarlier || monthOf(today) !== month ? inMonth : inMonth.filter((d) => d >= today);

  return (
    <>
      <div className="calendar-head">
        <div>
          <h2 id="calendar-month" aria-live="polite">{monthLabel(month, loc)}</h2>
          <p className="caption">{t("schedule.sydneyTime")}</p>
        </div>
        <div className="calendar-controls">
          <button type="button" className="btn outline today-btn" onClick={() => (monthOf(today) === month ? choose(today) : go(today))}>{t("schedule.today")}</button>
          <button type="button" className="round-btn" aria-label={t("schedule.previousMonth", { month: monthLabel(addMonths(month, -1), loc) })} onClick={() => router.push(`/schedule?month=${addMonths(month, -1)}`, { scroll: false })}><Icon name="chevron-left" /></button>
          <button type="button" className="round-btn" aria-label={t("schedule.nextMonth", { month: monthLabel(addMonths(month, 1), loc) })} onClick={() => router.push(`/schedule?month=${addMonths(month, 1)}`, { scroll: false })}><Icon name="chevron-right" /></button>
        </div>
      </div>

      <table className="month-grid" role="grid" aria-labelledby="calendar-month" ref={grid}>
        <thead>
          <tr>{weekdays(loc).map(([short, long]) => <th key={short} scope="col" abbr={long}>{short}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const list = byDay.get(day) ?? [];
                const outside = monthOf(day) !== month;
                const on = day === selected;
                return (
                  <td key={day} role="gridcell" aria-selected={on}>
                    <button
                      type="button"
                      data-day={day}
                      className={`month-day${on ? " active" : ""}${outside ? " outside" : ""}${day === today ? " today" : ""}`}
                      tabIndex={day === focusDay ? 0 : -1}
                      aria-label={dayLabel(day, list.length, today, t, loc)}
                      aria-controls="day-lessons"
                      onClick={() => choose(day)}
                      onKeyDown={(e) => onKeyDown(e, day)}
                    >
                      <span className="month-date" aria-hidden="true">{fmt.number(Number(day.slice(8)))}</span>
                      <span className="month-chips" aria-hidden="true">
                        {list.slice(0, CHIPS).map((l) => (
                          <span key={l.id} className={`lesson-chip ${l.iconClass}${l.warn ? " warn" : ""}`}>{l.time}{l.period} {l.subject}</span>
                        ))}
                        {list.length > CHIPS && <span className="more-chip">{t("schedule.more", { count: list.length - CHIPS })}</span>}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <section className="day-lessons" id="day-lessons" aria-labelledby="day-lessons-heading">
        <div className="card-head">
          <h2 id="day-lessons-heading">{longDay(selected, loc)}</h2>
          <span className="caption">{chosen.length ? t("schedule.lessonCount", { count: chosen.length }) : t("schedule.noLessons")}</span>
        </div>
        {chosen.length ? <LessonRows lessons={chosen} /> : <p className="caption empty-day">{t("schedule.nothingThisDay")}</p>}
      </section>

      <section className="agenda" aria-label={t("schedule.lessonsIn", { month: monthLabel(month, loc) })}>
        {!showEarlier && monthOf(today) === month && earlier.length > 0 && (
          <button type="button" className="btn outline today-btn agenda-earlier" onClick={() => setShowEarlier(true)}>{t("schedule.showEarlier")}</button>
        )}
        {agenda.length ? agenda.map((day) => (
          <div key={day} className="agenda-day">
            <h3>{longDay(day, loc)}{day === today ? <span className="badge lilac">{t("schedule.today")}</span> : null}</h3>
            <LessonRows lessons={byDay.get(day) ?? []} />
          </div>
        )) : <p className="caption empty-day">{inMonth.length ? t("schedule.noMoreThisMonth") : t("schedule.noneThisMonth")}</p>}
      </section>
    </>
  );
}
