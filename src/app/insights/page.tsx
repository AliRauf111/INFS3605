import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { LoadError } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { Icon, type IconName } from "@/components/Icons";
import { insightsRecords } from "@/lib/insights/data";
import { lessonsToday, nextWeek, openByNextStep, recentMix, sydneyPeriod, tutorsAvailable, weeklyCapacity } from "@/lib/insights/logic";
import { readAttention } from "@/lib/workflows/attention";
import { LIGHT_ORDER } from "@/lib/overview/lights";
import type { AttentionBlock } from "@/lib/assistant/logic";
import { getI18n } from "@/lib/i18n/server";
import { isMissingRetention, readRetentionData, type RetentionData } from "@/lib/retention/server";
import { RetentionSection } from "@/components/retention/RetentionSection";
import "./retention.css";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.insights") };
}

// Insights: how the week looks, worked out from the saved records each time the page loads.
// Overview is for acting on requests; this page is for understanding the business. Rule
// coverage, suggestions and integrations stay on the Coverage page.

function Stat({ icon, tint, label, value, unit, note, unavailable, children }: { icon: IconName; tint: string; label: string; value: string | null; unit?: string; note: string; unavailable: string; children?: React.ReactNode }) {
  return (
    <section className={`card stat-card tint-${tint}`} aria-label={label}>
      <div className="stat-top">
        <span className="stat-icon" aria-hidden="true"><Icon name={icon} /></span>
        <h2>{label}</h2>
      </div>
      {value === null ? (
        <p className="stat-value unavailable">{unavailable}</p>
      ) : (
        <p className="stat-value">{value}{unit && <span className="stat-unit">{unit}</span>}</p>
      )}
      <p className="stat-note">{note}</p>
      {children}
    </section>
  );
}

export default async function Insights({ searchParams }: { searchParams: Promise<{ retention?: string; tab?: string; student?: string; prepare?: string }> }) {
  const user = await requirePageUser();
  const { t, fmt } = await getI18n();
  // Calendar days (YYYY-MM-DD) shown in the reader's language; midday UTC keeps the Sydney date.
  const day = (iso: string, opts: Intl.DateTimeFormatOptions) => fmt.date(new Date(`${iso}T02:00:00Z`), opts);
  const formatDay = (iso: string) => day(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const dayLabel = (iso: string) => ({ short: day(iso, { weekday: "short" }), long: day(iso, { weekday: "long", day: "numeric", month: "long" }) });
  const hrs = (n: number) => t("insights.hours", { n: fmt.number(n, { maximumFractionDigits: 1 }) });
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

  // Student Retention sits below the existing cards. If its tables aren't set up yet, or the
  // read fails, the rest of the page still shows.
  const sp = await searchParams;
  let retention: RetentionData | null = null;
  let retentionMissing = false;
  try {
    retention = await readRetentionData(user, now);
  } catch (e) {
    retentionMissing = isMissingRetention(e);
    if (!retentionMissing) console.error("[insights] retention unavailable:", e instanceof Error ? e.message : e);
  }

  const lessons = data.lessons ? lessonsToday(data.lessons, p, now) : null;
  const tutors = tutorsAvailable(data.tutors.map((tu) => tu.id), data.slots, data.absences, p);
  // This week's capacity; when nothing is offered this week, next week's, clearly labelled.
  const thisWeek = weeklyCapacity(data.slots, data.absences, p);
  const later = thisWeek.offered === 0 ? weeklyCapacity(data.slots, data.absences, nextWeek(p)) : null;
  const showNext = Boolean(later && later.offered > 0);
  const capacity = showNext && later ? later : thisWeek;
  const capWeek = showNext ? nextWeek(p) : p;
  const capWhen = showNext ? t("overview.capacity.nextWeekLower") : t("overview.capacity.thisWeekLower");
  const reqRows = data.requests.map((r) => ({ decision: r.decision, status: r.status, created_at: r.created_at, missing: r.missing_count ?? 0, reviewStartedAt: r.owner_review_started_at, welfare: r.welfare_status === "yes" }));
  const mix = recentMix(reqRows, p);
  const steps = openByNextStep(reqRows, user.role).map((st) => ({ ...st, label: t(`insights.queue.${st.queue}`) }));
  const maxDay = Math.max(1, ...capacity.byDay.map((d) => d.booked + d.free));
  const maxStep = Math.max(1, ...steps.map((s) => s.count));
  const weekText = t("insights.range", { start: formatDay(p.weekStart), end: formatDay(p.weekEnd) });
  const attentionParts = attention ? attention.counts.filter((c) => c.count > 0) : [];

  return (
    <div className="stack insights">
      <PageHeader actions={<Link className="btn secondary" href="/coverage"><Icon name="coverage" /> {t("insights.ruleCoverage")}</Link>}>
        <p className="kicker">{t("nav.insights")}</p>
        <h1>{t("insights.title")}</h1>
        <p className="muted">{t("insights.intro", { week: weekText })}</p>
      </PageHeader>

      <div className="stat-grid" data-compass-avoid="">
        <Stat
          icon="alert"
          tint="rose"
          label={t("insights.attention")}
          unavailable={t("insights.notAvailable")}
          value={attention ? fmt.number(attention.total) : null}
          note={attention
            ? attention.total === 0
              ? t("insights.nothingWaiting")
              : attentionParts.map((c) => `${t(`insights.attentionKey.${c.key}`)}: ${fmt.number(c.count)}`).join(". ") + "."
            : t("insights.couldntRead")}
        >
          <p className="stat-def">{t("insights.attentionDef")}</p>
        </Stat>
        <Stat
          icon="calendar"
          tint="lilac"
          label={t("insights.lessonsToday")}
          unavailable={t("insights.notAvailable")}
          value={lessons ? fmt.number(lessons.count) : null}
          note={lessons === null
            ? t("insights.noTimetable")
            : lessons.count === 0
              ? t("insights.noLessonsToday")
              : lessons.next
                ? t("insights.stillToCome", { count: lessons.remaining, time: fmt.time(lessons.next.starts_at) })
                : t("insights.allStarted")}
        >
          <p className="stat-def">{t("insights.lessonsDef")}</p>
        </Stat>
        <Stat
          icon="people"
          tint="blue"
          label={t("insights.tutorsAvailable")}
          unavailable={t("insights.notAvailable")}
          value={tutors.available === null ? null : fmt.number(tutors.available)}
          unit={tutors.available === null ? undefined : ` ${t("insights.ofTotal", { total: tutors.total })}`}
          note={tutors.available === null
            ? t("insights.noAvailability")
            : tutors.away === 0 ? t("insights.noneAway") : t("insights.away", { count: tutors.away })}
        >
          <p className="stat-def">{t("insights.tutorsDef")}</p>
        </Stat>
        <Stat
          icon="gauge"
          tint="lilac"
          label={t("insights.weeklyCapacity")}
          unavailable={t("insights.notAvailable")}
          value={capacity.percent === null ? null : fmt.number(capacity.percent)}
          unit={capacity.percent === null ? undefined : "%"}
          note={capacity.percent === null
            ? t("insights.noCapacity")
            : showNext
              ? t("insights.bookedNextWeek", { booked: fmt.number(capacity.booked), offered: fmt.number(capacity.offered), range: t("insights.range", { start: formatDay(capWeek.weekStart), end: formatDay(capWeek.weekEnd) }) })
              : t("insights.bookedThisWeek", { booked: fmt.number(capacity.booked), offered: fmt.number(capacity.offered) })}
        >
          <p className="stat-def">{t("insights.capacityDef")}</p>
        </Stat>
      </div>

      <div className="insight-grid" data-compass-avoid="">
        <section className="card chart-card" aria-labelledby="cap-heading">
          <div className="card-head">
            <div>
              <h2 id="cap-heading">{t("insights.bookedFree")}</h2>
              <p className="hint">{t("insights.eachDay", { when: capWhen })}</p>
            </div>
            <ul className="chart-legend" aria-label={t("insights.legend")}>
              <li><span className="swatch booked" aria-hidden="true" /> {t("overview.capacity.booked")}</li>
              <li><span className="swatch free" aria-hidden="true" /> {t("insights.free")}</li>
            </ul>
          </div>
          {capacity.offered === 0 ? (
            <p className="muted chart-empty">{t("insights.notEnough")}</p>
          ) : (
            <>
              <div className="bars" role="img" aria-label={`${t("insights.byDayCaption", { when: capWhen })}. ${capacity.byDay.map((d) => t("insights.dayHours", { day: dayLabel(d.day).long, booked: fmt.number(d.booked), free: fmt.number(d.free) })).join(". ")}.`}>
                {capacity.byDay.map((d) => {
                  const total = d.booked + d.free;
                  return (
                    <div key={d.day} className={`bar-col${d.day === p.today ? " today" : ""}`} title={t("insights.dayHours", { day: dayLabel(d.day).long, booked: hrs(d.booked), free: hrs(d.free) })}>
                      <span className="bar-total">{total ? hrs(total) : ""}</span>
                      <div className="bar-track">
                        <div className="bar-stack" style={{ height: `${(total / maxDay) * 100}%` }}>
                          {d.free > 0 && <span className="seg free" style={{ flexGrow: d.free }} />}
                          {d.booked > 0 && <span className="seg booked" style={{ flexGrow: d.booked }} />}
                        </div>
                      </div>
                      <span className="bar-label">{dayLabel(d.day).short}{d.day === p.today ? <span className="sr-only"> ({t("insights.todayLower")})</span> : null}</span>
                    </div>
                  );
                })}
              </div>
              <details className="chart-table">
                <summary>{t("insights.showTable")}</summary>
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">{t("insights.byDayCaption", { when: capWhen })}</caption>
                    <thead><tr><th scope="col">{t("insights.day")}</th><th scope="col" className="num">{t("overview.capacity.booked")}</th><th scope="col" className="num">{t("insights.free")}</th></tr></thead>
                    <tbody>{capacity.byDay.map((d) => <tr key={d.day}><th scope="row">{dayLabel(d.day).long}</th><td className="num">{hrs(d.booked)}</td><td className="num">{hrs(d.free)}</td></tr>)}</tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </section>

        <section className="card chart-card" aria-labelledby="mix-heading">
          <div className="card-head">
            <div>
              <h2 id="mix-heading">{t("insights.mix")}</h2>
              <p className="hint">{t("insights.mixHint", { range: t("insights.range", { start: formatDay(p.recentStart), end: formatDay(p.today) }) })}</p>
            </div>
          </div>
          {mix.total === 0 ? (
            <p className="muted chart-empty">{t("insights.noNew")}</p>
          ) : (
            <ul className="hbars">
              {LIGHT_ORDER.map((c) => (
                <li key={c} className={c}>
                  <span className="hbar-label"><span className="light-dot" aria-hidden="true" />{t(`domain.colourShort.${c}`)}</span>
                  <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(mix[c] / mix.total) * 100}%` }} /></span>
                  <span className="hbar-value">{fmt.number(mix[c])}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="stat-def">{t("insights.mixDef")}</p>
        </section>

        <section className="card chart-card" aria-labelledby="steps-heading">
          <div className="card-head">
            <div>
              <h2 id="steps-heading">{t("insights.byStep")}</h2>
              <p className="hint">{t("insights.byStepHint")}</p>
            </div>
            <Link className="icon-link" href="/" aria-label={t("insights.actOverview")}><Icon name="arrow" /></Link>
          </div>
          <ul className="hbars lilac">
            {steps.map((s) => (
              <li key={s.queue}>
                <span className="hbar-label">{s.label}</span>
                <span className="hbar-track"><span className="hbar-fill" style={{ width: `${(s.count / maxStep) * 100}%` }} /></span>
                <span className="hbar-value">{fmt.number(s.count)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card coverage-link-card tint-blue" aria-labelledby="cov-heading">
          <span className="stat-icon" aria-hidden="true"><Icon name="coverage" /></span>
          <h2 id="cov-heading">{t("insights.coverageCard")}</h2>
          <p className="muted">{t("insights.coverageCardText")}</p>
          <Link className="btn secondary" href="/coverage">{t("insights.openCoverage")} <Icon name="arrow" size={16} /></Link>
        </section>
      </div>
      {retention ? (
        <RetentionSection data={retention} initial={{ open: sp.retention === "open" || Boolean(sp.prepare), tab: sp.tab, student: sp.student, prepare: sp.prepare }} />
      ) : (
        <section id="retention" className="retention" aria-labelledby="ret-heading">
          <div className="card ret-overview">
            <h2 id="ret-heading">{t("retention.title")}</h2>
            <p className="muted">{retentionMissing ? t("retention.notSetUp") : t("retention.loadFailed")}</p>
          </div>
        </section>
      )}
      <p className="hint insights-foot">{t("insights.foot")}</p>
    </div>
  );
}
