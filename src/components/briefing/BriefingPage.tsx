"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Icon, type IconName } from "@/components/Icons";
import { OpenCompassButton } from "@/components/OpenCompassButton";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { BriefingPageData } from "@/lib/briefing/server";
import type { BriefingAction, BriefingView, Comparison, Priority, Recommendation } from "@/lib/briefing/types";
import {
  actionLabel,
  compareSentence,
  compareValue,
  evidenceLine,
  periodLabel,
  recExplain,
  recImpact,
  recNext,
  recTitle,
  recWhy,
  sectionSays,
  sourceLine,
  warningLine,
} from "@/lib/briefing/text";
import { BriefingSettingsPanel } from "./BriefingSettings";
import { post } from "./api";

// The Weekly Owner Briefing page. Everything shown comes from the briefing the server
// worked out from the records; this component only lays it out, opens the supporting
// records and sends the person to the existing workflow for each recommendation.

const PRIORITY_ICON: Record<Priority, IconName> = { red: "alert", amber: "clock", green: "check" };

export function BriefingPage({ data, role }: { data: BriefingPageData; role: "owner" | "admin" }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [view, setView] = useState<BriefingView>(data.view);
  const [busy, setBusy] = useState<"refresh" | "reset" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [openRec, setOpenRec] = useState<string | null>(null);
  const d = view.detail;
  const days = Number(view.recommendations.find((r) => r.kind === "overdue")?.params.days ?? 14);

  const refresh = async () => {
    setBusy("refresh");
    setNotice(null);
    try {
      const r = await post({ action: "generate" });
      setView(r.view as BriefingView);
      setNotice({ tone: "success", text: t("briefing.refreshed") });
      router.refresh();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : t("briefing.loadFailed") });
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    setBusy("reset");
    try {
      await post({ action: "reset" });
      window.location.assign("/briefing");
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : t("briefing.loadFailed") });
      setBusy(null);
    }
  };
  const review = (id: string) => {
    setOpenRec(id);
    requestAnimationFrame(() => document.getElementById(`rec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="bf-page">
      {notice && <div className={`notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>}
      {data.viewingPast && (
        <div className="notice studio-notice" role="status">
          <Icon name="clock" />
          <span>{t("briefing.history.viewing", { period: periodLabel(view.period, t, fmt) })} <Link href="/briefing">{t("briefing.history.back")}</Link></span>
        </div>
      )}

      {/* Section 1: Weekly Business Overview */}
      <section className="card bf-hero" aria-labelledby="bf-hero-h">
        <div className="bf-hero-top">
          <div>
            <h2 id="bf-hero-h">{t("briefing.title")}</h2>
            <dl className="bf-meta">
              <div><dt>{t("briefing.periodLabel")}</dt><dd>{periodLabel(view.period, t, fmt)}</dd></div>
              <div><dt>{t("briefing.generatedLabel")}</dt><dd>{fmt.dateTime(view.generatedAt)}</dd></div>
              <div><dt>{t("briefing.statusLabel")}</dt><dd><span className={`bf-status ${view.overall}`}><i aria-hidden="true" />{t(`briefing.overall.${view.overall}`)}</span></dd></div>
            </dl>
          </div>
          <div className="bf-hero-actions">
            <button type="button" className="btn dark" onClick={refresh} disabled={busy !== null}>
              <Icon name="refresh" /> {busy === "refresh" ? t("briefing.refreshing") : t("briefing.refresh")}
            </button>
            {data.mode === "demo" && role === "owner" && (
              <button type="button" className="btn outline" onClick={reset} disabled={busy !== null}>{t("briefing.resetDemo")}</button>
            )}
            <OpenCompassButton className="btn soft" />
          </div>
        </div>
        <p className="bf-overall-help">{t(`briefing.overallHelp.${view.overall}`)}</p>
        <div className="bf-sources" aria-label={t("briefing.sourcesLabel")}>
          <span className="bf-sources-label">{t("briefing.sourcesLabel")}</span>
          <ul>
            {view.sources.map((s) => (
              <li key={s.id} className={s.state}><i aria-hidden="true" />{sourceLine(s, t)}</li>
            ))}
          </ul>
        </div>
        {view.warnings.filter((w) => w.kind !== "demo").map((w, i) => (
          <p key={i} className="bf-warning" role="note"><Icon name="alert" /> {warningLine(w, t, fmt)}</p>
        ))}

        <div className="bf-kpis">
          <Kpi icon="people" label={t("briefing.metric.activeStudents")} value={fmt.number(view.headline.activeStudents)} />
          <Kpi icon="wallet" label={t("briefing.metric.overdueInvoices")} value={view.financeHidden ? null : fmt.number(view.headline.overdueInvoices)} tone={view.headline.overdueInvoices ? "red" : undefined} />
          <Kpi icon="wallet" label={t("briefing.metric.outstanding")} value={view.financeHidden ? null : fmt.money(view.headline.outstandingCents, { whole: true })} />
          <Kpi icon="requests" label={t("briefing.metric.unanswered")} value={fmt.number(view.headline.unanswered)} tone={view.headline.unanswered ? "amber" : undefined} />
          <Kpi icon="calendar" label={t("briefing.metric.upcomingLessons")} value={fmt.number(view.headline.upcomingLessons)} note={t("briefing.metric.upcomingNote")} />
          <Kpi icon="check" label={t("briefing.metric.tasksCompleted")} value={fmt.number(view.headline.tasksCompleted)} note={t("briefing.metric.completedNote")} tone="green" />
        </div>
        {view.financeHidden && <p className="bf-caption">{t("briefing.ownerOnlyFinance")}</p>}
      </section>

      {!d && (
        <section className="card bf-section" aria-label={t("briefing.history.heading")}>
          <p className="bf-empty"><Icon name="info" /> {t("briefing.history.summaryOnly")}</p>
          <span className="bf-kinds">
            {(view.recommendations as Array<Pick<Recommendation, "kind" | "priority">>).map((k, i) => <span key={i} className={`bf-kind ${k.priority}`}>{t(`briefing.recShort.${k.kind}`)}</span>)}
          </span>
        </section>
      )}

      {d && <>
      {/* Section 6: Compass Recommends (kept near the top, so the owner sees what to do first) */}
      <section className="card bf-recs" aria-labelledby="bf-recs-h" id="recommendations">
        <div className="card-head">
          <div>
            <p className="bf-overline"><Icon name="sparkle" /> {t("briefing.aiLabel")}</p>
            <h2 id="bf-recs-h">{t("briefing.recs.heading")}</h2>
            <p className="caption">{t("briefing.recs.caption")}</p>
          </div>
        </div>
        <ol className="bf-rec-list">
          {view.recommendations.map((r) => (
            <RecCard key={r.id} r={r} open={openRec === r.id} onToggle={() => setOpenRec(openRec === r.id ? null : r.id)} />
          ))}
        </ol>
        <p className="bf-caption">{t("briefing.aiNote")}</p>
      </section>

      {/* Financial Overview with Lessons and Completed under it on the left; Parent Communications on the right. */}
      <div className="bf-grid bf-split">
        <div className="bf-col">
          {/* Section 2: Financial Overview */}
          <section className="card bf-section" aria-labelledby="bf-fin-h">
            <SectionHead id="bf-fin-h" icon="wallet" title={t("briefing.finance.heading")} caption={t("briefing.finance.caption")} />
            {view.financeHidden ? (
              <p className="bf-empty"><Icon name="info" /> {t("briefing.ownerOnlyFinance")}</p>
            ) : !d?.finance ? (
              <p className="bf-empty"><Icon name="info" /> {t("briefing.finance.notConnected")}</p>
            ) : (
              <FinanceBody view={view} days={days} onReview={() => review("overdue")} />
            )}
          </section>

          {/* Section 4: Lessons and Tutor Operations */}
          <section className="card bf-section" aria-labelledby="bf-les-h">
            <SectionHead id="bf-les-h" icon="calendar" title={t("briefing.lessons.heading")} caption={t("briefing.lessons.caption")} />
            {d && <LessonsBody view={view} />}
          </section>

          {/* Section 5: What Compass Completed This Week */}
          <section className="card bf-section" aria-labelledby="bf-done-h">
            <SectionHead id="bf-done-h" icon="check" title={t("briefing.completed.heading")} caption={t("briefing.completed.caption")} />
            {d && <CompletedBody view={view} />}
          </section>
        </div>
        <div className="bf-col">
          {/* Section 3: Parent Communications */}
          <section className="card bf-section" aria-labelledby="bf-comms-h">
            <SectionHead id="bf-comms-h" icon="requests" title={t("briefing.comms.heading")} caption={t("briefing.comms.caption")} />
            {!d?.comms ? <p className="bf-empty"><Icon name="info" /> {t("briefing.comms.notConnected")}</p> : <CommsBody view={view} />}
          </section>
        </div>
      </div>

      {/* Week on week */}
      <section className="card bf-compare" aria-labelledby="bf-cmp-h">
        <SectionHead id="bf-cmp-h" icon="insights" title={t("briefing.compare.heading")} caption={t("briefing.compare.caption")} />
        <CompareBody comparisons={d.comparisons} snapshotDate={d.previousBriefing?.generatedAt ?? null} />
      </section>
      </>}

      <div className="bf-grid bf-bottom">
        <HistoryCard data={data} currentId={view.id} />
        {role === "owner" && data.settings ? (
          <BriefingSettingsPanel data={data} />
        ) : (
          <section className="card bf-section" aria-labelledby="bf-set-h">
            <SectionHead id="bf-set-h" icon="settings" title={t("briefing.schedule.heading")} caption={t("briefing.schedule.caption")} />
            <p className="bf-empty"><Icon name="info" /> {t("briefing.schedule.ownerOnly")}</p>
          </section>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, note, tone }: { icon: IconName; label: string; value: string | null; note?: string; tone?: Priority }) {
  const { t } = useI18n();
  return (
    <div className={`bf-kpi${tone ? ` ${tone}` : ""}`}>
      <span className="bf-kpi-label"><Icon name={icon} />{label}</span>
      <strong className="bf-kpi-value">{value ?? <span className="bf-hidden">{t("briefing.ownerOnly")}</span>}</strong>
      {note && <span className="bf-kpi-note">{note}</span>}
    </div>
  );
}

function SectionHead({ id, icon, title, caption }: { id: string; icon: IconName; title: string; caption: string }) {
  return (
    <div className="card-head bf-head">
      <span className="bf-head-icon" aria-hidden="true"><Icon name={icon} /></span>
      <div>
        <h2 id={id}>{title}</h2>
        <p className="caption">{caption}</p>
      </div>
    </div>
  );
}

function Says({ text }: { text: string | null }) {
  const { t } = useI18n();
  if (!text) return null;
  return (
    <div className="bf-says">
      <p className="bf-overline"><Icon name="sparkle" /> {t("briefing.aiLabel")}</p>
      <p>{text}</p>
    </div>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: Priority }) {
  return (
    <div className={`bf-figure${tone ? ` ${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function ChangeChip({ c }: { c: Comparison | undefined }) {
  const { t, fmt } = useI18n();
  if (!c) return null;
  if (c.verdict === "insufficient") return <small className="bf-chip insufficient">{t("briefing.compare.insufficient")}</small>;
  if (c.verdict === "same") return <small className="bf-chip same">{t("briefing.compare.same")}</small>;
  const arrow = (c.change ?? 0) < 0 ? "↓" : "↑";
  const amount = c.key === "outstandingCents" ? fmt.money(Math.abs(c.change ?? 0), { whole: true }) : fmt.number(Math.abs(c.change ?? 0));
  return <small className={`bf-chip ${c.verdict}`}><span aria-hidden="true">{arrow}</span> {amount}{c.percent !== null ? ` (${fmt.number(Math.abs(c.percent))}%)` : ""} <span className="sr-only">{t(`briefing.compare.${c.verdict === "neutral" ? "neutral" : c.verdict}`)}</span></small>;
}

function FinanceBody({ view, days, onReview }: { view: BriefingView; days: number; onReview: () => void }) {
  const { t, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const f = view.detail!.finance!;
  const cmp = (k: Comparison["key"]) => view.detail!.comparisons.find((c) => c.key === k);
  const listId = useId();
  return (
    <>
      <div className="bf-figures">
        <Figure label={t("briefing.finance.outstanding")} value={fmt.money(f.outstandingCents, { whole: true })} note={t("briefing.finance.outstandingNote", { count: f.outstandingInvoices })} />
        <Figure label={t("briefing.finance.overdue")} value={fmt.number(f.overdueInvoices)} tone={f.overdueInvoices ? "red" : "green"} />
        <Figure label={t("briefing.finance.overdueBalance")} value={fmt.money(f.overdueCents, { whole: true })} tone={f.overdueCents ? "red" : "green"} />
        <Figure label={t("briefing.finance.overDays", { days })} value={fmt.number(f.over14Invoices)} note={fmt.money(f.over14Cents, { whole: true })} tone={f.over14Invoices ? "red" : "green"} />
        <Figure label={t("briefing.finance.received")} value={fmt.money(f.paymentsReceivedCents, { whole: true })} note={t("briefing.finance.receivedNote", { count: f.paymentsReceivedCount })} />
        <div className="bf-figure">
          <span>{t("briefing.finance.vsLastWeek")}</span>
          <ChangeChip c={cmp("overdueInvoices")} />
          <ChangeChip c={cmp("outstandingCents")} />
        </div>
      </div>
      <Says text={sectionSays("finance", view.detail!, t, fmt, days)} />
      <div className="bf-actions">
        <button type="button" className="btn outline" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
          <Icon name="search" /> {open ? t("briefing.actions.hideRecords") : t("briefing.actions.viewRecords")}
        </button>
        <button type="button" className="btn outline" onClick={onReview}><Icon name="sparkle" /> {t("briefing.actions.reviewRecommendation")}</button>
        <Link className="btn dark" href="/payments?tab=recovery"><Icon name="wallet" /> {t("briefing.actions.prepareReminders")}</Link>
      </div>
      <p className="bf-caption">{t("briefing.actions.approvalNote")}</p>
      {open && (
        <div id={listId} className="bf-table-wrap">
          <table className="bf-table">
            <caption className="sr-only">{t("briefing.finance.families")}</caption>
            <thead><tr><th scope="col">{t("briefing.finance.families")}</th><th scope="col">{t("briefing.finance.overdue")}</th><th scope="col">{t("briefing.finance.overdueBalance")}</th><th scope="col">{t("briefing.statusLabel")}</th></tr></thead>
            <tbody>
              {f.families.map((x) => (
                <tr key={x.contactId}>
                  <th scope="row"><bdi>{x.name}</bdi><small>{x.students.join(", ")}</small></th>
                  <td>{x.invoices.map((i) => <span key={i.id} className="bf-ref"><bdi>{i.id}</bdi> · {i.days} d</span>)}</td>
                  <td>{fmt.money(x.cents, { whole: true })}</td>
                  <td><span className={`bf-state ${x.state}`}>{t(`briefing.finance.state.${x.state}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CommsBody({ view }: { view: BriefingView }) {
  const { t, fmt } = useI18n();
  const c = view.detail!.comms!;
  const groups: Priority[] = ["red", "amber", "green"];
  return (
    <>
      <div className="bf-figures">
        <Figure label={t("briefing.comms.unanswered")} value={fmt.number(c.unanswered)} tone={c.unanswered ? "amber" : "green"} />
        <Figure label={t("briefing.comms.awaitingOwner")} value={fmt.number(c.awaitingOwner)} tone={c.awaitingOwner ? "amber" : undefined} />
        <Figure label={t("briefing.comms.lessonChanges")} value={fmt.number(c.lessonChanges)} />
        <Figure label={t("briefing.comms.billing")} value={fmt.number(c.billing)} />
        <Figure label={t("briefing.comms.followUp")} value={fmt.number(c.failedTexts.length + c.tutorMessages)} note={c.failedTexts.length ? t("briefing.comms.followUpNote", { count: c.failedTexts.length }) : undefined} />
      </div>
      <Says text={sectionSays("comms", view.detail!, t, fmt, 0)} />
      {c.open.length === 0 ? (
        <p className="bf-empty"><Icon name="check" /> {t("briefing.comms.none")}</p>
      ) : (
        groups.map((g) => {
          const items = c.open.filter((m) => m.urgency === g);
          if (!items.length) return null;
          return (
            <div key={g} className="bf-group">
              <h3 className={`bf-group-h ${g}`}><i aria-hidden="true" />{t(`briefing.comms.urgency.${g}`)} <span>({items.length})</span></h3>
              <ul className="bf-msgs">
                {items.map((m) => (
                  <li key={m.id}>
                    <div className="bf-msg-top">
                      <span className="bf-tag">{t(`briefing.comms.category.${m.category}`)}</span>
                      <span className="bf-tag plain">{m.channel === "sms" ? "SMS" : "Gmail"}</span>
                      <span className="bf-age">{m.ageHours >= 48 ? t("briefing.comms.waitedDays", { days: Math.floor(m.ageHours / 24) }) : t("briefing.comms.waited", { hours: m.ageHours })}</span>
                    </div>
                    <strong dir="auto">{m.subject}</strong>
                    <span className="bf-msg-from"><bdi>{m.contactName}</bdi>{m.studentName ? <> · <bdi>{m.studentName}</bdi></> : null} · <bdi>{m.id}</bdi></span>
                    <div className="bf-msg-actions">
                      {m.requestId ? (
                        <Link className="btn small outline" href={`/requests/${m.requestId}`}>{t("briefing.comms.openRequest")} <Icon name="arrow" /></Link>
                      ) : m.category === "lesson_change" ? (
                        <OpenCompassButton className="btn small outline" shortcut="lesson_change" label={t("briefing.comms.startChange")} variant="plain" icon="calendar" />
                      ) : m.category === "tutor_absence" ? (
                        <OpenCompassButton className="btn small outline" shortcut="tutor_absence" label={t("briefing.actions.startTutorAbsence")} variant="plain" icon="people" />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </>
  );
}

function LessonsBody({ view }: { view: BriefingView }) {
  const { t, fmt } = useI18n();
  const l = view.detail!.lessons;
  const day = (d: string) => fmt.date(new Date(`${d}T12:00:00Z`), { day: "numeric", month: "short" });
  return (
    <>
      <div className="bf-figures">
        <Figure label={t("briefing.lessons.held")} value={fmt.number(l.held)} />
        <Figure label={t("briefing.lessons.upcoming")} value={fmt.number(l.upcoming)} note={t("briefing.metric.upcomingNote")} />
        <Figure label={t("briefing.lessons.confirmation")} value={t("briefing.lessons.notTracked")} />
        <Figure label={t("briefing.lessons.absences")} value={fmt.number(l.absences.length)} tone={l.absences.length ? "amber" : undefined} />
        <Figure label={t("briefing.lessons.pendingChanges")} value={fmt.number(l.pendingChanges)} tone={l.pendingChanges ? "amber" : undefined} />
        <Figure label={t("briefing.lessons.intervention")} value={fmt.number(l.clarifications + l.openTasks + l.ownerDecisions.length)} note={t("briefing.lessons.interventionNote", { clarifications: l.clarifications, tasks: l.openTasks })} />
      </div>
      <Says text={sectionSays("lessons", view.detail!, t, fmt, 0)} />
      {l.absences.length ? (
        <ul className="bf-list">{l.absences.map((a, i) => <li key={i}><Icon name="people" /> {t("briefing.lessons.away", { name: a.tutorName, start: day(a.startsOn), end: day(a.endsOn) })}</li>)}</ul>
      ) : (
        <p className="bf-empty"><Icon name="check" /> {t("briefing.lessons.noAbsences")}</p>
      )}
      {l.needCover.length > 0 && (
        <ul className="bf-list">{l.needCover.map((x) => <li key={x.id} className="warn"><Icon name="alert" /> <bdi>{x.id}</bdi> · {x.subject} · <bdi>{x.tutorName}</bdi> · {fmt.dateTime(x.startsAt)}</li>)}</ul>
      )}
      <div className="bf-actions">
        <OpenCompassButton className="btn outline" shortcut="tutor_absence" label={t("briefing.actions.startTutorAbsence")} variant="plain" icon="people" />
        <OpenCompassButton className="btn outline" shortcut="lesson_change" label={t("briefing.actions.startLessonChange")} variant="plain" icon="calendar" />
        <Link className="btn outline" href="/schedule"><Icon name="calendar" /> {t("briefing.actions.openSchedule")}</Link>
      </div>
    </>
  );
}

function CompletedBody({ view }: { view: BriefingView }) {
  const { t, fmt } = useI18n();
  const c = view.detail!.completed;
  const who: Array<keyof typeof c.byWho> = ["rules", "admin", "owner", "compass"];
  const max = Math.max(1, ...who.map((w) => c.byWho[w]));
  return (
    <>
      <div className="bf-figures">
        <Figure label={t("briefing.completed.requestsProcessed")} value={fmt.number(c.requestsReceived)} />
        <Figure label={t("briefing.completed.requestsClosed")} value={fmt.number(c.requestsClosed)} />
        <Figure label={t("briefing.completed.lessonChanges")} value={fmt.number(c.lessonChanges)} />
        <Figure label={t("briefing.completed.availability")} value={fmt.number(c.availabilityChecks)} />
        <Figure label={t("briefing.completed.drafted")} value={fmt.number(c.drafted)} note={t("briefing.completed.draftedNote")} />
        <Figure label={t("briefing.completed.ownerApprovals")} value={fmt.number(c.ownerApprovals)} />
      </div>
      <h3 className="bf-sub">{t("briefing.completed.who.heading")} · {t("briefing.completed.total", { count: c.total })}</h3>
      <ul className="bf-bars">
        {who.map((w) => (
          <li key={w}>
            <span>{t(`briefing.completed.who.${w}`)}</span>
            <span className="bf-bar" aria-hidden="true"><i className={w} style={{ width: `${(c.byWho[w] / max) * 100}%` }} /></span>
            <strong>{fmt.number(c.byWho[w])}</strong>
          </li>
        ))}
      </ul>
      <p className="bf-caption">{t("briefing.completed.compassNote")}</p>
    </>
  );
}

function CompareBody({ comparisons, snapshotDate }: { comparisons: Comparison[]; snapshotDate: string | null }) {
  const { t, fmt } = useI18n();
  return (
    <>
      <ul className="bf-compare-grid">
        {comparisons.map((c) => {
          const top = Math.max(c.current ?? 0, c.previous ?? 0, 1);
          return (
            <li key={c.key} className={`bf-cmp ${c.verdict}`}>
              <div className="bf-cmp-top">
                <span>{t(`briefing.compare.key.${c.key}`)}</span>
                <ChangeChip c={c} />
              </div>
              {c.verdict === "insufficient" ? (
                <p className="bf-insufficient">{t("briefing.compare.insufficient")}</p>
              ) : (
                <>
                  <div className="bf-cmp-bars" aria-hidden="true">
                    <span><i className="prev" style={{ width: `${((c.previous ?? 0) / top) * 100}%` }} /></span>
                    <span><i className="now" style={{ width: `${((c.current ?? 0) / top) * 100}%` }} /></span>
                  </div>
                  <p className="bf-cmp-values">
                    <span>{t("briefing.compare.lastWeek")}: <b>{compareValue(c, "previous", t, fmt)}</b></span>
                    <span>{t("briefing.compare.thisWeek")}: <b>{compareValue(c, "current", t, fmt)}</b></span>
                  </p>
                  <p className="bf-cmp-sentence">{compareSentence(c, t, fmt)}</p>
                </>
              )}
              <small className="bf-basis">{c.basis === "snapshot" && snapshotDate ? t("briefing.compare.fromSnapshot", { date: fmt.date(snapshotDate) }) : c.basis === "records" ? t("briefing.compare.fromRecords") : ""}</small>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function RecCard({ r, open, onToggle }: { r: Recommendation; open: boolean; onToggle: () => void }) {
  const { t, fmt } = useI18n();
  const [records, setRecords] = useState(false);
  const whyId = useId();
  const recId = useId();
  const impact = recImpact(r, t, fmt);
  return (
    <li className={`bf-rec ${r.priority}`} id={`rec-${r.id}`}>
      <div className="bf-rec-head">
        <span className={`bf-priority ${r.priority}`}><Icon name={PRIORITY_ICON[r.priority]} />{t(`briefing.priority.${r.priority}`)}</span>
        <h3>{recTitle(r, t, fmt)}</h3>
      </div>
      <dl className="bf-rec-body">
        <div><dt>{t("briefing.recs.whyMatters")}</dt><dd>{recWhy(r, t, fmt)}</dd></div>
        <div><dt>{t("briefing.recs.nextStep")}</dt><dd>{recNext(r, t, fmt)}</dd></div>
        {impact && <div><dt>{t("briefing.recs.impact")}</dt><dd>{impact}</dd></div>}
      </dl>
      <div className="bf-actions">
        {r.actions.map((a, i) => <ActionButton key={i} a={a} primary={i === 0} onRecords={() => setRecords(!records)} recordsOpen={records} recordsId={recId} />)}
        <button type="button" className="bf-why-btn" aria-expanded={open} aria-controls={whyId} onClick={onToggle}>
          <Icon name="info" /> {t("briefing.recs.why")}
        </button>
      </div>
      {open && (
        <div id={whyId} className="bf-why">
          <p>{recExplain(r, t, fmt)}</p>
          {r.evidence.length > 0 && (
            <>
              <p className="bf-overline">{t("briefing.recs.evidence")}</p>
              <ul>{r.evidence.map((e, i) => <li key={i}><span className="bf-tag plain">{t(`briefing.source.${e.source}`)}</span> <span dir="auto">{evidenceLine(e, t, fmt)}</span></li>)}</ul>
            </>
          )}
        </div>
      )}
      {records && !open && r.evidence.length > 0 && (
        <ul id={recId} className="bf-why bf-records">{r.evidence.map((e, i) => <li key={i}><span className="bf-tag plain">{t(`briefing.source.${e.source}`)}</span> <span dir="auto">{evidenceLine(e, t, fmt)}</span></li>)}</ul>
      )}
    </li>
  );
}

function ActionButton({ a, primary, onRecords, recordsOpen, recordsId }: { a: BriefingAction; primary: boolean; onRecords: () => void; recordsOpen: boolean; recordsId: string }) {
  const { t } = useI18n();
  const cls = `btn small ${primary ? "dark" : "outline"}`;
  if (a.kind === "link") return <Link className={cls} href={a.href}>{actionLabel(a, t)} <Icon name="arrow" /></Link>;
  if (a.kind === "compass") return <OpenCompassButton className={cls} shortcut={a.shortcut} label={actionLabel(a, t)} variant="plain" icon="sparkle" />;
  return <button type="button" className={cls} aria-expanded={recordsOpen} aria-controls={recordsId} onClick={onRecords}>{recordsOpen ? t("briefing.actions.hideRecords") : actionLabel(a, t)}</button>;
}

function HistoryCard({ data, currentId }: { data: BriefingPageData; currentId: string }) {
  const { t, fmt } = useI18n();
  return (
    <section className="card bf-section" aria-labelledby="bf-hist-h">
      <SectionHead id="bf-hist-h" icon="clock" title={t("briefing.history.heading")} caption={t("briefing.history.caption")} />
      {data.history.length === 0 ? (
        <p className="bf-empty">{t("briefing.history.none")}</p>
      ) : (
        <ul className="bf-history">
          {data.history.map((h) => (
            <li key={h.id} className={h.id === currentId ? "current" : ""}>
              <Link href={h.id === data.history[0]?.id ? "/briefing" : `/briefing?id=${h.id}`} aria-current={h.id === currentId ? "page" : undefined}>
                <span className={`bf-status ${h.overall}`}><i aria-hidden="true" />{t(`briefing.overall.${h.overall}`)}</span>
                <strong>{fmt.date(new Date(`${h.periodKey}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</strong>
                <small>
                  {t(`briefing.history.trigger.${h.trigger}`)} · {t("briefing.history.figures", { overdue: data.view.financeHidden ? "–" : h.headline.overdueInvoices, unanswered: h.headline.unanswered, done: h.headline.tasksCompleted })}
                </small>
                <span className="bf-kinds">
                  {h.kinds.filter((k) => !(data.view.financeHidden && k.kind === "overdue")).slice(0, 4).map((k, i) => <span key={i} className={`bf-kind ${k.priority}`}>{t(`briefing.recShort.${k.kind}`)}</span>)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
