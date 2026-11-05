"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { PaymentsData } from "@/lib/payments/server";
import type { LogLine, SavedMessage, ScanStep, StepId } from "@/lib/payments/types";
import { balanceOf, messageWarnings } from "@/lib/payments/logic";
import type { Role } from "@/lib/domain/types";
import { ErrorNote, FamilyBadge, MessageBadge, Money, useAction } from "./shared";

// The Autonomous Payment Recovery Agent, in five stages: one-click scan, family grouping,
// personalised drafts, one owner approval for the whole batch, then delivery and
// monitoring. Every stage reads and writes the server's records, so leaving the tab and
// coming back finds it where it was.

type Stage = "scan" | "families" | "messages" | "approval" | "monitor";
const STAGES: Stage[] = ["scan", "families", "messages", "approval", "monitor"];
const STEP_IDS: StepId[] = ["xero", "enrolment", "families", "gmail", "rules"];

function reachable(data: PaymentsData): Record<Stage, boolean> {
  const draft = data.batch?.status === "draft";
  const sent = data.batch?.status === "sent";
  return { scan: true, families: Boolean(data.run?.summary), messages: draft, approval: draft, monitor: sent };
}

function initialStage(data: PaymentsData): Stage {
  if (data.batch?.status === "sent") return "monitor";
  if (data.batch?.status === "draft") return "messages";
  if (data.run?.summary) return "families";
  return "scan";
}

export function RecoveryAgent({ data, role, onShowActivity }: { data: PaymentsData; role: Role; onShowActivity: () => void }) {
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>(() => initialStage(data));
  const can = reachable(data);
  const doneThrough = STAGES.indexOf(initialStage(data));

  return (
    <div className="pay-stack">
      <ol className="pay-stepper" aria-label={t("payments.recovery.stepsLabel")}>
        {STAGES.map((s, i) => {
          const state = s === stage ? "current" : i < doneThrough || (s === "monitor" && can.monitor) ? "done" : "upcoming";
          return (
            <li key={s} className={state}>
              <button type="button" disabled={!can[s]} aria-current={s === stage ? "step" : undefined} onClick={() => setStage(s)}>
                <span className="pay-step-dot" aria-hidden="true">{state === "done" && s !== stage ? <Icon name="check" size={14} /> : i + 1}</span>
                <span className="pay-step-text">
                  <strong>{t(`payments.recovery.stage.${s}`)}</strong>
                  <small>{t(`payments.recovery.stageNote.${s}`)}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {stage === "scan" && <ScanStage data={data} onNext={() => setStage("families")} />}
      {stage !== "scan" && !can[stage] && <Loading />}
      {stage === "families" && can.families && <FamiliesStage data={data} onNext={() => setStage("messages")} onRescan={() => setStage("scan")} />}
      {stage === "messages" && can.messages && <MessagesStage data={data} onNext={() => setStage("approval")} onBack={() => setStage("families")} />}
      {stage === "approval" && can.approval && <ApprovalStage data={data} role={role} onBack={() => setStage("messages")} onDone={() => setStage("monitor")} />}
      {stage === "monitor" && can.monitor && <MonitorStage data={data} onShowActivity={onShowActivity} onNewScan={() => setStage("scan")} />}
    </div>
  );
}

function Loading() {
  const { t } = useI18n();
  return <section className="card pay-panel pay-loading" role="status"><span className="pay-spinner" />{t("payments.recovery.loading")}</section>;
}

// 1. Scan --------------------------------------------------------------------------------------

function StepIcon({ state }: { state: ScanStep["state"] }) {
  if (state === "completed") return <Icon name="check" size={16} />;
  if (state === "failed") return <Icon name="close" size={16} />;
  if (state === "running") return <span className="pay-spinner" />;
  if (state === "skipped") return <span aria-hidden="true">–</span>;
  return <Icon name="clock" size={16} />;
}

function ScanStage({ data, onNext }: { data: PaymentsData; onNext: () => void }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const blank = STEP_IDS.map((id) => ({ id, state: "pending" as const, detail: "" }));
  const [steps, setSteps] = useState<ScanStep[]>(data.run?.steps?.length ? data.run.steps : blank);
  const [log, setLog] = useState<LogLine[]>(data.run?.log ?? []);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(data.run?.status ?? null);
  const summary = data.run?.summary ?? null;

  async function scan() {
    setRunning(true);
    setError(null);
    setStatus(null);
    setSteps(blank);
    setLog([]);
    try {
      const res = await fetch("/api/payments/scan", { method: "POST" });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? t("payments.scan.failed"));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: string; step?: ScanStep; line?: LogLine; status?: string; message?: string };
          if (ev.type === "step" && ev.step) setSteps((prev) => prev.map((s) => (s.id === ev.step!.id ? ev.step! : s)));
          else if (ev.type === "log" && ev.line) setLog((prev) => [...prev, ev.line!]);
          else if (ev.type === "done") setStatus(ev.status ?? "completed");
          else if (ev.type === "error") setError(ev.message ?? t("payments.scan.failed"));
        }
      }
      router.refresh();
    } catch {
      setError(t("payments.scan.failed"));
    } finally {
      setRunning(false);
    }
  }

  const finished = !running && status && status !== "running";
  return (
    <section className="card pay-panel" aria-labelledby="pay-scan-heading">
      <div className="pay-panel-head">
        <div>
          <p className="eyebrow">{t("payments.recovery.stepOf", { n: 1 })}</p>
          <h2 id="pay-scan-heading">{t("payments.scan.title")}</h2>
          <p className="subheading">{t("payments.scan.text")}</p>
        </div>
        <button type="button" className="btn pay-primary pay-big" onClick={scan} disabled={running} aria-describedby="pay-scan-heading">
          {running ? <span className="pay-spinner light" /> : <Icon name="sparkle" size={18} />}
          {running ? t("payments.scan.running") : t("payments.scan.button")}
        </button>
      </div>

      <ol className="pay-checks" aria-live="polite">
        {steps.map((s, i) => (
          <li key={s.id} className={s.state}>
            <span className="pay-check-icon"><StepIcon state={s.state} /></span>
            <div>
              <strong>{i + 1}. {t(`payments.scan.step.${s.id}`)}</strong>
              <span>{s.detail || t(`payments.scan.stepNote.${s.id}`)}</span>
            </div>
            <span className={`pay-pill ${s.state === "completed" ? "green" : s.state === "failed" ? "red" : s.state === "running" ? "lilac" : "grey"}`}>{t(`payments.scan.state.${s.state}`)}</span>
          </li>
        ))}
      </ol>

      <ErrorNote text={error} />
      {finished && status === "partial" && <p className="pay-alert amber" role="status">{t("payments.scan.partial")}</p>}
      {finished && status === "failed" && <p className="pay-alert red" role="status">{t("payments.scan.stopped")}</p>}

      {finished && summary && (
        <>
          <div className="pay-summary" role="status">
            <div><span>{t("payments.scan.summary.accounts")}</span><strong>{summary.accountsChecked}</strong></div>
            <div><span>{t("payments.scan.summary.overdue")}</span><strong className="pay-red">{summary.overdueInvoices}</strong></div>
            <div><span>{t("payments.scan.summary.eligible")}</span><strong className="pay-purple">{summary.eligibleInvoices}</strong><small>{t("payments.scan.summary.families", { count: summary.eligibleFamilies })}</small></div>
            <div><span>{t("payments.scan.summary.protected")}</span><strong className="pay-amber">{summary.protectedFamilies}</strong></div>
            <div><span>{t("payments.scan.summary.outstanding")}</span><strong>{fmt.money(summary.outstandingCents, { whole: true })}</strong><small>{t("payments.scan.summary.eligibleAmount", { amount: fmt.money(summary.eligibleCents, { whole: true }) })}</small></div>
          </div>
          <div className="pay-actions">
            <button type="button" className="btn pay-primary" onClick={onNext} disabled={summary.eligibleFamilies === 0}>
              {t("payments.scan.next")} <Icon name="arrow" size={16} />
            </button>
          </div>
        </>
      )}

      {log.length > 0 && (
        <details className="pay-log">
          <summary>{t("payments.scan.log", { count: log.length })}</summary>
          <ol>
            {log.map((l, i) => <li key={i}><span className="pay-pill grey">{t(`payments.scan.step.${l.step}`)}</span>{l.text}</li>)}
          </ol>
        </details>
      )}
    </section>
  );
}

// 2. Families --------------------------------------------------------------------------------------

function FamiliesStage({ data, onNext, onRescan }: { data: PaymentsData; onNext: () => void; onRescan: () => void }) {
  const { t, fmt } = useI18n();
  const run = data.run!;
  const eligible = run.assessments.filter((a) => a.state === "eligible").map((a) => a.contactId);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(data.batch?.status === "draft" && data.batch.runId === run.id ? data.batch.contactIds : eligible));
  const [channels, setChannels] = useState({ email: true, sms: true });
  const [students, setStudents] = useState(false);
  const { run: call, busy, error } = useAction();
  useEffect(() => { setSelected(new Set(eligible)); }, [run.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = eligible.length > 0 && eligible.every((id) => selected.has(id));
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = run.assessments.filter((a) => selected.has(a.contactId));
  const total = chosen.reduce((s, a) => s + a.totalCents, 0);

  async function prepare() {
    const r = await call<{ batchId: string }>("prepare", "/api/payments/batches", "POST", { runId: run.id, contactIds: [...selected], channels, includeStudents: students });
    if (r) onNext();
  }

  return (
    <section className="card pay-panel" aria-labelledby="pay-fam-heading">
      <div className="pay-panel-head">
        <div>
          <p className="eyebrow">{t("payments.recovery.stepOf", { n: 2 })}</p>
          <h2 id="pay-fam-heading">{t("payments.families.title")}</h2>
          <p className="subheading">{t("payments.families.text")}</p>
        </div>
        <button type="button" className="btn outline" onClick={onRescan}><Icon name="refresh" size={16} />{t("payments.families.rescan")}</button>
      </div>

      <div className="pay-scroll" tabIndex={0} role="region" aria-label={t("payments.families.title")}>
        <table className="pay-table pay-families">
          <thead>
            <tr>
              <th scope="col" className="pick">
                <label className="pay-check-label">
                  <input type="checkbox" checked={all} disabled={!eligible.length} onChange={() => setSelected(all ? new Set() : new Set(eligible))} />
                  <span className="sr-only">{t("payments.families.selectAll")}</span>
                </label>
              </th>
              <th scope="col">{t("payments.families.contact")}</th>
              <th scope="col">{t("payments.families.students")}</th>
              <th scope="col">{t("payments.families.invoices")}</th>
              <th scope="col" className="num">{t("payments.families.days")}</th>
              <th scope="col" className="num">{t("payments.families.total")}</th>
              <th scope="col" className="end">{t("payments.table.status")}</th>
            </tr>
          </thead>
          <tbody>
            {run.assessments.map((a) => {
              const ok = a.state === "eligible";
              return (
                <tr key={a.contactId} className={ok ? (selected.has(a.contactId) ? "picked" : undefined) : "muted-row"}>
                  <td className="pick">
                    <label className="pay-check-label">
                      <input type="checkbox" disabled={!ok} checked={ok && selected.has(a.contactId)} onChange={() => toggle(a.contactId)} />
                      <span className="sr-only">{t("payments.families.select", { name: a.contactName })}</span>
                    </label>
                  </td>
                  <th scope="row">{a.contactName}{a.students.length > 1 && <span className="pay-sub">{t("payments.families.grouped", { count: a.students.length })}</span>}</th>
                  <td>{fmt.list(a.students)}</td>
                  <td>
                    <ul className="pay-inv-list">
                      {a.invoices.map((i) => <li key={i.id}><strong>{i.id}</strong> {fmt.money(i.balanceCents, { whole: true })}</li>)}
                    </ul>
                  </td>
                  <td className="num">{a.maxDaysOverdue}</td>
                  <td className="num"><strong>{fmt.money(a.totalCents, { whole: true })}</strong></td>
                  <td className="end"><FamilyBadge state={a.state} />{!ok && <span className="pay-sub">{a.reason}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <fieldset className="pay-options">
        <legend>{t("payments.families.channels")}</legend>
        <label className="pay-toggle"><input type="checkbox" checked={channels.email} onChange={(e) => setChannels({ ...channels, email: e.target.checked })} />{t("payments.channel.email")}</label>
        <label className="pay-toggle"><input type="checkbox" checked={channels.sms} onChange={(e) => setChannels({ ...channels, sms: e.target.checked })} />{t("payments.channel.sms")}</label>
        <label className="pay-toggle"><input type="checkbox" checked={students} onChange={(e) => setStudents(e.target.checked)} />{t("payments.families.includeStudents")}</label>
        <p className="caption">{t("payments.families.studentRule")}</p>
      </fieldset>

      <ErrorNote text={error} />
      <div className="pay-actions">
        <p className="caption" aria-live="polite">{t("payments.families.chosen", { count: chosen.length, amount: fmt.money(total, { whole: true }) })}</p>
        <button type="button" className="btn pay-primary" onClick={prepare} disabled={!selected.size || (!channels.email && !channels.sms) || busy !== null}>
          {busy ? <span className="pay-spinner light" /> : <Icon name="sparkle" size={16} />}{t("payments.families.prepare")}
        </button>
      </div>
    </section>
  );
}

// 3. Messages ---------------------------------------------------------------------------------------

function MessageCard({ m, locked }: { m: SavedMessage; locked: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(m.body);
  const [subject, setSubject] = useState(m.subject ?? "");
  const { run, busy, error } = useAction();
  useEffect(() => { setBody(m.body); setSubject(m.subject ?? ""); }, [m.body, m.subject]);
  const warnings = messageWarnings({ ...m, body });

  async function save() {
    const r = await run("save", `/api/payments/messages/${m.id}`, "PATCH", m.channel === "email" ? { body, subject } : { body });
    if (r) setEditing(false);
  }
  return (
    <li className={`pay-msg${m.included ? "" : " left-out"}`}>
      <div className="pay-msg-head">
        <label className="pay-check-label">
          <input type="checkbox" checked={m.included} disabled={locked || busy !== null} onChange={(e) => run("include", `/api/payments/messages/${m.id}`, "PATCH", { included: e.target.checked })} />
          <span className="sr-only">{t("payments.messages.include", { name: m.recipientName })}</span>
        </label>
        <div className="pay-msg-who">
          <strong>{m.recipientName}</strong>
          <span>{t(`payments.recipient.${m.recipientKind}`)} · <bdi>{m.address}</bdi></span>
        </div>
        <span className={`pay-pill ${m.channel === "sms" ? "blue" : "lilac"}`}><Icon name={m.channel === "sms" ? "bell" : "book"} size={12} />{t(`payments.channel.${m.channel}`)}</span>
        {m.edited && <span className="pay-pill grey">{t("payments.messages.edited")}</span>}
        {!locked && !editing && <button type="button" className="btn outline small-btn" onClick={() => setEditing(true)}>{t("payments.messages.edit")}</button>}
      </div>
      {editing ? (
        <div className="pay-msg-edit">
          {m.channel === "email" && (
            <label>{t("payments.messages.subject")}<input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /></label>
          )}
          <label>{t("payments.messages.body")}<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={m.channel === "sms" ? 4 : 12} /></label>
          {m.channel === "sms" && <p className="caption">{t("payments.messages.chars", { count: body.length })}</p>}
          <ErrorNote text={error} />
          <div className="pay-actions start">
            <button type="button" className="btn pay-primary small-btn" onClick={save} disabled={busy !== null}>{t("payments.messages.save")}</button>
            <button type="button" className="btn outline small-btn" onClick={() => { setEditing(false); setBody(m.body); setSubject(m.subject ?? ""); }}>{t("payments.messages.cancel")}</button>
          </div>
        </div>
      ) : (
        <details className="pay-preview" open={m.recipientKind === "student" || undefined}>
          <summary>{t("payments.messages.preview")}</summary>
          {m.subject && <p className="pay-subject">{m.subject}</p>}
          <pre>{m.body}</pre>
        </details>
      )}
      {warnings.length > 0 && <ul className="pay-warnings">{warnings.map((w) => <li key={w}><Icon name="alert" size={14} />{w}</li>)}</ul>}
      {!editing && error && <ErrorNote text={error} />}
    </li>
  );
}

function MessagesStage({ data, onNext, onBack }: { data: PaymentsData; onNext: () => void; onBack: () => void }) {
  const { t } = useI18n();
  const batch = data.batch!;
  const included = batch.messages.filter((m) => m.included);
  const families = new Set(included.filter((m) => m.recipientKind === "parent").map((m) => m.contactId));
  const groups = useMemo(() => {
    const g = new Map<string, SavedMessage[]>();
    for (const m of batch.messages) g.set(m.contactId, [...(g.get(m.contactId) ?? []), m]);
    return [...g.entries()];
  }, [batch.messages]);
  const names = new Map(data.records.contacts.map((c) => [c.id, c.name]));
  const skipped = batch.excluded.filter((x) => x.reason !== "Left out by you" && batch.contactIds.includes(x.contactId));

  return (
    <section className="card pay-panel" aria-labelledby="pay-msg-heading">
      <div className="pay-panel-head">
        <div>
          <p className="eyebrow">{t("payments.recovery.stepOf", { n: 3 })}</p>
          <h2 id="pay-msg-heading">{t("payments.messages.title")}</h2>
          <p className="subheading">{t("payments.messages.text")}</p>
        </div>
        <p className="pay-count" aria-live="polite">
          <strong>{included.length}</strong> {t("payments.messages.count", { count: included.length, families: families.size })}
        </p>
      </div>

      {groups.length === 0 && <p className="caption pay-empty">{t("payments.messages.none")}</p>}
      {groups.map(([cid, msgs]) => (
        <div key={cid} className="pay-msg-group">
          <h3>{names.get(cid) ?? cid}</h3>
          <ul>{msgs.map((m) => <MessageCard key={m.id} m={m} locked={false} />)}</ul>
        </div>
      ))}

      {skipped.length > 0 && (
        <div className="pay-skipped">
          <h3>{t("payments.messages.skipped")}</h3>
          <ul>{skipped.map((s, i) => <li key={i}><strong>{s.name}</strong> · {t(`payments.channel.${s.channel}`)}: {s.reason}</li>)}</ul>
        </div>
      )}

      <div className="pay-actions">
        <button type="button" className="btn outline" onClick={onBack}><Icon name="chevron-left" size={16} />{t("payments.messages.back")}</button>
        <button type="button" className="btn pay-primary" onClick={onNext} disabled={!included.length}>{t("payments.messages.next")} <Icon name="arrow" size={16} /></button>
      </div>
    </section>
  );
}

// 4. Approval -------------------------------------------------------------------------------------------

function ApprovalStage({ data, role, onBack, onDone }: { data: PaymentsData; role: Role; onBack: () => void; onDone: () => void }) {
  const { t, fmt } = useI18n();
  const batch = data.batch!;
  const [checked, setChecked] = useState(false);
  const { run, busy, error } = useAction();
  const inc = batch.messages.filter((m) => m.included);
  const parents = inc.filter((m) => m.recipientKind === "parent");
  const families = [...new Set(parents.map((m) => m.contactId))];
  const invoiceIds = [...new Set(parents.flatMap((m) => m.invoiceIds))];
  const invoices = data.records.invoices.filter((i) => invoiceIds.includes(i.id));
  const total = invoices.reduce((s, i) => s + balanceOf(i), 0);
  const emails = inc.filter((m) => m.channel === "email").length;
  const sms = inc.filter((m) => m.channel === "sms").length;
  const studentMsgs = inc.filter((m) => m.recipientKind === "student").length;
  const excludedFamilies = [...new Map(batch.excluded.filter((x) => !families.includes(x.contactId)).map((x) => [x.contactId, x])).values()];
  const leftOut = batch.messages.filter((m) => !m.included);
  const warnings = inc.flatMap((m) => messageWarnings(m).map((w) => `${m.recipientName} (${t(`payments.channel.${m.channel}`)}): ${w}`));
  const demo = data.mode === "demo";

  async function approve() {
    const r = await run("approve", `/api/payments/batches/${batch.id}/approve`, "POST", { version: batch.version, simulated: demo });
    if (r) onDone();
  }

  return (
    <section className="card pay-panel" aria-labelledby="pay-approve-heading">
      <div className="pay-panel-head">
        <div>
          <p className="eyebrow">{t("payments.recovery.stepOf", { n: 4 })}</p>
          <h2 id="pay-approve-heading">{t("payments.approval.title")}</h2>
          <p className="subheading">{t("payments.approval.text")}</p>
        </div>
      </div>

      <div className="pay-summary">
        <div><span>{t("payments.approval.families")}</span><strong>{families.length}</strong></div>
        <div><span>{t("payments.approval.invoices")}</span><strong>{invoices.length}</strong></div>
        <div><span>{t("payments.approval.total")}</span><strong className="pay-red">{fmt.money(total, { whole: true })}</strong></div>
        <div><span>{t("payments.approval.emails")}</span><strong>{emails}</strong></div>
        <div><span>{t("payments.approval.sms")}</span><strong>{sms}</strong>{studentMsgs > 0 && <small>{t("payments.approval.students", { count: studentMsgs })}</small>}</div>
      </div>

      <div className="pay-two">
        <div className="pay-box">
          <h3>{t("payments.approval.excluded")}</h3>
          {excludedFamilies.length + leftOut.length === 0 ? <p className="caption">{t("payments.approval.noneExcluded")}</p> : (
            <ul className="pay-reasons">
              {excludedFamilies.map((x) => <li key={x.contactId}><strong>{x.name}</strong><span>{x.reason}</span></li>)}
              {leftOut.map((m) => <li key={m.id}><strong>{m.recipientName}</strong><span>{t("payments.approval.leftOutMsg", { channel: t(`payments.channel.${m.channel}`) })}</span></li>)}
            </ul>
          )}
        </div>
        <div className="pay-box">
          <h3>{t("payments.approval.checks")}</h3>
          <ul className="pay-checklist">
            <li><Icon name="check" size={14} />{t("payments.approval.check.permissions")}</li>
            <li><Icon name="check" size={14} />{t("payments.approval.check.duplicates")}</li>
            <li><Icon name="check" size={14} />{t("payments.approval.check.students")}</li>
            <li><Icon name="check" size={14} />{t("payments.approval.check.spam")}</li>
            <li><Icon name="check" size={14} />{t("payments.approval.check.recheck")}</li>
          </ul>
          {warnings.length > 0 && <ul className="pay-warnings">{warnings.map((w) => <li key={w}><Icon name="alert" size={14} />{w}</li>)}</ul>}
        </div>
      </div>

      {demo && <p className="pay-alert lilac" role="note"><Icon name="info" size={16} />{t("payments.approval.demoWarning")}</p>}

      {role === "owner" ? (
        <>
          <label className="pay-toggle pay-confirm">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {t("payments.approval.confirm", { count: inc.length })}
          </label>
          <ErrorNote text={error} />
          <div className="pay-actions">
            <button type="button" className="btn outline" onClick={onBack}><Icon name="chevron-left" size={16} />{t("payments.approval.back")}</button>
            <button type="button" className="btn pay-primary pay-big" onClick={approve} disabled={!checked || !inc.length || busy !== null}>
              {busy ? <span className="pay-spinner light" /> : <Icon name="check" size={18} />}
              {demo ? t("payments.approval.simulate") : t("payments.approval.send")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="pay-alert amber" role="note"><Icon name="approval" size={16} />{t("payments.approval.ownerOnly")}</p>
          <div className="pay-actions start">
            <button type="button" className="btn outline" onClick={onBack}><Icon name="chevron-left" size={16} />{t("payments.approval.back")}</button>
          </div>
        </>
      )}
    </section>
  );
}

// 5. Monitor -------------------------------------------------------------------------------------------

function MonitorStage({ data, onShowActivity, onNewScan }: { data: PaymentsData; onShowActivity: () => void; onNewScan: () => void }) {
  const { t, fmt } = useI18n();
  const batch = data.batch!;
  const { run, busy, error, done, setDone } = useAction();
  const reached = batch.messages.filter((m) => ["simulated", "sent", "delivered"].includes(m.status));
  const contacted = new Set(reached.map((m) => m.contactId));
  const payable = data.records.invoices.filter((i) => contacted.has(i.contactId) && balanceOf(i) > 0);
  const [invoice, setInvoice] = useState(payable[0]?.id ?? "");
  const current = payable.find((i) => i.id === invoice) ?? payable[0];
  const [amount, setAmount] = useState("");
  useEffect(() => { setAmount(current ? String(balanceOf(current) / 100) : ""); }, [current?.id, current?.paidCents]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = data.tasks.filter((x) => x.status === "open");
  const counts = { sent: 0, simulated: 0, failed: 0, held: 0 };
  for (const m of batch.messages) {
    if (m.status === "sent" || m.status === "delivered") counts.sent++;
    else if (m.status === "simulated") counts.simulated++;
    else if (m.status === "failed") counts.failed++;
    else counts.held++;
  }

  async function check() {
    const r = await run<{ replies: number; tasks: number; payments: number; escalations: number }>("monitor", "/api/payments/monitor", "POST");
    if (r) setDone(t("payments.monitor.checked", { replies: r.replies, payments: r.payments, escalations: r.escalations }));
  }
  async function simulate() {
    const cents = Math.round(Number(amount) * 100);
    const r = await run<{ counted: boolean; fullyPaid: boolean }>("pay", "/api/payments/simulate-payment", "POST", { invoiceId: current?.id, amountCents: cents });
    if (r) setDone(r.counted ? t("payments.monitor.paymentCounted", { amount: fmt.money(cents) }) : t("payments.monitor.paymentNotCounted"));
  }

  return (
    <section className="card pay-panel" aria-labelledby="pay-mon-heading">
      <div className="pay-panel-head">
        <div>
          <p className="eyebrow">{t("payments.recovery.stepOf", { n: 5 })}</p>
          <h2 id="pay-mon-heading">{t("payments.monitor.title")}</h2>
          <p className="subheading">{data.mode === "demo" ? t("payments.monitor.textDemo") : t("payments.monitor.text")}</p>
        </div>
        <div className="pay-head-buttons">
          <button type="button" className="btn pay-primary" onClick={check} disabled={busy !== null}>
            {busy === "monitor" ? <span className="pay-spinner light" /> : <Icon name="refresh" size={16} />}{t("payments.monitor.check")}
          </button>
          <button type="button" className="btn outline" onClick={onNewScan}>{t("payments.monitor.newScan")}</button>
        </div>
      </div>

      <div className="pay-summary">
        <div><span>{data.mode === "demo" ? t("payments.monitor.simulated") : t("payments.monitor.sent")}</span><strong className="pay-green">{data.mode === "demo" ? counts.simulated : counts.sent}</strong></div>
        <div><span>{t("payments.monitor.failed")}</span><strong className="pay-red">{counts.failed}</strong></div>
        <div><span>{t("payments.monitor.held")}</span><strong className="pay-amber">{counts.held}</strong></div>
        <div><span>{t("payments.kpi.recovered")}</span><strong className="pay-green"><Money cents={data.kpis.recoveredCents} /></strong></div>
      </div>

      <ErrorNote text={error} />
      {done && <p className="pay-alert green" role="status"><Icon name="check" size={16} />{done}</p>}

      <div className="pay-scroll" tabIndex={0} role="region" aria-label={t("payments.monitor.delivery")}>
        <table className="pay-table">
          <caption className="sr-only">{t("payments.monitor.delivery")}</caption>
          <thead><tr><th scope="col">{t("payments.monitor.recipient")}</th><th scope="col">{t("payments.monitor.channel")}</th><th scope="col">{t("payments.monitor.invoices")}</th><th scope="col">{t("payments.monitor.result")}</th></tr></thead>
          <tbody>
            {batch.messages.map((m) => (
              <tr key={m.id}>
                <th scope="row">{m.recipientName}<span className="pay-sub"><bdi>{m.address}</bdi></span></th>
                <td>{t(`payments.channel.${m.channel}`)}</td>
                <td>{m.invoiceIds.join(", ")}</td>
                <td><MessageBadge status={m.status} />{m.statusReason && <span className="pay-sub">{m.statusReason}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pay-two">
        <div className="pay-box">
          <h3>{t("payments.monitor.tasks")}</h3>
          {open.length === 0 ? <p className="caption">{t("payments.monitor.noTasks")}</p> : (
            <ul className="pay-reasons">
              {open.map((x) => (
                <li key={x.id}>
                  <strong>{x.contactName} {x.needsOwner && <span className="pay-pill amber">{t("payments.attention.ownerDecision")}</span>}</strong>
                  <span>{x.summary}</span>
                  <button type="button" className="btn outline small-btn" onClick={() => run("task", `/api/payments/tasks/${x.id}`, "POST")} disabled={busy !== null}>{t("payments.monitor.done")}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {data.mode === "demo" ? (
          <div className="pay-box pay-sim">
            <h3>{t("payments.monitor.simTitle")}</h3>
            <p className="caption">{t("payments.monitor.simText")}</p>
            {payable.length === 0 ? <p className="caption">{t("payments.monitor.allPaid")}</p> : (
              <div className="pay-sim-form">
                <label>{t("payments.table.invoice")}
                  <select value={current?.id ?? ""} onChange={(e) => setInvoice(e.target.value)}>
                    {payable.map((i) => <option key={i.id} value={i.id}>{i.id} · {data.records.contacts.find((c) => c.id === i.contactId)?.name} · {fmt.money(balanceOf(i))}</option>)}
                  </select>
                </label>
                <label>{t("payments.monitor.amount")}
                  <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <button type="button" className="btn pay-success" onClick={simulate} disabled={busy !== null || !(Number(amount) > 0)}>{t("payments.monitor.simulate")}</button>
              </div>
            )}
          </div>
        ) : (
          <div className="pay-box"><h3>{t("payments.monitor.xeroTitle")}</h3><p className="caption">{t("payments.monitor.xeroText")}</p></div>
        )}
      </div>

      <div className="pay-actions">
        <button type="button" className="btn outline" onClick={onShowActivity}>{t("payments.monitor.activity")} <Icon name="arrow" size={16} /></button>
      </div>
    </section>
  );
}
