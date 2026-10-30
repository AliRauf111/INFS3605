"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AttentionBlock, BriefingBlock, Block, Command, DraftBlock, ReviewAction, ReviewBlock, RulesBlock } from "@/lib/assistant/logic";
import type { ProposalAction } from "@/lib/agent/permissions";
import type { ProposalView } from "@/lib/agent/proposal-logic";
import { motionReduced } from "@/lib/a11y/motion";
import { useI18n } from "@/components/i18n/I18nProvider";
import { enT, type Translate } from "@/lib/i18n/core";
import type { Format } from "@/lib/i18n/format";

// Compass replies are English (see EN in Messages.tsx). Labels around them follow the page language.
const EN = { lang: "en", dir: "auto" } as const;

// Compass's owner and enquiry cards: the briefing, decision-ready reviews, drafts and the
// confirmation card every saved change goes through. The server holds the real state.
// These cards only show it, and they report success only when the server says so.

export type ProposalState = {
  stage: "pending" | "confirming" | "editing" | "updating" | "cancelling" | "done" | "closed";
  proposal: ProposalView;
  message?: string;
  reasons?: string[];
  error?: string;
  editText?: string;
  result?: { requestId: string | null; status: string | null; duplicate: boolean };
  replacedNote?: string;
};

export type CardState = {
  /** The proposal card opened from this card, if any. */
  p?: ProposalState;
  /** Which action on a review card is being prepared. */
  preparing?: string;
  /** An action waiting for the person to write its note first. */
  composing?: string;
  /** Edited draft text, kept so minimising the panel doesn't lose it. */
  text?: string;
  error?: string;
};

export type CardProps = {
  sessionKey: string;
  disabled: boolean;
  state: CardState;
  onState: (next: CardState) => void;
  onCommand: (c: Command, label: string) => void;
  onAnnounce: (text: string) => void;
};

async function postJson<T>(url: string, body: unknown, t: Translate = enT): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? t("compass.card.genericError", { status: res.status }));
  return json as T;
}

export async function prepare(body: Record<string, unknown>, t?: Translate): Promise<ProposalView> {
  return postJson<ProposalView>("/api/agent/proposals", body, t);
}

type ConfirmOutcome =
  | { outcome: "succeeded"; message: string; duplicate: boolean; requestId: string | null; status: string | null }
  | { outcome: "changed"; message: string; reasons: string[]; proposal: ProposalView | null }
  | { outcome: "expired" | "cancelled" | "superseded" | "failed" | "stale"; message: string };

const time = (iso: string, fmt: Format) => fmt.time(iso);
const stamp = (iso: string, fmt: Format) => fmt.date(iso, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const colourText = (c: string, t: Translate) => (c === "green" || c === "amber" || c === "red" ? t(`domain.colourShort.${c}`) : c);

// ---------------------------------------------------------------------------
// Confirmation card: Confirm, Edit or Cancel. Used by every saved change.

export function ProposalCard({ state, onState, onAnnounce, onCommand, intro, introTranslated, next, disabled }: {
  state: ProposalState;
  onState: (s: ProposalState) => void;
  onAnnounce: (t: string) => void;
  onCommand: (c: Command, label: string) => void;
  intro?: string | null;
  /** True when the intro was written on this page in the chosen language, not by the server. */
  introTranslated?: boolean;
  /** The workflow's next step, offered once this preview is finished. */
  next?: { label: string; command: Command };
  disabled?: boolean;
}) {
  const p = state.proposal;
  const v = p.preview;
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { t, fmt } = useI18n();
  const busy = state.stage === "confirming" || state.stage === "updating" || state.stage === "cancelling";
  const set = (patch: Partial<ProposalState>) => onState({ ...state, ...patch });

  useEffect(() => {
    if (state.stage === "pending" && !state.message) ref.current?.scrollIntoView({ block: "nearest", behavior: motionReduced() ? "auto" : "smooth" });
    // Only when a new preview arrives.
  }, [p.id]);

  const confirm = async () => {
    if (busy) return;
    set({ stage: "confirming", error: undefined });
    try {
      const r = await postJson<ConfirmOutcome>(`/api/agent/proposals/${p.id}/confirm`, {}, t);
      if (r.outcome === "succeeded") {
        onState({ ...state, stage: "done", message: r.message, error: undefined, result: { requestId: r.requestId, status: r.status, duplicate: r.duplicate } });
        onAnnounce(r.message);
        router.refresh(); // so the page behind the panel shows the change
      } else if (r.outcome === "changed") {
        if (r.proposal) {
          onState({ stage: "pending", proposal: r.proposal, reasons: r.reasons, message: r.message });
          onAnnounce(`${r.message} ${r.reasons.join(" ")}`);
        } else {
          onState({ ...state, stage: "closed", reasons: r.reasons, message: r.message });
          onAnnounce(r.message);
        }
      } else {
        onState({ ...state, stage: "closed", message: r.message });
        onAnnounce(r.message);
      }
    } catch (e) {
      const msg = e instanceof Error && e.message !== "Failed to fetch" ? e.message : t("compass.card.didntGoThrough");
      onState({ ...state, stage: "pending", error: msg });
      onAnnounce(msg);
    }
  };

  const saveEdit = async () => {
    if (!v.editable || busy) return;
    set({ stage: "updating", error: undefined });
    try {
      const next = await postJson<ProposalView>(`/api/agent/proposals/${p.id}/edit`, { [v.editable.field]: state.editText ?? "" }, t);
      const replaced = next.id !== p.id;
      onState({ stage: "pending", proposal: next, replacedNote: replaced ? t("compass.card.previewReplaced") : undefined });
      onAnnounce(replaced ? t("compass.card.previewUpdated") : t("compass.card.noChanges"));
    } catch (e) {
      set({ stage: "editing", error: e instanceof Error ? e.message : t("compass.card.editFailed") });
    }
  };

  const cancel = async () => {
    if (busy) return;
    set({ stage: "cancelling", error: undefined });
    try {
      const r = await postJson<{ message: string }>(`/api/agent/proposals/${p.id}/cancel`, {}, t);
      onState({ ...state, stage: "closed", message: r.message });
      onAnnounce(r.message);
    } catch (e) {
      set({ stage: "pending", error: e instanceof Error ? e.message : t("compass.card.couldntCancel") });
    }
  };

  if (state.stage === "done") {
    const id = state.result?.requestId;
    return (
      <div className="cp-proposal done" role="status">
        <p className="cp-status"><strong>{t("compass.card.done")}</strong> <span {...EN}>{state.message}</span></p>
        {state.result?.duplicate && <p className="cp-small">{t("compass.card.alreadyConfirmed")}</p>}
        {(next || id) && (
          <div className="cp-row">
            {next && <button type="button" className="cp-btn" disabled={disabled} onClick={() => onCommand(next.command, next.label)} {...EN}>{next.label}</button>}
            {id && !next && <button type="button" className="cp-btn secondary" onClick={() => onCommand({ type: "review", requestId: id }, t("compass.card.reviewRequest"))}>{t("compass.card.reviewRequest")}</button>}
            {id && <Link className="cp-btn secondary" href={`/requests/${id}`}>{t("compass.card.openRequest")}</Link>}
          </div>
        )}
      </div>
    );
  }
  if (state.stage === "closed") {
    return (
      <div className="cp-proposal closed" role="status">
        <p className="cp-status" {...EN}>{state.message}</p>
        {state.reasons?.length ? <ul className="cp-missing" {...EN}>{state.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
        {next && (
          <div className="cp-row">
            <button type="button" className="cp-btn secondary" disabled={disabled} onClick={() => onCommand(next.command, next.label)} {...EN}>{next.label}</button>
          </div>
        )}
      </div>
    );
  }

  const expired = new Date(p.expiresAt).getTime() < Date.now();
  return (
    <div ref={ref} className="cp-proposal" role="group" aria-label={t("compass.card.confirmLabel", { title: v.title })}>
      {intro && <p className="cp-small" {...(introTranslated ? {} : EN)}>{intro}</p>}
      {state.message && (
        <div className="cp-notice warning" role="alert" {...EN}>
          {state.message}
          {state.reasons?.length ? <ul>{state.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
        </div>
      )}
      {state.replacedNote && <p className="cp-small" role="status">{state.replacedNote}</p>}
      <p className="cp-status"><strong>{t("compass.card.preparedNotSaved")}</strong> {t("compass.card.awaiting")}</p>
      <h4 {...EN}>{v.title}</h4>
      <p className="cp-small">
        <span {...EN}>{v.target.typeLabel}</span> · <bdi>{v.target.reference}</bdi>{v.target.shortId ? <> · <bdi>{v.target.shortId}</bdi></> : ""}{v.target.statusLabel ? <> · <span {...EN}>{v.target.statusLabel}</span></> : ""}
        {v.target.href && <> · <Link href={v.target.href}>{t("compass.card.open")}</Link></>}
      </p>
      {v.changes.length > 0 && (
        <table className="cp-changes">
          <caption className="sr-only">{t("compass.card.whatChanges")}</caption>
          <thead><tr><th scope="col">{t("compass.card.field")}</th><th scope="col">{t("compass.card.now")}</th><th scope="col">{t("compass.card.after")}</th></tr></thead>
          <tbody {...EN}>{v.changes.map((c, i) => <tr key={i}><th scope="row">{c.field}</th><td>{c.current}</td><td>{c.proposed}</td></tr>)}</tbody>
        </table>
      )}
      {state.stage === "editing" || state.stage === "updating" ? (
        <div className="cp-draft">
          <label htmlFor={`edit-${p.id}`} {...(v.editable?.label ? EN : {})}>{v.editable?.label ?? t("compass.card.edit")}</label>
          <textarea id={`edit-${p.id}`} dir="auto" rows={v.editable?.field === "body" ? 8 : 4} value={state.editText ?? ""} onChange={(e) => set({ editText: e.target.value })} disabled={state.stage === "updating"} />
          {state.error && <p className="cp-error" role="alert">{state.error}</p>}
          <div className="cp-row">
            <button type="button" className="cp-btn" onClick={saveEdit} disabled={state.stage === "updating" || !(state.editText ?? "").trim()}>{state.stage === "updating" ? t("compass.card.updating") : t("compass.card.updatePreview")}</button>
            <button type="button" className="cp-btn secondary" onClick={() => set({ stage: "pending", error: undefined })} disabled={state.stage === "updating"}>{t("compass.card.back")}</button>
          </div>
        </div>
      ) : (
        <>
          {v.note && <div className="cp-quote"><span className="cp-label">{t("compass.card.noteRecorded")}</span><p dir="auto">{v.note}</p></div>}
          {v.body && <div className="cp-quote"><span className="cp-label">{t("compass.card.draftText")}</span><p dir="auto">{v.body}</p></div>}
        </>
      )}
      {v.warnings.length > 0 && <ul className="cp-warnings" {...EN}>{v.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      <p className="cp-small"><strong>{t("compass.card.whatHappens")}</strong> <span {...EN}>{v.outcome}</span></p>
      <p className="cp-small"><strong>{t("compass.card.whoConfirms")}</strong> <span {...EN}>{v.requiredRoleText}</span></p>
      {(v.policyRefs.length > 0 || v.versions.length > 0) && (
        <details className="cp-more">
          <summary>{t("compass.card.versions")}</summary>
          <ul {...EN}>{[...v.policyRefs, ...v.versions].map((x, i) => <li key={i}>{x}</li>)}</ul>
        </details>
      )}
      <p className="cp-small">{expired ? t("compass.card.expired") : t("compass.card.validUntil", { time: time(p.expiresAt, fmt) })}</p>
      {state.stage !== "editing" && state.stage !== "updating" && (
        <>
          {state.error && <p className="cp-error" role="alert">{state.error}</p>}
          {!p.canConfirm && <p className="cp-notice info">{t("compass.card.ownerOnly")}</p>}
          <div className="cp-row">
            <button type="button" className="cp-btn" onClick={confirm} disabled={busy || !p.canConfirm} aria-busy={state.stage === "confirming"}>
              {state.stage === "confirming" ? t("compass.card.saving") : t("compass.card.confirm")}
            </button>
            {v.editable && (
              <button type="button" className="cp-btn secondary" disabled={busy} onClick={() => set({ stage: "editing", editText: v.editable!.field === "body" ? v.body ?? "" : v.note ?? "", error: undefined })}>{t("compass.card.edit")}</button>
            )}
            <button type="button" className="cp-btn secondary" onClick={cancel} disabled={busy}>{state.stage === "cancelling" ? t("compass.card.cancelling") : t("compass.card.cancel")}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Briefing

export function BriefingCard({ block, disabled, onCommand }: { block: BriefingBlock; disabled: boolean; onCommand: (c: Command, label: string) => void }) {
  const { t, fmt } = useI18n();
  const generated = stamp(block.generatedAt, fmt);
  const refresh = () => onCommand(block.scope === "all" ? { type: "briefing" } : { type: "briefing", bucket: block.scope }, t("compass.card.refresh"));
  return (
    <section className="cp-briefing" aria-label={block.scope === "all" ? t("compass.card.allUnfinished") : block.sections[0]?.title}>
      <div className="cp-card-head">
        <h3 {...(block.scope === "all" ? {} : EN)}>{block.scope === "all" ? t("compass.card.allUnfinished") : block.sections[0]?.title}</h3>
        <button type="button" className="cp-link" onClick={refresh} disabled={disabled}>{t("compass.card.refresh")}</button>
      </div>
      <p className="cp-small">{t("compass.card.generated", { when: generated })}</p>
      {block.total === 0 ? (
        <p className="cp-empty">{t("compass.card.nothingWaiting")}</p>
      ) : (
        <>
          {block.scope === "all" && <p className="cp-small" {...EN}>{block.ordering}</p>}
          {block.sections.map((s) => (
            <div key={s.key} className="cp-section">
              <h4 className="cp-section-title">
                {(s.key === "red" || s.key === "amber" || s.key === "green") && <span className={`cp-dot-c ${s.key}`} aria-hidden="true" />}
                {block.scope === "all" ? <span {...EN}>{s.title}</span> : t("compass.card.requests")} <span className="cp-count" aria-label={t("compass.card.countLabel", { count: s.count })}>{fmt.number(s.count)}</span>
              </h4>
              {s.count === 0 ? (
                <p className="cp-small">{t("compass.msg.noneDot")}</p>
              ) : (
                <ol className="cp-items">
                  {s.items.map((it) => (
                    <li key={it.id} className={`cp-item ${it.colour}`}>
                      <div className="cp-item-top">
                        <span className={`cp-dot-c ${it.colour}`} aria-hidden="true" />
                        <span className="sr-only">{colourText(it.colour, t)}. </span>
                        <strong {...EN}>{it.description}</strong>
                      </div>
                      <p className="cp-small"><span {...EN}>{it.statusLabel}</span> · {t("compass.card.waiting", { time: it.waiting })} · <bdi>{it.shortId}</bdi></p>
                      {it.flag && <p className="cp-flag" {...EN}>{it.flag}</p>}
                      <p className="cp-why" {...EN}>{it.why}</p>
                      <div className="cp-row">
                        <button type="button" className="cp-btn" disabled={disabled} onClick={() => onCommand(it.next.command, `${it.next.label}: ${it.reference}`)} {...EN}>{it.next.label}</button>
                        <Link className="cp-btn secondary" href={it.href}>{t("compass.card.open")}</Link>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {s.count > s.page * s.pageSize && (
                <button type="button" className="cp-link" disabled={disabled} onClick={() => onCommand({ type: "briefing", bucket: s.key, page: block.scope === "all" ? 1 : s.page + 1 }, block.scope === "all" ? t("compass.card.showAllLabel", { title: s.title }) : t("compass.card.showMoreLabel"))}>
                  {block.scope === "all" ? t("compass.card.showAll", { count: s.count }) : t("compass.card.showMore", { shown: fmt.number(s.page * s.pageSize), count: s.count })}
                </button>
              )}
              {s.page > 1 && <p className="cp-small">{t("compass.card.page", { page: fmt.number(s.page) })}</p>}
              {!s.orderedAll && <p className="cp-small">{t("compass.card.largeQueue")}</p>}
            </div>
          ))}
          {block.scope === "all" && block.pendingOutcomes > 0 && (
            <div className="cp-row">
              <button type="button" className="cp-btn secondary" disabled={disabled} onClick={() => onCommand({ type: "briefing", bucket: "pending_outcome" }, t("compass.card.pendingOutcomes"))}>{t("compass.card.pendingOutcomes")}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Decision-ready review

export function ReviewCard({ block, sessionKey, disabled, state, onState, onCommand, onAnnounce }: CardProps & { block: ReviewBlock }) {
  const r = block.request;
  const { t } = useI18n();
  const runAction = async (a: ReviewAction, note?: string) => {
    if (a.command) return onCommand(a.command, a.label);
    if (!a.action) return;
    // Some actions, like recording an outcome, need the person's own words first.
    if (note === undefined && !a.note) return onState({ ...state, composing: a.action, text: "", error: undefined });
    onState({ ...state, preparing: a.action, error: undefined });
    try {
      const proposal = await prepare({ sessionKey, action: a.action as ProposalAction, requestId: r.id, note: note ?? a.note ?? "" }, t);
      onState({ preparing: undefined, composing: undefined, p: { stage: "pending", proposal } });
      onAnnounce(t("compass.card.preparedAction", { label: a.label }));
    } catch (e) {
      onState({ ...state, preparing: undefined, error: e instanceof Error ? e.message : t("compass.card.couldntPrepare") });
    }
  };
  return (
    <section className={`cp-review ${block.rule.colour}`} aria-label={t("compass.card.reviewOf", { reference: r.reference })}>
      <div className="cp-card-head">
        <div>
          <h3><span {...EN}>{r.typeLabel}</span> · <bdi>{r.reference}</bdi></h3>
          <p className="cp-small"><bdi>{r.shortId}</bdi> · <span {...EN}>{r.statusLabel}</span> · {t("compass.card.waiting", { time: r.waiting })}</p>
        </div>
        <Link className="cp-link" href={r.href}>{t("compass.card.open")}</Link>
      </div>
      {(r.student || r.tutor) && <p className="cp-small" dir="auto">{[r.student, r.subject, r.tutor && t("compass.card.withTutor", { tutor: r.tutor }), r.classCode].filter(Boolean).join(" · ")}</p>}

      <h4>{t("compass.card.parentWants")}</h4>
      <p><span {...EN}>{block.summary}</span>{block.summarySource === "live_ai" && <span className="cp-tag ai">{t("compass.card.aiWording")}</span>}</p>
      {block.restricted && <p className="cp-notice warning">{t("compass.card.welfareRestricted")}</p>}

      {block.figures.length > 0 && (
        <>
          <h4>{t("compass.card.money")}</h4>
          <dl className="cp-figures">
            {block.figures.map((f, i) => (
              <div key={i}><dt {...EN}>{f.label}</dt><dd><bdi dir="ltr">{f.value}</bdi><span className="cp-src"> ({f.source === "record" ? t("compass.card.srcRecords") : f.source === "request" ? t("compass.card.srcRequest") : t("compass.card.srcCalculated")})</span></dd></div>
            ))}
          </dl>
          {block.figuresNote && <p className="cp-small" {...EN}>{block.figuresNote}</p>}
        </>
      )}

      <h4>{t("compass.card.ruleResult")}</h4>
      <p className={`cp-rule-line ${block.rule.colour}`}><strong>{colourText(block.rule.colour, t)}:</strong> <span {...EN}>{block.rule.ruleLabel}</span></p>
      <p {...EN}>{block.rule.explanation}</p>
      {block.rule.escalation && <p className="cp-small" {...EN}>{block.rule.escalation}</p>}
      <p className="cp-small" {...EN}>
        {block.rule.policyHref ? <Link href={block.rule.policyHref}>{block.rule.policyLabel}</Link> : block.rule.policyLabel} · {block.rule.checkedAt}
      </p>

      {block.issues.length > 0 && (
        <ul className="cp-issues" {...EN}>{block.issues.map((x, i) => <li key={i} className={x.tone}>{x.text}</li>)}</ul>
      )}

      <details className="cp-more">
        <summary>{t("compass.card.facts")}</summary>
        <h5>{t("compass.msg.fromRecords")}</h5>
        <ul>{block.sources.retrieved.length ? block.sources.retrieved.map((x, i) => <li key={i} {...EN}>{x}</li>) : <li>{t("compass.msg.noneDot")}</li>}</ul>
        <h5>{t("compass.msg.suppliedByStaff")}</h5>
        <ul {...EN}>{block.sources.supplied.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <h5>{t("compass.msg.stillMissing")}</h5>
        <ul>{block.sources.missing.length ? block.sources.missing.map((x, i) => <li key={i} {...EN}>{x}</li>) : <li>{t("compass.msg.nothingDot")}</li>}</ul>
      </details>
      {block.procedures.length > 0 && (
        <details className="cp-more">
          <summary>{t("compass.card.procedures")}</summary>
          <ul>{block.procedures.map((p) => <li key={p.id}><Link href={p.href} {...EN}>{p.id} {p.title}</Link> {t("compass.card.procedureVersion", { version: p.version })}</li>)}</ul>
        </details>
      )}
      {block.history.length > 0 && (
        <details className="cp-more">
          <summary>{t("compass.card.history")}</summary>
          <ol className="cp-history" {...EN}>{block.history.map((h, i) => <li key={i}><strong>{h.what}</strong> · {h.who} · {h.when}{h.note && <p dir="auto">{h.note}</p>}</li>)}</ol>
        </details>
      )}

      <div className={`cp-ready ${block.readiness.ready ? "yes" : "no"}`}>
        {block.readiness.ready ? (
          <p><strong>{t("compass.card.ready")}</strong> {t("compass.card.readyText")}</p>
        ) : (
          <>
            <p><strong>{t("compass.card.notReady")}</strong></p>
            <ul {...EN}>{block.readiness.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
      </div>
      {block.roleNote && <p className="cp-notice info" {...EN}>{block.roleNote}</p>}

      {!state.p && state.composing && (() => {
        const a = block.actions.find((x) => x.action === state.composing)!;
        const id = `compose-${r.id}`;
        return (
          <div className="cp-draft">
            <label htmlFor={id}>{a.action === "request.record_outcome" ? t("compass.card.outcomePrompt") : t("compass.card.noteFor", { label: a.label })}</label>
            <textarea id={id} rows={3} dir="auto" value={state.text ?? ""} onChange={(e) => onState({ ...state, text: e.target.value })} autoFocus />
            <div className="cp-row">
              <button type="button" className="cp-btn" disabled={!(state.text ?? "").trim() || Boolean(state.preparing)} onClick={() => void runAction(a, state.text ?? "")}>{state.preparing ? t("compass.msg.preparing") : t("compass.card.preview")}</button>
              <button type="button" className="cp-btn secondary" onClick={() => onState({ ...state, composing: undefined })}>{t("compass.card.back")}</button>
            </div>
          </div>
        );
      })()}
      {!state.p && !state.composing && (
        <div className="cp-row" role="group" aria-label={t("compass.card.nextActions")}>
          {block.actions.map((a, i) => a.href
            ? <Link key={i} className={`cp-btn${a.primary ? "" : " secondary"}`} href={a.href} {...EN}>{a.label}</Link>
            : (
              <button key={i} type="button" className={`cp-btn${a.primary ? "" : " secondary"}`} disabled={disabled || Boolean(state.preparing)} onClick={() => void runAction(a)}>
                {a.action && state.preparing === a.action ? t("compass.msg.preparing") : <span {...EN}>{a.label}</span>}
              </button>
            ))}
        </div>
      )}
      {state.error && <p className="cp-error" role="alert">{state.error}</p>}
      {state.p && (
        <ProposalCard
          state={state.p}
          onState={(p) => onState({ ...state, p: p.stage === "closed" ? undefined : p, error: p.stage === "closed" ? p.message : undefined })}
          onAnnounce={onAnnounce}
          onCommand={onCommand}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Drafts: editable, never sent. Saving one goes through a proposal.

export function DraftCard({ block, sessionKey, state, onState, onCommand, onAnnounce }: CardProps & { block: DraftBlock }) {
  const text = state.text ?? block.body;
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
  const save = async () => {
    onState({ ...state, preparing: "draft.save", error: undefined });
    try {
      const proposal = await prepare({ sessionKey, action: "draft.save", requestId: block.requestId, kind: block.draftKind, body: text, generatedBy: text === block.body ? block.generatedBy : "edited" }, t);
      onState({ ...state, preparing: undefined, p: { stage: "pending", proposal } });
      onAnnounce(t("compass.card.preparedDraft"));
    } catch (e) {
      onState({ ...state, preparing: undefined, error: e instanceof Error ? e.message : t("compass.card.couldntPrepare") });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onAnnounce(t("compass.card.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onState({ ...state, error: t("compass.card.copyBlocked") });
    }
  };
  const id = `draft-${block.requestId}-${block.draftKind}`;
  return (
    <section className="cp-draftcard" aria-label={block.title}>
      <h3 {...EN}>{block.title}</h3>
      <p className="cp-small"><bdi>{block.reference}</bdi> · <span {...EN}>{block.note}</span>{block.generatedBy === "live_ai" && <span className="cp-tag ai">{t("compass.card.aiWording")}</span>}</p>
      {block.restricted ? (
        <p className="cp-notice warning" {...EN}>{block.body}</p>
      ) : (
        <>
          <label htmlFor={id} className="sr-only">{block.title}</label>
          <textarea id={id} rows={9} dir="auto" value={text} disabled={Boolean(state.p)} onChange={(e) => onState({ ...state, text: e.target.value })} />
        </>
      )}
      {block.staffChecks.length > 0 && (
        <>
          <h4>{t("compass.card.staffChecks")}</h4>
          <ul {...EN}>{block.staffChecks.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {!block.restricted && !state.p && (
        <div className="cp-row">
          <button type="button" className="cp-btn secondary" onClick={() => void copy()}>{copied ? t("compass.card.copiedButton") : t("compass.card.copy")}</button>
          <button type="button" className="cp-btn" onClick={() => void save()} disabled={Boolean(state.preparing) || !text.trim()}>{state.preparing ? t("compass.msg.preparing") : t("compass.card.saveDraft")}</button>
          <button type="button" className="cp-btn secondary" onClick={() => onCommand({ type: "review", requestId: block.requestId }, t("compass.card.reviewRequest"))}>{t("compass.card.reviewRequest")}</button>
        </div>
      )}
      <p className="cp-small">{t("compass.card.neverSends")}</p>
      {state.error && <p className="cp-error" role="alert">{state.error}</p>}
      {state.p && (
        <ProposalCard
          state={state.p}
          onState={(p) => onState({ ...state, p: p.stage === "closed" ? undefined : p, error: p.stage === "closed" ? p.message : undefined })}
          onAnnounce={onAnnounce}
          onCommand={onCommand}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small blocks

export function OptionsRow({ block, disabled, onCommand }: { block: Extract<Block, { kind: "options" }>; disabled: boolean; onCommand: (c: Command, label: string) => void }) {
  return (
    <div className="cp-chips" role="group" aria-label={block.label} {...EN}>
      {block.options.map((o, i) => (
        <button key={i} type="button" className="cp-chip" disabled={disabled} onClick={() => onCommand(o.command, o.label)}>{o.label}</button>
      ))}
    </div>
  );
}

export function ChecklistCard({ block }: { block: Extract<Block, { kind: "checklist" }> }) {
  const { t } = useI18n();
  const mark = { have: "✓", missing: "!", check: "○" } as const;
  const word = { have: t("compass.card.have"), missing: t("compass.card.missing"), check: t("compass.card.toCheck") } as const;
  return (
    <section className="cp-found" aria-label={block.title}>
      <h3 {...EN}>{block.title}</h3>
      <ul className="cp-checklist">
        {block.items.map((it, i) => (
          <li key={i} className={it.state}>
            <span aria-hidden="true">{mark[it.state]}</span> <span className="sr-only">{word[it.state]}: </span><span {...EN}>{it.label}{it.detail && <span className="cp-small"> ({it.detail})</span>}</span>
          </li>
        ))}
      </ul>
      {block.notes.length > 0 && <ul className="cp-warnings" {...EN}>{block.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {block.refs.length > 0 && <p className="cp-small">{t("compass.card.sources", { list: block.refs.join("; ") })}</p>}
      {block.link && <Link href={block.link.href} {...EN}>{block.link.label}</Link>}
    </section>
  );
}

export function RulesCard({ block }: { block: RulesBlock }) {
  const { t } = useI18n();
  return (
    <section className="cp-found" aria-label={t("compass.card.currentRules")}>
      {block.sections.map((s, i) => (
        <div key={i} className="cp-section">
          <h3 {...EN}>{s.title} <span className="cp-small">({s.policyLabel})</span></h3>
          <table className="cp-changes">
            <caption className="sr-only">{s.title}</caption>
            <thead><tr><th scope="col">{t("compass.card.when")}</th><th scope="col">{t("compass.card.result")}</th><th scope="col">{t("compass.card.who")}</th></tr></thead>
            <tbody>
              {s.rules.map((r, j) => (
                <tr key={j}><td {...EN}>{r.when}</td><td><span className={`cp-dot-c ${r.colour}`} aria-hidden="true" /> {colourText(r.colour, t)}</td><td {...EN}>{r.who}</td></tr>
              ))}
            </tbody>
          </table>
          {s.notes.length > 0 && <ul className="cp-warnings" {...EN}>{s.notes.map((n, j) => <li key={j}>{n}</li>)}</ul>}
          <Link href={s.href}>{t("compass.card.viewPolicy")}</Link>
        </div>
      ))}
      <h4>{t("compass.card.always")}</h4>
      <ul {...EN}>{block.systemRules.map((r, i) => <li key={i}>{r}</li>)}</ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// What Needs My Attention?

export function AttentionCard({ block, disabled, onCommand }: { block: AttentionBlock; disabled: boolean; onCommand: (c: Command, label: string) => void }) {
  const { t, fmt } = useI18n();
  const generated = stamp(block.generatedAt, fmt);
  const countLabel = (key: AttentionBlock["counts"][number]["key"], count: number) => t(`compass.attentionKey.${key}`, { count });
  return (
    <section className="cp-briefing cp-attention" aria-label={t("compass.card.attention")}>
      <div className="cp-card-head">
        <h3>{t("compass.card.attention")}</h3>
        <button type="button" className="cp-link" onClick={() => onCommand({ type: "attention" }, t("compass.card.refresh"))} disabled={disabled}>{t("compass.card.refresh")}</button>
      </div>
      <p className="cp-small">{t("compass.card.checkedAt", { when: generated })}</p>
      <ul className="cp-counts" aria-label={t("compass.card.counts")}>
        {block.counts.map((c) => (
          <li key={c.key} className={c.count ? "has" : ""}><span className="cp-count">{fmt.number(c.count)}</span> {countLabel(c.key, c.count)}</li>
        ))}
      </ul>
      {block.total === 0 ? (
        <p className="cp-empty">{t("compass.card.nothingOutstanding")}</p>
      ) : (
        <ol className="cp-items">
          {block.items.map((it) => (
            <li key={it.key} className={`cp-item ${it.colour ?? "none"} cat-${it.category}`}>
              <div className="cp-item-top">
                {it.colour && <span className={`cp-dot-c ${it.colour}`} aria-hidden="true" />}
                {it.colour && <span className="sr-only">{colourText(it.colour, t)}. </span>}
                <strong {...EN}>{it.title}</strong>
              </div>
              <p className="cp-small">{countLabel(it.category, 1)} · <span {...EN}>{it.meta}</span></p>
              <p className="cp-why" {...EN}>{it.reason}</p>
              <div className="cp-row">
                {it.action.command
                  ? <button type="button" className="cp-btn" disabled={disabled} onClick={() => onCommand(it.action.command!, `${it.action.label}: ${it.title}`)} {...EN}>{it.action.label}</button>
                  : it.action.href && <Link className="cp-btn" href={it.action.href} {...EN}>{it.action.label}</Link>}
                {it.href && <Link className="cp-btn secondary" href={it.href}>{t("compass.card.open")}</Link>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {block.notes.map((n, i) => <p key={i} className="cp-small" {...EN}>{n}</p>)}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Read back after a change, and simulated messages

export function ResultCard({ block }: { block: Extract<Block, { kind: "result" }> }) {
  const { t, fmt } = useI18n();
  return (
    <section className="cp-result" aria-label={block.title} role="status">
      <h3 {...EN}>{block.title}</h3>
      <table className="cp-changes">
        <caption className="sr-only">{t("compass.card.beforeAfter")}</caption>
        <thead><tr><th scope="col">{t("compass.card.field")}</th><th scope="col">{t("compass.card.before")}</th><th scope="col">{t("compass.card.now")}</th></tr></thead>
        <tbody {...EN}>{block.rows.map((r, i) => <tr key={i}><th scope="row">{r.label}</th><td>{r.before}</td><td>{r.after}</td></tr>)}</tbody>
      </table>
      {block.notes.map((n, i) => <p key={i} className="cp-small" {...EN}>{n}</p>)}
      <p className="cp-small">{t("compass.card.readBack", { time: time(block.verifiedAt, fmt) })}</p>
    </section>
  );
}

export function SimulatedCard({ block, onAnnounce }: { block: Extract<Block, { kind: "simulated" }>; onAnnounce: (t: string) => void }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block.body);
      setCopied(true);
      onAnnounce(t("compass.card.copiedNotSent"));
    } catch {
      onAnnounce(t("compass.card.couldntCopy"));
    }
  };
  return (
    <section className="cp-simulated" aria-label={t("compass.card.simulatedLabel", { title: block.title })}>
      <p className="cp-sim-tag">{t("compass.card.simulated")}</p>
      <h3 {...EN}>{block.title}</h3>
      <p className="cp-small">{t("compass.card.to", { to: block.to })}</p>
      <div className="cp-quote"><p {...EN}>{block.body}</p></div>
      <p className="cp-small" {...EN}>{block.note}</p>
      <div className="cp-row">
        <button type="button" className="cp-btn secondary" onClick={() => void copy()}>{copied ? t("compass.card.copiedButton") : t("compass.card.copyText")}</button>
      </div>
    </section>
  );
}
