import { requirePageUser } from "@/lib/auth/page";
import { LoadError } from "@/components/ui";
import { PageActions } from "@/components/PageHeader";
import { Icon } from "@/components/Icons";
import { OpenCompassButton } from "@/components/OpenCompassButton";
import { MonthCalendar, type CalendarLesson } from "@/components/MonthCalendar";
import { isAway } from "@/lib/insights/logic";
import { lessonsBetween, nextLesson, type ScheduleLesson } from "@/lib/schedule/data";
import { dayFromParam, lessonStatus, longDay, monthFromParam, monthGrid, monthOf, subjectIcon, timeParts } from "@/lib/schedule/calendar";
import { sydneyDate, sydneyToday } from "@/lib/workflows/dates";
import { demoResetEnabled } from "@/lib/demo/mode";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule" };

// The Schedule: a month of lessons from the timetable, the chosen day's lessons underneath,
// and a shortcut to Compass's Lesson Change workflow beside it.

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ month?: string; day?: string; kb?: string }> }) {
  await requirePageUser();
  const params = await searchParams;
  const now = new Date();
  const today = sydneyToday(now);
  const month = monthFromParam(params.month, today);
  const weeks = monthGrid(month);
  const first = weeks[0][0];
  const last = weeks[weeks.length - 1][6];

  let data: Awaited<ReturnType<typeof lessonsBetween>>;
  let upcoming: ScheduleLesson | null;
  try {
    [data, upcoming] = await Promise.all([lessonsBetween(first, last), nextLesson(now)]);
  } catch (e) {
    return <LoadError error={e} />;
  }

  const lessons: CalendarLesson[] = (data?.lessons ?? [])
    .map((l) => {
      const day = sydneyDate(l.starts_at);
      const subject = l.bookings?.subject ?? "Lesson";
      const icon = subjectIcon(subject);
      const t = timeParts(l.starts_at);
      const status = lessonStatus(l.status, isAway(data?.absences ?? [], l.tutor_id, day));
      return {
        id: l.id, day, time: t.time, period: t.period, subject,
        student: l.bookings?.families?.student_name ?? "Student",
        tutor: l.tutors?.name ?? l.tutor_id,
        letter: icon.letter, iconClass: icon.cls, status: status.label, warn: status.warn,
      };
    })
    .filter((l) => l.day >= first && l.day <= last);

  // The chosen day: the one in the address, otherwise today in this month, otherwise the
  // month's first day with lessons, otherwise the 1st.
  const asked = dayFromParam(params.day);
  const days = weeks.flat();
  const initialDay = asked && days.includes(asked) ? asked
    : monthOf(today) === month ? today
    : lessons.find((l) => monthOf(l.day) === month)?.day ?? `${month}-01`;

  const demo = demoResetEnabled(process.env.DEMO_MODE);
  const next = upcoming ? { ...upcoming, t: timeParts(upcoming.starts_at), day: sydneyDate(upcoming.starts_at) } : null;

  return (
    <div className="studio">
      <div className="page-head">
        <div>
          <p className="eyebrow">Time, well spent</p>
          <h1>Space for <span>every lesson.</span></h1>
          <p className="subheading">See what is ahead and deal with changes before they become a scramble.</p>
        </div>
        <PageActions className="head-actions">
          <OpenCompassButton className="btn dark" label="Change a lesson" variant="plain" icon="calendar" shortcut="lesson_change" />
        </PageActions>
      </div>

      <div className="schedule-layout">
        <section className="card large-schedule" aria-label="Lesson calendar" data-compass-avoid="">
          {data === null ? (
            <p className="caption">The lesson timetable isn&apos;t set up in this database yet.</p>
          ) : (
            <MonthCalendar month={month} today={today} weeks={weeks} lessons={lessons} initialDay={initialDay} keyboard={params.kb === "1"} />
          )}
        </section>

        <div className="centre-column" data-compass-avoid="">
          <section className="card" aria-labelledby="plans-heading">
            <h2 id="plans-heading">Change of plans?</h2>
            <p className="subheading plans-text">Compass can find a suitable time, check the policy and prepare the update for you.</p>
            <OpenCompassButton className="btn soft" label="Lesson Change" variant="plain" shortcut="lesson_change" />
          </section>
          {next && (
            <section className="card booking-card" aria-labelledby="booking-heading">
              <h2 id="booking-heading">Booking {next.booking_id}</h2>
              <p className="caption">
                {next.bookings?.families?.student_name ?? "Student"} · {next.bookings?.subject ?? "Lesson"}<br />
                Tutor: {next.tutors?.name ?? next.tutor_id}<br />
                Next lesson: {longDay(next.day)} · {next.t.time} {next.t.period}
              </p>
              <span className="badge blue">Upcoming lesson found</span>
            </section>
          )}
          <div className="notice studio-notice">
            <Icon name="info" />
            <span>
              {demo
                ? "These are fictional demo lessons. Times are in Sydney, and the timetable goes back to its starting point on every refresh."
                : "Lessons come from your tutor calendar. Times are in Sydney."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
