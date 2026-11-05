"use client";
import { useMemo, useState } from "react";
import { Icon } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { RetentionData } from "@/lib/retention/server";
import type { Assessment, LessonOutcome, RetentionSettings } from "@/lib/retention/types";
import { concernLabel, DEFAULT_SETTINGS, POINTS } from "@/lib/retention/logic";
import { ErrorNote, LevelBadge, useDay, useRetentionAction, useWhen } from "./shared";

// Tab 1: every monitored student, flagged ones first, with Compass's investigation of the
// one selected. Owners can dismiss a wrong flag (with a reason), resolve a concern that has
// been dealt with and change the thresholds.

type Filter = "flagged" | "high" | "medium" | "low" | "all";
const OUTCOME_TONE: Record<LessonOutcome, string> = { attended: "green", cancelled_family: "red", no_show: "red", cancelled_tutor: "", rescheduled: "amber", scheduled: "info" };

export function StudentsTab({ data, selected, onSelect, onReviewDrafts }: { data: RetentionData; selected: string | null; onSelect: (id: string) => void; onReviewDrafts: (studentId?: string) => void }) {
  const { t, fmt } = useI18n();
  const [filter, setFilter] = useState<Filter>("flagged");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const { run, busy, error, setError } = useRetentionAction();

  const list = useMemo(() => data.assessments.filter((a) => {
    if (filter === "all") return true;
    if (filter === "flagged") return a.flagged;
    if (filter === "low") return a.level === "low" || Boolean(a.dismissed);
    return a.flagged && a.level === filter;
  }), [data.assessments, filter]);
  const current = data.assessments.find((a) => a.studentId === selected) ?? list[0] ?? null;
  const inProgress = new Set(data.messages.filter((m) => ["draft", "awaiting_approval", "approved", "rejected", "sending"].includes(m.status)).map((m) => m.studentId));
  const counts: Record<Filter, number> = {
    flagged: data.assessments.filter((a) => a.flagged).length,
    high: data.assessments.filter((a) => a.flagged && a.level === "high").length,
    medium: data.assessments.filter((a) => a.flagged && a.level === "medium").length,
    low: data.assessments.filter((a) => a.level === "low" || a.dismissed).length,
    all: data.assessments.length,
  };

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function prepare(ids: string[]) {
    setNotice(null);
    const r = await run<{ prepared: number; existing: number; skipped: Array<{ id: string; reason: string }> }>("prepare", { action: "prepare", studentIds: ids });
    if (!r.ok) return;
    const { prepared, existing, skipped } = r.data;
    setChecked(new Set());
    setNotice([
      prepared ? t("retention.students.prepared", { count: prepared }) : null,
      existing ? t("retention.students.existing", { count: existing }) : null,
      skipped.length ? t("retention.students.skipped", { count: skipped.length, reasons: skipped.map((s) => `${data.names[s.id] ?? s.id}: ${s.reason}`).join("; ") }) : null,
    ].filter(Boolean).join(" "));
    onReviewDrafts(ids.length === 1 ? ids[0] : undefined);
  }

  const selectable = list.filter((a) => a.flagged);
  const chosen = [...checked].filter((id) => data.assessments.some((a) => a.studentId === id));

  return (
    <div className="ret-students">
      <div className="ret-toolbar">
        <div className="ret-filters" role="group" aria-label={t("retention.students.filterLabel")}>
          {(["flagged", "high", "medium", "low", "all"] as Filter[]).map((f) => (
            <button key={f} type="button" className={`ret-chip${filter === f ? " active" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`retention.filter.${f}`)} <span className="ret-chip-count">{fmt.number(counts[f])}</span>
            </button>
          ))}
        </div>
        <div className="ret-bulk" role="group" aria-label={t("retention.students.bulkLabel")}>
          <button type="button" className="btn small secondary" onClick={() => setChecked(new Set(selectable.map((a) => a.studentId)))} disabled={!selectable.length}>{t("retention.students.selectAll")}</button>
          <button type="button" className="btn small secondary" onClick={() => setChecked(new Set())} disabled={!chosen.length}>{t("retention.students.clear")}</button>
          <button type="button" className="btn small" onClick={() => prepare(chosen)} disabled={!chosen.length || Boolean(busy)} aria-busy={busy === "prepare" || undefined}>
            {busy === "prepare" ? t("retention.students.preparing") : t("retention.students.prepareN", { count: chosen.length })}
          </button>
          <button type="button" className="btn small secondary" onClick={() => onReviewDrafts()}>{t("retention.students.reviewDrafts")}</button>
        </div>
      </div>
      {notice && <p className="notice success" role="status">{notice}</p>}
      <ErrorNote text={error} onClose={() => setError(null)} />

      <div className="ret-split">
        <ul className="ret-list" aria-label={t("retention.students.listLabel")}>
          {list.length === 0 && <li className="ret-empty muted">{filter === "flagged" ? t("retention.students.noneFlagged") : t("retention.students.none")}</li>}
          {list.map((a) => (
            <li key={a.studentId} className={`ret-row${current?.studentId === a.studentId ? " selected" : ""}`}>
              {a.flagged ? (
                <input type="checkbox" className="ret-check" checked={checked.has(a.studentId)} onChange={() => toggle(a.studentId)} aria-label={t("retention.students.selectOne", { name: a.name })} />
              ) : <span className="ret-check-gap" aria-hidden="true" />}
              <button type="button" className="ret-row-main" aria-current={current?.studentId === a.studentId ? "true" : undefined} onClick={() => onSelect(a.studentId)}>
                <span className="ret-row-top">
                  <span className="ret-name">{a.name}</span>
                  <LevelBadge level={a.level} score={a.score} dismissed={Boolean(a.dismissed)} />
                </span>
                <span className="ret-row-meta">{a.yearLevel ? `${t("retention.common.year", { n: a.yearLevel })} · ` : ""}{a.subject}</span>
                <span className="ret-row-reason">{a.reasons[0]}</span>
                {inProgress.has(a.studentId) && <span className="ret-row-flag"><Icon name="clock" size={14} /> {t("retention.students.checkInUnderWay")}</span>}
              </button>
            </li>
          ))}
        </ul>

        {current ? (
          <Investigation key={current.studentId} a={current} data={data} underWay={inProgress.has(current.studentId)} onPrepare={() => prepare([current.studentId])} onReviewDrafts={() => onReviewDrafts(current.studentId)} busy={busy} />
        ) : (
          <div className="ret-detail muted">{t("retention.students.pick")}</div>
        )}
      </div>

      <SettingsPanel settings={data.settings} owner={data.role === "owner"} />
    </div>
  );
}

function Investigation({ a, data, underWay, onPrepare, onReviewDrafts, busy }: { a: Assessment; data: RetentionData; underWay: boolean; onPrepare: () => void; onReviewDrafts: () => void; busy: string | null }) {
  const { t, fmt } = useI18n();
  const day = useDay();
  const when = useWhen();
  const owner = data.role === "owner";
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const action = useRetentionAction();
  const rec = data.records[a.studentId] ?? { lessons: [], concerns: [] };
  const c = a.contact;
  const s = data.settings;

  return (
    <article className="ret-detail" aria-labelledby={`ret-inv-${a.studentId}`}>
      <header className="ret-detail-head">
        <div>
          <p className="kicker">{t("retention.inv.kicker")}</p>
          <h3 id={`ret-inv-${a.studentId}`}>{a.name}</h3>
          <p className="muted">{[a.yearLevel ? t("retention.common.year", { n: a.yearLevel }) : null, a.subject, a.tutorName ? t("retention.inv.withTutor", { tutor: a.tutorName }) : null].filter(Boolean).join(" · ")}</p>
        </div>
        <LevelBadge level={a.level} score={a.score} dismissed={Boolean(a.dismissed)} />
      </header>

      <dl className="ret-profile">
        <div><dt>{t("retention.inv.parent")}</dt><dd>{c ? <>{c.name}<span className="ret-contact">{c.email ?? t("retention.inv.noEmail")}{c.emailPermitted ? "" : ` (${t("retention.inv.notAgreed")})`}</span><span className="ret-contact">{c.phone ?? t("retention.inv.noPhone")}{c.smsPermitted ? "" : ` (${t("retention.inv.smsNotAgreed")})`}</span></> : t("retention.inv.noParent")}</dd></div>
        <div><dt>{t("retention.inv.attendanceNow")}</dt><dd>{a.currentAttendance === null ? "–" : `${fmt.number(a.currentAttendance)}%`}<span className="ret-contact">{t("retention.inv.lessonsIn", { count: a.currentLessons, days: s.windowDays })}</span></dd></div>
        <div><dt>{t("retention.inv.attendanceBefore")}</dt><dd>{a.previousAttendance === null ? "–" : `${fmt.number(a.previousAttendance)}%`}<span className="ret-contact">{t("retention.inv.lessonsIn", { count: a.previousLessons, days: s.baselineDays })}</span></dd></div>
        <div><dt>{t("retention.inv.cancellations")}</dt><dd>{fmt.number(a.cancellations)}<span className="ret-contact">{t("retention.inv.plusMissed", { count: a.noShows })}</span></dd></div>
        <div><dt>{t("retention.inv.concerns")}</dt><dd>{fmt.number(a.openConcerns.length)}{a.confidentialNotes > 0 && <span className="ret-contact">{t("retention.inv.confidential", { count: a.confidentialNotes })}</span>}</dd></div>
        <div><dt>{t("retention.inv.next")}</dt><dd>{a.nextLesson ? day(a.nextLesson) : t("retention.inv.noneBooked")}</dd></div>
      </dl>

      {a.dismissed && (
        <p className="notice info">{t("retention.inv.dismissedNote", { who: a.dismissed.by ? data.users[a.dismissed.by] ?? t("retention.common.owner") : t("retention.common.owner"), when: when(a.dismissed.createdAt), reason: a.dismissed.reason })}</p>
      )}

      <section className="ret-findings" aria-labelledby={`ret-find-${a.studentId}`}>
        <h4 id={`ret-find-${a.studentId}`}><Icon name="sparkle" size={16} /> {t("retention.inv.findings")}</h4>
        {a.factors.length ? (
          <ul>{[...a.factors].sort((x, y) => y.points - x.points).map((f) => <li key={f.id}>{f.text}</li>)}</ul>
        ) : <p>{a.reasons[0]}</p>}
        <p className="ret-suggest"><strong>{t("retention.inv.suggested")}</strong> {a.suggestedAction}</p>
        <p className="hint">{t("retention.inv.notPrediction")}</p>
      </section>

      <details className="ret-score-detail">
        <summary>{t("retention.inv.howScored", { score: a.score })}</summary>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{t("retention.inv.howScoredCaption", { name: a.name })}</caption>
            <thead><tr><th scope="col">{t("retention.inv.sign")}</th><th scope="col">{t("retention.inv.records")}</th><th scope="col" className="num">{t("retention.inv.points")}</th></tr></thead>
            <tbody>
              {a.factors.map((f) => (
                <tr key={f.id}>
                  <th scope="row">{f.text}</th>
                  <td><ul className="ret-evidence">{f.evidence.map((e) => <li key={e}>{e}</li>)}</ul></td>
                  <td className="num">{f.points} / {f.max}</td>
                </tr>
              ))}
              {!a.factors.length && <tr><td colSpan={3} className="muted">{t("retention.inv.noPoints")}</td></tr>}
            </tbody>
            <tfoot><tr><th scope="row" colSpan={2}>{t("retention.inv.total")}</th><td className="num"><strong>{a.score} / 100</strong></td></tr></tfoot>
          </table>
        </div>
        <p className="hint">{t("retention.inv.scoreRules", { high: s.highThreshold, medium: s.mediumThreshold, window: s.windowDays, baseline: s.baselineDays, cancel: POINTS.cancellation, noShow: POINTS.noShow, concern: POINTS.concern })}</p>
      </details>

      <details className="ret-records">
        <summary>{t("retention.inv.supporting", { lessons: rec.lessons.length, concerns: rec.concerns.length })}</summary>
        {rec.concerns.length > 0 && (
          <ul className="ret-concerns">
            {rec.concerns.map((cn) => (
              <li key={cn.id} className={cn.confidential ? "confidential" : undefined}>
                <p className="ret-concern-top">
                  <span className={`badge ${cn.status === "open" ? "amber" : "green"}`}>{cn.status === "open" ? t("retention.inv.open") : t("retention.inv.resolved")}</span>
                  <span>{cn.confidential ? t("retention.inv.confidentialLabel") : concernLabel(cn.category)}</span>
                  <span className="hint">{day(cn.raisedOn)}</span>
                </p>
                <p>{cn.summary}</p>
                {owner && cn.status === "open" && !cn.confidential && (
                  <button type="button" className="ret-link" disabled={Boolean(action.busy)} onClick={() => action.run(`resolve-${cn.id}`, { action: "resolve_concern", id: cn.id })}>{t("retention.inv.markResolved")}</button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{t("retention.inv.lessonsCaption", { name: a.name })}</caption>
            <thead><tr><th scope="col">{t("retention.inv.date")}</th><th scope="col">{t("retention.inv.lesson")}</th><th scope="col">{t("retention.inv.outcome")}</th></tr></thead>
            <tbody>
              {rec.lessons.slice(0, 24).map((l) => (
                <tr key={l.id}><td>{day(l.date)}</td><td>{l.subject}{l.tutorName ? `, ${l.tutorName}` : ""}</td><td><span className={`badge ${OUTCOME_TONE[l.outcome]}`}>{t(`retention.outcome.${l.outcome}`)}</span></td></tr>
              ))}
              {!rec.lessons.length && <tr><td colSpan={3} className="muted">{t("retention.inv.noLessons")}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="hint">{t("retention.inv.recordsNote")}</p>
      </details>

      <div className="ret-detail-actions">
        {underWay ? (
          <button type="button" className="btn" onClick={onReviewDrafts}>{t("retention.inv.openDraft")} <Icon name="arrow" size={16} /></button>
        ) : (
          <button type="button" className="btn" onClick={onPrepare} disabled={Boolean(busy) || !a.contact} aria-busy={busy === "prepare" || undefined}>
            {busy === "prepare" ? t("retention.students.preparing") : t("retention.inv.prepare")} <Icon name="arrow" size={16} />
          </button>
        )}
        {owner && a.level !== "low" && !a.dismissed && !dismissing && (
          <button type="button" className="btn secondary" onClick={() => setDismissing(true)}>{t("retention.inv.dismiss")}</button>
        )}
        {owner && a.dismissed && (
          <button type="button" className="btn secondary" disabled={Boolean(action.busy)} onClick={() => action.run("restore", { action: "restore", studentId: a.studentId })}>{t("retention.inv.restore")}</button>
        )}
      </div>
      {dismissing && (
        <form className="ret-dismiss" onSubmit={async (e) => {
          e.preventDefault();
          const r = await action.run("dismiss", { action: "dismiss", studentId: a.studentId, reason });
          if (r.ok) { setDismissing(false); setReason(""); }
        }}>
          <label htmlFor={`ret-dismiss-${a.studentId}`}>{t("retention.inv.dismissWhy")}</label>
          <textarea id={`ret-dismiss-${a.studentId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} required minLength={5} placeholder={t("retention.inv.dismissPlaceholder")} />
          <div className="row">
            <button type="submit" className="btn small" disabled={reason.trim().length < 5 || Boolean(action.busy)}>{t("retention.inv.dismissConfirm")}</button>
            <button type="button" className="btn small secondary" onClick={() => { setDismissing(false); setReason(""); }}>{t("retention.common.cancel")}</button>
          </div>
        </form>
      )}
      <ErrorNote text={action.error} onClose={() => action.setError(null)} />
    </article>
  );
}

function SettingsPanel({ settings, owner }: { settings: RetentionSettings; owner: boolean }) {
  const { t } = useI18n();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const { run, busy, error, setError } = useRetentionAction();
  const fields: Array<{ key: keyof RetentionSettings; min: number; max: number }> = [
    { key: "highThreshold", min: 2, max: 100 },
    { key: "mediumThreshold", min: 1, max: 99 },
    { key: "windowDays", min: 7, max: 90 },
    { key: "baselineDays", min: 14, max: 180 },
    { key: "minLessons", min: 1, max: 20 },
    { key: "cooldownDays", min: 1, max: 60 },
  ];
  const changed = fields.some((f) => form[f.key] !== settings[f.key]);
  return (
    <details className="ret-settings">
      <summary><Icon name="sliders" size={16} /> {t("retention.settings.title")}</summary>
      <p className="hint">{owner ? t("retention.settings.intro") : t("retention.settings.ownerOnly")}</p>
      <form onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const r = await run("settings", { action: "settings", settings: form });
        if (r.ok) setSaved(true);
      }}>
        <div className="ret-settings-grid">
          {fields.map((f) => (
            <label key={f.key}>
              <span>{t(`retention.settings.${f.key}`)}</span>
              <input type="number" inputMode="numeric" min={f.min} max={f.max} value={form[f.key]} disabled={!owner} onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        {owner && (
          <div className="row">
            <button type="submit" className="btn small" disabled={!changed || Boolean(busy)}>{t("retention.settings.save")}</button>
            <button type="button" className="btn small secondary" disabled={Boolean(busy)} onClick={() => setForm(DEFAULT_SETTINGS)}>{t("retention.settings.defaults")}</button>
            {saved && !changed && <span className="hint" role="status">{t("retention.settings.saved")}</span>}
          </div>
        )}
      </form>
      <ErrorNote text={error} onClose={() => setError(null)} />
    </details>
  );
}
