"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Block, Choice, Step, TaskField } from "@/lib/assistant/logic";
import { STATUS_LABELS, type RequestStatus } from "@/lib/domain/types";
import { CompassAvatar } from "./CompassAvatar";

// What a conversation looks like on screen: bubbles, the steps Compass actually ran,
// what it found and the decision cards. Cards keep their own progress in `action` so
// it survives minimising the panel.

export type ActionState = {
  stage: "idle" | "preview" | "saving" | "saved" | "note" | "submitting" | "submitted" | "drafting" | "error";
  key: string;
  requestId?: string;
  savedColour?: string;
  status?: RequestStatus;
  note?: string;
  draft?: string;
  error?: string;
};

export type ChatItem = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  blocks?: Block[];
  steps?: Step[];
  modeNote?: string;
  error?: boolean;
  actions?: Record<number, ActionState>;
};

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Something went wrong (${res.status}).`);
  return json;
}

const ICON: Record<string, string> = { green: "✓", amber: "!", red: "■" };

export function Steps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <ul className="cp-steps" aria-label="What Compass checked">
      {steps.map((s, i) => (
        <li key={i} className={`cp-step ${s.state}`}>
          <span aria-hidden="true">{s.state === "done" ? "✓" : s.state === "blocked" ? "!" : "×"}</span>
          {s.label}
          <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "blocked" ? " (needs attention)" : " (failed)"}</span>
        </li>
      ))}
    </ul>
  );
}

function ChoiceRow({ field, options, disabled, onPick }: { field: TaskField; options: Choice[]; disabled: boolean; onPick: (field: TaskField, c: Choice) => void }) {
  return (
    <div className="cp-chips" role="group" aria-label="Quick answers">
      {options.map((o) => (
        <button key={o.value} type="button" className="cp-chip" disabled={disabled} onClick={() => onPick(field, o)}>{o.label}</button>
      ))}
    </div>
  );
}

function DecisionCard({ block, action, onAction }: {
  block: Extract<Block, { kind: "decision" }>;
  action: ActionState;
  onAction: (next: ActionState) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  // Bring the confirm button into view when the preview opens.
  useEffect(() => {
    if (action.stage === "preview") previewRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [action.stage]);
  const set = (patch: Partial<ActionState>) => onAction({ ...action, ...patch });

  const save = async () => {
    set({ stage: "saving", error: undefined });
    try {
      const r = await postJson("/api/requests", { idempotencyKey: action.key, intakeMethod: "ai_intake", facts: block.facts });
      onAction({ ...action, stage: "saved", requestId: r.id, savedColour: r.colour, status: r.status, error: undefined });
    } catch (e) {
      onAction({ ...action, stage: "error", error: e instanceof Error ? e.message : "Saving failed." });
    }
  };
  const submit = async () => {
    set({ stage: "submitting", error: undefined });
    try {
      const r = await postJson(`/api/requests/${action.requestId}/transition`, { action: "send_to_owner", note: action.note ?? "" });
      onAction({ ...action, stage: "submitted", status: r.status, error: undefined });
    } catch (e) {
      onAction({ ...action, stage: "note", error: e instanceof Error ? e.message : "That didn't go through." });
    }
  };
  const draft = async () => {
    const before = action.stage;
    set({ stage: "drafting", error: undefined });
    try {
      const r = await postJson(`/api/requests/${action.requestId}/drafts`, { kind: "parent_response", useAi: true });
      onAction({ ...action, stage: before === "drafting" ? "saved" : before, draft: r.body, error: undefined });
    } catch (e) {
      onAction({ ...action, stage: before, error: e instanceof Error ? e.message : "The draft couldn't be prepared." });
    }
  };

  const saved = action.requestId && ["saved", "note", "submitting", "submitted", "drafting"].includes(action.stage);
  const canSubmit = action.status === "review_required" || action.status === "needs_clarification";
  const doneMessage = block.requestType === "refund"
    ? "You can now process the refund in your payment system. Tutor Compass never moves money."
    : block.requestType === "lesson_change"
      ? "You can now update the booking in your booking system. Tutor Compass doesn't change bookings."
      : "You can now follow the next steps below.";

  return (
    <section className={`cp-decision ${block.colour}`} aria-label={`Decision: ${block.title}`}>
      <div className="cp-decision-head">
        <span className="cp-decision-icon" aria-hidden="true">{ICON[block.colour]}</span>
        <div>
          <h3>{block.title}</h3>
          <p className="cp-rule">{block.ruleLabel}</p>
        </div>
      </div>
      <p>{block.explanation}</p>
      {block.missing.length > 0 && (
        <ul className="cp-missing">{block.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
      )}
      {block.nextSteps.length > 0 && (
        <>
          <button type="button" className="cp-link" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? "Hide details" : "View details"}
          </button>
          {showDetails && (
            <div className="cp-details">
              <strong>Next steps under this rule</strong>
              <ol>{block.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              {block.policy && <Link href={block.policy.href}>{block.policy.label}</Link>}
            </div>
          )}
        </>
      )}

      {action.stage === "idle" && <button type="button" className="cp-btn" onClick={() => set({ stage: "preview", key: action.key || crypto.randomUUID() })}>{block.actionLabel}</button>}

      {(action.stage === "preview" || action.stage === "saving" || (action.stage === "error" && !action.requestId)) && (
        <div ref={previewRef} className="cp-preview" role="group" aria-label="Preview before saving">
          <p className="cp-status"><strong>Draft prepared.</strong> Awaiting your confirmation.</p>
          <ul>{block.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <p className="cp-small">Saving creates a request in Tutor Compass with this decision. It doesn&apos;t refund money, change a booking or send a message.</p>
          {action.error && <p className="cp-error" role="alert">{action.error}</p>}
          <div className="cp-row">
            <button type="button" className="cp-btn" onClick={save} disabled={action.stage === "saving"}>{action.stage === "saving" ? "Saving…" : "Confirm and save"}</button>
            <button type="button" className="cp-btn secondary" onClick={() => set({ stage: "idle", error: undefined })} disabled={action.stage === "saving"}>Cancel</button>
          </div>
        </div>
      )}

      {saved && (
        <div className="cp-result" role="status">
          {action.stage === "submitted"
            ? <p className="cp-status"><strong>Submitted for owner review.</strong> {action.status ? STATUS_LABELS[action.status] : ""}</p>
            : <p className="cp-status"><strong>Saved.</strong> Status: {action.status ? STATUS_LABELS[action.status] : "saved"}.</p>}
          {action.savedColour && action.savedColour !== block.colour && (
            <p className="cp-error">The records changed after the check. The saved decision is {action.savedColour}. Open the request to see why.</p>
          )}
          {action.status === "ready" && <p className="cp-small">{doneMessage}</p>}
          <div className="cp-row">
            <Link className="cp-btn secondary" href={`/requests/${action.requestId}`}>Open request</Link>
            {canSubmit && action.stage === "saved" && <button type="button" className="cp-btn" onClick={() => set({ stage: "note", note: block.summary.join(". ") + "." })}>Submit for owner review</button>}
            {!action.draft && action.stage !== "note" && action.stage !== "submitting" && (
              <button type="button" className="cp-btn secondary" onClick={draft} disabled={action.stage === "drafting"}>{action.stage === "drafting" ? "Drafting…" : "Draft parent message"}</button>
            )}
          </div>
          {(action.stage === "note" || action.stage === "submitting") && (
            <div className="cp-preview">
              <label htmlFor={`note-${action.key}`}>Note for the owner</label>
              <textarea id={`note-${action.key}`} rows={3} value={action.note ?? ""} onChange={(e) => set({ note: e.target.value })} />
              {action.error && <p className="cp-error" role="alert">{action.error}</p>}
              <div className="cp-row">
                <button type="button" className="cp-btn" onClick={submit} disabled={action.stage === "submitting" || !(action.note ?? "").trim()}>{action.stage === "submitting" ? "Submitting…" : "Confirm and submit"}</button>
                <button type="button" className="cp-btn secondary" onClick={() => set({ stage: "saved", error: undefined })}>Cancel</button>
              </div>
            </div>
          )}
          {action.draft && (
            <div className="cp-draft">
              <label htmlFor={`draft-${action.key}`}>Parent message draft (not sent)</label>
              <textarea id={`draft-${action.key}`} rows={6} readOnly value={action.draft} />
              <button type="button" className="cp-btn secondary" onClick={() => navigator.clipboard?.writeText(action.draft ?? "")}>Copy</button>
              <p className="cp-small">Tutor Compass never sends messages. Copy it into your email when you&apos;re ready.</p>
            </div>
          )}
          {action.error && action.stage === "saved" && <p className="cp-error" role="alert">{action.error}</p>}
        </div>
      )}
    </section>
  );
}

function PolicyBlock({ block }: { block: Extract<Block, { kind: "policy" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="cp-policy" aria-label={block.title}>
      <h3>{block.title} {block.approved && <span className="cp-tag">Owner approved</span>}</h3>
      <p>{block.answer}</p>
      {block.details !== block.answer && (
        <>
          <button type="button" className="cp-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide details" : "View details"}</button>
          {open && <p className="cp-details">{block.details}</p>}
        </>
      )}
      <Link href={block.link.href}>{block.link.label}</Link>
    </section>
  );
}

export function AssistantMessage({ item, last, busy, onPick, onAction, onRetry }: {
  item: ChatItem;
  last: boolean;
  busy: boolean;
  onPick: (field: TaskField, c: Choice) => void;
  onAction: (itemId: string, index: number, next: ActionState) => void;
  onRetry: () => void;
}) {
  return (
    <div className="cp-msg assistant">
      <CompassAvatar size={28} className="cp-msg-avatar" />
      <div className="cp-msg-body">
        {item.steps && <Steps steps={item.steps} />}
        {item.text && <div className={`cp-bubble ${item.error ? "error" : ""}`}>{item.text}</div>}
        {item.error && last && <button type="button" className="cp-link" onClick={onRetry}>Try again</button>}
        {item.blocks?.map((b, i) => {
          switch (b.kind) {
            case "text":
              return <div key={i} className="cp-bubble">{b.text}</div>;
            case "notice":
              return <div key={i} className={`cp-notice ${b.tone}`}>{b.text}</div>;
            case "choices":
              return <ChoiceRow key={i} field={b.field} options={b.options} disabled={!last || busy} onPick={onPick} />;
            case "found":
              return (
                <section key={i} className="cp-found" aria-label="What I found">
                  <h3>What I found</h3>
                  <ul>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>
                  {b.links.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
                  {b.note && <p className="cp-small">{b.note}</p>}
                </section>
              );
            case "policy":
              return <PolicyBlock key={i} block={b} />;
            case "decision": {
              const action: ActionState = item.actions?.[i] ?? { stage: "idle", key: "" };
              return <DecisionCard key={i} block={b} action={action} onAction={(next) => onAction(item.id, i, next)} />;
            }
          }
        })}
      </div>
    </div>
  );
}
