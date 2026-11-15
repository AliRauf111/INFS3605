import Link from "next/link";
import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth/page";
import { LoadError } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { Icon, type IconName } from "@/components/Icons";
import { insightsRecords } from "@/lib/insights/data";
import { dayLabel, lessonsToday, nextWeek, openByNextStep, recentMix, sydneyPeriod, tutorsAvailable, weeklyCapacity } from "@/lib/insights/logic";
import { readAttention } from "@/lib/workflows/attention";
import { ATTENTION_LABELS } from "@/lib/workflows/attention-logic";
import { LIGHT_ORDER, LIGHT_WORD } from "@/lib/overview/lights";
import { formatDay } from "@/lib/workflows/dates";
import type { AttentionBlock } from "@/lib/assistant/logic";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Insights" };

// Insights: how the week looks, worked out from the saved records each time the page loads.
// Overview is for acting on requests; this page is for understanding the business. Rule
// coverage, suggestions and integrations stay on the Coverage page.

const timeFmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" });

function Stat({ icon, tint, label, value, unit, note, children }: { icon: IconName; tint: string; label: string; value: string | null; unit?: string; note: string; children?: React.ReactNode }) {
  return (
    <section className={`card stat-card tint-${tint}`} aria-label={label}>
      <div className="stat-top">
        <span className="stat-icon" aria-hidden="true"><Icon name={icon} /></span>
        <h2>{label}</h2>
      </div>
      {value === null ? (
        <p className="stat-value unavailable">Not available</p>
      ) : (
        <p className="stat-value">{value}{unit && <span className="stat-unit">{unit}</span>}</p>
      )}
      <p className="stat-note">{note}</p>
      {children}
    </section>
  );
}

export default async function Insights() {
  const user = await requirePageUser();
  const now = new Date();
  const p = sydneyPeriod(now);
  let data: Awaited<ReturnType<typeof insightsRecords>>;
  let attention: AttentionBlock | null = null;
  try {
    data = await insightsRecords(p);
  } catch (e) {
    return <LoadError error={e} />;
  }
  try {
    attention = await readAttention(user, now);
  } catch (e) {
    console.error("[insights] attention unavailable:", e instanceof Error ? e.message : e);
  }

  const lessons = data.lessons ? lessonsToday(data.lessons, p, now) : null;
  const tutors = tutorsAvailable(data.tutors.map((t) => t.id), data.slots, data.absences, p);
  // This week's capacity; when nothing is offered this week, next week's, clearly labelled.
  const thisWeek = weeklyCapacity(data.slots, data.absences, p);
  const later = thisWeek.offered === 0 ? weeklyCapacity(data.slots, data.absences, nextWeek(p)) : null;
  const showNext = Boolean(later && later.offered > 0);
  const capacity = showNext && later ? later : thisWeek;
  const capWeek = showNext ? nextWeek(p) : p;
  const capWhen = showNext ? "next week" : "this week";
  const reqRows = data.requests.map((r) => ({ decision: r.decision, status: r.status, created_at: r.created_at, missing: r.missing_count ?? 0, reviewStartedAt: r.owner_review_started_at, welfare: r.welfare_status === "yes" }));
  const mix = recentMix(reqRows, p);
  const steps = openByNextStep(reqRows, user.role);
  const maxDay = Math.max(1, ...capacity.byDay.map((d) => d.booked + d.free));
  const maxStep = Math.max(1, ...steps.map((s) => s.count));
  const weekText = `${formatDay(p.weekStart)} to ${formatDay(p.weekEnd)}`;
  const attentionParts = attention ? attention.counts.filter((c) => c.count > 0) : [];

  return (
    <div className="stack insights">
      <PageHeader actions={<Link className="btn secondary" href="/coverage"><Icon name="coverage" /> Rule Coverage</Link>}>
        <p className="kicker">Insights</p>
        <h1>How the Week Looks</h1>
        <p className="muted">Worked out from your records when this page loads. Sydney time. This week is {weekText}.</p>
      </PageHeader>

      <div className="stat-grid" data-compass-avoid="">
        <Stat
          icon="alert"
          tint="rose"
          label="Needs Your Attention"
          value={attention ? String(attention.total) : null}
          note={attention
            ? attention.total === 0
              ? "Nothing is waiting on you."
              : attentionParts.map((c) => `${ATTENTION_LABELS[c.key]}: ${c.count}`).join(". ") + "."
            : "Couldn't read this just now. Nothing is guessed."}
        >
          <p className="stat-def">Owner decisions, clarifications, your waiting workflows, your previews, failed actions and outcomes to record, for your role.</p>
        </Stat>
        <Stat
          icon="calendar"
          tint="lilac"
          label="Lessons Today"
          value={lessons ? String(lessons.count) : null}
          note={lessons === null
            ? "The lesson timetable isn't set up in this database."
            : lessons.count === 0
              ? "No lessons on the timetable today."
              : lessons.next
                ? `${lessons.remaining} still to come. Next at ${timeFmt.format(new Date(lessons.next.starts_at))}.`
                : "All of today's lessons have started or finished."}
        >
          <p className="stat-def">Scheduled or taught lessons starting today. Cancelled lessons aren&apos;t counted.</p>
        </Stat>
        <Stat
          icon="people"
          tint="blue"
          label="Tutors Available"
          value={tutors.available === null ? null : String(tutors.available)}
          unit={tutors.available === null ? undefined : ` of ${tutors.total}`}
          note={tutors.available === null
            ? "No tutor availability is recorded for today, so this can't be worked out."
            : `${tutors.away === 0 ? "No tutors" : tutors.away === 1 ? "1 tutor" : `${tutors.away} tutors`} recorded as away today.`}
        >
          <p className="stat-def">Tutors with at least one free slot today who aren&apos;t recorded as away.</p>
        </Stat>
        <Stat
          icon="gauge"
          tint="lilac"
          label="Weekly Capacity"
          value={capacity.percent === null ? null : String(capacity.percent)}
          unit={capacity.percent === null ? undefined : "%"}
          note={capacity.percent === null
            ? "No tutor availability is recorded for this week or next week."
            : `${capacity.booked} of ${capacity.offered} offered hours are booked${showNext ? ` next week (${formatDay(capWeek.weekStart)} to ${formatDay(capWeek.weekEnd)}). Nothing is offered this week yet` : ""}.`}
        >
          <p className="stat-def">Booked hours divided by all offered hours (booked plus free) in the tutor calendar, Monday to Sunday. If nothing is offered this week yet, next week is shown and labelled. Free time on a day a tutor is away isn&apos;t offered.</p>
        </Stat>
      </div>

      <div className="insight-grid" data-compass-avoid="">
        <section className="card chart-card" aria-labelledby="cap-heading">
          <div className="card-head">
            <div>
              <h2 id="cap-heading">Booked and Free Hours</h2>
              <p className="hint">Each day {capWhen}, from the tutor calendar.</p>
            </div>
            <ul className="chart-legend" aria-label="Legend">
              <li><span className="swatch booked" aria-hidden="true" /> Booked</li>
              <li><span className="swatch free" aria-hidden="true" /> Free</li>
            </ul>
          </div>
          {capacity.offered === 0 ? (
            <p className="muted chart-empty">Not enough data: no tutor availability is recorded for this week or next week.</p>
          ) : (
            <>
              <div className="bars" role="img" aria-label={`Booked and free hours by day, ${capWhen}. ${capacity.byDay.map((d) => `${dayLabel(d.day).long}: ${d.booked} booked, ${d.free} free`).join(". ")}.`}>
                {capacity.byDay.map((d) => {
                  const total = d.booked + d.free;
                  return (
                    <div key={d.day} className={`bar-col${d.day === p.today ? " today" : ""}`} title={`${dayLabel(d.day).long}: ${d.booked} h booked, ${d.free} h free`}>
                      <span className="bar-total">{total ? `${total} h` : ""}</span>
                      <div className="bar-track">
                        <div className="bar-stack" style={{ height: `${(total / maxDay) * 100}%` }}>
                          {d.free > 0 && <span className="seg free" style={{ flexGrow: d.free }} />}
                          {d.booked > 0 && <span className="seg booked" style={{ flexGrow: d.booked }} />}
                        </div>
                      </div>
                      <span className="bar-label">{dayLabel(d.day).short}{d.day === p.today ? <span className="sr-only"> (today)</span> : null}</span>
                    </div>
                  );
                })}
              </div>
              <details className="chart-table">
                <summary>Show as a table</summary>
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Booked and free hours by day, {capWhen}</caption>
                    <thead><tr><th scope="col">Day</th><th scope="col" className="num">Booked</th><th scope="col" className="num">Free</th></tr></thead>
                    <tbody>{capacity.byDay.map((d) => <tr key={d.day}><th scope="row">{dayLabel(d.day).long}</th><td className="num">{d.booked} h</td><td className="num">{d.free} h</td></tr>)}</tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </section>

        <section className="card chart-card" aria-labelledby="mix-heading">
          <div className="card-head">
            <div>
              <h2 id="mix-heading">New Requests by Rule Result</h2>
              <p className="hint">Saved in the last 30 days ({formatDay(p.recentStart)} to {formatDay(p.today)}), by the colour the rules gave them.</p>
            </div>
          </div>
          {mix.total === 0 ? (
            <p className="muted chart-empty">No new requests in the last 30 days.</p>
          ) : (
            <ul className="hbars">
              {LIGHT_ORDER.map((c) => (
                <li key={c} className={c}>
                  <span className="hbar-label"><span className="light-dot" aria-hidden="true" />{LIGHT_WORD[c]}</span>
                  <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(mix[c] / mix.total) * 100}%` }} /></span>
                  <span className="hbar-value">{mix[c]}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="stat-def">A count of rule results, not a measure of time saved.</p>
        </section>

        <section className="card chart-card" aria-labelledby="steps-heading">
          <div className="card-head">
            <div>
              <h2 id="steps-heading">Open Requests by Next Step</h2>
              <p className="hint">What happens next on each open request, for your role.</p>
            </div>
            <Link className="icon-link" href="/" aria-label="Act on these in the Overview"><Icon name="arrow" /></Link>
          </div>
          <ul className="hbars lilac">
            {steps.map((s) => (
              <li key={s.queue}>
                <span className="hbar-label">{s.label}</span>
                <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(s.count / maxStep) * 100}%` }} /></span>
                <span className="hbar-value">{s.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card coverage-link-card tint-blue" aria-labelledby="cov-heading">
          <span className="stat-icon" aria-hidden="true"><Icon name="coverage" /></span>
          <h2 id="cov-heading">Rule Coverage, Suggestions and Integrations</h2>
          <p className="muted">How many requests the owner&apos;s rules handled, common reasons for yellow, suggested rule changes and what is connected are on the Coverage page.</p>
          <Link className="btn secondary" href="/coverage">Open Coverage <Icon name="arrow" size={16} /></Link>
        </section>
      </div>
      <p className="hint insights-foot">Figures come from the records in this database. Later days this week show what is already booked or offered.</p>
    </div>
  );
}
