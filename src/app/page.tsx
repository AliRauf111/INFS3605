import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { listRequests, withWorkflowState, type RequestRow } from "@/lib/data/queries";
import { LoadError } from "@/components/ui";
import { friendlyTime } from "@/lib/domain/progress";
import { PageActions } from "@/components/PageHeader";
import { Icon } from "@/components/Icons";
import { CapacityCard, type CapacityPeriod, type PeriodKey } from "@/components/CapacityChart";
import { OverviewBoard, type Tile } from "@/components/OverviewBoard";
import { upcomingLessons } from "@/lib/insights/data";
import { isAway, sydneyPeriod } from "@/lib/insights/logic";
import { activePolicies, calendarWeeks, overviewHiddenIds, recentEvents, studentsByBooking } from "@/lib/overview/data";
import { ruleLines } from "@/lib/overview/rules";
import { monthSeries, monthWeekStarts, niceMax, pointsChange, weekSeries, type CapacitySeries } from "@/lib/overview/capacity";
import {
  STATUS_GROUPS,
  TILE_COLOUR,
  cardLine,
  cardTitle,
  countGroups,
  groupFromParam,
  groupOf,
  groupText,
  pendingRequests,
  type CardRow,
  type StatusGroup,
} from "@/lib/overview/status-cards";
import { addDays, sydneyDate, sydneyToday } from "@/lib/workflows/dates";
import { subjectIcon, timeParts } from "@/lib/schedule/calendar";
import { getI18n } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/core";

export const dynamic = "force-dynamic";

// Overview, laid out like the Studio design: three status cards, then "Over to You" on the
// left, tutor capacity and today's lessons in the middle, and Compass AI, the owner's rules
// and recent activity on the right. Every figure comes from the records; nothing here is
// sample data.

const EVENTS = ["sent_to_owner", "owner_approved", "owner_declined", "owner_requested_info", "admin_replied", "closed", "reevaluated"] as const;
type EventKey = (typeof EVENTS)[number];

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.overview") };
}

function partOfDay(now: Date): "morning" | "afternoon" | "evening" {
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

function initials(name: string | undefined | null): string {
  return (name ?? "").split(/[\s-]+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

function asCard(r: RequestRow): CardRow {
  return {
    id: r.id,
    request_type: r.request_type,
    status: r.status,
    decision: r.decision,
    amount_cents: r.amount_cents,
    reference_id: r.reference_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    missing: r.missing_count ?? 0,
    reviewStartedAt: r.owner_review_started_at,
    welfare: r.welfare_status === "yes",
    complaint: r.complaint_status === "yes",
    extensionDays: r.confirmed_facts?.extensionDays ?? null,
    context: r.context,
  };
}

type Against = "lastWeek" | "thisWeek";
function changeText(change: number | null, against: Against, t: Translate): string {
  if (change === null) return t(`overview.capacity.nothingToCompare.${against}`);
  if (change === 0) return t(`overview.capacity.same.${against}`);
  return change > 0 ? t(`overview.capacity.more.${against}`, { count: Math.abs(change) }) : t(`overview.capacity.fewer.${against}`, { count: Math.abs(change) });
}

/** The tip starts on today, or on the busiest day when today isn't in the period. */
function tipIndex(s: CapacitySeries, todayIndex: number): number {
  if (todayIndex >= 0 && todayIndex < s.labels.length) return todayIndex;
  let best = 0;
  s.booked.forEach((b, i) => { if (b > s.booked[best]) best = i; });
  return best;
}

export default async function Overview({ searchParams }: { searchParams: Promise<{ status?: string; removed?: string }> }) {
  const user = await requirePageUser();
  const { t, fmt } = await getI18n();
  const { status, removed } = await searchParams;
  const now = new Date();
  const p = sydneyPeriod(now);
  const todayIso = sydneyToday(now);
  const lastWeek = addDays(p.weekStart, -7);
  const nextWeek = addDays(p.weekStart, 7);
  const monthStarts = monthWeekStarts(todayIso);
  const from = monthStarts[0] < lastWeek ? monthStarts[0] : lastWeek;
  const monthEnd = addDays(monthStarts[monthStarts.length - 1], 7);
  const to = monthEnd > addDays(nextWeek, 7) ? monthEnd : addDays(nextWeek, 7);

  let rows: RequestRow[];
  let lessons: Awaited<ReturnType<typeof upcomingLessons>>;
  let calendar: Awaited<ReturnType<typeof calendarWeeks>>;
  let events: Awaited<ReturnType<typeof recentEvents>>;
  let policies: Awaited<ReturnType<typeof activePolicies>>;
  let hidden: Set<string>;
  try {
    [rows, lessons, calendar, events, policies, hidden] = await Promise.all([
      listRequests({ limit: 200 }).then(withWorkflowState),
      upcomingLessons(now, 8),
      calendarWeeks(from, to),
      recentEvents(2),
      activePolicies(),
      overviewHiddenIds(),
    ]);
  } catch (e) {
    return <LoadError error={e} />;
  }

  // Status cards and "Over to You". Requests kept off the Overview still count in the cards.
  const cards = rows.map(asCard);
  const counts = countGroups(cards);
  const pending = pendingRequests(cards).filter((r) => !hidden.has(r.id));
  const students = await studentsByBooking(rows.filter((r) => pending.some((s) => s.id === r.id)).map((r) => r.booking_id ?? ""));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tiles: Tile[] = pending.map((r) => {
    const row = byId.get(r.id)!;
    const who = students.get(row.booking_id ?? "") ?? null;
    return {
      id: r.id,
      group: groupOf(r.status)!,
      type: t(`domain.requestType.${r.request_type}`),
      colour: TILE_COLOUR[r.request_type],
      title: cardTitle(r, t, fmt),
      line: cardLine(r, 96, t),
      reference: r.reference_id,
      when: friendlyTime(r.created_at, now, fmt),
      initials: initials(who ?? r.reference_id),
      who,
    };
  });
  const texts = Object.fromEntries(STATUS_GROUPS.map((g) => [g, groupText(g, user.role, t)])) as Record<StatusGroup, string>;

  // Capacity: this week, next week and this month from the tutor calendar.
  const thisWeek = weekSeries(calendar.slots, calendar.absences, p.weekStart);
  const next = weekSeries(calendar.slots, calendar.absences, nextWeek);
  const last = weekSeries(calendar.slots, calendar.absences, lastWeek);
  const month = monthSeries(calendar.slots, calendar.absences, todayIso);
  const todayIndex = (new Date(`${todayIso}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monthIndex = monthStarts.findIndex((s) => s === p.weekStart);
  // Day and week names on the chart, in the reader's language (2 November 2026 was a Monday).
  const dayNames = Array.from({ length: 7 }, (_, i) => fmt.date(new Date(Date.UTC(2026, 10, 2 + i, 2)), { weekday: "short" }));
  const named = (series: CapacitySeries, weeks: boolean): CapacitySeries => ({
    ...series,
    labels: series.labels.map((l, i) => (weeks ? t("overview.capacity.weekShort", { n: i + 1 }) : dayNames[i] ?? l)),
  });
  const period = (key: PeriodKey, label: string, raw: CapacitySeries, change: string, long: string, tip: number): CapacityPeriod => {
    const series = named(raw, key === "month");
    return { key, label, series, change, long, tip: tipIndex(series, tip), max: niceMax(Math.max(0, ...series.offered)) };
  };
  const periods: CapacityPeriod[] = [
    period("week", t("overview.capacity.thisWeek"), thisWeek, changeText(pointsChange(thisWeek.percent, last.percent), "lastWeek", t), t("overview.capacity.thisWeekLower"), todayIndex),
    period("next", t("overview.capacity.nextWeek"), next, changeText(pointsChange(next.percent, thisWeek.percent), "thisWeek", t), t("overview.capacity.nextWeekLower"), -1),
    period("month", t("overview.capacity.thisMonth"), month, t("overview.capacity.acrossWeeks", { count: monthStarts.length }), t("overview.capacity.thisMonthLower"), monthIndex),
  ];
  // Open on this week, or next week while nothing is offered this week yet.
  const initialPeriod: PeriodKey = thisWeek.percent === null && next.percent !== null ? "next" : "week";

  // Today's lessons, or the next ones when today is clear.
  const todays = lessons?.lessons.filter((l) => sydneyDate(l.starts_at) === todayIso) ?? [];
  const lessonList = (todays.length ? todays : lessons?.lessons ?? []).slice(0, 3);

  const today = fmt.date(now, { weekday: "long", day: "numeric", month: "long" });
  const firstName = user.displayName.split(" ")[0];
  const rules = ruleLines(policies, t, fmt).slice(0, 2);
  const part = partOfDay(now);

  return (
    <div className="studio">
      {removed && (
        <div className="notice success" role="status">
          {t("overview.removed")} <Link href="/requests?removed=1">{t("overview.removedLink")}</Link>
        </div>
      )}
      <div className="page-head">
        <div>
          <p className="eyebrow">{t("overview.eyebrow")}</p>
          <h1>{t(`overview.greeting.${part}`, { name: firstName })} <span aria-hidden="true">✧</span></h1>
          <p className="subheading">{t("overview.subheading")}</p>
        </div>
        <PageActions className="head-actions">
          <span className="date-label">{today}</span>
        </PageActions>
      </div>

      <OverviewBoard tiles={tiles} counts={counts} texts={texts} initial={groupFromParam(status)}>
        <div className="centre-column">
          <CapacityCard periods={periods} initial={initialPeriod} />
          <section className="card schedule-card" aria-labelledby="today-heading">
            <div className="card-head">
              <div>
                <h2 id="today-heading">{todays.length ? t("overview.today.headingToday") : t("overview.today.headingNext")}</h2>
                <p className="caption">{todays.length ? t(`overview.today.snapshot.${part}`) : t("overview.today.nothingToday")}</p>
              </div>
              <Link className="round-btn" href="/schedule" aria-label={t("overview.today.openSchedule")}><Icon name="external" /></Link>
            </div>
            {lessons === null ? (
              <p className="caption">{t("overview.today.notSetUp")}</p>
            ) : lessonList.length === 0 ? (
              <p className="caption">{t("overview.today.noLessons")}</p>
            ) : (
              lessonList.map((l) => {
                const day = sydneyDate(l.starts_at);
                const away = isAway(lessons.absences, l.tutor_id, day);
                const subject = l.bookings?.subject ?? t("common.lesson");
                const icon = subjectIcon(l.bookings?.subject ?? "Lesson");
                const tp = timeParts(l.starts_at, fmt.locale);
                return (
                  <div key={l.id} className="schedule-row">
                    <div className="time-block"><b>{tp.time}</b>{day === todayIso ? tp.period : `${tp.period} ${fmt.date(l.starts_at, { weekday: "short" })}`}</div>
                    <span className={`subject-icon ${icon.cls}`} aria-hidden="true">{icon.letter}</span>
                    <div className="lesson-info">
                      <strong>{subject}</strong>
                      <span><bdi>{l.bookings?.families?.student_name ?? t("common.student")}</bdi> · <bdi>{l.tutors?.name ?? l.tutor_id}</bdi></span>
                    </div>
                    <span className={`status-dot${away ? " warn" : ""}`}>{away ? t("overview.today.coverNeeded") : t("overview.today.confirmed")}</span>
                  </div>
                );
              })
            )}
          </section>
        </div>

        <div className="right-column">
          <section className="card rules-card" aria-labelledby="rules-heading">
            <div className="card-head">
              <div>
                <h2 id="rules-heading">{t("overview.rules.heading")}</h2>
                <p className="caption">{t("overview.rules.caption")}</p>
              </div>
              <Link className="round-btn" href="/knowledge#rules" aria-label={t("overview.rules.open")}><Icon name="external" /></Link>
            </div>
            <div className="rule-status"><i aria-hidden="true" />{t("overview.rules.exceptions")}</div>
            {rules.length ? rules.map((r) => <div key={r} className="rule-status"><i aria-hidden="true" />{r}</div>) : <div className="rule-status"><i aria-hidden="true" />{t("overview.rules.none")}</div>}
            <p className="rule-bottom">{t("overview.rules.bottom")}</p>
          </section>

          <section className="card activity-card" aria-labelledby="activity-heading">
            <h2 id="activity-heading">{t("overview.activity.heading")}</h2>
            {events.length === 0 ? (
              <div className="activity-row"><span className="activity-dot" aria-hidden="true"><Icon name="check" /></span><div>{t("overview.activity.none")}</div></div>
            ) : (
              events.map((e) => {
                const known = (EVENTS as readonly string[]).includes(e.event_type) ? (e.event_type as EventKey) : null;
                const lead = known ? t(`overview.activity.event.${known}.lead`) : t("overview.activity.updated");
                const rest = known ? t(`overview.activity.event.${known}.rest`) : "";
                const ref = byId.get(e.request_id)?.reference_id;
                return (
                  <div key={e.id} className="activity-row">
                    <span className="activity-dot" aria-hidden="true"><Icon name="check" /></span>
                    <div>
                      <Link href={`/requests/${e.request_id}`}><strong>{lead}</strong></Link> {rest}{ref ? <> · <bdi>{ref}</bdi></> : null}.
                      <small>{friendlyTime(e.created_at, now, fmt)}</small>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>
      </OverviewBoard>
    </div>
  );
}
