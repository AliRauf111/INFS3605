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
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.schedule") };
}

// The Schedule: a month of lessons from the timetable, the chosen day's lessons underneath,
// and a shortcut to Compass's Lesson Change workflow beside it.

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ month?: string; day?: string; kb?: string }> }) {
  await requirePageUser();
  const { t, fmt } = await getI18n();
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
      const subject = l.bookings?.subject ?? t("common.lesson");
      const icon = subjectIcon(l.bookings?.subject ?? "Lesson");
      const tp = timeParts(l.starts_at, fmt.locale);
      const status = lessonStatus(l.status, isAway(data?.absences ?? [], l.tutor_id, day), t);
      return {
        id: l.id, day, time: tp.time, period: tp.period, subject,
        student: l.bookings?.families?.student_name ?? t("common.student"),
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
  const next = upcoming ? { ...upcoming, t: timeParts(upcoming.starts_at, fmt.locale), day: sydneyDate(upcoming.starts_at) } : null;

  return (
    <div className="studio">
      <div className="page-head">
        <div>
          <p className="eyebrow">{t("schedule.eyebrow")}</p>
          <h1>{t("schedule.titleStart")} <span>{t("schedule.titleEnd")}</span></h1>
          <p className="subheading">{t("schedule.subheading")}</p>
        </div>
        <PageActions className="head-actions">
          <OpenCompassButton className="btn dark" label={t("schedule.changeLesson")} variant="plain" icon="calendar" shortcut="lesson_change" />
        </PageActions>
      </div>

      <div className="schedule-layout">
        <section className="card large-schedule" aria-label={t("schedule.calendarLabel")} data-compass-avoid="">
          {data === null ? (
            <p className="caption">{t("overview.today.notSetUp")}</p>
          ) : (
            <MonthCalendar month={month} today={today} weeks={weeks} lessons={lessons} initialDay={initialDay} keyboard={params.kb === "1"} />
          )}
        </section>

        <div className="centre-column" data-compass-avoid="">
          <section className="card" aria-labelledby="plans-heading">
            <h2 id="plans-heading">{t("schedule.plansHeading")}</h2>
            <p className="subheading plans-text">{t("schedule.plansText")}</p>
            <OpenCompassButton className="btn soft" label={t("domain.requestType.lesson_change")} variant="plain" shortcut="lesson_change" />
          </section>
          {next && (
            <section className="card booking-card" aria-labelledby="booking-heading">
              <h2 id="booking-heading">{t("schedule.booking", { id: next.booking_id })}</h2>
              <p className="caption">
                <bdi>{next.bookings?.families?.student_name ?? t("common.student")}</bdi> · <bdi>{next.bookings?.subject ?? t("common.lesson")}</bdi><br />
                {t("schedule.tutor", { name: next.tutors?.name ?? next.tutor_id })}<br />
                {t("schedule.nextLesson", { day: longDay(next.day, fmt.locale), time: `${next.t.time} ${next.t.period}`.trim() })}
              </p>
              <span className="badge blue">{t("schedule.upcomingFound")}</span>
            </section>
          )}
          <div className="notice studio-notice">
            <Icon name="info" />
            <span>
              {demo ? t("schedule.demoNote") : t("schedule.liveNote")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
