"use client";
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { PaymentsData } from "@/lib/payments/server";
import { assessFamilies, balanceOf, daysOverdue, invoiceState } from "@/lib/payments/logic";
import type { Role } from "@/lib/domain/types";
import { InvoiceBadge, Money } from "./shared";
import { RecoveryAgent } from "./RecoveryAgent";
import { AgentActivity } from "./AgentActivity";

// The Payments module: three headline figures, then four tabs that share one set of
// records. The chosen tab is kept in the address (?tab=) without reloading, and each tab
// keeps its own state while the others are open, because all four stay mounted.

export const TABS = ["overview", "invoices", "recovery", "activity"] as const;
export type Tab = (typeof TABS)[number];

export function PaymentsModule({ data, role, initialTab }: { data: PaymentsData; role: Role; initialTab?: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "overview");
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ overview: null, invoices: null, recovery: null, activity: null });

  function choose(next: Tab, focus = false) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
    if (focus) refs.current[next]?.focus();
  }
  function onKey(e: React.KeyboardEvent) {
    const i = TABS.indexOf(tab);
    const rtl = document.documentElement.dir === "rtl";
    const fwd = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === fwd) choose(TABS[(i + 1) % TABS.length], true);
    else if (e.key === back) choose(TABS[(i + TABS.length - 1) % TABS.length], true);
    else if (e.key === "Home") choose(TABS[0], true);
    else if (e.key === "End") choose(TABS[TABS.length - 1], true);
    else return;
    e.preventDefault();
  }

  return (
    <div className="pay-module" data-compass-avoid="">
      {data.mode === "demo" && (
        <div className="notice studio-notice pay-demo-note" role="note">
          <Icon name="info" />
          <span>{t("payments.demoNote")}</span>
        </div>
      )}

      <section className="pay-kpis" aria-label={t("payments.kpi.label")}>
        <div className="card pay-kpi">
          <p className="pay-kpi-label"><Icon name="people" size={16} />{t("payments.kpi.students")}</p>
          <p className="pay-kpi-value">{data.kpis.students}</p>
          <p className="pay-kpi-note">{t("payments.kpi.studentsNote")}</p>
        </div>
        <div className="card pay-kpi">
          <p className="pay-kpi-label"><Icon name="wallet" size={16} />{t("payments.kpi.eligible")}</p>
          <p className="pay-kpi-value">{data.kpis.eligibleFamilies}</p>
          <p className="pay-kpi-note">{t("payments.kpi.eligibleNote")}</p>
        </div>
        <div className="card pay-kpi recovered">
          <p className="pay-kpi-label"><Icon name="check" size={16} />{t("payments.kpi.recovered")}</p>
          <p className="pay-kpi-value pay-green" data-testid="payments-recovered"><Money cents={data.kpis.recoveredCents} /></p>
          <p className="pay-kpi-note">{data.mode === "demo" ? t("payments.kpi.recoveredNoteDemo") : t("payments.kpi.recoveredNote")}</p>
        </div>
      </section>

      <div className="pay-tabs" role="tablist" aria-label={t("payments.tabs.label")} onKeyDown={onKey}>
        {TABS.map((id) => (
          <button
            key={id}
            ref={(el) => { refs.current[id] = el; }}
            type="button"
            role="tab"
            id={`pay-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`pay-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "active" : undefined}
            onClick={() => choose(id)}
          >
            {t(`payments.tabs.${id}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="pay-panel-overview" aria-labelledby="pay-tab-overview" hidden={tab !== "overview"}>
        <Overview data={data} onOpen={choose} />
      </div>
      <div role="tabpanel" id="pay-panel-invoices" aria-labelledby="pay-tab-invoices" hidden={tab !== "invoices"}>
        <Invoices data={data} />
      </div>
      <div role="tabpanel" id="pay-panel-recovery" aria-labelledby="pay-tab-recovery" hidden={tab !== "recovery"}>
        <RecoveryAgent data={data} role={role} onShowActivity={() => choose("activity")} />
      </div>
      <div role="tabpanel" id="pay-panel-activity" aria-labelledby="pay-tab-activity" hidden={tab !== "activity"}>
        <AgentActivity data={data} />
      </div>
    </div>
  );
}

function Overview({ data, onOpen }: { data: PaymentsData; onOpen: (t: Tab) => void }) {
  const { t, fmt } = useI18n();
  const assessments = useMemo(() => assessFamilies({ ...data.records, today: data.today, gmailChecked: true }), [data]);
  const eligible = assessments.filter((a) => a.state === "eligible");
  const eligibleCents = eligible.reduce((s, a) => s + a.totalCents, 0);
  const eligibleInvoices = eligible.reduce((s, a) => s + a.invoices.length, 0);
  const openTasks = data.tasks.filter((x) => x.status === "open");
  const attention = assessments.filter((a) => a.state === "eligible" || a.state === "protected");
  const prot = new Set(data.protectedIds);
  const names = new Map(data.records.contacts.map((c) => [c.id, c.name]));
  const students = new Map(data.records.students.map((s) => [s.id, s.name]));
  const recent = [...data.records.invoices]
    .filter((i) => i.status !== "voided")
    .sort((a, b) => (balanceOf(b) > 0 ? 1 : 0) - (balanceOf(a) > 0 ? 1 : 0) || a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);
  const pending = attention.length + openTasks.length;
  const last = data.run;

  return (
    <div className="pay-stack">
      <section className="pay-figures" aria-label={t("payments.overview.summary")}>
        <div className="card pay-figure">
          <p>{t("payments.overview.outstanding")}</p>
          <strong><Money cents={data.totals.outstandingCents} /></strong>
          <span>{t("payments.overview.outstandingNote")}</span>
        </div>
        <div className="card pay-figure">
          <p>{t("payments.overview.overdue")}</p>
          <strong className="pay-red">{data.totals.overdueInvoices}</strong>
          <span>{t("payments.overview.overdueNote", { amount: fmt.money(data.totals.overdueCents, { whole: true }) })}</span>
        </div>
        <div className="card pay-figure">
          <p>{t("payments.overview.eligible")}</p>
          <strong className="pay-purple"><Money cents={eligibleCents} /></strong>
          <span>{t("payments.overview.eligibleNote", { count: eligible.length, invoices: eligibleInvoices })}</span>
        </div>
        <div className="card pay-figure">
          <p>{t("payments.overview.protected")}</p>
          <strong className="pay-amber"><Money cents={data.totals.protectedCents} /></strong>
          <span>{t("payments.overview.protectedNote", { count: prot.size })}</span>
        </div>
      </section>

      <div className="pay-overview-grid">
        <section className="card pay-agent-card" aria-labelledby="pay-agent-heading">
          <div className="pay-agent-text">
            <p className="eyebrow">{t("payments.agent.eyebrow")}</p>
            <h2 id="pay-agent-heading">{t("payments.agent.title")}</h2>
            <p className="subheading">{t("payments.agent.text")}</p>
          </div>
          <span className="pay-spark" aria-hidden="true"><Icon name="sparkle" size={26} /></span>
          <ul className="pay-chips" aria-label={t("payments.agent.connections")}>
            {(["xero", "gmail", "sms"] as const).map((p) => (
              <li key={p} className={data.providers[p] && data.mode === "live" ? "on" : undefined}>
                <i aria-hidden="true" />{t(`payments.provider.${p}`)}
                <span className="sr-only">{data.providers[p] && data.mode === "live" ? t("payments.provider.connected") : t("payments.provider.demoData")}</span>
              </li>
            ))}
            <li><Icon name="approval" size={13} />{t("payments.agent.ownerControlled")}</li>
          </ul>
          <p className="pay-agent-last">
            {last ? t(`payments.agent.last.${last.status}`, { families: last.summary?.eligibleFamilies ?? 0 }) : t("payments.agent.never")}
          </p>
          <button type="button" className="btn pay-primary" onClick={() => onOpen("recovery")}>
            {t("payments.agent.open")} <Icon name="arrow" size={16} />
          </button>
        </section>

        <section className="card pay-attention" aria-labelledby="pay-attention-heading">
          <div className="card-head">
            <h2 id="pay-attention-heading">{t("payments.attention.title")}</h2>
            {pending > 0 && <span className="pay-pill red">{t("payments.attention.pending", { count: pending })}</span>}
          </div>
          {pending === 0 ? (
            <p className="caption">{t("payments.attention.none")}</p>
          ) : (
            <ul className="pay-attention-list">
              {openTasks.map((x) => (
                <li key={x.id}>
                  <div><strong>{x.contactName}</strong><span>{x.summary}</span></div>
                  <div className="pay-attention-side"><span className={`pay-pill ${x.needsOwner ? "amber" : "lilac"}`}>{t(x.needsOwner ? "payments.attention.ownerDecision" : "payments.attention.followUp")}</span></div>
                </li>
              ))}
              {attention.map((a) => (
                <li key={a.contactId}>
                  <div><strong>{a.contactName}</strong><span>{fmt.list(a.students)}</span></div>
                  <div className="pay-attention-side"><strong><Money cents={a.totalCents} /></strong><span>{a.state === "eligible" ? t("payments.invoiceState.overdue") : a.reason}</span></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="pay-section-head">
        <h2>{t("payments.overview.recent")}</h2>
        <button type="button" className="btn outline small-btn" onClick={() => onOpen("invoices")}>{t("payments.overview.viewAll")} <Icon name="arrow" size={14} /></button>
      </div>
      <div className="card pay-table-card">
        <div className="pay-scroll" tabIndex={0} role="region" aria-label={t("payments.overview.recent")}>
        <table className="pay-table">
          <thead>
            <tr><th scope="col">{t("payments.table.invoice")}</th><th scope="col">{t("payments.table.student")}</th><th scope="col">{t("payments.table.contact")}</th><th scope="col">{t("payments.table.balance")}</th><th scope="col" className="end">{t("payments.table.status")}</th></tr>
          </thead>
          <tbody>
            {recent.map((i) => (
              <tr key={i.id}>
                <th scope="row">{i.id}</th>
                <td>{(i.studentId && students.get(i.studentId)) || "–"}</td>
                <td>{names.get(i.contactId) ?? i.contactId}</td>
                <td><Money cents={balanceOf(i)} /></td>
                <td className="end"><InvoiceBadge state={invoiceState(i, data.today, prot)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function Invoices({ data }: { data: PaymentsData }) {
  const { t, fmt } = useI18n();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const prot = useMemo(() => new Set(data.protectedIds), [data.protectedIds]);
  const names = new Map(data.records.contacts.map((c) => [c.id, c.name]));
  const students = new Map(data.records.students.map((s) => [s.id, s.name]));
  const rows = data.records.invoices
    .map((i) => ({ i, state: invoiceState(i, data.today, prot), student: (i.studentId && students.get(i.studentId)) || "", contact: names.get(i.contactId) ?? i.contactId }))
    .filter((r) => status === "all" || r.state === status)
    .filter((r) => {
      const n = q.trim().toLowerCase();
      return !n || [r.i.id, r.student, r.contact, r.i.description].some((s) => s.toLowerCase().includes(n));
    })
    .sort((a, b) => daysOverdue(b.i, data.today) - daysOverdue(a.i, data.today) || a.i.id.localeCompare(b.i.id));

  return (
    <div className="pay-stack">
      <div className="card pay-filters">
        <label className="pay-search">
          <span className="sr-only">{t("payments.invoices.search")}</span>
          <Icon name="search" size={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("payments.invoices.searchPlaceholder")} />
        </label>
        <label className="pay-select">
          <span>{t("payments.invoices.status")}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">{t("payments.invoices.all")}</option>
            {(["overdue", "protected", "current", "paid"] as const).map((s) => <option key={s} value={s}>{t(`payments.invoiceState.${s}`)}</option>)}
          </select>
        </label>
        <p className="caption" aria-live="polite">{t("payments.invoices.count", { count: rows.length })}</p>
      </div>
      <div className="card pay-table-card">
        {rows.length === 0 ? (
          <p className="caption pay-empty">{t("payments.invoices.empty")}</p>
        ) : (
          <div className="pay-scroll" tabIndex={0} role="region" aria-label={t("payments.tabs.invoices")}>
            <table className="pay-table">
              <thead>
                <tr>
                  <th scope="col">{t("payments.table.invoice")}</th><th scope="col">{t("payments.table.student")}</th><th scope="col">{t("payments.table.contact")}</th>
                  <th scope="col" className="num">{t("payments.table.amount")}</th><th scope="col" className="num">{t("payments.table.paid")}</th><th scope="col" className="num">{t("payments.table.balance")}</th>
                  <th scope="col">{t("payments.table.due")}</th><th scope="col" className="num">{t("payments.table.daysOverdue")}</th><th scope="col" className="end">{t("payments.table.status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ i, state, student, contact }) => (
                  <tr key={i.id}>
                    <th scope="row">{i.id}<span className="pay-sub">{i.description}</span></th>
                    <td>{student || "–"}</td>
                    <td>{contact}</td>
                    <td className="num"><Money cents={i.amountCents} /></td>
                    <td className="num"><Money cents={i.paidCents} /></td>
                    <td className="num"><strong><Money cents={balanceOf(i)} /></strong></td>
                    <td>{fmt.date(`${i.dueDate}T02:00:00Z`, { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td className="num">{balanceOf(i) > 0 ? daysOverdue(i, data.today) : "–"}</td>
                    <td className="end"><InvoiceBadge state={state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
