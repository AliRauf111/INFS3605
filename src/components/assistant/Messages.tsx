"use client";
import { useState } from "react";
import Link from "next/link";
import type { Block, Choice, Command, Step, TaskField } from "@/lib/assistant/logic";
import { AttentionCard, BriefingCard, ChecklistCard, DraftCard, OptionsRow, ProposalCard, ResultCard, ReviewCard, RulesCard, SimulatedCard, prepare, type CardState } from "./AgentCards";
import { CompassAvatar } from "./CompassAvatar";
import { useI18n } from "@/components/i18n/I18nProvider";

// Compass writes its replies in English, whatever language the page is in. Text from the
// server is marked as English so screen readers pronounce it correctly.
/** Server text: the message carries the language it was written in, so only the direction is set here. */
export const EN = { dir: "auto" } as const;

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
  /** The language Compass wrote this reply in, as a lang attribute value. */
  lang?: string;
  error?: boolean;
  actions?: Record<number, ActionState>;
};

const ICON: Record<string, string> = { green: "✓", amber: "!", red: "■" };

export function Steps({ steps }: { steps: Step[] }) {
  const { t } = useI18n();
  if (!steps.length) return null;
  return (
    <ul className="cp-steps" aria-label={t("compass.msg.checked")}>
      {steps.map((s, i) => (
        <li key={i} className={`cp-step ${s.state}`}>
          <span aria-hidden="true">{s.state === "done" ? "✓" : s.state === "blocked" ? "!" : "×"}</span>
          <span {...EN}>{s.label}</span>
          <span className="sr-only">{s.state === "done" ? t("compass.msg.stepDone") : s.state === "blocked" ? t("compass.msg.stepBlocked") : t("compass.msg.stepFailed")}</span>
        </li>
      ))}
    </ul>
  );
}

function ChoiceRow({ field, options, disabled, onPick }: { field: TaskField; options: Choice[]; disabled: boolean; onPick: (field: TaskField, c: Choice) => void }) {
  const { t } = useI18n();
  return (
    <div className="cp-chips" role="group" aria-label={t("compass.msg.quickAnswers")}>
      {options.map((o) => (
        <button key={o.value} type="button" className="cp-chip" {...EN} disabled={disabled} onClick={() => onPick(field, o)}>{o.label}</button>
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
  const { t } = useI18n();
  const card = action.card ?? {};

  // Saving goes through the same server-side approval as every other Compass change:
  // prepare a proposal, show exactly what will be saved, then confirm.
  const start = async () => {
    onAction({ ...action, stage: "preparing", error: undefined });
    try {
      const proposal = await prepare({ sessionKey, action: "request.create", facts: block.facts }, t);
      onAction({ ...action, stage: "idle", error: undefined, card: { p: { stage: "pending", proposal } } });
      onAnnounce(t("compass.msg.preparedCheck"));
    } catch (e) {
      onAction({ ...action, stage: "error", error: e instanceof Error ? e.message : t("compass.msg.couldntPrepareNothing") });
    }
  };

  const done = card.p?.stage === "done" ? card.p.result : undefined;
  const doneMessage = block.requestType === "refund"
    ? t("compass.msg.doneRefund")
    : block.requestType === "lesson_change"
      ? t("compass.msg.doneLesson")
      : t("compass.msg.doneOther");

  return (
    <section className={`cp-decision ${block.colour}`} aria-label={t("compass.msg.decision", { title: block.title })}>
      <div className="cp-decision-head">
        <span className="cp-decision-icon" aria-hidden="true">{ICON[block.colour]}</span>
        <div {...EN}>
          <h3>{block.title}</h3>
          <p className="cp-rule">{block.ruleLabel}</p>
        </div>
      </div>
      <p {...EN}>{block.explanation}</p>
      {block.missing.length > 0 && (
        <ul className="cp-missing" {...EN}>{block.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
      )}
      {block.findings && block.findings.length > 0 && <ul className="cp-warnings" {...EN}>{block.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>}
      <button type="button" className="cp-link" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
        {showDetails ? t("compass.msg.hideDetails") : t("compass.msg.viewDetails")}
      </button>
      {showDetails && (
        <div className="cp-details">
          {block.sources && (
            <>
              <strong>{t("compass.msg.fromRecords")}</strong>
              <ul>{block.sources.retrieved.length ? block.sources.retrieved.map((x, i) => <li key={i} {...EN}>{x}</li>) : <li>{t("compass.msg.noneDot")}</li>}</ul>
              <strong>{t("compass.msg.suppliedByYou")}</strong>
              <ul {...EN}>{block.sources.supplied.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <strong>{t("compass.msg.stillMissing")}</strong>
              <ul>{block.sources.missing.length ? block.sources.missing.map((x, i) => <li key={i} {...EN}>{x}</li>) : <li>{t("compass.msg.nothingDot")}</li>}</ul>
            </>
          )}
          {block.nextSteps.length > 0 && (
            <>
              <strong>{t("compass.msg.nextSteps")}</strong>
              <ol {...EN}>{block.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </>
          )}
          {block.policy && <Link href={block.policy.href} {...EN}>{block.policy.label}</Link>}
        </div>
      )}

      {!card.p && (
        <button type="button" className="cp-btn" onClick={() => void start()} disabled={action.stage === "preparing"}>
          {action.stage === "preparing" ? t("compass.msg.preparing") : <span {...EN}>{block.actionLabel}</span>}
        </button>
      )}
      {action.error && <p className="cp-error" role="alert">{action.error}</p>}
      {card.p && (
        <ProposalCard
          state={card.p}
          intro={t("compass.msg.saveIntro")}
          introTranslated
          onState={(p) => onAction({ ...action, card: { ...card, p: p.stage === "closed" ? undefined : p }, error: p.stage === "closed" ? p.message : undefined })}
          onAnnounce={onAnnounce}
          onCommand={onCommand}
        />
      )}
      {done?.status === "ready" && <p className="cp-small">{doneMessage}</p>}
      {done?.requestId && done.status !== "ready" && done.status !== "closed" && (
        <div className="cp-row">
          <button type="button" className="cp-btn secondary" onClick={() => onCommand({ type: "followup", requestId: done.requestId! }, t("compass.msg.prepareFollowUp"))}>{t("compass.msg.prepareFollowUp")}</button>
        </div>
      )}
    </section>
  );
}

function PolicyBlock({ block }: { block: Extract<Block, { kind: "policy" }> }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return (
    <section className="cp-policy" aria-label={block.title}>
      <h3><span {...EN}>{block.title}</span> {block.approved && <span className="cp-tag">{t("compass.msg.ownerApproved")}</span>}</h3>
      <p {...EN}>{block.answer}</p>
      {block.details !== block.answer && (
        <>
          <button type="button" className="cp-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? t("compass.msg.hideDetails") : t("compass.msg.viewDetails")}</button>
          {open && <p className="cp-details" {...EN}>{block.details}</p>}
        </>
      )}
      <Link href={block.link.href} {...EN}>{block.link.label}</Link>
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
  const { t } = useI18n();
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
    <div className="cp-msg assistant" lang={item.lang}>
      <CompassAvatar size={28} className="cp-msg-avatar" />
      <div className="cp-msg-body">
        {item.steps && <Steps steps={item.steps} />}
        {item.text && <div className={`cp-bubble ${item.error ? "error" : ""}`} dir="auto">{item.text}</div>}
        {item.error && last && <button type="button" className="cp-link" onClick={onRetry}>{t("compass.msg.tryAgain")}</button>}
        {item.blocks?.map((b, i) => {
          switch (b.kind) {
            case "text":
              return <div key={i} className="cp-bubble" {...EN}>{b.text}</div>;
            case "notice":
              return <div key={i} className={`cp-notice ${b.tone}`} {...EN}>{b.text}</div>;
            case "choices":
              return <ChoiceRow key={i} field={b.field} options={b.options} disabled={!last || busy} onPick={onPick} />;
            case "options":
              return <OptionsRow key={i} block={b} disabled={busy} onCommand={onCommand} />;
            case "found":
              return (
                <section key={i} className="cp-found" aria-label={t("compass.msg.whatIFound")}>
                  <h3>{t("compass.msg.whatIFound")}</h3>
                  <ul {...EN}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>
                  {b.links.map((l) => <Link key={l.href} href={l.href} {...EN}>{l.label}</Link>)}
                  {b.note && <p className="cp-small" {...EN}>{b.note}</p>}
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
                  next={b.next}
                  disabled={busy}
                  onState={(p) => onAction(item.id, i, { ...actionFor(i), card: { p } })}
                  onAnnounce={onAnnounce}
                  onCommand={onCommand}
                />
              );
            }
            case "checklist":
              return <ChecklistCard key={i} block={b} />;
            case "attention":
              return <AttentionCard key={i} block={b} disabled={busy} onCommand={onCommand} />;
            case "result":
              return <ResultCard key={i} block={b} />;
            case "simulated":
              return <SimulatedCard key={i} block={b} onAnnounce={onAnnounce} />;
            case "rules":
              return <RulesCard key={i} block={b} />;
          }
        })}
      </div>
    </div>
  );
}
