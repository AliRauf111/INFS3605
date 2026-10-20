"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BriefingBlock, Block, Command, DraftBlock, ReviewAction, ReviewBlock, RulesBlock } from "@/lib/assistant/logic";
import type { ProposalAction } from "@/lib/agent/permissions";
import type { ProposalView } from "@/lib/agent/proposal-logic";
import { motionReduced } from "@/lib/a11y/motion";

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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Something went wrong (${res.status}). Nothing was changed.`);
  return json as T;
}

export async function prepare(body: Record<string, unknown>): Promise<ProposalView> {
  return postJson<ProposalView>("/api/agent/proposals", body);
}

type ConfirmOutcome =
  | { outcome: "succeeded"; message: string; duplicate: boolean; requestId: string | null; status: string | null }
  | { outcome: "changed"; message: string; reasons: string[]; proposal: ProposalView | null }
  | { outcome: "expired" | "cancelled" | "superseded" | "failed" | "stale"; message: string };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

const COLOUR_TEXT: Record<string, string> = { green: "Green", amber: "Amber", red: "Red" };

// ---------------------------------------------------------------------------
// Confirmation card: Confirm, Edit or Cancel. Used by every saved change.

export function ProposalCard({ state, onState, onAnnounce, onCommand, intro }: {
  state: ProposalState;
  onState: (s: ProposalState) => void;
  onAnnounce: (t: string) => void;
  onCommand: (c: Command, label: string) => void;
  intro?: string | null;
}) {
  const p = state.proposal;
  const v = p.preview;
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
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
      const r = await postJson<ConfirmOutcome>(`/api/agent/proposals/${p.id}/confirm`, {});
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
      const msg = e instanceof Error ? e.message : "That didn't go through. Nothing was changed.";
      onState({ ...state, stage: "pending", error: msg });
      onAnnounce(msg);
    }
  };

  const saveEdit = async () => {
    if (!v.editable || busy) return;
    set({ stage: "updating", error: undefined });
    try {
      const next = await postJson<ProposalView>(`/api/agent/proposals/${p.id}/edit`, { [v.editable.field]: state.editText ?? "" });
      const replaced = next.id !== p.id;
      onState({ stage: "pending", proposal: next, replacedNote: replaced ? "Preview updated. The earlier preview can no longer be confirmed." : undefined });
      onAnnounce(replaced ? "Preview updated. Check it, then confirm." : "No changes made.");
    } catch (e) {
      set({ stage: "editing", error: e instanceof Error ? e.message : "The edit couldn't be applied." });
    }
  };

  const cancel = async () => {
    if (busy) return;
    set({ stage: "cancelling", error: undefined });
    try {
      const r = await postJson<{ message: string }>(`/api/agent/proposals/${p.id}/cancel`, {});
      onState({ ...state, stage: "closed", message: r.message });
      onAnnounce(r.message);
    } catch (e) {
      set({ stage: "pending", error: e instanceof Error ? e.message : "Couldn't cancel." });
    }
  };

  if (state.stage === "done") {
    const id = state.result?.requestId;
    return (
      <div className="cp-proposal done" role="status">
        <p className="cp-status"><strong>Done.</strong> {state.message}</p>
        {state.result?.duplicate && <p className="cp-small">This was already confirmed, so it wasn&apos;t done twice.</p>}
        {id && (
          <div className="cp-row">
            <button type="button" className="cp-btn secondary" onClick={() => onCommand({ type: "review", requestId: id }, "Review Request")}>Review Request</button>
            <Link className="cp-btn secondary" href={`/requests/${id}`}>Open Request</Link>
          </div>
        )}
      </div>
    );
  }
  if (state.stage === "closed") {
    return (
      <div className="cp-proposal closed" role="status">
        <p className="cp-status">{state.message}</p>
        {state.reasons?.length ? <ul className="cp-missing">{state.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
      </div>
    );
  }

  const expired = new Date(p.expiresAt).getTime() < Date.now();
  return (
    <div ref={ref} className="cp-proposal" role="group" aria-label={`Confirm: ${v.title}`}>
      {intro && <p className="cp-small">{intro}</p>}
      {state.message && (
        <div className="cp-notice warning" role="alert">
          {state.message}
          {state.reasons?.length ? <ul>{state.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
        </div>
      )}
      {state.replacedNote && <p className="cp-small" role="status">{state.replacedNote}</p>}
      <p className="cp-status"><strong>Prepared, not saved.</strong> Awaiting your confirmation.</p>
      <h4>{v.title}</h4>
      <p className="cp-small">
        {v.target.typeLabel} · {v.target.reference}{v.target.shortId ? ` · ${v.target.shortId}` : ""}{v.target.statusLabel ? ` · ${v.target.statusLabel}` : ""}
        {v.target.href && <> · <Link href={v.target.href}>Open</Link></>}
      </p>
      {v.changes.length > 0 && (
        <table className="cp-changes">
          <caption className="sr-only">What will change</caption>
          <thead><tr><th scope="col">Field</th><th scope="col">Now</th><th scope="col">After</th></tr></thead>
          <tbody>{v.changes.map((c, i) => <tr key={i}><th scope="row">{c.field}</th><td>{c.current}</td><td>{c.proposed}</td></tr>)}</tbody>
        </table>
      )}
      {state.stage === "editing" || state.stage === "updating" ? (
        <div className="cp-draft">
          <label htmlFor={`edit-${p.id}`}>{v.editable?.label ?? "Edit"}</label>
          <textarea id={`edit-${p.id}`} rows={v.editable?.field === "body" ? 8 : 4} value={state.editText ?? ""} onChange={(e) => set({ editText: e.target.value })} disabled={state.stage === "updating"} />
          {state.error && <p className="cp-error" role="alert">{state.error}</p>}
          <div className="cp-row">
            <button type="button" className="cp-btn" onClick={saveEdit} disabled={state.stage === "updating" || !(state.editText ?? "").trim()}>{state.stage === "updating" ? "Updating…" : "Update Preview"}</button>
            <button type="button" className="cp-btn secondary" onClick={() => set({ stage: "pending", error: undefined })} disabled={state.stage === "updating"}>Back</button>
          </div>
        </div>
      ) : (
        <>
          {v.note && <div className="cp-quote"><span className="cp-label">Note recorded</span><p>{v.note}</p></div>}
          {v.body && <div className="cp-quote"><span className="cp-label">Draft text</span><p>{v.body}</p></div>}
        </>
      )}
      {v.warnings.length > 0 && <ul className="cp-warnings">{v.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      <p className="cp-small"><strong>What happens:</strong> {v.outcome}</p>
      <p className="cp-small"><strong>Who can confirm:</strong> {v.requiredRoleText}</p>
      {(v.policyRefs.length > 0 || v.versions.length > 0) && (
        <details className="cp-more">
          <summary>Policy and record versions</summary>
          <ul>{[...v.policyRefs, ...v.versions].map((x, i) => <li key={i}>{x}</li>)}</ul>
        </details>
      )}
      <p className="cp-small">{expired ? "This preview has expired. Confirming will check the records again." : `Preview valid until ${time(p.expiresAt)}.`}</p>
      {state.stage !== "editing" && state.stage !== "updating" && (
        <>
          {state.error && <p className="cp-error" role="alert">{state.error}</p>}
          {!p.canConfirm && <p className="cp-notice info">Only the owner can confirm this. Send the request to the owner instead.</p>}
          <div className="cp-row">
            <button type="button" className="cp-btn" onClick={confirm} disabled={busy || !p.canConfirm} aria-busy={state.stage === "confirming"}>
              {state.stage === "confirming" ? "Checking and saving…" : "Confirm"}
            </button>
            {v.editable && (
              <button type="button" className="cp-btn secondary" disabled={busy} onClick={() => set({ stage: "editing", editText: v.editable!.field === "body" ? v.body ?? "" : v.note ?? "", error: undefined })}>Edit</button>
            )}
            <button type="button" className="cp-btn secondary" onClick={cancel} disabled={busy}>{state.stage === "cancelling" ? "Cancelling…" : "Cancel"}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Briefing

export function BriefingCard({ block, disabled, onCommand }: { block: BriefingBlock; disabled: boolean; onCommand: (c: Command, label: string) => void }) {
  const generated = new Date(block.generatedAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const refresh = () => onCommand(block.scope === "all" ? { type: "briefing" } : { type: "briefing", bucket: block.scope }, "Refresh");
  return (
    <section className="cp-briefing" aria-label={block.scope === "all" ? "What Needs My Attention" : block.sections[0]?.title}>
      <div className="cp-card-head">
        <h3>{block.scope === "all" ? "What Needs My Attention?" : block.sections[0]?.title}</h3>
        <button type="button" className="cp-link" onClick={refresh} disabled={disabled}>Refresh</button>
      </div>
      <p className="cp-small">Generated {generated} from current records. Counts include every active request.</p>
      {block.total === 0 ? (
        <p className="cp-empty">Nothing is waiting. No requests need a decision, a follow-up or an outcome right now.</p>
      ) : (
        <>
          {block.scope === "all" && <p className="cp-small">{block.ordering}</p>}
          {block.sections.map((s) => (
            <div key={s.key} className="cp-section">
              <h4 className="cp-section-title">
                {(s.key === "red" || s.key === "amber" || s.key === "green") && <span className={`cp-dot-c ${s.key}`} aria-hidden="true" />}
                {block.scope === "all" ? s.title : "Requests"} <span className="cp-count" aria-label={`${s.count} requests`}>{s.count}</span>
              </h4>
              {s.count === 0 ? (
                <p className="cp-small">None.</p>
              ) : (
                <ol className="cp-items">
                  {s.items.map((it) => (
                    <li key={it.id} className={`cp-item ${it.colour}`}>
                      <div className="cp-item-top">
                        <span className={`cp-dot-c ${it.colour}`} aria-hidden="true" />
                        <span className="sr-only">{COLOUR_TEXT[it.colour]}. </span>
                        <strong>{it.description}</strong>
                      </div>
                      <p className="cp-small">{it.statusLabel} · waiting {it.waiting} · {it.shortId}</p>
                      {it.flag && <p className="cp-flag">{it.flag}</p>}
                      <p className="cp-why">{it.why}</p>
                      <div className="cp-row">
                        <button type="button" className="cp-btn" disabled={disabled} onClick={() => onCommand(it.next.command, `${it.next.label}: ${it.reference}`)}>{it.next.label}</button>
                        <Link className="cp-btn secondary" href={it.href}>Open</Link>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {s.count > s.page * s.pageSize && (
                <button type="button" className="cp-link" disabled={disabled} onClick={() => onCommand({ type: "briefing", bucket: s.key, page: block.scope === "all" ? 1 : s.page + 1 }, block.scope === "all" ? `Show all: ${s.title}` : "Show more")}>
                  {block.scope === "all" ? `Show all ${s.count}` : `Show more (${s.page * s.pageSize} of ${s.count} shown)`}
                </button>
              )}
              {s.page > 1 && <p className="cp-small">Page {s.page}. Earlier pages are in the messages above.</p>}
              {!s.orderedAll && <p className="cp-small">This queue is very large, so ordering used the oldest 2000 requests. The count is still exact.</p>}
            </div>
          ))}
          {block.scope === "all" && block.pendingOutcomes > 0 && (
            <div className="cp-row">
              <button type="button" className="cp-btn secondary" disabled={disabled} onClick={() => onCommand({ type: "briefing", bucket: "pending_outcome" }, "Show Pending Outcomes")}>Show Pending Outcomes</button>
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
  const runAction = async (a: ReviewAction, note?: string) => {
    if (a.command) return onCommand(a.command, a.label);
    if (!a.action) return;
    // Some actions, like recording an outcome, need the person's own words first.
    if (note === undefined && !a.note) return onState({ ...state, composing: a.action, text: "", error: undefined });
    onState({ ...state, preparing: a.action, error: undefined });
    try {
      const proposal = await prepare({ sessionKey, action: a.action as ProposalAction, requestId: r.id, note: note ?? a.note ?? "" });
      onState({ preparing: undefined, composing: undefined, p: { stage: "pending", proposal } });
      onAnnounce(`Prepared ${a.label}. Check the preview, then confirm.`);
    } catch (e) {
      onState({ ...state, preparing: undefined, error: e instanceof Error ? e.message : "Couldn't prepare that." });
    }
  };
  return (
    <section className={`cp-review ${block.rule.colour}`} aria-label={`Review of ${r.reference}`}>
      <div className="cp-card-head">
        <div>
          <h3>{r.typeLabel} · {r.reference}</h3>
          <p className="cp-small">{r.shortId} · {r.statusLabel} · waiting {r.waiting}</p>
        </div>
        <Link className="cp-link" href={r.href}>Open</Link>
      </div>
      {(r.student || r.tutor) && <p className="cp-small">{[r.student, r.subject, r.tutor && `with ${r.tutor}`, r.classCode].filter(Boolean).join(" · ")}</p>}

      <h4>What the parent wants</h4>
      <p>{block.summary}{block.summarySource === "live_ai" && <span className="cp-tag ai">AI wording</span>}</p>
      {block.restricted && <p className="cp-notice warning">A welfare concern is recorded. The details are restricted to the owner, and none of it was sent to the AI service.</p>}

      {block.figures.length > 0 && (
        <>
          <h4>Money</h4>
          <dl className="cp-figures">
            {block.figures.map((f, i) => (
              <div key={i}><dt>{f.label}</dt><dd>{f.value}<span className="cp-src"> ({f.source === "record" ? "records" : f.source === "request" ? "request" : "calculated"})</span></dd></div>
            ))}
          </dl>
          {block.figuresNote && <p className="cp-small">{block.figuresNote}</p>}
        </>
      )}

      <h4>Rule result</h4>
      <p className={`cp-rule-line ${block.rule.colour}`}><strong>{COLOUR_TEXT[block.rule.colour]}:</strong> {block.rule.ruleLabel}</p>
      <p>{block.rule.explanation}</p>
      {block.rule.escalation && <p className="cp-small">{block.rule.escalation}</p>}
      <p className="cp-small">
        {block.rule.policyHref ? <Link href={block.rule.policyHref}>{block.rule.policyLabel}</Link> : block.rule.policyLabel} · {block.rule.checkedAt}
      </p>

      {block.issues.length > 0 && (
        <ul className="cp-issues">{block.issues.map((x, i) => <li key={i} className={x.tone}>{x.text}</li>)}</ul>
      )}

      <details className="cp-more">
        <summary>Facts: from records, supplied and missing</summary>
        <h5>From records</h5>
        <ul>{block.sources.retrieved.length ? block.sources.retrieved.map((x, i) => <li key={i}>{x}</li>) : <li>None.</li>}</ul>
        <h5>Supplied by staff</h5>
        <ul>{block.sources.supplied.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <h5>Still missing</h5>
        <ul>{block.sources.missing.length ? block.sources.missing.map((x, i) => <li key={i}>{x}</li>) : <li>Nothing.</li>}</ul>
      </details>
      {block.procedures.length > 0 && (
        <details className="cp-more">
          <summary>Approved procedures</summary>
          <ul>{block.procedures.map((p) => <li key={p.id}><Link href={p.href}>{p.id} {p.title}</Link> (version {p.version})</li>)}</ul>
        </details>
      )}
      {block.history.length > 0 && (
        <details className="cp-more">
          <summary>History</summary>
          <ol className="cp-history">{block.history.map((h, i) => <li key={i}><strong>{h.what}</strong> · {h.who} · {h.when}{h.note && <p>{h.note}</p>}</li>)}</ol>
        </details>
      )}

      <div className={`cp-ready ${block.readiness.ready ? "yes" : "no"}`}>
        {block.readiness.ready ? (
          <p><strong>Ready for a decision.</strong> The evidence is complete. Compass doesn&apos;t recommend an outcome.</p>
        ) : (
          <>
            <p><strong>Not ready for a clean decision.</strong></p>
            <ul>{block.readiness.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
      </div>
      {block.roleNote && <p className="cp-notice info">{block.roleNote}</p>}

      {!state.p && state.composing && (() => {
        const a = block.actions.find((x) => x.action === state.composing)!;
        const id = `compose-${r.id}`;
        return (
          <div className="cp-draft">
            <label htmlFor={id}>{a.action === "request.record_outcome" ? "What was done? For example, refund paid in the payment system on 20 October." : `Note for ${a.label}`}</label>
            <textarea id={id} rows={3} value={state.text ?? ""} onChange={(e) => onState({ ...state, text: e.target.value })} autoFocus />
            <div className="cp-row">
              <button type="button" className="cp-btn" disabled={!(state.text ?? "").trim() || Boolean(state.preparing)} onClick={() => void runAction(a, state.text ?? "")}>{state.preparing ? "Preparing…" : "Preview"}</button>
              <button type="button" className="cp-btn secondary" onClick={() => onState({ ...state, composing: undefined })}>Back</button>
            </div>
          </div>
        );
      })()}
      {!state.p && !state.composing && (
        <div className="cp-row" role="group" aria-label="Next actions">
          {block.actions.map((a, i) => a.href
            ? <Link key={i} className={`cp-btn${a.primary ? "" : " secondary"}`} href={a.href}>{a.label}</Link>
            : (
              <button key={i} type="button" className={`cp-btn${a.primary ? "" : " secondary"}`} disabled={disabled || Boolean(state.preparing)} onClick={() => void runAction(a)}>
                {a.action && state.preparing === a.action ? "Preparing…" : a.label}
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
  const save = async () => {
    onState({ ...state, preparing: "draft.save", error: undefined });
    try {
      const proposal = await prepare({ sessionKey, action: "draft.save", requestId: block.requestId, kind: block.draftKind, body: text, generatedBy: text === block.body ? block.generatedBy : "edited" });
      onState({ ...state, preparing: undefined, p: { stage: "pending", proposal } });
      onAnnounce("Prepared to save the draft. Check it, then confirm.");
    } catch (e) {
      onState({ ...state, preparing: undefined, error: e instanceof Error ? e.message : "Couldn't prepare that." });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onAnnounce("Copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onState({ ...state, error: "Copying isn't allowed here. Select the text and copy it instead." });
    }
  };
  const id = `draft-${block.requestId}-${block.draftKind}`;
  return (
    <section className="cp-draftcard" aria-label={block.title}>
      <h3>{block.title}</h3>
      <p className="cp-small">{block.reference} · {block.note}{block.generatedBy === "live_ai" && <span className="cp-tag ai">AI wording</span>}</p>
      {block.restricted ? (
        <p className="cp-notice warning">{block.body}</p>
      ) : (
        <>
          <label htmlFor={id} className="sr-only">{block.title}</label>
          <textarea id={id} rows={9} value={text} disabled={Boolean(state.p)} onChange={(e) => onState({ ...state, text: e.target.value })} />
        </>
      )}
      {block.staffChecks.length > 0 && (
        <>
          <h4>For staff to check (not in the message)</h4>
          <ul>{block.staffChecks.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {!block.restricted && !state.p && (
        <div className="cp-row">
          <button type="button" className="cp-btn secondary" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
          <button type="button" className="cp-btn" onClick={() => void save()} disabled={Boolean(state.preparing) || !text.trim()}>{state.preparing ? "Preparing…" : "Save Draft"}</button>
          <button type="button" className="cp-btn secondary" onClick={() => onCommand({ type: "review", requestId: block.requestId }, "Review Request")}>Review Request</button>
        </div>
      )}
      <p className="cp-small">Tutor Compass never sends emails or texts. Copy the message into your email when you&apos;re ready.</p>
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
    <div className="cp-chips" role="group" aria-label={block.label}>
      {block.options.map((o, i) => (
        <button key={i} type="button" className="cp-chip" disabled={disabled} onClick={() => onCommand(o.command, o.label)}>{o.label}</button>
      ))}
    </div>
  );
}

export function ChecklistCard({ block }: { block: Extract<Block, { kind: "checklist" }> }) {
  const mark = { have: "✓", missing: "!", check: "○" } as const;
  const word = { have: "Have", missing: "Missing", check: "To check" } as const;
  return (
    <section className="cp-found" aria-label={block.title}>
      <h3>{block.title}</h3>
      <ul className="cp-checklist">
        {block.items.map((it, i) => (
          <li key={i} className={it.state}>
            <span aria-hidden="true">{mark[it.state]}</span> <span className="sr-only">{word[it.state]}: </span>{it.label}{it.detail && <span className="cp-small"> ({it.detail})</span>}
          </li>
        ))}
      </ul>
      {block.notes.length > 0 && <ul className="cp-warnings">{block.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {block.refs.length > 0 && <p className="cp-small">Sources: {block.refs.join("; ")}</p>}
      {block.link && <Link href={block.link.href}>{block.link.label}</Link>}
    </section>
  );
}

export function RulesCard({ block }: { block: RulesBlock }) {
  return (
    <section className="cp-found" aria-label="Current rules">
      {block.sections.map((s, i) => (
        <div key={i} className="cp-section">
          <h3>{s.title} <span className="cp-small">({s.policyLabel})</span></h3>
          <table className="cp-changes">
            <caption className="sr-only">{s.title}</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Result</th><th scope="col">Who</th></tr></thead>
            <tbody>
              {s.rules.map((r, j) => (
                <tr key={j}><td>{r.when}</td><td><span className={`cp-dot-c ${r.colour}`} aria-hidden="true" /> {COLOUR_TEXT[r.colour]}</td><td>{r.who}</td></tr>
              ))}
            </tbody>
          </table>
          {s.notes.length > 0 && <ul className="cp-warnings">{s.notes.map((n, j) => <li key={j}>{n}</li>)}</ul>}
          <Link href={s.href}>View policy</Link>
        </div>
      ))}
      <h4>Always</h4>
      <ul>{block.systemRules.map((r, i) => <li key={i}>{r}</li>)}</ul>
    </section>
  );
}
