"use client";
import { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { RetentionData } from "@/lib/retention/server";
import type { RetentionMessage } from "@/lib/retention/types";
import { nextAction, stageOf } from "@/lib/retention/logic";
import { ErrorNote, StageBadge, useDay, useRetentionAction, useWhen } from "./shared";

// Tab 3: every check-in and what happened after it. Delivery is only shown as delivered
// when the provider confirmed it. The outcome figures describe what happened after each
// check-in; they don't claim the check-in caused it.

export function TrackingTab({ data, onOpenStudent }: { data: RetentionData; onOpenStudent: (id: string) => void }) {
  const { t, fmt } = useI18n();
  const [days, setDays] = useState<14 | 30>(14);
  const o = days === 14 ? data.outcomes.d14 : data.outcomes.d30;
  const history = [...data.messages].sort((a, b) => (b.sentAt ?? b.updatedAt).localeCompare(a.sentAt ?? a.updatedAt));
  const day = useDay();
  const pct = (n: number | null) => (n === null ? "–" : `${fmt.number(n)}%`);

  return (
    <div className="ret-tracking">
      <section aria-labelledby="ret-out-h">
        <div className="card-head ret-out-head">
          <div>
            <h3 id="ret-out-h">{t("retention.track.outcomes")}</h3>
            <p className="hint">{t("retention.track.outcomesHint", { days })}</p>
          </div>
          <div className="ret-filters" role="group" aria-label={t("retention.track.viewLabel")}>
            {([14, 30] as const).map((d) => (
              <button key={d} type="button" className={`ret-chip${days === d ? " active" : ""}`} aria-pressed={days === d} onClick={() => setDays(d)}>{t("retention.track.dayView", { days: d })}</button>
            ))}
          </div>
        </div>
        {o.checkIns === 0 ? (
          <p className="muted">{t("retention.track.noneSent")}</p>
        ) : (
          <>
            <dl className="ret-out-tiles">
              <div><dt>{t("retention.track.checkIns")}</dt><dd>{fmt.number(o.checkIns)}</dd></div>
              <div><dt>{t("retention.track.responseRate")}</dt><dd>{pct(o.responseRate)}</dd><p className="hint">{t("retention.track.responded", { n: o.responded, total: o.checkIns })}</p></div>
              <div><dt>{t("retention.track.continued")}</dt><dd>{fmt.number(o.continued)}</dd></div>
              <div><dt>{t("retention.track.discontinued")}</dt><dd>{fmt.number(o.discontinued)}</dd></div>
              <div><dt>{t("retention.track.resolved")}</dt><dd>{fmt.number(o.resolved)}</dd></div>
              <div><dt>{t("retention.track.cancelledAfter")}</dt><dd>{fmt.number(o.cancellationsAfter)}</dd></div>
              <div><dt>{t("retention.track.attendanceChange")}</dt><dd>{o.averageChange === null ? "–" : `${o.averageChange > 0 ? "+" : ""}${fmt.number(o.averageChange)}`}</dd><p className="hint">{o.averageChange === null ? t("retention.track.notEnough") : t("retention.track.pointsAcross", { count: o.compared })}</p></div>
            </dl>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">{t("retention.track.outcomeCaption", { days })}</caption>
                <thead><tr><th scope="col">{t("retention.track.student")}</th><th scope="col">{t("retention.track.sentOn")}</th><th scope="col">{t("retention.track.before", { days })}</th><th scope="col">{t("retention.track.after", { days })}</th><th scope="col" className="num">{t("retention.track.cancelled")}</th><th scope="col">{t("retention.track.enrolment")}</th></tr></thead>
                <tbody>
                  {o.rows.map((r) => (
                    <tr key={r.messageId}>
                      <th scope="row"><button type="button" className="ret-link" onClick={() => onOpenStudent(r.studentId)}>{r.name}</button></th>
                      <td>{day(r.sentOn)}</td>
                      <td>{pct(r.before)} <span className="hint">({t("retention.track.lessons", { count: r.beforeLessons })})</span></td>
                      <td>{pct(r.after)} <span className="hint">({t("retention.track.lessons", { count: r.afterLessons })}{r.complete ? "" : `, ${t("retention.track.soFar", { n: r.daysSoFar, days })}`})</span></td>
                      <td className="num">{fmt.number(r.cancellationsAfter)}</td>
                      <td>{r.enrolled ? t("retention.track.stillEnrolled") : t("retention.track.left")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="hint ret-caveat">{t("retention.track.caveat")}</p>
      </section>

      <section aria-labelledby="ret-hist-h">
        <h3 id="ret-hist-h">{t("retention.track.history")}</h3>
        {history.length === 0 ? <p className="muted">{t("retention.track.noHistory")}</p> : (
          <div className="table-wrap ret-history">
            <table>
              <caption className="sr-only">{t("retention.track.history")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("retention.track.student")}</th>
                  <th scope="col">{t("retention.track.parent")}</th>
                  <th scope="col">{t("retention.track.type")}</th>
                  <th scope="col">{t("retention.track.status")}</th>
                  <th scope="col">{t("retention.track.approval")}</th>
                  <th scope="col">{t("retention.track.approvedOn")}</th>
                  <th scope="col">{t("retention.track.sentAt")}</th>
                  <th scope="col">{t("retention.track.delivery")}</th>
                  <th scope="col">{t("retention.track.response")}</th>
                  <th scope="col">{t("retention.track.next")}</th>
                  <th scope="col"><span className="sr-only">{t("retention.track.actions")}</span></th>
                </tr>
              </thead>
              <tbody>{history.map((m) => <HistoryRow key={m.id} m={m} data={data} />)}</tbody>
            </table>
          </div>
        )}
      </section>

      <details className="ret-log">
        <summary>{t("retention.track.log", { count: data.events.length })}</summary>
        <ul>
          {data.events.map((e) => <li key={e.id}><span className="hint">{fmt.dateTime(e.createdAt)}</span> {e.detail}{e.mode === "demo" ? <span className="badge lilac ret-demo-tag">{t("retention.mode.demoShort")}</span> : null}</li>)}
        </ul>
      </details>
    </div>
  );
}

function HistoryRow({ m, data }: { m: RetentionMessage; data: RetentionData }) {
  const { t } = useI18n();
  const when = useWhen();
  const stage = stageOf(m, data.today);
  const [replying, setReplying] = useState(false);
  const [note, setNote] = useState("");
  const { run, busy, error, setError } = useRetentionAction();
  const owner = data.role === "owner";
  const approval = m.approvedAt ? t("retention.track.approvedByOwner") : m.status === "rejected" ? t("retention.track.rejected") : m.status === "awaiting_approval" ? t("retention.track.awaiting") : t("retention.track.notApproved");
  const delivery = m.deliveryStatus === "simulated" ? t("retention.track.simulated") : m.deliveryStatus === "accepted" ? t("retention.track.accepted") : m.deliveryStatus === "delivered" ? t("retention.track.delivered") : m.deliveryStatus === "failed" ? t("retention.track.failed") : "–";
  return (
    <tr>
      <th scope="row">{data.names[m.studentId] ?? m.studentId}</th>
      <td>{m.recipientName}</td>
      <td>{m.channel === "sms" ? "SMS" : t("retention.common.email")}{m.mode === "demo" && <span className="badge lilac ret-demo-tag">{t("retention.mode.demoShort")}</span>}</td>
      <td><StageBadge stage={stage} /></td>
      <td>{approval}</td>
      <td>{when(m.approvedAt)}</td>
      <td>{when(m.sentAt)}</td>
      <td title={m.deliveryDetail ?? undefined}>{delivery}</td>
      <td>{m.responseStatus === "received" ? <>{t("retention.track.received")}{m.responseNote && <span className="ret-contact">{m.responseNote}</span>}</> : m.status === "sent" ? t("retention.track.noReply") : "–"}</td>
      <td>{nextAction(stage, m.followUpOn)}</td>
      <td className="ret-row-actions">
        {m.status === "sent" && m.followUp !== "resolved" && (
          <div className="ret-mini">
            {m.responseStatus !== "received" && !replying && <button type="button" className="ret-link" onClick={() => setReplying(true)}>{t("retention.track.recordReply")}</button>}
            {stage !== "follow_up_required" && <button type="button" className="ret-link" disabled={Boolean(busy)} onClick={() => run("fu", { action: "track", id: m.id, followUp: "required" })}>{t("retention.track.needFollowUp")}</button>}
            <button type="button" className="ret-link" disabled={Boolean(busy)} onClick={() => run("res", { action: "track", id: m.id, followUp: "resolved" })}>{t("retention.track.markResolved")}</button>
            {owner && m.mode === "live" && m.channel === "sms" && m.deliveryStatus === "accepted" && (
              <button type="button" className="ret-link" disabled={Boolean(busy)} onClick={() => run("del", { action: "delivery", id: m.id })}>{t("retention.track.checkDelivery")}</button>
            )}
          </div>
        )}
        {replying && (
          <form className="ret-reply" onSubmit={async (e) => {
            e.preventDefault();
            const r = await run("reply", { action: "track", id: m.id, response: note });
            if (r.ok) { setReplying(false); setNote(""); }
          }}>
            <label className="sr-only" htmlFor={`ret-reply-${m.id}`}>{t("retention.track.replyLabel")}</label>
            <textarea id={`ret-reply-${m.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("retention.track.replyPlaceholder")} />
            <div className="row">
              <button type="submit" className="btn small" disabled={note.trim().length < 3 || Boolean(busy)}>{t("retention.track.saveReply")}</button>
              <button type="button" className="btn small secondary" onClick={() => setReplying(false)}>{t("retention.common.cancel")}</button>
            </div>
          </form>
        )}
        <ErrorNote text={error} onClose={() => setError(null)} />
      </td>
    </tr>
  );
}
