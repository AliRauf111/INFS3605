"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wizard, type WizardState } from "@/components/Wizard";
import { centsToInput } from "@/lib/domain/money";
import type { Colour, RequestStatus, Role } from "@/lib/domain/types";
import type { ConfirmedFacts } from "@/lib/validation/facts";
import { A11yTrigger } from "@/components/a11y/A11yPanel";

const CLARIFY = ["needs_clarification", "review_required", "more_info_requested"];

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
  /** The page title. The action buttons sit beside it, and their forms open underneath. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "facts" | "send" | "owner" | "close">("none");
  const [note, setNote] = useState("");
  const [ownerAction, setOwnerAction] = useState<"approve" | "decline" | "request_info" | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function transition(action: string, text: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${props.requestId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `That did not work (${res.status}).`);
      setDone("Saved.");
      setPanel("none");
      setNote("");
      setConfirmed(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the server. Nothing was confirmed as saved.");
    } finally {
      setBusy(false);
    }
  }

  const canClarify = CLARIFY.includes(props.status) && props.currentDecisionId;
  const canSend = CLARIFY.includes(props.status);
  const ownerCanDecide = props.role === "owner" && props.status === "awaiting_owner";
  const canClose = ["ready", "approved", "declined"].includes(props.status);

  const open = (p: typeof panel, preset = "") => {
    setPanel(panel === p ? "none" : p);
    setNote(preset);
    setError(null);
    setDone(null);
    setConfirmed(false);
  };

  return (
    <div className="stack">
      <div className="rq-head">
        <div className="rq-title">{props.children}</div>
        <div className="rq-actions">
          {canClarify && <button className="btn secondary" type="button" aria-expanded={panel === "facts"} onClick={() => open("facts")}>Update facts</button>}
          {canSend && (
            <button className="btn" type="button" aria-expanded={panel === "send"} onClick={() => open("send", props.escalationDraft)}>
              Send to Owner <span aria-hidden="true">→</span>
            </button>
          )}
          {ownerCanDecide && <button className="btn" type="button" aria-expanded={panel === "owner"} onClick={() => open("owner")}>Make a decision</button>}
          {canClose && <button className="btn" type="button" aria-expanded={panel === "close"} onClick={() => open("close")}>Record what you did</button>}
          <A11yTrigger />
        </div>
      </div>
      {done && <p className="notice success" role="status">{done}</p>}

      {panel === "facts" && props.currentDecisionId && (
        <Wizard
          mode={{ kind: "reevaluate", requestId: props.requestId, expectedDecisionId: props.currentDecisionId }}
          initial={toWizard(props.facts)}
          lockType
        />
      )}

      {panel === "send" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); transition("send_to_owner", note); }}>
          <div className="field">
            <label htmlFor="summary">Summary for the owner</label>
            <p className="hint">Prepare an escalation summary draft below to fill this in, or write your own. Stick to the facts.</p>
            <textarea id="summary" required value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I have checked this summary and want to create an owner review request.
          </label>
          {error && <p className="notice error" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy || !confirmed || !note.trim()}>{busy ? "Sending…" : "Create owner review request"}</button>
        </form>
      )}

      {panel === "owner" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); if (ownerAction) transition(ownerAction, note); }}>
          <fieldset>
            <legend>Your decision for this request only</legend>
            <div className="choices">
              {([["approve", "Approve"], ["decline", "Decline"], ["request_info", "Ask for Information"]] as const).map(([v, l]) => (
                <label className="choice" key={v}><input type="radio" name="ownerAction" checked={ownerAction === v} onChange={() => setOwnerAction(v)} />{l}</label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="reason">{ownerAction === "request_info" ? "What do you need to know?" : "Reason (required)"}</label>
            <p className="hint">{props.colour !== "green" && ownerAction === "approve" ? "Approving this is an exception to the rule, so explain why. " : ""}The reason is shown to the admin and kept in the history. It does not change the general policy.</p>
            <textarea id="reason" required value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="notice error" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy || !ownerAction || !note.trim()}>{busy ? "Saving…" : "Save decision"}</button>
        </form>
      )}

      {panel === "close" && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); transition("record_and_close", `Admin recorded: ${note}`); }}>
          <div className="field">
            <label htmlFor="did">What did you do?</label>
            <p className="hint">For example: &ldquo;Processed the $30 refund in the payment system and emailed the parent.&rdquo; Tutor Compass records your note. It did not do these things itself.</p>
            <textarea id="did" required value={note} maxLength={3900} onChange={(e) => setNote(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I completed these steps outside Tutor Compass, or I am recording that no action will be taken.
          </label>
          {error && <p className="notice error" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy || !confirmed || !note.trim()}>{busy ? "Saving…" : "Record and close"}</button>
        </form>
      )}
    </div>
  );
}
