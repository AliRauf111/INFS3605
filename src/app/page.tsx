import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { listRequests, withWorkflowState, type RequestRow } from "@/lib/data/queries";
import { LoadError } from "@/components/ui";
import { friendlyTime } from "@/lib/domain/progress";
import { PageActions } from "@/components/PageHeader";
import { Icon } from "@/components/Icons";
import { OpenCompassButton } from "@/components/OpenCompassButton";
import { BotScene } from "@/components/BotScene";
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
import { REQUEST_TYPE_LABELS } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

// Overview, laid out like the Studio design: three status cards, then "Over to You" on the
// left, tutor capacity and today's lessons in the middle, and Compass AI, the owner's rules
// and recent activity on the right. Every figure comes from the records; nothing here is
// sample data.

const EVENT_TEXT: Record<string, [string, string]> = {
  sent_to_owner: ["Sent to the owner", "for a decision"],
  owner_approved: ["Approved by the owner", "and back with the team"],
  owner_declined: ["Declined by the owner", "with a reason recorded"],
  owner_requested_info: ["The owner asked", "for a few more details"],
  admin_replied: ["Details sent back", "to the owner"],
  closed: ["Outcome recorded", "and the request closed"],
  reevaluated: ["Rules re-checked", "with the new facts"],
};

function partOfDay(now: Date): "morning" | "afternoon" | "evening" {
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

function initials(name: string | undefined | null): string {
  return (name ?? "").split(/[\s-]+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

const shortDay = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short" });

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

function changeText(change: number | null, against: string): string {
  if (change === null) return `Nothing offered ${against} to compare`;
  if (change === 0) return `The same as ${against}`;
  return `${Math.abs(change)} ${Math.abs(change) === 1 ? "point" : "points"} ${change > 0 ? "more" : "fewer"} than ${against}`;
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
      type: REQUEST_TYPE_LABELS[r.request_type],
      colour: TILE_COLOUR[r.request_type],
      title: cardTitle(r),
      line: cardLine(r),
      when: `${r.reference_id ? `${r.reference_id} · ` : ""}${friendlyTime(r.created_at, now)}`,
      initials: initials(who ?? r.reference_id),
      who,
    };
  });
  const texts = Object.fromEntries(STATUS_GROUPS.map((g) => [g, groupText(g, user.role)])) as Record<StatusGroup, string>;

  // Capacity: this week, next week and this month from the tutor calendar.
  const thisWeek = weekSeries(calendar.slots, calendar.absences, p.weekStart);
  const next = weekSeries(calendar.slots, calendar.absences, nextWeek);
  const last = weekSeries(calendar.slots, calendar.absences, lastWeek);
  const month = monthSeries(calendar.slots, calendar.absences, todayIso);
  const todayIndex = (new Date(`${todayIso}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monthIndex = monthStarts.findIndex((s) => s === p.weekStart);
  const period = (key: PeriodKey, label: string, series: CapacitySeries, change: string, long: string, tip: number): CapacityPeriod => ({
    key, label, series, change, long, tip: tipIndex(series, tip), max: niceMax(Math.max(0, ...series.offered)),
  });
  const periods: CapacityPeriod[] = [
    period("week", "This week", thisWeek, changeText(pointsChange(thisWeek.percent, last.percent), "last week"), "this week", todayIndex),
    period("next", "Next week", next, changeText(pointsChange(next.percent, thisWeek.percent), "this week"), "next week", -1),
    period("month", "This month", month, `Across ${monthStarts.length} weeks this month`, "this month", monthIndex),
  ];
  // Open on this week, or next week while nothing is offered this week yet.
  const initialPeriod: PeriodKey = thisWeek.percent === null && next.percent !== null ? "next" : "week";

  // Today's lessons, or the next ones when today is clear.
  const todays = lessons?.lessons.filter((l) => sydneyDate(l.starts_at) === todayIso) ?? [];
  const lessonList = (todays.length ? todays : lessons?.lessons ?? []).slice(0, 3);

  const today = now.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long" });
  const firstName = user.displayName.split(" ")[0];
  const rules = ruleLines(policies).slice(0, 2);

  return (
    <div className="studio">
      {removed && (
        <div className="notice success" role="status">
          Request removed from the list. You can find it again under <Link href="/requests?removed=1">Removed Requests</Link>.
        </div>
      )}
      <div className="page-head">
        <div>
          <p className="eyebrow">Your day, in focus</p>
          <h1>Good {partOfDay(now)}, {firstName} <span aria-hidden="true">✧</span></h1>
          <p className="subheading">A calmer view of your tutoring business. Let us take it one decision at a time.</p>
        </div>
        <PageActions className="head-actions">
          <span className="date-label">{today}</span>
        </PageActions>
      </div>

      <OverviewBoard tiles={tiles} counts={counts} texts={texts} initial={groupFromParam(status)}>
        <div className="centre-column">
          <CapacityCard periods={periods} initial={initialPeriod} />
          <section className="card schedule-card" aria-labelledby="today-heading" data-compass-avoid="">
            <div className="card-head">
              <div>
                <h2 id="today-heading">Coming up {todays.length ? "today" : "next"}</h2>
                <p className="caption">{todays.length ? `A snapshot of your ${partOfDay(now)}` : "Nothing on the timetable today. These are the next lessons."}</p>
              </div>
              <Link className="round-btn" href="/schedule" aria-label="Open full schedule"><Icon name="external" /></Link>
            </div>
            {lessons === null ? (
              <p className="caption">The lesson timetable isn&apos;t set up in this database yet.</p>
            ) : lessonList.length === 0 ? (
              <p className="caption">No lessons on the timetable.</p>
            ) : (
              lessonList.map((l) => {
                const day = sydneyDate(l.starts_at);
                const away = isAway(lessons.absences, l.tutor_id, day);
                const subject = l.bookings?.subject ?? "Lesson";
                const icon = subjectIcon(subject);
                const t = timeParts(l.starts_at);
                return (
                  <div key={l.id} className="schedule-row">
                    <div className="time-block"><b>{t.time}</b>{day === todayIso ? t.period : `${t.period} ${shortDay.format(new Date(l.starts_at))}`}</div>
                    <span className={`subject-icon ${icon.cls}`} aria-hidden="true">{icon.letter}</span>
                    <div className="lesson-info">
                      <strong>{subject}</strong>
                      <span>{l.bookings?.families?.student_name ?? "Student"} · {l.tutors?.name ?? l.tutor_id}</span>
                    </div>
                    <span className={`status-dot${away ? " warn" : ""}`}>{away ? "Cover needed" : "Confirmed"}</span>
                  </div>
                );
              })
            )}
          </section>
        </div>

        <div className="right-column" data-compass-avoid="">
          <section className="card ai-card" aria-labelledby="ai-card-heading">
            <p className="overline"><Icon name="sparkle" /> COMPASS AI</p>
            <BotScene />
            <h2 id="ai-card-heading">Less chasing.<br /> More teaching.</h2>
            <p>Bring the pieces together.<br />Make the next move with confidence.</p>
            <OpenCompassButton className="btn dark" />
          </section>

          <section className="card rules-card" aria-labelledby="rules-heading">
            <div className="card-head">
              <div>
                <h2 id="rules-heading">Your business, your rules</h2>
                <p className="caption">Compass follows the boundaries you set</p>
              </div>
              <Link className="round-btn" href="/knowledge#rules" aria-label="Open business rules"><Icon name="external" /></Link>
            </div>
            <div className="rule-status"><i aria-hidden="true" />Owner approval for exceptions</div>
            {rules.length ? rules.map((r) => <div key={r} className="rule-status"><i aria-hidden="true" />{r}</div>) : <div className="rule-status"><i aria-hidden="true" />No active rules yet</div>}
            <p className="rule-bottom">You stay in control of every decision that matters.</p>
          </section>

          <section className="card activity-card" aria-labelledby="activity-heading">
            <h2 id="activity-heading">Quietly getting things done</h2>
            {events.length === 0 ? (
              <div className="activity-row"><span className="activity-dot" aria-hidden="true"><Icon name="check" /></span><div>Nothing has happened on a request yet.</div></div>
            ) : (
              events.map((e) => {
                const [lead, rest] = EVENT_TEXT[e.event_type] ?? ["Updated", ""];
                const ref = byId.get(e.request_id)?.reference_id;
                return (
                  <div key={e.id} className="activity-row">
                    <span className="activity-dot" aria-hidden="true"><Icon name="check" /></span>
                    <div>
                      <Link href={`/requests/${e.request_id}`}><strong>{lead}</strong></Link> {rest}{ref ? ` · ${ref}` : ""}.
                      <small>{friendlyTime(e.created_at, now)}</small>
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
