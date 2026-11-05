"use client";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Icon } from "@/components/Icons";
import type { PaymentsData } from "@/lib/payments/server";
import { MessageBadge, Money } from "./shared";

// What Compass has done and what it was worth. Measured figures come straight from the
// records; the time and money saved are estimates from the owner's own settings, and the
// page keeps the two apart.

export function AgentActivity({ data }: { data: PaymentsData }) {
  const { t, fmt } = useI18n();
  const m = data.impact.measured;
  const e = data.impact.estimated;
  const demo = data.mode === "demo";
  const rules = data.records.rules;
  const hours = e.minutesSaved / 60;

  return (
    <div className="pay-stack">
      <section className="card pay-panel" aria-labelledby="pay-impact-heading">
        <div className="pay-panel-head">
          <div>
            <p className="eyebrow">{t("payments.activity.eyebrow")}</p>
            <h2 id="pay-impact-heading">{t("payments.activity.title")}</h2>
            <p className="subheading">{t("payments.activity.text")}</p>
          </div>
        </div>

        <h3 className="pay-group-title"><span className="pay-pill green">{t("payments.activity.measured")}</span>{t("payments.activity.measuredNote")}</h3>
        <div className="pay-impact">
          <div><span>{t("payments.activity.invoicesReviewed")}</span><strong>{m.invoicesReviewed}</strong></div>
          <div><span>{t("payments.activity.familiesContacted")}</span><strong>{m.familiesContacted}</strong></div>
          <div><span>{demo ? t("payments.activity.simulated") : t("payments.activity.delivered")}</span><strong>{demo ? m.simulated : m.delivered}</strong>{demo && <small>{t("payments.activity.simulatedNote")}</small>}</div>
          <div className="recovered"><span>{t("payments.kpi.recovered")}</span><strong className="pay-green"><Money cents={m.recoveredCents} /></strong><small>{t("payments.activity.recoveredNote")}</small></div>
          <div><span>{t("payments.activity.stillOutstanding")}</span><strong><Money cents={m.stillOutstandingCents} /></strong><small>{t("payments.activity.stillOutstandingNote")}</small></div>
          <div><span>{t("payments.activity.approvals")}</span><strong className={m.ownerApprovalsWaiting ? "pay-amber" : undefined}>{m.ownerApprovalsWaiting}</strong></div>
          <div><span>{t("payments.activity.failures")}</span><strong className={m.failed + m.exceptions ? "pay-red" : undefined}>{m.failed}</strong><small>{t("payments.activity.exceptions", { count: m.exceptions })}</small></div>
        </div>

        <h3 className="pay-group-title"><span className="pay-pill amber">{t("payments.activity.estimated")}</span>{t("payments.activity.estimatedNote")}</h3>
        <div className="pay-impact estimate">
          <div><span>{t("payments.activity.timeSaved")}</span><strong>{t("payments.activity.hours", { n: fmt.number(hours, { maximumFractionDigits: 1 }) })}</strong></div>
          <div><span>{t("payments.activity.valueSaved")}</span><strong>{fmt.money(e.valueCents)}</strong></div>
          <p className="caption pay-formula">{t("payments.activity.formula", { invoice: rules.manualMinutesPerInvoice, family: rules.manualMinutesPerFamily, rate: fmt.money(rules.adminHourlyRateCents) })}</p>
        </div>
      </section>

      <div className="pay-two wide">
        <section className="card pay-panel" aria-labelledby="pay-timeline-heading">
          <h2 id="pay-timeline-heading">{t("payments.activity.timeline")}</h2>
          {data.events.length === 0 ? <p className="caption pay-empty">{t("payments.activity.noEvents")}</p> : (
            <ol className="pay-timeline">
              {data.events.map((ev) => (
                <li key={ev.id} className={ev.kind}>
                  <span className="pay-dot" aria-hidden="true" />
                  <div>
                    <p>{ev.detail}</p>
                    <small>{fmt.friendly(ev.createdAt)} · {ev.mode === "demo" ? t("payments.activity.modeDemo") : ev.mode === "live" ? t("payments.activity.modeLive") : t("payments.activity.modeSystem")}</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="pay-stack">
          <section className="card pay-panel" aria-labelledby="pay-recovered-heading">
            <h2 id="pay-recovered-heading">{t("payments.activity.payments")}</h2>
            {data.payments.length === 0 ? <p className="caption pay-empty">{t("payments.activity.noPayments")}</p> : (
              <ul className="pay-reasons">
                {data.payments.map((p) => (
                  <li key={p.paymentRef}>
                    <strong>{p.invoiceId} · <span className={p.attributed ? "pay-green" : undefined}>{fmt.money(p.amountCents)}</span></strong>
                    <span>{p.attributed ? t("payments.activity.attributed") : t("payments.activity.notAttributed")} · {p.source === "demo_simulated" ? t("payments.activity.sourceDemo") : t("payments.activity.sourceXero")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card pay-panel" aria-labelledby="pay-history-heading">
            <h2 id="pay-history-heading">{t("payments.activity.messages")}</h2>
            {data.sentMessages.length === 0 ? <p className="caption pay-empty">{t("payments.activity.noMessages")}</p> : (
              <ul className="pay-reasons">
                {data.sentMessages.slice(0, 30).map((msg) => (
                  <li key={msg.id}>
                    <strong>{msg.recipientName} <MessageBadge status={msg.status} /></strong>
                    <span><Icon name={msg.channel === "sms" ? "bell" : "book"} size={12} /> {t(`payments.channel.${msg.channel}`)} · {msg.sentAt ? fmt.friendly(msg.sentAt) : msg.statusReason ?? ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
