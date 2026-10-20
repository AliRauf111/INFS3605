"use client";
import { useState } from "react";
import Link from "next/link";
import type { Block, Choice, Command, Step, TaskField } from "@/lib/assistant/logic";
import { BriefingCard, ChecklistCard, DraftCard, OptionsRow, ProposalCard, ReviewCard, RulesCard, prepare, type CardState } from "./AgentCards";
import { CompassAvatar } from "./CompassAvatar";

// What a conversation looks like on screen: bubbles, the steps Compass actually ran,
// what it found and the decision cards. Cards keep their own progress in `action` so
// it survives minimising the panel.

export type ActionState = {
  stage: "idle" | "preparing" | "error";
  key: string;
  card?: CardState;
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

function DecisionCard({ block, action, onAction, sessionKey, onCommand, onAnnounce }: {
  block: Extract<Block, { kind: "decision" }>;
  action: ActionState;
  onAction: (next: ActionState) => void;
  sessionKey: string;
  onCommand: (c: Command, label: string) => void;
  onAnnounce: (t: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const card = action.card ?? {};

  // Saving goes through the same server-side approval as every other Compass change:
  // prepare a proposal, show exactly what will be saved, then confirm.
  const start = async () => {
    onAction({ ...action, stage: "preparing", error: undefined });
    try {
      const proposal = await prepare({ sessionKey, action: "request.create", facts: block.facts });
      onAction({ ...action, stage: "idle", error: undefined, card: { p: { stage: "pending", proposal } } });
      onAnnounce("Prepared. Check what will be saved, then confirm.");
    } catch (e) {
      onAction({ ...action, stage: "error", error: e instanceof Error ? e.message : "Couldn't prepare that. Nothing was saved." });
    }
  };

  const done = card.p?.stage === "done" ? card.p.result : undefined;
  const doneMessage = block.requestType === "refund"
    ? "You can now process the refund in your payment system. Tutor Compass never moves money."
    : block.requestType === "lesson_change"
      ? "You can now update the booking in your booking system. Tutor Compass doesn't change bookings."
      : "You can now follow the next steps under this rule.";

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
      {block.findings && block.findings.length > 0 && <ul className="cp-warnings">{block.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>}
      <button type="button" className="cp-link" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
        {showDetails ? "Hide details" : "View details"}
      </button>
      {showDetails && (
        <div className="cp-details">
          {block.sources && (
            <>
              <strong>From records</strong>
              <ul>{block.sources.retrieved.length ? block.sources.retrieved.map((x, i) => <li key={i}>{x}</li>) : <li>None.</li>}</ul>
              <strong>Supplied by you</strong>
              <ul>{block.sources.supplied.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <strong>Still missing</strong>
              <ul>{block.sources.missing.length ? block.sources.missing.map((x, i) => <li key={i}>{x}</li>) : <li>Nothing.</li>}</ul>
            </>
          )}
          {block.nextSteps.length > 0 && (
            <>
              <strong>Next steps under this rule</strong>
              <ol>{block.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </>
          )}
          {block.policy && <Link href={block.policy.href}>{block.policy.label}</Link>}
        </div>
      )}

      {!card.p && (
        <button type="button" className="cp-btn" onClick={() => void start()} disabled={action.stage === "preparing"}>
          {action.stage === "preparing" ? "Preparing…" : block.actionLabel}
        </button>
      )}
      {action.error && <p className="cp-error" role="alert">{action.error}</p>}
      {card.p && (
        <ProposalCard
          state={card.p}
          intro="Saving creates a request in Tutor Compass with this rule result. It doesn't refund money, change a booking or send a message."
          onState={(p) => onAction({ ...action, card: { ...card, p: p.stage === "closed" ? undefined : p }, error: p.stage === "closed" ? p.message : undefined })}
          onAnnounce={onAnnounce}
          onCommand={onCommand}
        />
      )}
      {done?.status === "ready" && <p className="cp-small">{doneMessage}</p>}
      {done?.requestId && done.status !== "ready" && done.status !== "closed" && (
        <div className="cp-row">
          <button type="button" className="cp-btn secondary" onClick={() => onCommand({ type: "followup", requestId: done.requestId! }, "Prepare Follow-up")}>Prepare Follow-up</button>
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

export function AssistantMessage({ item, last, busy, sessionKey, onPick, onAction, onCommand, onAnnounce, onRetry }: {
  item: ChatItem;
  last: boolean;
  busy: boolean;
  sessionKey: string;
  onPick: (field: TaskField, c: Choice) => void;
  onAction: (itemId: string, index: number, next: ActionState) => void;
  onCommand: (c: Command, label: string) => void;
  onAnnounce: (t: string) => void;
  onRetry: () => void;
}) {
  const actionFor = (i: number): ActionState => item.actions?.[i] ?? { stage: "idle", key: "" };
  const cardProps = (i: number) => ({
    sessionKey,
    disabled: busy,
    state: actionFor(i).card ?? {},
    onState: (card: CardState) => onAction(item.id, i, { ...actionFor(i), card }),
    onCommand,
    onAnnounce,
  });
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
            case "options":
              return <OptionsRow key={i} block={b} disabled={busy} onCommand={onCommand} />;
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
            case "decision":
              return <DecisionCard key={i} block={b} action={actionFor(i)} onAction={(next) => onAction(item.id, i, next)} sessionKey={sessionKey} onCommand={onCommand} onAnnounce={onAnnounce} />;
            case "briefing":
              return <BriefingCard key={i} block={b} disabled={busy} onCommand={onCommand} />;
            case "review":
              return <ReviewCard key={i} block={b} {...cardProps(i)} />;
            case "draft":
              return <DraftCard key={i} block={b} {...cardProps(i)} />;
            case "proposal": {
              const st = actionFor(i).card?.p ?? { stage: "pending" as const, proposal: b.proposal };
              return (
                <ProposalCard
                  key={i}
                  state={st}
                  intro={b.intro}
                  onState={(p) => onAction(item.id, i, { ...actionFor(i), card: { p } })}
                  onAnnounce={onAnnounce}
                  onCommand={onCommand}
                />
              );
            }
            case "checklist":
              return <ChecklistCard key={i} block={b} />;
            case "rules":
              return <RulesCard key={i} block={b} />;
          }
        })}
      </div>
    </div>
  );
}
