"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseAmountToCents, formatAud } from "@/lib/domain/money";
import {
  REQUEST_TYPES,
  REQUEST_TYPE_LABELS,
  TRI_STATES,
  TRI_STATE_LABELS,
  type RequestType,
  type TriState,
} from "@/lib/domain/types";

// The guided request wizard. Used for new requests, for AI intake review (pre-filled
// with suggestions) and for clarifying an existing request. Whatever the route, the
// answers are posted to the same server endpoint, validated by the same code and
// decided by the same rule engine.

export type WizardState = {
  requestType: RequestType | "";
  moneyInvolved: TriState | "";
  amount: string;
  complaint: TriState | "";
  welfare: TriState | "";
  referenceId: string;
  bookingId: string;
  financialImpact: TriState | "";
  proposedSlotId: string;
  extensionDays: string;
  context: string;
};

export const EMPTY_WIZARD: WizardState = {
  requestType: "",
  moneyInvolved: "",
  amount: "",
  complaint: "",
  welfare: "",
  referenceId: "",
  bookingId: "",
  financialImpact: "",
  proposedSlotId: "",
  extensionDays: "",
  context: "",
};

type Mode =
  | { kind: "create"; intakeMethod: "wizard" | "ai_intake"; sessionKey: string }
  | { kind: "reevaluate"; requestId: string; expectedDecisionId: string };

type Lookup =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "not_found" | "not_checked" }
  | { status: "multiple"; candidates: Array<{ id: string; label: string }> }
  | { status: "found"; booking: { id: string; label: string; lessons: string; source: string }; payments: string[]; slots: Array<{ id: string; startsAt: string; status: string }> };

const STEPS = ["Request type", "Details", "Concerns", "Reference", "Review"];

/** Which wizard field and step answer each required fact the rule check can report missing. */
const FACT_FIELDS: Record<string, { field: keyof WizardState; step: number }> = {
  amount: { field: "amount", step: 1 },
  extension_days: { field: "extensionDays", step: 1 },
  financial_impact: { field: "financialImpact", step: 1 },
  complaint: { field: "complaint", step: 2 },
  welfare: { field: "welfare", step: 2 },
  reference: { field: "referenceId", step: 3 },
  payment_record: { field: "referenceId", step: 3 },
  outstanding_invoice: { field: "referenceId", step: 3 },
  availability: { field: "proposedSlotId", step: 3 },
};

/** Required details the latest rule check says are missing. Used to highlight fields. */
export type NeededFacts = Array<{ fact: string; message: string }>;

function slotText(iso: string) {
  return new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function NeededBadge({ show }: { show?: boolean }) {
  return show ? <span className="badge amber needed-badge">Needed for a decision</span> : null;
}

function TriChoice({ name, label, hint, value, onChange, suggested, needed }: {
  name: string; label: string; hint?: string; value: TriState | ""; onChange: (v: TriState | "") => void; suggested?: boolean; needed?: boolean;
}) {
  return (
    <fieldset className={needed ? "field-needed" : undefined} aria-describedby={needed ? `${name}-needed` : undefined}>
      <legend>{label} {suggested && <span className="badge info">Suggested from message</span>} <NeededBadge show={needed} /></legend>
      {needed && <p className="sr-only" id={`${name}-needed`}>This answer is needed before a decision can be made.</p>}
      {hint && <p className="hint">{hint}</p>}
      <div className="choices">
        {TRI_STATES.map((t) => (
          <label className="choice" key={t}>
            <input type="radio" name={name} value={t} checked={value === t} onChange={() => onChange(t)} />
            {TRI_STATE_LABELS[t]}
          </label>
        ))}
      </div>
      {value !== "" && (
        <button type="button" className="link-button" onClick={() => onChange("")}>Clear answer</button>
      )}
    </fieldset>
  );
}

export function Wizard({
  mode,
  initial,
  suggested = [],
  lockType = false,
  requireConfirmation = false,
  intro,
  needed = [],
}: {
  mode: Mode;
  initial?: Partial<WizardState>;
  suggested?: string[];
  lockType?: boolean;
  requireConfirmation?: boolean;
  intro?: React.ReactNode;
  /** Required details to highlight (from the latest rule check). Existing answers are kept. */
  needed?: NeededFacts;
}) {
  const router = useRouter();
  const [s, setS] = useState<WizardState>({ ...EMPTY_WIZARD, ...initial });
  const neededFields = new Set(needed.map((n) => FACT_FIELDS[n.fact]?.field).filter(Boolean) as Array<keyof WizardState>);
  const firstNeededStep = Math.min(...needed.map((n) => FACT_FIELDS[n.fact]?.step ?? 99));
  const [step, setStep] = useState(firstNeededStep < 99 ? Math.max(firstNeededStep, lockType ? 1 : 0) : lockType ? 1 : 0);
  const isNeeded = (f: keyof WizardState) => neededFields.has(f);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; details?: Record<string, string> } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isSuggested = (f: string) => suggested.includes(f);

  const set = <K extends keyof WizardState>(k: K, v: WizardState[K]) => setS((prev) => ({ ...prev, [k]: v }));

  const amountCheck = useMemo(() => parseAmountToCents(s.amount), [s.amount]);
  const daysError = s.extensionDays && !/^\d{1,3}$/.test(s.extensionDays.trim()) ? "Enter a whole number of days." : null;

  function go(to: number) {
    setStep(to);
    setError(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function stepError(): string | null {
    if (step === 0 && !s.requestType) return "Choose a request type to continue.";
    if (step === 1 && !amountCheck.ok) return amountCheck.error;
    if (step === 1 && daysError) return daysError;
    return null;
  }

  async function doLookup() {
    const reference = s.referenceId.trim();
    if (!reference) return setLookup({ status: "error", message: "Enter a reference first." });
    setLookup({ status: "loading" });
    try {
      const res = await fetch("/api/requests/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, bookingId: s.bookingId || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Lookup failed.");
      setLookup(body);
      if (body.status === "found") set("bookingId", body.booking.id);
      if (body.status !== "found" && body.status !== "multiple") set("bookingId", "");
    } catch (e) {
      setLookup({ status: "error", message: e instanceof Error ? e.message : "Lookup failed." });
    }
  }

  function payload() {
    const nul = <T extends string>(v: T | "") => (v === "" ? null : v);
    const t = s.requestType as RequestType;
    return {
      requestType: t,
      moneyInvolved: nul(s.moneyInvolved),
      amount: s.amount.trim() || null,
      complaint: nul(s.complaint),
      welfare: nul(s.welfare),
      referenceId: s.referenceId.trim() || null,
      bookingId: s.bookingId.trim() || null,
      financialImpact: t === "lesson_change" ? nul(s.financialImpact) : null,
      proposedSlotId: t === "lesson_change" ? s.proposedSlotId || null : null,
      extensionDays: t === "payment_extension" ? s.extensionDays.trim() || null : null,
      context: s.context,
    };
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const url = mode.kind === "create" ? "/api/requests" : `/api/requests/${mode.requestId}/reevaluate`;
      const body =
        mode.kind === "create"
          ? { idempotencyKey: mode.sessionKey, intakeMethod: mode.intakeMethod, facts: payload() }
          : { expectedDecisionId: mode.expectedDecisionId, facts: payload(), note };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: json.error ?? `Save failed (${res.status}).`, details: json.details });
        setSubmitting(false);
        return;
      }
      // Only move on once the server has confirmed the save.
      router.push(`/requests/${mode.kind === "create" ? json.id : mode.requestId}?saved=1`);
      router.refresh();
    } catch {
      setError({ message: "Could not reach the server. Nothing was confirmed as saved. Check your connection and try again; it is safe to retry." });
      setSubmitting(false);
    }
  }

  const t = s.requestType;
  const unanswered = [
    !t && "Request type",
    t !== "lesson_change" && !s.moneyInvolved && "Whether money is involved",
    t === "refund" && !s.amount && "Refund amount",
    t === "lesson_change" && !s.financialImpact && "Whether fees change",
    t === "lesson_change" && !s.proposedSlotId && "New lesson time",
    t === "payment_extension" && !s.extensionDays && "Extension length",
    !s.complaint && "Complaint status",
    !s.welfare && "Welfare status",
    !s.referenceId && "Reference",
  ].filter(Boolean) as string[];
  const unsure = [
    s.moneyInvolved === "unsure" && "Money involved",
    s.complaint === "unsure" && "Complaint",
    s.welfare === "unsure" && "Welfare",
    s.financialImpact === "unsure" && "Fee impact",
  ].filter(Boolean) as string[];

  const err = stepError();

  return (
    <div className="stack">
      {intro}
      {needed.length > 0 && (
        <div className="notice warning" role="note">
          <p><strong>{needed.length === 1 ? "One required detail is" : `${needed.length} required details are`} missing, so no decision can be made yet.</strong> Your existing answers are kept. Fill in the highlighted {needed.length === 1 ? "field" : "fields"}, then choose Re-check and save. The rules run again straight away.</p>
          <ul>{needed.map((n) => <li key={n.fact + n.message}>{n.message}</li>)}</ul>
        </div>
      )}
      <ol className="progress" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : undefined}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      <section className="card" aria-labelledby="step-heading">
        <h2 id="step-heading" tabIndex={-1} ref={headingRef}>
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </h2>

        {step === 0 && (
          <fieldset>
            <legend>What is the request about? {isSuggested("requestType") && <span className="badge info">Suggested from message</span>}</legend>
            <div className="choices">
              {REQUEST_TYPES.map((rt) => (
                <label className="choice" key={rt}>
                  <input type="radio" name="requestType" value={rt} checked={t === rt} disabled={lockType} onChange={() => set("requestType", rt)} />
                  {REQUEST_TYPE_LABELS[rt]}
                </label>
              ))}
            </div>
            {t === "other" && <p className="notice warning">Tutor Compass has no rules for other requests yet, so they are always amber and go to the owner.</p>}
          </fieldset>
        )}

        {step === 1 && (
          <div>
            {t === "lesson_change" ? (
              <TriChoice name="financialImpact" label="Does the change affect fees?" hint="For example a longer lesson, a cancellation fee or a credit." value={s.financialImpact} onChange={(v) => set("financialImpact", v)} suggested={isSuggested("financialImpact")} needed={isNeeded("financialImpact")} />
            ) : (
              <TriChoice name="moneyInvolved" label="Is money involved?" value={s.moneyInvolved} onChange={(v) => set("moneyInvolved", v)} suggested={isSuggested("moneyInvolved")} needed={isNeeded("moneyInvolved")} />
            )}
            {(t === "refund" || t === "other") && (
              <div className={`field${isNeeded("amount") ? " field-needed" : ""}`}>
                <label htmlFor="amount">Amount in AUD {isSuggested("amount") && <span className="badge info">Suggested from message</span>} <NeededBadge show={isNeeded("amount")} /></label>
                <p className="hint" id="amount-hint">Dollars and cents, for example 49.99. Leave blank if you do not know yet.</p>
                <input id="amount" type="text" inputMode="decimal" value={s.amount} onChange={(e) => set("amount", e.target.value)} aria-describedby="amount-hint amount-error" aria-invalid={!amountCheck.ok} />
                {!amountCheck.ok && <p className="error-text" id="amount-error">{amountCheck.error}</p>}
                {amountCheck.ok && amountCheck.cents !== null && <p className="hint">Recorded as {formatAud(amountCheck.cents)}.</p>}
              </div>
            )}
            {t === "payment_extension" && (
              <div className={`field${isNeeded("extensionDays") ? " field-needed" : ""}`}>
                <label htmlFor="days">Extra days requested {isSuggested("extensionDays") && <span className="badge info">Suggested from message</span>} <NeededBadge show={isNeeded("extensionDays")} /></label>
                <input id="days" type="text" inputMode="numeric" value={s.extensionDays} onChange={(e) => set("extensionDays", e.target.value)} aria-invalid={Boolean(daysError)} aria-describedby="days-error" />
                {daysError && <p className="error-text" id="days-error">{daysError}</p>}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <TriChoice name="complaint" label="Is this a complaint?" hint="About the service, a tutor or how something was handled." value={s.complaint} onChange={(v) => set("complaint", v)} suggested={isSuggested("complaint")} needed={isNeeded("complaint")} />
            <TriChoice name="welfare" label="Is there any concern about a child's safety or wellbeing?" hint="If you are unsure, choose Not sure. It will not be treated as no." value={s.welfare} onChange={(v) => set("welfare", v)} suggested={isSuggested("welfare")} needed={isNeeded("welfare")} />
            {s.welfare === "yes" && <p className="notice error">Welfare concerns always go straight to the owner. If a child may be in immediate danger, call 000 first.</p>}
          </div>
        )}

        {step === 3 && (
          <div>
            <div className={`field${isNeeded("referenceId") ? " field-needed" : ""}`}>
              <label htmlFor="reference">Booking, family or payment reference {isSuggested("referenceId") && <span className="badge info">Suggested from message</span>} <NeededBadge show={isNeeded("referenceId")} /></label>
              <p className="hint" id="ref-hint">For example BK-1042, FAM-07 or PAY-2001.</p>
              <div className="row">
                <input id="reference" type="text" value={s.referenceId} aria-describedby="ref-hint" style={{ flex: "1 1 200px", width: "auto" }}
                  onChange={(e) => { set("referenceId", e.target.value.toUpperCase()); set("bookingId", ""); set("proposedSlotId", ""); setLookup({ status: "idle" }); }} />
                <button type="button" className="btn secondary" onClick={doLookup} disabled={lookup.status === "loading"}>
                  {lookup.status === "loading" ? "Looking up…" : "Find records"}
                </button>
              </div>
            </div>
            <div aria-live="polite">
              {lookup.status === "error" && <p className="notice error">{lookup.message} <button type="button" className="link-button" onClick={doLookup}>Retry</button></p>}
              {lookup.status === "not_found" && <p className="notice warning">No booking matches that reference. You can still save the request, but it cannot be green.</p>}
              {lookup.status === "multiple" && (
                <fieldset>
                  <legend>Several bookings match. Which one is this about?</legend>
                  <div className="choices" style={{ flexDirection: "column" }}>
                    {lookup.candidates.map((c) => (
                      <label className="choice" key={c.id}>
                        <input type="radio" name="booking" checked={s.bookingId === c.id} onChange={() => { set("bookingId", c.id); set("proposedSlotId", ""); }} />
                        {c.label}
                      </label>
                    ))}
                  </div>
                  {s.bookingId && <button type="button" className="btn secondary small" onClick={doLookup}>Load records for {s.bookingId}</button>}
                </fieldset>
              )}
              {lookup.status === "found" && (
                <div className="card" style={{ background: "var(--surface-2)" }}>
                  <p><strong>{lookup.booking.id}</strong>: {lookup.booking.label}. {lookup.booking.lessons}. <span className="badge info">{lookup.booking.source}</span></p>
                  <p className="hint">Payments: {lookup.payments.length ? lookup.payments.join("; ") : "none on record"}</p>
                  {t === "lesson_change" && (
                    <fieldset className={isNeeded("proposedSlotId") ? "field-needed" : undefined}>
                      <legend>New lesson time (same tutor) <NeededBadge show={isNeeded("proposedSlotId")} /></legend>
                      {lookup.slots.length === 0 && <p className="muted">No upcoming slots are recorded for this tutor.</p>}
                      <div className="choices">
                        {lookup.slots.map((slot) => (
                          <label className="choice" key={slot.id}>
                            <input type="radio" name="slot" checked={s.proposedSlotId === slot.id} disabled={slot.status !== "free"} onChange={() => set("proposedSlotId", slot.id)} />
                            {slotText(slot.startsAt)} {slot.status !== "free" && "(booked)"}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="context">Anything else the owner should know? (optional)</label>
              <p className="hint">Use first names only. Do not paste bank or card details.</p>
              <textarea id="context" maxLength={2000} value={s.context} onChange={(e) => set("context", e.target.value)} />
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <dl className="facts">
              <dt>Request type</dt><dd>{t ? REQUEST_TYPE_LABELS[t] : "Not answered"} <button type="button" className="link-button" onClick={() => go(0)} disabled={lockType}>Change</button></dd>
              {t === "lesson_change" ? (
                <><dt>Fees affected</dt><dd>{s.financialImpact ? TRI_STATE_LABELS[s.financialImpact] : "Not answered"}</dd></>
              ) : (
                <><dt>Money involved</dt><dd>{s.moneyInvolved ? TRI_STATE_LABELS[s.moneyInvolved] : "Not answered"}</dd></>
              )}
              {(t === "refund" || t === "other") && <><dt>Amount</dt><dd>{amountCheck.ok && amountCheck.cents !== null ? formatAud(amountCheck.cents) : "Not provided"}</dd></>}
              {t === "payment_extension" && <><dt>Extra days</dt><dd>{s.extensionDays || "Not provided"}</dd></>}
              {t === "lesson_change" && <><dt>New time</dt><dd>{s.proposedSlotId || "Not chosen"}</dd></>}
              <dt>Complaint</dt><dd>{s.complaint ? TRI_STATE_LABELS[s.complaint] : "Not answered"} <NeededBadge show={isNeeded("complaint") && !s.complaint} /> <button type="button" className="link-button" onClick={() => go(2)}>Change</button></dd>
              <dt>Welfare concern</dt><dd>{s.welfare ? TRI_STATE_LABELS[s.welfare] : "Not answered"}</dd>
              <dt>Reference</dt><dd>{s.referenceId || "Not provided"}{s.bookingId && s.bookingId !== s.referenceId ? ` (booking ${s.bookingId})` : ""} <button type="button" className="link-button" onClick={() => go(3)}>Change</button></dd>
              <dt>Context</dt><dd>{s.context || <span className="muted">None</span>}</dd>
            </dl>
            {(unanswered.length > 0 || unsure.length > 0) && (
              <div className="notice warning" style={{ marginTop: "1rem" }}>
                <p><strong>This request cannot be green yet.</strong> You can still save it for clarification or owner review.</p>
                {unanswered.length > 0 && <p>Not answered: {unanswered.join(", ")}.</p>}
                {unsure.length > 0 && <p>Marked not sure: {unsure.join(", ")}.</p>}
              </div>
            )}
            {mode.kind === "reevaluate" && (
              <div className="field" style={{ marginTop: "1rem" }}>
                <label htmlFor="note">What changed? (optional)</label>
                <textarea id="note" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
            {requireConfirmation && (
              <label className="check" style={{ marginTop: "1rem" }}>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                I have checked these facts against the message. Suggestions I have not confirmed are left blank or marked not sure.
              </label>
            )}
          </div>
        )}

        {error && (
          <div className="notice error" role="alert" style={{ marginTop: "1rem" }}>
            <p><strong>{error.message}</strong></p>
            {error.details && <ul>{Object.entries(error.details).map(([k, v]) => <li key={k}>{k}: {String(v)}</li>)}</ul>}
          </div>
        )}
        {err && step !== 4 && <p className="error-text" role="status">{err}</p>}

        <div className="row" style={{ marginTop: "1rem" }}>
          {step > (lockType ? 1 : 0) && <button type="button" className="btn secondary" onClick={() => go(step - 1)}>Back</button>}
          {step < 4 && <button type="button" className="btn" onClick={() => !err && go(step + 1)} aria-disabled={Boolean(err)}>Next</button>}
          {step === 4 && (
            <button type="button" className="btn" onClick={submit} disabled={submitting || !t || (requireConfirmation && !confirmed) || !amountCheck.ok}>
              {submitting ? "Saving…" : mode.kind === "create" ? "Check rules and save" : "Re-check and save"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
