"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import { addMonths, dayLabel, longDay, monthLabel, monthOf, moveDay } from "@/lib/schedule/calendar";

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

const WEEKDAYS: Array<[string, string]> = [["Mon", "Monday"], ["Tue", "Tuesday"], ["Wed", "Wednesday"], ["Thu", "Thursday"], ["Fri", "Friday"], ["Sat", "Saturday"], ["Sun", "Sunday"]];
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
            <span>{l.student} · {l.tutor}</span>
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
    const next = moveDay(day, e.key);
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
          <h2 id="calendar-month" aria-live="polite">{monthLabel(month)}</h2>
          <p className="caption">Sydney time</p>
        </div>
        <div className="calendar-controls">
          <button type="button" className="btn outline today-btn" onClick={() => (monthOf(today) === month ? choose(today) : go(today))}>Today</button>
          <button type="button" className="round-btn" aria-label={`Previous month, ${monthLabel(addMonths(month, -1))}`} onClick={() => router.push(`/schedule?month=${addMonths(month, -1)}`, { scroll: false })}><Icon name="chevron-left" /></button>
          <button type="button" className="round-btn" aria-label={`Next month, ${monthLabel(addMonths(month, 1))}`} onClick={() => router.push(`/schedule?month=${addMonths(month, 1)}`, { scroll: false })}><Icon name="chevron-right" /></button>
        </div>
      </div>

      <table className="month-grid" role="grid" aria-labelledby="calendar-month" ref={grid}>
        <thead>
          <tr>{WEEKDAYS.map(([short, long]) => <th key={short} scope="col" abbr={long}>{short}</th>)}</tr>
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
                      aria-label={dayLabel(day, list.length, today)}
                      aria-controls="day-lessons"
                      onClick={() => choose(day)}
                      onKeyDown={(e) => onKeyDown(e, day)}
                    >
                      <span className="month-date" aria-hidden="true">{Number(day.slice(8))}</span>
                      <span className="month-chips" aria-hidden="true">
                        {list.slice(0, CHIPS).map((l) => (
                          <span key={l.id} className={`lesson-chip ${l.iconClass}${l.warn ? " warn" : ""}`}>{l.time}{l.period} {l.subject}</span>
                        ))}
                        {list.length > CHIPS && <span className="more-chip">+ {list.length - CHIPS} more</span>}
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
          <h2 id="day-lessons-heading">{longDay(selected)}</h2>
          <span className="caption">{chosen.length ? `${chosen.length} ${chosen.length === 1 ? "lesson" : "lessons"}` : "No lessons"}</span>
        </div>
        {chosen.length ? <LessonRows lessons={chosen} /> : <p className="caption empty-day">Nothing on the timetable for this day.</p>}
      </section>

      <section className="agenda" aria-label={`Lessons in ${monthLabel(month)}`}>
        {!showEarlier && monthOf(today) === month && earlier.length > 0 && (
          <button type="button" className="btn outline today-btn agenda-earlier" onClick={() => setShowEarlier(true)}>Show earlier days this month</button>
        )}
        {agenda.length ? agenda.map((day) => (
          <div key={day} className="agenda-day">
            <h3>{longDay(day)}{day === today ? <span className="badge lilac">Today</span> : null}</h3>
            <LessonRows lessons={byDay.get(day) ?? []} />
          </div>
        )) : <p className="caption empty-day">{inMonth.length ? "No more lessons this month." : "No lessons this month."}</p>}
      </section>
    </>
  );
}
