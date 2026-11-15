"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { RetentionData } from "@/lib/retention/server";
import type { Channel, RetentionMessage } from "@/lib/retention/types";
import { internalWording, SMS_LIMIT, soundsBlaming, stageOf } from "@/lib/retention/logic";
import { ConfirmDialog, ErrorNote, StageBadge, useRetentionAction, useWhen } from "./shared";

// Tab 2: each family's check-in, one card per draft. The five steps are shown on every
// card: Compass prepares, the owner reviews and edits, approves, picks how to send, then
// confirms. Any change after approval clears it. Several approved messages can be sent
// together, but each was approved on its own and the database checks each one again.

const OPEN = ["draft", "awaiting_approval", "approved", "rejected", "sending"];

type SendPlan = { ids: string[]; single: RetentionMessage | null };
type SentNote = { simulated: boolean; count: number; failed: number; to?: string; channel?: Channel; detail?: string };

export function DraftsTab({ data, focusStudent, onOpenStudent, onTracking }: { data: RetentionData; focusStudent: string | null; onOpenStudent: (id: string) => void; onTracking: () => void }) {
  const { t } = useI18n();
  const owner = data.role === "owner";
  const drafts = useMemo(() => data.messages.filter((m) => OPEN.includes(m.status)).sort((a, b) => (a.studentId === focusStudent ? -1 : b.studentId === focusStudent ? 1 : a.createdAt.localeCompare(b.createdAt))), [data.messages, focusStudent]);
  const approved = drafts.filter((m) => m.status === "approved");
  const byChannel = { email: approved.filter((m) => m.channel === "email").length, sms: approved.filter((m) => m.channel === "sms").length };
  const [plan, setPlan] = useState<SendPlan | null>(null);
  const [sent, setSent] = useState<SentNote | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const { run, error, setError } = useRetentionAction();
  const sending = useRef(false);

  async function sendAll(ids: string[]) {
    if (sending.current) return;
    sending.current = true;
    let ok = 0, failed = 0, simulated = true, last: { to: string; channel: Channel; detail: string } | undefined;
    for (const [n, id] of ids.entries()) {
      const m = drafts.find((x) => x.id === id);
      if (!m) continue;
      setProgress(t("retention.drafts.sendingN", { n: n + 1, total: ids.length }));
      const r = await run<{ status: "sent" | "failed"; simulated: boolean; channel: Channel; to: string; detail: string }>(`send-${id}`, { action: "send", id, channel: m.channel });
      if (r.ok && r.data.status === "sent") { ok++; simulated = r.data.simulated; last = r.data; }
      else failed++;
    }
    setProgress(null);
    setPlan(null);
    setSent({ simulated, count: ok, failed, ...(ids.length === 1 && last ? last : {}) });
    sending.current = false;
  }

  return (
    <div className="ret-drafts">
      {sent && (
        <div className={`notice ${sent.failed && !sent.count ? "error" : "success"} ret-sent`} role="status">
          <p>
            <strong>{sent.simulated ? t("retention.drafts.simulatedTitle", { count: sent.count }) : t("retention.drafts.sentTitle", { count: sent.count })}</strong>{" "}
            {sent.to && sent.channel ? t("retention.drafts.sentTo", { channel: sent.channel === "sms" ? "SMS" : t("retention.common.email"), to: sent.to }) : null}{" "}
            {sent.simulated ? t("retention.drafts.simulatedText") : sent.detail ?? ""}
            {sent.failed ? ` ${t("retention.drafts.failedN", { count: sent.failed })}` : ""}
          </p>
          <button type="button" className="btn small secondary" onClick={onTracking}>{t("retention.drafts.viewHistory")} <Icon name="arrow" size={14} /></button>
        </div>
      )}
      <ErrorNote text={error} onClose={() => setError(null)} />

      {drafts.length > 0 && (
        <div className="ret-batch" aria-live="polite">
          <p>
            <strong>{t("retention.drafts.summary", { count: drafts.length })}</strong>{" "}
            {t("retention.drafts.summaryApproved", { count: approved.length, email: byChannel.email, sms: byChannel.sms })}
          </p>
          {owner && (
            <button type="button" className="btn small" disabled={!approved.length || Boolean(progress)} onClick={() => setPlan({ ids: approved.map((m) => m.id), single: null })}>
              <Icon name="check" size={16} /> {t("retention.drafts.sendApproved", { count: approved.length })}
            </button>
          )}
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true"><Icon name="sparkle" /></span>
          <h3>{t("retention.drafts.emptyTitle")}</h3>
          <p className="muted">{t("retention.drafts.emptyText")}</p>
        </div>
      ) : (
        <div className="ret-draft-list">
          {drafts.map((m) => (
            <DraftCard key={m.id} m={m} data={data} focus={m.studentId === focusStudent} onOpenStudent={onOpenStudent} onSend={(msg) => setPlan({ ids: [msg.id], single: msg })} sendingNow={Boolean(progress)} />
          ))}
        </div>
      )}

      {plan && (
        <SendConfirm
          plan={plan}
          drafts={drafts}
          data={data}
          busy={Boolean(progress)}
          progress={progress}
          onCancel={() => setPlan(null)}
          onConfirm={() => sendAll(plan.ids)}
        />
      )}
    </div>
  );
}

const STEPS = ["prepared", "reviewed", "approved", "method", "confirmed"] as const;

function stepIndex(m: RetentionMessage, dirty: boolean): number {
  if (m.status === "sending" || m.status === "sent") return 5;
  if (m.status === "approved" && !dirty) return 3;
  if (m.status === "awaiting_approval" || dirty) return 1;
  return 1;
}

function DraftCard({ m, data, focus, onOpenStudent, onSend, sendingNow }: { m: RetentionMessage; data: RetentionData; focus: boolean; onOpenStudent: (id: string) => void; onSend: (m: RetentionMessage) => void; sendingNow: boolean }) {
  const { t } = useI18n();
  const when = useWhen();
  const owner = data.role === "owner";
  const [subject, setSubject] = useState(m.subject ?? "");
  const [body, setBody] = useState(m.body);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [switchTo, setSwitchTo] = useState<Channel | null>(null);
  const [removing, setRemoving] = useState(false);
  const { run, busy, error, setError } = useRetentionAction();
  const ref = useRef<HTMLElement>(null);
  const a = data.assessments.find((x) => x.studentId === m.studentId);
  const c = a?.contact ?? null;
  const name = data.names[m.studentId] ?? m.studentId;

  // A new version from the server (after save, regenerate or channel switch) replaces the local text.
  useEffect(() => {
    setSubject(m.subject ?? "");
    setBody(m.body);
  }, [m.version, m.subject, m.body]);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "center" });
  }, [focus]);

  const dirty = body !== m.body || (m.channel === "email" && subject !== (m.subject ?? ""));
  const step = stepIndex(m, dirty);
  const internal = internalWording(`${subject}\n${body}`);
  const blaming = soundsBlaming(body);
  const tooLong = m.channel === "sms" && body.length > SMS_LIMIT;
  const approvedNow = m.status === "approved" && !dirty;
  const canEdit = ["draft", "awaiting_approval", "approved", "rejected"].includes(m.status);
  const can = (ch: Channel) => {
    if (!c) return t("retention.drafts.noParent");
    if (ch === "email") return !c.emailPermitted ? t("retention.drafts.emailNotAgreed") : !c.email ? t("retention.drafts.noEmail") : null;
    if (!c.smsPermitted) return t("retention.drafts.smsNotAgreed");
    if (!c.phone || !/^(\+?61|0)4\d{8}$/.test(c.phone.replace(/[^\d+]/g, ""))) return t("retention.drafts.badPhone");
    return null;
  };
  const otherChannel: Channel = m.channel === "email" ? "sms" : "email";

  async function save() {
    await run("save", { action: "update", id: m.id, version: m.version, body, ...(m.channel === "email" ? { subject } : {}) });
  }
  async function change(extra: Record<string, unknown>, key: string) {
    await run(key, { action: "update", id: m.id, version: m.version, ...extra });
  }

  return (
    <article ref={ref} className={`ret-draft${focus ? " focus" : ""}`} aria-labelledby={`ret-d-${m.id}`}>
      <header className="ret-draft-head">
        <div>
          <h3 id={`ret-d-${m.id}`}>{t("retention.drafts.checkInFor", { name })}</h3>
          <p className="muted">
            {a ? <button type="button" className="ret-link" onClick={() => onOpenStudent(m.studentId)}>{t("retention.drafts.seeFindings")}</button> : null}
            {" · "}{m.source === "ai" ? t("retention.drafts.sourceAi") : m.source === "owner" ? t("retention.drafts.sourceOwner") : data.aiDrafts ? t("retention.drafts.sourceTemplateAiDown") : t("retention.drafts.sourceTemplate")}
          </p>
        </div>
        <StageBadge stage={stageOf(m, data.today)} />
      </header>

      <ol className="ret-steps" aria-label={t("retention.drafts.stepsLabel")}>
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? "done" : i === step ? "current" : undefined} aria-current={i === step ? "step" : undefined}>
            <span className="ret-step-dot" aria-hidden="true">{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
            <span>{t(!owner && (s === "approved" || s === "confirmed") ? `retention.step.${s}Owner` : `retention.step.${s}`)}</span>
          </li>
        ))}
      </ol>

      <div className="ret-channel" role="radiogroup" aria-label={t("retention.drafts.channelLabel")}>
        {(["email", "sms"] as Channel[]).map((ch) => {
          const problem = can(ch);
          return (
            <button
              key={ch}
              type="button"
              role="radio"
              aria-checked={m.channel === ch}
              className={`ret-chip${m.channel === ch ? " active" : ""}`}
              disabled={Boolean(problem) || !canEdit || Boolean(busy)}
              title={problem ?? undefined}
              onClick={() => { if (m.channel !== ch) { if (m.status === "approved") setSwitchTo(ch); else change({ channel: ch }, "channel"); } }}
            >
              <Icon name={ch === "email" ? "book" : "bell"} size={14} /> {ch === "email" ? t("retention.common.email") : "SMS"}
            </button>
          );
        })}
        {can(otherChannel) && <span className="hint">{can(otherChannel)}</span>}
      </div>

      <p className="ret-recipient"><strong>{t("retention.drafts.to")}</strong> {m.recipientName} <span className="muted">&lt;{m.address || t("retention.drafts.noAddress")}&gt;</span>{c && <span className="hint"> · {t("retention.drafts.parentOf", { name })}</span>}</p>

      {m.channel === "email" && (
        <label className="ret-field">
          <span>{t("retention.drafts.subject")}</span>
          <input type="text" value={subject} maxLength={200} disabled={!canEdit} onChange={(e) => setSubject(e.target.value)} />
        </label>
      )}
      <label className="ret-field">
        <span>{m.channel === "sms" ? t("retention.drafts.smsText") : t("retention.drafts.body")}</span>
        <textarea value={body} rows={m.channel === "sms" ? 4 : 11} maxLength={4000} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} aria-describedby={`ret-help-${m.id}`} />
      </label>
      <div id={`ret-help-${m.id}`} className="ret-help">
        {m.channel === "sms" && <span className={tooLong ? "ret-warn" : "hint"}>{t("retention.drafts.chars", { n: body.length, max: SMS_LIMIT })}</span>}
        {dirty && m.status === "approved" && <span className="ret-warn">{t("retention.drafts.willClear")}</span>}
        {internal.length > 0 && <span className="ret-warn">{t("retention.drafts.internal", { words: internal.join(", ") })}</span>}
        {blaming && <span className="ret-warn">{t("retention.drafts.blaming")}</span>}
      </div>

      {m.status === "rejected" && <p className="notice warning">{t("retention.drafts.rejectedNote", { reason: m.rejectedReason ?? t("retention.drafts.noReason") })}</p>}
      {approvedNow && (
        <p className="ret-approved" role="status">{t("retention.drafts.approvedBy", { who: (m.approvedBy && data.users[m.approvedBy]) || t("retention.common.owner"), when: when(m.approvedAt) })}</p>
      )}
      {m.status === "awaiting_approval" && !owner && <p className="hint">{t("retention.drafts.waitingOwner")}</p>}

      <div className="ret-draft-actions">
        {canEdit && dirty && <button type="button" className="btn small" disabled={Boolean(busy) || tooLong || !body.trim()} onClick={save}>{t("retention.drafts.save")}</button>}
        {canEdit && dirty && <button type="button" className="btn small secondary" onClick={() => { setBody(m.body); setSubject(m.subject ?? ""); }}>{t("retention.drafts.undo")}</button>}
        {canEdit && !dirty && <button type="button" className="btn small secondary" disabled={Boolean(busy)} aria-busy={busy === "regen" || undefined} onClick={() => change({ regenerate: true }, "regen")}><Icon name="refresh" size={14} /> {t("retention.drafts.regenerate")}</button>}
        {owner && !dirty && ["draft", "awaiting_approval"].includes(m.status) && (
          <button type="button" className="btn small" disabled={Boolean(busy) || internal.length > 0} aria-busy={busy === "approve" || undefined} onClick={() => run("approve", { action: "approve", id: m.id, version: m.version })}>
            <Icon name="check" size={14} /> {t("retention.drafts.approve")}
          </button>
        )}
        {owner && !dirty && ["draft", "awaiting_approval", "approved"].includes(m.status) && !rejecting && (
          <button type="button" className="btn small secondary" onClick={() => setRejecting(true)}>{t("retention.drafts.reject")}</button>
        )}
        {!owner && !dirty && m.status === "draft" && (
          <button type="button" className="btn small" disabled={Boolean(busy)} onClick={() => run("submit", { action: "submit", id: m.id, version: m.version })}>{t("retention.drafts.sendToOwner")}</button>
        )}
        {canEdit && !dirty && <button type="button" className="btn small secondary" onClick={() => setRemoving(true)}>{t("retention.drafts.remove")}</button>}
      </div>

      {approvedNow && owner && (
        <div className="ret-send" role="group" aria-label={t("retention.drafts.methodLabel")}>
          <p className="ret-send-title">{t("retention.drafts.method")}</p>
          <div className="row">
            {(["sms", "email"] as Channel[]).map((ch) => {
              const isApproved = ch === m.channel;
              const ready = data.ready[ch];
              const problem = can(ch);
              return (
                <button
                  key={ch}
                  type="button"
                  className={`btn small${isApproved ? "" : " secondary"}`}
                  disabled={sendingNow || Boolean(busy) || Boolean(problem) || (isApproved && !ready)}
                  title={problem ?? (!ready ? t("retention.drafts.notConnected") : undefined)}
                  onClick={() => (isApproved ? onSend(m) : setSwitchTo(ch))}
                >
                  {ch === "sms" ? t("retention.drafts.viaSms") : t("retention.drafts.viaEmail")}
                </button>
              );
            })}
          </div>
          <p className="hint">{data.ready[m.channel] ? t("retention.drafts.methodHint", { channel: m.channel === "sms" ? "SMS" : t("retention.common.email") }) : m.channel === "email" ? t("retention.drafts.gmailNeeded") : t("retention.drafts.smsNeeded")}</p>
        </div>
      )}
      {m.status === "sending" && <p className="hint">{t("retention.drafts.sending")}</p>}

      {rejecting && (
        <form className="ret-dismiss" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run("reject", { action: "reject", id: m.id, version: m.version, reason });
          if (r.ok) { setRejecting(false); setReason(""); }
        }}>
          <label htmlFor={`ret-rej-${m.id}`}>{t("retention.drafts.rejectWhy")}</label>
          <textarea id={`ret-rej-${m.id}`} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row">
            <button type="submit" className="btn small danger" disabled={Boolean(busy)}>{t("retention.drafts.rejectConfirm")}</button>
            <button type="button" className="btn small secondary" onClick={() => setRejecting(false)}>{t("retention.common.cancel")}</button>
          </div>
        </form>
      )}
      <ErrorNote text={error} onClose={() => setError(null)} />

      {switchTo && (
        <ConfirmDialog
          title={t("retention.drafts.switchTitle", { channel: switchTo === "sms" ? "SMS" : t("retention.common.email") })}
          confirmLabel={t("retention.drafts.switchConfirm")}
          cancelLabel={t("retention.common.cancel")}
          busy={busy === "channel"}
          onCancel={() => setSwitchTo(null)}
          onConfirm={async () => { await change({ channel: switchTo }, "channel"); setSwitchTo(null); }}
        >
          <p>{t("retention.drafts.switchText")}</p>
        </ConfirmDialog>
      )}
      {removing && (
        <ConfirmDialog
          title={t("retention.drafts.removeTitle")}
          confirmLabel={t("retention.drafts.removeConfirm")}
          cancelLabel={t("retention.common.cancel")}
          danger
          busy={busy === "discard"}
          onCancel={() => setRemoving(false)}
          onConfirm={async () => { await run("discard", { action: "discard", id: m.id }); setRemoving(false); }}
        >
          <p>{t("retention.drafts.removeText", { name: m.recipientName })}</p>
        </ConfirmDialog>
      )}
    </article>
  );
}

function SendConfirm({ plan, drafts, data, busy, progress, onCancel, onConfirm }: { plan: SendPlan; drafts: RetentionMessage[]; data: RetentionData; busy: boolean; progress: string | null; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  const list = plan.ids.map((id) => drafts.find((m) => m.id === id)).filter((m): m is RetentionMessage => Boolean(m));
  const demo = data.mode === "demo";
  const one = plan.single;
  const email = list.filter((m) => m.channel === "email").length;
  const sms = list.length - email;
  return (
    <ConfirmDialog
      title={one ? t("retention.confirm.oneTitle", { channel: one.channel === "sms" ? "SMS" : t("retention.common.email") }) : t("retention.confirm.manyTitle", { count: list.length })}
      confirmLabel={progress ?? (demo ? t("retention.confirm.simulate") : t("retention.confirm.send"))}
      cancelLabel={t("retention.common.cancel")}
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {one ? (
        <dl className="ret-confirm">
          <div><dt>{t("retention.confirm.recipient")}</dt><dd>{one.recipientName} &lt;{one.address}&gt;</dd></div>
          <div><dt>{t("retention.confirm.channel")}</dt><dd>{one.channel === "sms" ? "SMS" : t("retention.common.email")}</dd></div>
          {one.subject && <div><dt>{t("retention.drafts.subject")}</dt><dd>{one.subject}</dd></div>}
          <div><dt>{t("retention.confirm.message")}</dt><dd><pre className="ret-preview">{one.body}</pre></dd></div>
        </dl>
      ) : (
        <>
          <p>{t("retention.confirm.manyText", { email, sms })}</p>
          <ul className="confirm-list">
            {list.map((m) => <li key={m.id}><strong>{m.recipientName}</strong> · {m.channel === "sms" ? "SMS" : t("retention.common.email")} · {m.address}</li>)}
          </ul>
        </>
      )}
      <p className={demo ? "notice info" : "notice warning"}>{demo ? t("retention.confirm.demoNote") : t("retention.confirm.liveNote")}</p>
    </ConfirmDialog>
  );
}
