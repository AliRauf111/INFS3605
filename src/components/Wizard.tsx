"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseAmountToCents } from "@/lib/domain/money";
import { REQUEST_TYPES, TRI_STATES, type RequestType, type TriState } from "@/lib/domain/types";
import { useI18n } from "@/components/i18n/I18nProvider";

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

const STEPS = ["type", "details", "concerns", "reference", "review"] as const;

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

function NeededBadge({ show }: { show?: boolean }) {
  const { t } = useI18n();
  return show ? <span className="badge amber needed-badge">{t("wizard.needed")}</span> : null;
}

function SuggestedBadge({ show }: { show?: boolean }) {
  const { t } = useI18n();
  return show ? <span className="badge info">{t("wizard.suggested")}</span> : null;
}

function TriChoice({ name, label, hint, value, onChange, suggested, needed }: {
  name: string; label: string; hint?: string; value: TriState | ""; onChange: (v: TriState | "") => void; suggested?: boolean; needed?: boolean;
}) {
  const { t } = useI18n();
  return (
    <fieldset className={needed ? "field-needed" : undefined} aria-describedby={needed ? `${name}-needed` : undefined}>
      <legend>{label} <SuggestedBadge show={suggested} /> <NeededBadge show={needed} /></legend>
      {needed && <p className="sr-only" id={`${name}-needed`}>{t("wizard.neededSr")}</p>}
      {hint && <p className="hint">{hint}</p>}
      <div className="choices">
        {TRI_STATES.map((v) => (
          <label className="choice" key={v}>
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
            {t(`domain.triState.${v}`)}
          </label>
        ))}
      </div>
      {value !== "" && (
        <button type="button" className="link-button" onClick={() => onChange("")}>{t("wizard.clearAnswer")}</button>
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
  const { t, fmt } = useI18n();
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
  const daysError = s.extensionDays && !/^\d{1,3}$/.test(s.extensionDays.trim()) ? t("wizard.wholeDays") : null;
  const amountError = amountCheck.ok ? null : t(`wizard.amountError.${amountCheck.code}`);

  function go(to: number) {
    setStep(to);
    setError(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function stepError(): string | null {
    if (step === 0 && !s.requestType) return t("wizard.chooseType");
    if (step === 1 && amountError) return amountError;
    if (step === 1 && daysError) return daysError;
    return null;
  }

  async function doLookup() {
    const reference = s.referenceId.trim();
    if (!reference) return setLookup({ status: "error", message: t("wizard.enterReference") });
    setLookup({ status: "loading" });
    try {
      const res = await fetch("/api/requests/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, bookingId: s.bookingId || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("wizard.lookupFailed"));
      setLookup(body);
      if (body.status === "found") set("bookingId", body.booking.id);
      if (body.status !== "found" && body.status !== "multiple") set("bookingId", "");
    } catch (e) {
      setLookup({ status: "error", message: e instanceof Error ? e.message : t("wizard.lookupFailed") });
    }
  }

  function payload() {
    const nul = <T extends string>(v: T | "") => (v === "" ? null : v);
    const rt = s.requestType as RequestType;
    return {
      requestType: rt,
      moneyInvolved: nul(s.moneyInvolved),
      amount: s.amount.trim() || null,
      complaint: nul(s.complaint),
      welfare: nul(s.welfare),
      referenceId: s.referenceId.trim() || null,
      bookingId: s.bookingId.trim() || null,
      financialImpact: rt === "lesson_change" ? nul(s.financialImpact) : null,
      proposedSlotId: rt === "lesson_change" ? s.proposedSlotId || null : null,
      extensionDays: rt === "payment_extension" ? s.extensionDays.trim() || null : null,
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
        setError({ message: json.error ?? t("wizard.saveFailed", { status: res.status }), details: json.details });
        setSubmitting(false);
        return;
      }
      // Only move on once the server has confirmed the save.
      router.push(`/requests/${mode.kind === "create" ? json.id : mode.requestId}?saved=1`);
      router.refresh();
    } catch {
      setError({ message: t("wizard.unreachable") });
      setSubmitting(false);
    }
  }

  const type = s.requestType;
  const unanswered = [
    !type && t("wizard.missing.type"),
    type !== "lesson_change" && !s.moneyInvolved && t("wizard.missing.money"),
    type === "refund" && !s.amount && t("wizard.missing.amount"),
    type === "lesson_change" && !s.financialImpact && t("wizard.missing.fees"),
    type === "lesson_change" && !s.proposedSlotId && t("wizard.missing.slot"),
    type === "payment_extension" && !s.extensionDays && t("wizard.missing.extension"),
    !s.complaint && t("wizard.missing.complaint"),
    !s.welfare && t("wizard.missing.welfare"),
    !s.referenceId && t("wizard.missing.reference"),
  ].filter(Boolean) as string[];
  const unsure = [
    s.moneyInvolved === "unsure" && t("wizard.unsure.money"),
    s.complaint === "unsure" && t("wizard.unsure.complaint"),
    s.welfare === "unsure" && t("wizard.unsure.welfare"),
    s.financialImpact === "unsure" && t("wizard.unsure.fees"),
  ].filter(Boolean) as string[];
  const notAnswered = t("request.notAnswered");
  const tri = (v: TriState | "") => (v ? t(`domain.triState.${v}`) : notAnswered);
  const slotText = (iso: string) => fmt.date(iso, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const err = stepError();

  return (
    <div className="stack">
      {intro}
      {needed.length > 0 && (
        <div className="notice warning" role="note">
          <p><strong>{t("wizard.neededTitle", { count: needed.length })}</strong> {t("wizard.neededText", { count: needed.length })}</p>
          <ul lang="en" dir="auto">{needed.map((n) => <li key={n.fact + n.message}>{n.message}</li>)}</ul>
        </div>
      )}
      <ol className="progress" aria-label={t("request.progress")}>
        {STEPS.map((key, i) => (
          <li key={key} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : undefined}>
            {t("wizard.stepItem", { n: i + 1, label: t(`wizard.steps.${key}`) })}
          </li>
        ))}
      </ol>
      <section className="card" aria-labelledby="step-heading">
        <h2 id="step-heading" tabIndex={-1} ref={headingRef}>
          {t("wizard.stepHeading", { n: step + 1, total: STEPS.length, label: t(`wizard.steps.${STEPS[step]}`) })}
        </h2>

        {step === 0 && (
          <fieldset>
            <legend>{t("wizard.whatAbout")} <SuggestedBadge show={isSuggested("requestType")} /></legend>
            <div className="choices">
              {REQUEST_TYPES.map((rt) => (
                <label className="choice" key={rt}>
                  <input type="radio" name="requestType" value={rt} checked={type === rt} disabled={lockType} onChange={() => set("requestType", rt)} />
                  {t(`domain.requestType.${rt}`)}
                </label>
              ))}
            </div>
            {type === "other" && <p className="notice warning">{t("wizard.otherWarning")}</p>}
          </fieldset>
        )}

        {step === 1 && (
          <div>
            {type === "lesson_change" ? (
              <TriChoice name="financialImpact" label={t("wizard.feesQuestion")} hint={t("wizard.feesHint")} value={s.financialImpact} onChange={(v) => set("financialImpact", v)} suggested={isSuggested("financialImpact")} needed={isNeeded("financialImpact")} />
            ) : (
              <TriChoice name="moneyInvolved" label={t("wizard.moneyQuestion")} value={s.moneyInvolved} onChange={(v) => set("moneyInvolved", v)} suggested={isSuggested("moneyInvolved")} needed={isNeeded("moneyInvolved")} />
            )}
            {(type === "refund" || type === "other") && (
              <div className={`field${isNeeded("amount") ? " field-needed" : ""}`}>
                <label htmlFor="amount">{t("wizard.amountLabel")} <SuggestedBadge show={isSuggested("amount")} /> <NeededBadge show={isNeeded("amount")} /></label>
                <p className="hint" id="amount-hint">{t("wizard.amountHint")}</p>
                <input id="amount" type="text" inputMode="decimal" dir="ltr" value={s.amount} onChange={(e) => set("amount", e.target.value)} aria-describedby="amount-hint amount-error" aria-invalid={!amountCheck.ok} />
                {amountError && <p className="error-text" id="amount-error">{amountError}</p>}
                {amountCheck.ok && amountCheck.cents !== null && <p className="hint">{t("wizard.recordedAs", { amount: fmt.money(amountCheck.cents) })}</p>}
              </div>
            )}
            {type === "payment_extension" && (
              <div className={`field${isNeeded("extensionDays") ? " field-needed" : ""}`}>
                <label htmlFor="days">{t("wizard.daysLabel")} <SuggestedBadge show={isSuggested("extensionDays")} /> <NeededBadge show={isNeeded("extensionDays")} /></label>
                <input id="days" type="text" inputMode="numeric" dir="ltr" value={s.extensionDays} onChange={(e) => set("extensionDays", e.target.value)} aria-invalid={Boolean(daysError)} aria-describedby="days-error" />
                {daysError && <p className="error-text" id="days-error">{daysError}</p>}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <TriChoice name="complaint" label={t("wizard.complaintQuestion")} hint={t("wizard.complaintHint")} value={s.complaint} onChange={(v) => set("complaint", v)} suggested={isSuggested("complaint")} needed={isNeeded("complaint")} />
            <TriChoice name="welfare" label={t("wizard.welfareQuestion")} hint={t("wizard.welfareHint")} value={s.welfare} onChange={(v) => set("welfare", v)} suggested={isSuggested("welfare")} needed={isNeeded("welfare")} />
            {s.welfare === "yes" && <p className="notice error">{t("wizard.welfareWarning")}</p>}
          </div>
        )}

        {step === 3 && (
          <div>
            <div className={`field${isNeeded("referenceId") ? " field-needed" : ""}`}>
              <label htmlFor="reference">{t("wizard.referenceLabel")} <SuggestedBadge show={isSuggested("referenceId")} /> <NeededBadge show={isNeeded("referenceId")} /></label>
              <p className="hint" id="ref-hint">{t("wizard.referenceHint")}</p>
              <div className="row">
                <input id="reference" type="text" dir="ltr" value={s.referenceId} aria-describedby="ref-hint" style={{ flex: "1 1 200px", width: "auto" }}
                  onChange={(e) => { set("referenceId", e.target.value.toUpperCase()); set("bookingId", ""); set("proposedSlotId", ""); setLookup({ status: "idle" }); }} />
                <button type="button" className="btn secondary" onClick={doLookup} disabled={lookup.status === "loading"}>
                  {lookup.status === "loading" ? t("wizard.lookingUp") : t("wizard.findRecords")}
                </button>
              </div>
            </div>
            <div aria-live="polite">
              {lookup.status === "error" && <p className="notice error">{lookup.message} <button type="button" className="link-button" onClick={doLookup}>{t("wizard.retry")}</button></p>}
              {lookup.status === "not_found" && <p className="notice warning">{t("wizard.notFound")}</p>}
              {lookup.status === "multiple" && (
                <fieldset>
                  <legend>{t("wizard.severalMatch")}</legend>
                  <div className="choices" style={{ flexDirection: "column" }}>
                    {lookup.candidates.map((c) => (
                      <label className="choice" key={c.id}>
                        <input type="radio" name="booking" checked={s.bookingId === c.id} onChange={() => { set("bookingId", c.id); set("proposedSlotId", ""); }} />
                        <bdi>{c.label}</bdi>
                      </label>
                    ))}
                  </div>
                  {s.bookingId && <button type="button" className="btn secondary small" onClick={doLookup}>{t("wizard.loadRecords", { id: s.bookingId })}</button>}
                </fieldset>
              )}
              {lookup.status === "found" && (
                <div className="card" style={{ background: "var(--surface-2)" }}>
                  <p><strong><bdi>{lookup.booking.id}</bdi></strong>: {lookup.booking.label}. {lookup.booking.lessons}. <span className="badge info">{lookup.booking.source}</span></p>
                  <p className="hint">{t("wizard.payments", { list: lookup.payments.length ? lookup.payments.join("; ") : t("wizard.noPayments") })}</p>
                  {type === "lesson_change" && (
                    <fieldset className={isNeeded("proposedSlotId") ? "field-needed" : undefined}>
                      <legend>{t("wizard.newTime")} <NeededBadge show={isNeeded("proposedSlotId")} /></legend>
                      {lookup.slots.length === 0 && <p className="muted">{t("wizard.noSlots")}</p>}
                      <div className="choices">
                        {lookup.slots.map((slot) => (
                          <label className="choice" key={slot.id}>
                            <input type="radio" name="slot" checked={s.proposedSlotId === slot.id} disabled={slot.status !== "free"} onChange={() => set("proposedSlotId", slot.id)} />
                            {slotText(slot.startsAt)} {slot.status !== "free" && t("wizard.booked")}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="context">{t("wizard.contextLabel")}</label>
              <p className="hint">{t("wizard.contextHint")}</p>
              <textarea id="context" dir="auto" maxLength={2000} value={s.context} onChange={(e) => set("context", e.target.value)} />
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <dl className="facts">
              <dt>{t("request.requestType")}</dt><dd>{type ? t(`domain.requestType.${type}`) : notAnswered} <button type="button" className="link-button" onClick={() => go(0)} disabled={lockType}>{t("wizard.change")}</button></dd>
              {type === "lesson_change" ? (
                <><dt>{t("request.feesAffected")}</dt><dd>{tri(s.financialImpact)}</dd></>
              ) : (
                <><dt>{t("request.moneyInvolved")}</dt><dd>{tri(s.moneyInvolved)}</dd></>
              )}
              {(type === "refund" || type === "other") && <><dt>{t("requests.table.amount")}</dt><dd>{amountCheck.ok && amountCheck.cents !== null ? fmt.money(amountCheck.cents) : t("common.notProvided")}</dd></>}
              {type === "payment_extension" && <><dt>{t("request.extraDays")}</dt><dd>{s.extensionDays || t("common.notProvided")}</dd></>}
              {type === "lesson_change" && <><dt>{t("wizard.newTimeShort")}</dt><dd><bdi>{s.proposedSlotId || t("request.notChosen")}</bdi></dd></>}
              <dt>{t("request.complaint")}</dt><dd>{tri(s.complaint)} <NeededBadge show={isNeeded("complaint") && !s.complaint} /> <button type="button" className="link-button" onClick={() => go(2)}>{t("wizard.change")}</button></dd>
              <dt>{t("request.welfare")}</dt><dd>{tri(s.welfare)}</dd>
              <dt>{t("requests.table.reference")}</dt><dd><bdi>{s.referenceId || t("common.notProvided")}</bdi>{s.bookingId && s.bookingId !== s.referenceId ? <> {t("request.bookingAside", { id: s.bookingId })}</> : null} <button type="button" className="link-button" onClick={() => go(3)}>{t("wizard.change")}</button></dd>
              <dt>{t("request.context")}</dt><dd dir="auto">{s.context || <span className="muted">{t("common.none")}</span>}</dd>
            </dl>
            {(unanswered.length > 0 || unsure.length > 0) && (
              <div className="notice warning" style={{ marginTop: "1rem" }}>
                <p><strong>{t("wizard.cannotBeGreen")}</strong> {t("wizard.canStillSave")}</p>
                {unanswered.length > 0 && <p>{t("wizard.notAnsweredList", { list: fmt.list(unanswered) })}</p>}
                {unsure.length > 0 && <p>{t("wizard.unsureList", { list: fmt.list(unsure) })}</p>}
              </div>
            )}
            {mode.kind === "reevaluate" && (
              <div className="field" style={{ marginTop: "1rem" }}>
                <label htmlFor="note">{t("wizard.whatChanged")}</label>
                <textarea id="note" dir="auto" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
            {requireConfirmation && (
              <label className="check" style={{ marginTop: "1rem" }}>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                {t("wizard.checkedFacts")}
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
          {step > (lockType ? 1 : 0) && <button type="button" className="btn secondary" onClick={() => go(step - 1)}>{t("common.back")}</button>}
          {step < 4 && <button type="button" className="btn" onClick={() => !err && go(step + 1)} aria-disabled={Boolean(err)}>{t("common.next")}</button>}
          {step === 4 && (
            <button type="button" className="btn" onClick={submit} disabled={submitting || !type || (requireConfirmation && !confirmed) || !amountCheck.ok}>
              {submitting ? t("common.saving") : mode.kind === "create" ? t("wizard.checkAndSave") : t("wizard.recheckAndSave")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
