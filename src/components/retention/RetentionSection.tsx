"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { RetentionData } from "@/lib/retention/server";
import { ErrorNote, LightShape, useRetentionAction, useWhen } from "./shared";
import { RetentionAgent, type AgentTab } from "./RetentionAgent";

// Student Retention on the Insights page: the overview card stays in view, and the agent
// opens underneath it on the same page. "?retention=open" in the address keeps it open
// after a refresh, and Compass links can name a student or a tab.

export function RetentionSection({ data, initial }: { data: RetentionData; initial: { open: boolean; tab?: string; student?: string; prepare?: string } }) {
  const { t, fmt, lang } = useI18n();
  const when = useWhen();
  const [open, setOpen] = useState(initial.open);
  const sectionRef = useRef<HTMLElement>(null);
  const { run, busy, error, setError } = useRetentionAction();
  const o = data.overview;
  const owner = data.role === "owner";
  const total = Math.max(1, o.monitored);

  useEffect(() => {
    if (initial.open) sectionRef.current?.scrollIntoView({ block: "start" });
  }, [initial.open]);
  // A Compass link to this page (for example "Open Aarav") opens the agent even when the page is already showing.
  const params = useSearchParams();
  const wantOpen = params.get("retention") === "open" || Boolean(params.get("prepare"));
  useEffect(() => {
    if (wantOpen && !open) {
      setOpen(true);
      requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: "start" }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantOpen, params]);

  function toggle() {
    const next = !open;
    setOpen(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("retention", "open");
    else ["retention", "tab", "student", "prepare"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(window.history.state, "", url);
  }

  const segments: Array<{ level: "high" | "medium" | "low"; count: number }> = [
    { level: "high", count: o.high },
    { level: "medium", count: o.medium },
    { level: "low", count: o.low },
  ];

  return (
    <section id="retention" ref={sectionRef} className="retention" aria-labelledby="ret-heading" lang={lang === "en" ? undefined : "en"} data-compass-avoid="">
      <p className="kicker ret-kicker">{t("retention.section")}</p>
      <div className="card ret-overview">
        <div className="ret-head">
          <span className="stat-icon" aria-hidden="true"><Icon name="people" /></span>
          <div className="ret-head-text">
            <h2 id="ret-heading">{t("retention.title")}</h2>
            <p className="muted">{t("retention.subheading")}</p>
          </div>
          <div className="ret-head-meta">
            <span className={`badge ${data.mode === "demo" ? "lilac" : "info"}`}>{data.mode === "demo" ? t("retention.mode.demo") : t("retention.mode.live")}</span>
            <p className="hint">{t("retention.latest", { when: when(data.latestRunAt) })}</p>
          </div>
        </div>

        <div className="ret-metrics" role="list" aria-label={t("retention.metricsLabel")}>
          {segments.map((s) => (
            <div key={s.level} role="listitem" className={`ret-metric ${s.level}`}>
              <p className="ret-metric-label"><LightShape level={s.level} />{t(`retention.metric.${s.level}`)}</p>
              <p className="ret-metric-value">{fmt.number(s.count)}</p>
              <p className="ret-metric-note">{t(`retention.metricNote.${s.level}`)}</p>
            </div>
          ))}
        </div>

        <dl className="ret-facts">
          <div><dt>{t("retention.fact.monitored")}</dt><dd>{fmt.number(o.monitored)}</dd></div>
          <div><dt>{t("retention.fact.flagged")}</dt><dd>{fmt.number(o.flagged)}</dd></div>
          <div><dt>{t("retention.fact.review")}</dt><dd className={o.ownerReview ? "ret-urgent" : undefined}>{fmt.number(o.ownerReview)}</dd></div>
          {o.dismissed > 0 && <div><dt>{t("retention.fact.dismissed")}</dt><dd>{fmt.number(o.dismissed)}</dd></div>}
        </dl>

        <div className="ret-dist">
          <p className="ret-dist-label">{t("retention.distribution")}</p>
          <div className="ret-dist-bar" role="img" aria-label={t("retention.distributionAria", { high: o.high, medium: o.medium, low: o.low })}>
            {segments.filter((s) => s.count > 0).map((s) => (
              <span key={s.level} className={`ret-seg ${s.level}`} style={{ flexGrow: s.count }} title={`${t(`retention.metric.${s.level}`)}: ${s.count}`}>
                <span>{Math.round((s.count / total) * 100)}%</span>
              </span>
            ))}
          </div>
        </div>

        <div className="ret-summary">
          <span className="ret-summary-icon" aria-hidden="true"><Icon name="sparkle" size={18} /></span>
          <div>
            <p className="ret-summary-title">{t("retention.summaryTitle")}</p>
            <p>{data.summary}</p>
            <p className="hint">{t("retention.summaryNote")}</p>
          </div>
        </div>

        {owner && data.alert && (
          <div className="ret-alert" role="group" aria-label={t("retention.alert.label")}>
            <Icon name="bell" size={18} />
            <p>
              {data.alert.state === "open" ? t("retention.alert.open") : data.alert.state === "snoozed" ? t("retention.alert.snoozed", { when: when(data.alert.until) }) : data.alert.state === "reviewed" ? t("retention.alert.reviewed") : t("retention.alert.dismissed")}
            </p>
            <div className="row">
              {data.alert.state === "open" ? (
                <>
                  <button type="button" className="btn small secondary" disabled={Boolean(busy)} onClick={() => run("alert", { action: "alert", key: data.alert!.key, state: "reviewed" })}>{t("retention.alert.markReviewed")}</button>
                  <button type="button" className="btn small secondary" disabled={Boolean(busy)} onClick={() => run("alert", { action: "alert", key: data.alert!.key, state: "snoozed" })}>{t("retention.alert.later")}</button>
                  <button type="button" className="btn small secondary" disabled={Boolean(busy)} onClick={() => run("alert", { action: "alert", key: data.alert!.key, state: "dismissed" })}>{t("retention.alert.dismiss")}</button>
                </>
              ) : (
                <button type="button" className="btn small secondary" disabled={Boolean(busy)} onClick={() => run("alert", { action: "alert", key: data.alert!.key, state: "open" })}>{t("retention.alert.showAgain")}</button>
              )}
            </div>
          </div>
        )}
        <ErrorNote text={error} onClose={() => setError(null)} />

        <div className="ret-cta">
          <button type="button" className="btn" aria-expanded={open} aria-controls="ret-agent" onClick={toggle}>
            {open ? t("retention.close") : t("retention.open")} <Icon name={open ? "chevron-down" : "arrow"} size={16} />
          </button>
          <button type="button" className="btn secondary" disabled={Boolean(busy)} aria-busy={busy === "analyse" || undefined} onClick={() => run("analyse", { action: "analyse" })}>
            <Icon name="refresh" size={16} /> {busy === "analyse" ? t("retention.analysing") : t("retention.analyse")}
          </button>
        </div>
      </div>

      {open && <RetentionAgent data={data} initialTab={initial.tab as AgentTab | undefined} initialStudent={initial.student} prepareFor={initial.prepare} />}
    </section>
  );
}
