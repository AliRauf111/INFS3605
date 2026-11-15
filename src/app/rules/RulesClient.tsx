"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIONS, COLOURS, type ActionKey, type Colour } from "@/lib/domain/types";
import { centsToInput, parseAmountToCents } from "@/lib/domain/money";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { Translate } from "@/lib/i18n/core";
import {
  CATEGORY_CONFIG,
  POLICY_CATEGORIES,
  categoryLabel,
  describeRange,
  factLabel,
  type FactKey,
  type PolicyCategory,
  type PolicyDefinition,
} from "@/lib/engine/policy";
import type { PolicyCheck } from "@/lib/engine/validate-policy";
import type { DecisionResult } from "@/lib/engine/evaluate";

async function post(url: string, body: unknown, method = "POST", t?: Translate) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(json.details) ? json.details.map((d: { message?: string } | string) => (typeof d === "string" ? d : d.message)).join(" ") : "";
    throw new Error(`${json.error ?? (t ? t("rules.requestFailed", { status: res.status }) : `Request failed (${res.status}).`)} ${details}`.trim());
  }
  return json;
}

export function NewDraftButton({ category, copyFromId, label }: { category: PolicyCategory; copyFromId: string; label: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button className="btn secondary small" type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          const json = await post("/api/policies", { category, copyFromId, note: "Copied for editing" }, "POST", t);
          router.push(`/rules/${json.id}`);
        } catch (e) {
          setError(e instanceof Error ? e.message : t("rules.failed"));
          setBusy(false);
        }
      }}>{busy ? t("rules.creating") : label}</button>
      {error && <span className="error-text" role="alert"> {error}</span>}
    </span>
  );
}

// ---- Rule editor --------------------------------------------------------------

type UiRule = {
  id: string;
  label: string;
  minText: string;
  maxText: string;
  maxInclusive: boolean;
  financialImpact: "" | "yes" | "no";
  colour: Colour;
  actions: ActionKey[];
  stepsText: string;
  escalation: string;
};

function toUi(def: PolicyDefinition): UiRule[] {
  const unit = CATEGORY_CONFIG[def.category].numeric?.unit;
  const show = (v: number | null) => (v === null ? "" : unit === "cents" ? centsToInput(v) : String(v));
  return def.rules.map((r) => ({
    id: r.id,
    label: r.label,
    minText: show(r.range?.min ?? null),
    maxText: show(r.range?.max ?? null),
    maxInclusive: r.range?.maxInclusive ?? true,
    financialImpact: r.financialImpact ?? "",
    colour: r.colour,
    actions: r.permittedActions,
    stepsText: r.nextSteps.join("\n"),
    escalation: r.escalation,
  }));
}

function fromUi(category: PolicyCategory, title: string, required: FactKey[], rules: UiRule[], t: Translate): { def?: PolicyDefinition; errors: string[] } {
  const config = CATEGORY_CONFIG[category];
  const errors: string[] = [];
  const num = (text: string, what: string): number | null => {
    if (!text.trim()) return null;
    if (config.numeric?.unit === "cents") {
      const p = parseAmountToCents(text);
      if (!p.ok) { errors.push(`${what}: ${t(`wizard.amountError.${p.code}`)}`); return null; }
      return p.cents;
    }
    if (!/^\d{1,3}$/.test(text.trim())) { errors.push(`${what}: ${t("rules.wholeDays")}`); return null; }
    return Number(text.trim());
  };
  const out = rules.map((r, i) => {
    const min = num(r.minText, t("rules.lowerLimitOf", { n: i + 1 }));
    const max = num(r.maxText, t("rules.upperLimitOf", { n: i + 1 }));
    return {
      id: r.id,
      label: r.label,
      range: config.numeric && (min !== null || max !== null) ? { min, max, maxInclusive: r.maxInclusive } : null,
      financialImpact: config.usesFinancialImpact && r.financialImpact ? r.financialImpact : null,
      colour: r.colour,
      permittedActions: r.actions,
      nextSteps: r.stepsText.split("\n").map((s) => s.trim()).filter(Boolean),
      escalation: r.escalation,
    };
  });
  return errors.length ? { errors } : { errors, def: { category, title, requiredFacts: required, rules: out } };
}

function CheckView({ check, category }: { check: PolicyCheck; category: PolicyCategory }) {
  const { t } = useI18n();
  const errs = check.issues.filter((i) => i.level === "error");
  const warns = check.issues.filter((i) => i.level === "warning");
  return (
    <div className="stack" aria-live="polite">
      {errs.length === 0 ? <p className="notice success">{warns.length ? t("rules.noErrorsWarnings") : t("rules.noErrors")}</p> : (
        <div className="notice error"><p><strong>{t("rules.errorsBlock", { count: errs.length })}</strong></p><ul lang="en" dir="auto">{errs.map((e) => <li key={e.message}>{e.message}</li>)}</ul></div>
      )}
      {warns.length > 0 && <div className="notice warning"><p><strong>{t("rules.warnings")}</strong></p><ul lang="en" dir="auto">{warns.map((e) => <li key={e.message}>{e.message}</li>)}</ul></div>}
      <p className="hint">{t("rules.defaultRoute")}</p>
      {check.boundaryCases.length > 0 && (
        <div>
          <h3>{t("rules.boundaryCases")}</h3>
          <p className="hint">{t("rules.boundaryHint")}</p>
          <div className="table-wrap"><table>
            <thead><tr><th>{CATEGORY_CONFIG[category].numeric ? t(`rules.numeric.${category}`) : t("rules.case")}</th><th>{t("rules.result")}</th><th>{t("request.rule")}</th></tr></thead>
            <tbody>{check.boundaryCases.map((c) => <tr key={c.label}><td lang="en" dir="auto">{c.label}</td><td><span className={`badge ${c.colour}`}>{t(`domain.colourShort.${c.colour as Colour}`)}</span></td><td><code>{c.matchedRuleId}</code></td></tr>)}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

export function TestArea({ definition }: { definition: () => PolicyDefinition | null }) {
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("");
  const [impact, setImpact] = useState<"" | "yes" | "no" | "unsure">("no");
  const [complaint, setComplaint] = useState<"" | "yes" | "no" | "unsure">("no");
  const [welfare, setWelfare] = useState<"" | "yes" | "no" | "unsure">("no");
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const tri = (label: string, v: string, set: (x: "" | "yes" | "no" | "unsure") => void, id: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={v} onChange={(e) => set(e.target.value as "" | "yes" | "no" | "unsure")}>
        <option value="">{t("request.notAnswered")}</option><option value="yes">{t("domain.triState.yes")}</option><option value="no">{t("domain.triState.no")}</option><option value="unsure">{t("domain.triState.unsure")}</option>
      </select>
    </div>
  );
  async function run() {
    setError(null);
    setResult(null);
    const def = definition();
    if (!def) return setError(t("rules.fixErrors"));
    try {
      const json = await post("/api/policies/test", {
        definition: def,
        facts: {
          requestType: def.category,
          moneyInvolved: def.category === "refund" ? "yes" : null,
          amount: def.category === "refund" ? amount || null : null,
          complaint: complaint || null,
          welfare: welfare || null,
          financialImpact: def.category === "lesson_change" ? impact || null : null,
          extensionDays: def.category === "payment_extension" ? days || null : null,
        },
      }, "POST", t);
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rules.testFailed"));
    }
  }
  const cat = definition()?.category;
  return (
    <section className="card">
      <h2>{t("rules.testHeading")}</h2>
      <p className="hint">{t("rules.testHint")}</p>
      <div className="grid grid-3">
        {cat === "refund" && <div className="field"><label htmlFor="t-amount">{t("rules.amountAud")}</label><input id="t-amount" type="text" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>}
        {cat === "payment_extension" && <div className="field"><label htmlFor="t-days">{t("request.extraDays")}</label><input id="t-days" type="text" inputMode="numeric" dir="ltr" value={days} onChange={(e) => setDays(e.target.value)} /></div>}
        {cat === "lesson_change" && tri(t("request.feesAffected"), impact, setImpact, "t-impact")}
        {tri(t("request.complaint"), complaint, setComplaint, "t-complaint")}
        {tri(t("request.welfare"), welfare, setWelfare, "t-welfare")}
      </div>
      <button className="btn secondary" type="button" onClick={run}>{t("rules.runTest")}</button>
      {error && <p className="notice error" role="alert" style={{ marginTop: "0.75rem" }}>{error}</p>}
      {result && (
        <div className={`banner ${result.colour}`} style={{ marginTop: "0.75rem" }} role="status">
          <span className="icon" aria-hidden="true">{result.colour === "green" ? "✓" : result.colour === "amber" ? "!" : "■"}</span>
          <div><h2>{t(`domain.colourShort.${result.colour}`)}: <span lang="en">{result.outcomeLabel}</span></h2><p lang="en" dir="auto">{result.explanation}</p><p><code>{result.matchedRuleId}</code></p></div>
        </div>
      )}
    </section>
  );
}

export function RuleEditor({ versionId, initial, version }: { versionId: string; initial: PolicyDefinition; version: number }) {
  const router = useRouter();
  const { t } = useI18n();
  const category = initial.category;
  const config = CATEGORY_CONFIG[category];
  const [title, setTitle] = useState(initial.title);
  const [required, setRequired] = useState<FactKey[]>(initial.requiredFacts);
  const [rules, setRules] = useState<UiRule[]>(toUi(initial));
  const [check, setCheck] = useState<PolicyCheck | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [activateNote, setActivateNote] = useState("");
  const [ack, setAck] = useState(false);
  const unitHint = config.numeric?.unit === "cents" ? t("rules.unitAud") : t("rules.unitDays");

  const build = () => fromUi(category, title, required, rules, t);
  const update = (i: number, patch: Partial<UiRule>) => { setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setCheck(null); };

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try { await fn(); } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : t("rules.failed") }); } finally { setBusy(false); }
  }
  const runCheck = () => act(async () => {
    const b = build();
    if (!b.def) throw new Error(b.errors.join(" "));
    setCheck(await post("/api/policies/check", { definition: b.def }, "POST", t));
  });
  const save = () => act(async () => {
    const b = build();
    if (!b.def) throw new Error(b.errors.join(" "));
    const json = await post(`/api/policies/${versionId}`, { definition: b.def }, "PUT", t);
    setCheck(json.check);
    setMessage({ kind: "success", text: t("rules.draftSaved") });
    router.refresh();
  });
  const activate = () => act(async () => {
    const b = build();
    if (!b.def) throw new Error(b.errors.join(" "));
    await post(`/api/policies/${versionId}`, { definition: b.def }, "PUT", t);
    await post(`/api/policies/${versionId}/activate`, { note: activateNote, acknowledgeWarnings: ack }, "POST", t);
    setMessage({ kind: "success", text: t("rules.activated") });
    router.refresh();
  });
  const remove = () => act(async () => {
    if (!window.confirm(t("rules.confirmDelete"))) return;
    await post(`/api/policies/${versionId}`, {}, "DELETE", t);
    router.push("/knowledge#rules");
  });

  return (
    <div className="stack">
      <section className="card">
        <h2>{t("rules.draftVersion", { version })}</h2>
        <div className="field"><label htmlFor="title">{t("rules.title")}</label><input id="title" type="text" dir="auto" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></div>
        <fieldset>
          <legend>{t("rules.factsBeforeGreen")}</legend>
          {config.allowedFacts.map((f) => (
            <label className="check" key={f}>
              <input type="checkbox" checked={required.includes(f)} onChange={(e) => { setRequired(e.target.checked ? [...required, f] : required.filter((x) => x !== f)); setCheck(null); }} />
              {factLabel(f, t)}
            </label>
          ))}
        </fieldset>
      </section>

      {rules.map((r, i) => (
        <section key={i} className={`rule-card ${r.colour}`} aria-label={t("rules.ruleN", { n: i + 1 })}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{t("rules.ruleN", { n: i + 1 })}</h3>
            <div className="row">
              <button className="btn secondary small" type="button" disabled={i === 0} onClick={() => setRules((rs) => { const c = [...rs]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; })}>{t("rules.moveUp")}</button>
              <button className="btn secondary small" type="button" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} disabled={rules.length === 1}>{t("common.remove")}</button>
            </div>
          </div>
          <div className="grid grid-2" style={{ marginTop: "0.5rem" }}>
            <div className="field"><label htmlFor={`label-${i}`}>{t("rules.name")}</label><input id={`label-${i}`} type="text" dir="auto" value={r.label} maxLength={120} onChange={(e) => update(i, { label: e.target.value })} /></div>
            <div className="field"><label htmlFor={`id-${i}`}>{t("rules.ruleId")}</label><input id={`id-${i}`} type="text" dir="ltr" value={r.id} maxLength={60} onChange={(e) => update(i, { id: e.target.value.toLowerCase() })} /></div>
            {config.numeric && (
              <>
                <div className="field"><label htmlFor={`min-${i}`}>{t("rules.atLeast", { label: t(`rules.numeric.${category}`) })}</label><p className="hint">{t("rules.noLower", { unit: unitHint })}</p><input id={`min-${i}`} type="text" dir="ltr" value={r.minText} onChange={(e) => update(i, { minText: e.target.value })} /></div>
                <div className="field">
                  <label htmlFor={`max-${i}`}>{t("rules.upperLimit")}</label>
                  <p className="hint">{t("rules.noUpper", { unit: unitHint })}</p>
                  <div className="row">
                    <select aria-label={t("rules.upperLimitType")} value={r.maxInclusive ? "lte" : "lt"} onChange={(e) => update(i, { maxInclusive: e.target.value === "lte" })} style={{ width: "auto" }}>
                      <option value="lte">{t("rules.upToIncluding")}</option><option value="lt">{t("rules.belowOption")}</option>
                    </select>
                    <input id={`max-${i}`} type="text" dir="ltr" value={r.maxText} onChange={(e) => update(i, { maxText: e.target.value })} style={{ flex: 1, width: "auto" }} />
                  </div>
                </div>
              </>
            )}
            {config.usesFinancialImpact && (
              <div className="field"><label htmlFor={`fi-${i}`}>{t("request.feesAffected")}</label>
                <select id={`fi-${i}`} value={r.financialImpact} onChange={(e) => update(i, { financialImpact: e.target.value as "" | "yes" | "no" })}>
                  <option value="">{t("rules.either")}</option><option value="no">{t("domain.triState.no")}</option><option value="yes">{t("domain.triState.yes")}</option>
                </select></div>
            )}
            <div className="field"><label htmlFor={`colour-${i}`}>{t("rules.decisionColour")}</label>
              <select id={`colour-${i}`} value={r.colour} onChange={(e) => update(i, { colour: e.target.value as Colour })}>
                {COLOURS.map((c) => <option key={c} value={c}>{t(`rules.colourOption.${c}`)}</option>)}
              </select></div>
          </div>
          <fieldset>
            <legend>{t("request.permittedActions")}</legend>
            <div className="choices">
              {ACTIONS.map((a) => (
                <label className="choice" key={a}><input type="checkbox" checked={r.actions.includes(a)} onChange={(e) => update(i, { actions: e.target.checked ? [...r.actions, a] : r.actions.filter((x) => x !== a) })} />{t(`domain.action.${a}`)}</label>
              ))}
            </div>
          </fieldset>
          <div className="field"><label htmlFor={`steps-${i}`}>{t("rules.nextStepsLabel")}</label><textarea id={`steps-${i}`} dir="auto" value={r.stepsText} onChange={(e) => update(i, { stepsText: e.target.value })} /></div>
          <div className="field"><label htmlFor={`esc-${i}`}>{t("rules.escalationLabel")}</label><input id={`esc-${i}`} type="text" dir="auto" value={r.escalation} maxLength={500} onChange={(e) => update(i, { escalation: e.target.value })} /></div>
        </section>
      ))}
      <div className="row">
        <button className="btn secondary" type="button" disabled={rules.length >= 20} onClick={() => setRules((rs) => [...rs, { id: `${category}.rule_${rs.length + 1}`, label: "New rule", minText: "", maxText: "", maxInclusive: true, financialImpact: "", colour: "amber", actions: ["send_to_owner"], stepsText: "", escalation: "" }])}>{t("rules.addRule")}</button>
      </div>

      <section className="card stack">
        <h2>{t("rules.checkSaveActivate")}</h2>
        {message && <p className={`notice ${message.kind}`} role="status">{message.text}</p>}
        <div className="row">
          <button className="btn secondary" type="button" onClick={runCheck} disabled={busy}>{t("rules.checkGaps")}</button>
          <button className="btn" type="button" onClick={save} disabled={busy}>{t("rules.saveDraft")}</button>
          <button className="btn danger" type="button" onClick={remove} disabled={busy}>{t("rules.deleteDraft")}</button>
        </div>
        {check && <CheckView check={check} category={category} />}
        <div className="field">
          <label htmlFor="activate-note">{t("rules.whyActivate")}</label>
          <textarea id="activate-note" dir="auto" value={activateNote} maxLength={1000} onChange={(e) => setActivateNote(e.target.value)} />
        </div>
        <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> {t("rules.ackWarnings")}</label>
        <button className="btn" type="button" onClick={activate} disabled={busy || !activateNote.trim()}>{t("rules.activate")}</button>
        <p className="hint">{t("rules.activateHint")}</p>
      </section>

      <TestArea definition={() => build().def ?? null} />
    </div>
  );
}

// ---- Describe a Rule -------------------------------------------------------------

type Proposal = { mode: "live_ai" | "simulated"; modeNote: string; definition: PolicyDefinition; ambiguities: string[]; check: PolicyCheck };

export function DescribeRule() {
  const router = useRouter();
  const { t, fmt: f } = useI18n();
  const [category, setCategory] = useState<PolicyCategory>("refund");
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    setBusy(true); setError(null); setProposal(null);
    try { setProposal(await post("/api/policies/describe", { category, instruction }, "POST", t)); }
    catch (e) { setError(e instanceof Error ? e.message : t("rules.failed")); }
    finally { setBusy(false); }
  }
  async function saveDraft() {
    if (!proposal) return;
    setBusy(true); setError(null);
    try {
      const json = await post("/api/policies", { category, definition: proposal.definition, note: `From description: ${instruction}`.slice(0, 1000), source: proposal.mode === "live_ai" ? "ai_proposal" : "owner" }, "POST", t);
      router.push(`/rules/${json.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : t("rules.failed")); setBusy(false); }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="field"><label htmlFor="cat">{t("rules.requestCategory")}</label>
          <select id="cat" value={category} onChange={(e) => setCategory(e.target.value as PolicyCategory)}>
            {POLICY_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c, t)}</option>)}
          </select></div>
        <div className="field"><label htmlFor="instr">{t("rules.describeLabel")}</label>
          <p className="hint">{t("rules.describeHint")}</p>
          <textarea id="instr" dir="auto" value={instruction} maxLength={2000} onChange={(e) => setInstruction(e.target.value)} /></div>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="btn" type="button" onClick={propose} disabled={busy || instruction.trim().length < 10}>{busy ? t("rules.working") : t("rules.propose")}</button>
      </section>
      {proposal && (
        <section className="card stack">
          <div className="row"><span className="badge info">{proposal.mode === "live_ai" ? t("activity.mode.live_ai") : t("activity.mode.simulated")}</span><small lang="en">{proposal.modeNote}</small></div>
          <h2 dir="auto">{proposal.definition.title}</h2>
          <ul>{proposal.definition.rules.map((r) => (
            <li key={r.id}><span className={`badge ${r.colour}`}>{t(`domain.colourShort.${r.colour}`)}</span> <span dir="auto">{r.label}</span>{r.range ? `: ${describeRange(category, r.range, t, f)}` : ""}{r.financialImpact ? `, ${t("request.feesAffectedValue", { value: t(`domain.triState.${r.financialImpact}`) })}` : ""}</li>
          ))}</ul>
          {proposal.ambiguities.length > 0 && <div className="notice warning"><p><strong>{t("rules.checkBeforeSaving")}</strong></p><ul lang="en" dir="auto">{proposal.ambiguities.map((a) => <li key={a}>{a}</li>)}</ul></div>}
          <CheckView check={proposal.check} category={category} />
          <p>{t("rules.savingCreatesDraft")}</p>
          <button className="btn" type="button" onClick={saveDraft} disabled={busy}>{t("rules.saveAsDraft")}</button>
        </section>
      )}
    </div>
  );
}
