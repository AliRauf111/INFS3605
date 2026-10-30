"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wizard, type NeededFacts, type WizardState } from "@/components/Wizard";
import type { Workflow } from "@/lib/workflow/next-step";
import { centsToInput } from "@/lib/domain/money";
import type { Colour, RequestStatus, Role } from "@/lib/domain/types";
import type { ConfirmedFacts } from "@/lib/validation/facts";
import { A11yTrigger } from "@/components/a11y/A11yPanel";
import { useI18n } from "@/components/i18n/I18nProvider";

function toWizard(f: ConfirmedFacts): Partial<WizardState> {
  return {
    requestType: f.requestType,
    moneyInvolved: f.moneyInvolved ?? "",
    amount: centsToInput(f.amountCents),
    complaint: f.complaint ?? "",
    welfare: f.welfare ?? "",
    referenceId: f.referenceId ?? f.bookingId ?? "",
    bookingId: f.bookingId ?? "",
    financialImpact: f.financialImpact ?? "",
    proposedSlotId: f.proposedSlotId ?? "",
    extensionDays: f.extensionDays ? String(f.extensionDays) : "",
    context: f.context,
  };
}

export function RequestActions(props: {
  requestId: string;
  status: RequestStatus;
  role: Role;
  colour: Colour;
  currentDecisionId: string | null;
  facts: ConfirmedFacts;
  escalationDraft: string;
  /** What this person can do next, from the shared next-step rules. */
  workflow: Workflow;
  /** Required details the latest rule check says are missing. */
  needed: NeededFacts;
  /** Who started the owner review and when, in words. */
  reviewStartedText: string | null;
  /** Open the details form straight away (a link from Compass). */
  openDetails?: boolean;
  /** The page title. The action buttons sit beside it, and their forms open underneath. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const wf = props.workflow;
  type Panel = "none" | "facts" | "send" | "owner" | "close";
  const [panel, setPanel] = useState<Panel>(props.openDetails && wf.can.completeDetails ? "facts" : "none");
  const [note, setNote] = useState("");
  const [handling, setHandling] = useState("");
  const [ownerAction, setOwnerAction] = useState<"approve" | "decline" | "request_info" | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Status the last successful action moved away from. Stops a second click before the refresh lands.
  const [sentFrom, setSentFrom] = useState<string | null>(null);

  // A new rule check or status means the open form is out of date: close it.
  const [seen, setSeen] = useState(`${props.currentDecisionId}|${props.status}`);
  const key = `${props.currentDecisionId}|${props.status}`;
  if (key !== seen) {
    setSeen(key);
    setSentFrom(null);
    if (panel === "facts" || panel === "send" || panel === "close") setPanel("none");
  }

  async function post(path: string, body: unknown, ok: string, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${props.requestId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? t("actions.didNotWork", { status: res.status }));
      setDone(ok);
      after?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actions.unreachable"));
    } finally {
      setBusy(false);
    }
  }

  const transition = (action: string, text: string, ok = t("actions.saved")) =>
    post("transition", { action, note: text }, ok, () => {
      setSentFrom(props.status);
      setPanel("none");
      setNote("");
      setConfirmed(false);
    });

  const startReview = () =>
    post("review", {}, t("actions.reviewStarted"), () => {
      setPanel("owner");
    });

  const open = (p: Panel, preset = "") => {
    setPanel(panel === p ? "none" : p);
    setNote(preset);
    setError(null);
    setDone(null);
    setConfirmed(false);
  };

  const locked = busy || sentFrom === props.status;
  const primary = wf.primary;
  const onPrimary = () => {
    if (!primary || primary.disabled || locked) return;
    if (primary.kind === "complete_details") open("facts");
    else if (primary.kind === "send_to_owner") open("send", props.escalationDraft);
    else if (primary.kind === "start_review") void startReview();
    else if (primary.kind === "continue_review") open("owner");
    else if (primary.kind === "record_outcome") open("close");
  };
  const primaryPanel: Panel | null =
    primary?.kind === "complete_details" ? "facts" : primary?.kind === "send_to_owner" ? "send" : primary?.kind === "continue_review" ? "owner" : primary?.kind === "record_outcome" ? "close" : null;
  const showUpdateFacts = wf.can.completeDetails && primary?.kind !== "complete_details" && props.currentDecisionId;
  const showSecondaryReview = wf.can.startReview && primary?.kind === "complete_details";
  const sensitive = props.colour === "red" || wf.can.handlingNote;

  return (
    <div className="stack">
      <div className="rq-head">
        <div className="rq-title">{props.children}</div>
        <div className="rq-actions">
          {showUpdateFacts && <button className="btn secondary" type="button" aria-expanded={panel === "facts"} onClick={() => open("facts")}>{t("actions.updateFacts")}</button>}
          {showSecondaryReview && (
            <button className="btn secondary" type="button" disabled={locked} aria-expanded={panel === "owner"} onClick={() => (wf.reviewStarted ? open("owner") : void startReview())}>
              {wf.reviewStarted ? t("workflow.primary.continue_review") : t("workflow.primary.start_review")}
            </button>
          )}
          {primary && (
            <button
              className="btn"
              type="button"
              disabled={primary.disabled || locked}
              aria-expanded={primaryPanel ? panel === primaryPanel : undefined}
              onClick={onPrimary}
            >
              {busy && primary.kind === "start_review" ? t("actions.starting") : primary.label}
              {primary.kind === "send_to_owner" && <span aria-hidden="true" className="dir-arrow"> →</span>}
            </button>
          )}
          <A11yTrigger />
        </div>
      </div>
      {done && <p className="notice success" role="status">{done}</p>}
      {error && panel === "none" && <p className="notice error" role="alert">{error}</p>}

      {panel === "facts" && props.currentDecisionId && (
        <Wizard
          mode={{ kind: "reevaluate", requestId: props.requestId, expectedDecisionId: props.currentDecisionId }}
          initial={toWizard(props.facts)}
          lockType
          needed={props.needed}
        />
      )}

      {panel === "send" && wf.can.sendToOwner && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); if (!locked) transition("send_to_owner", note, t("actions.sentToOwner")); }}>
          <div className="field">
            <label htmlFor="summary">{t("actions.summaryLabel")}</label>
            <p className="hint">{t("actions.summaryHint")}</p>
            <textarea id="summary" required value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {t("actions.summaryConfirm")}
          </label>
          {error && <p className="notice error" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={locked || !confirmed || !note.trim()}>{busy ? t("actions.sending") : t("actions.createOwnerReview")}</button>
        </form>
      )}

      {panel === "owner" && wf.can.startReview && (
        <div className="stack">
          <form className="card" onSubmit={(e) => { e.preventDefault(); if (ownerAction && !locked) transition(ownerAction, note, t("actions.decisionSaved")); }}>
            {props.reviewStartedText && <p className="hint">{props.reviewStartedText}</p>}
            {wf.missingDetails && <p className="notice warning">{t("actions.missingWarning")}</p>}
            <fieldset>
              <legend>{t("actions.decisionLegend")}</legend>
              <div className="choices">
                {([["approve", t("actions.approve"), wf.can.approve], ["decline", t("actions.decline"), wf.can.decline], ["request_info", t("actions.askInfo"), wf.can.requestInfo]] as const).map(([v, l, allowed]) => (
                  <label className="choice" key={v}>
                    <input type="radio" name="ownerAction" checked={ownerAction === v} disabled={!allowed} onChange={() => setOwnerAction(v)} />{l}
                  </label>
                ))}
              </div>
              {wf.approveBlocked && <p className="hint">{wf.approveBlocked}</p>}
            </fieldset>
            <div className="field">
              <label htmlFor="reason">{ownerAction === "request_info" ? t("actions.whatNeedToKnow") : t("actions.reasonRequired")}</label>
              <p className="hint">{props.colour !== "green" && ownerAction === "approve" ? `${t("actions.exceptionHint")} ` : ""}{t("actions.reasonHint")}</p>
              <textarea id="reason" required value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error && <p className="notice error" role="alert">{error}</p>}
            <button className="btn" type="submit" disabled={locked || !ownerAction || !note.trim()}>{busy ? t("common.saving") : t("actions.saveDecision")}</button>
          </form>

          {wf.can.handlingNote && sensitive && (
            <form className="card" onSubmit={(e) => { e.preventDefault(); if (!busy && handling.trim()) void post("handling", { note: handling }, t("actions.handlingSaved"), () => setHandling("")); }}>
              <div className="field">
                <label htmlFor="handling">{t("actions.handlingLabel")}</label>
                <p className="hint">{t("actions.handlingHint")}</p>
                <textarea id="handling" required value={handling} maxLength={4000} onChange={(e) => setHandling(e.target.value)} />
              </div>
              <button className="btn secondary" type="submit" disabled={busy || !handling.trim()}>{busy ? t("common.saving") : t("actions.saveHandling")}</button>
            </form>
          )}
        </div>
      )}

      {panel === "close" && wf.can.recordOutcome && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); if (!locked) transition("record_and_close", `Admin recorded: ${note}`, t("actions.recordedClosed")); }}>
          <div className="field">
            <label htmlFor="did">{t("actions.whatDidYouDo")}</label>
            <p className="hint">{t("actions.whatDidYouDoHint")}</p>
            <textarea id="did" required value={note} maxLength={3900} onChange={(e) => setNote(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {t("actions.completedOutside")}
          </label>
          {error && <p className="notice error" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={locked || !confirmed || !note.trim()}>{busy ? t("common.saving") : t("actions.recordAndClose")}</button>
        </form>
      )}
    </div>
  );
}
