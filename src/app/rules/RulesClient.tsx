"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIONS, ACTION_LABELS, COLOURS, type ActionKey, type Colour } from "@/lib/domain/types";
import { centsToInput, formatAud, parseAmountToCents } from "@/lib/domain/money";
import {
  CATEGORY_CONFIG,
  FACT_LABELS,
  POLICY_CATEGORIES,
  type FactKey,
  type PolicyCategory,
  type PolicyDefinition,
} from "@/lib/engine/policy";
import type { PolicyCheck } from "@/lib/engine/validate-policy";
import type { DecisionResult } from "@/lib/engine/evaluate";

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(json.details) ? json.details.map((d: { message?: string } | string) => (typeof d === "string" ? d : d.message)).join(" ") : "";
    throw new Error(`${json.error ?? `Request failed (${res.status}).`} ${details}`.trim());
  }
  return json;
}

export function NewDraftButton({ category, copyFromId, label }: { category: PolicyCategory; copyFromId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button className="btn secondary small" type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          const json = await post("/api/policies", { category, copyFromId, note: "Copied for editing" });
          router.push(`/rules/${json.id}`);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed.");
          setBusy(false);
        }
      }}>{busy ? "Creating…" : label}</button>
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

function fromUi(category: PolicyCategory, title: string, required: FactKey[], rules: UiRule[]): { def?: PolicyDefinition; errors: string[] } {
  const config = CATEGORY_CONFIG[category];
  const errors: string[] = [];
  const num = (text: string, what: string): number | null => {
    if (!text.trim()) return null;
    if (config.numeric?.unit === "cents") {
      const p = parseAmountToCents(text);
      if (!p.ok) { errors.push(`${what}: ${p.error}`); return null; }
      return p.cents;
    }
    if (!/^\d{1,3}$/.test(text.trim())) { errors.push(`${what}: enter whole days.`); return null; }
    return Number(text.trim());
  };
  const out = rules.map((r, i) => {
    const min = num(r.minText, `Rule ${i + 1} lower limit`);
    const max = num(r.maxText, `Rule ${i + 1} upper limit`);
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
  const errs = check.issues.filter((i) => i.level === "error");
  const warns = check.issues.filter((i) => i.level === "warning");
  return (
    <div className="stack" aria-live="polite">
      {errs.length === 0 ? <p className="notice success">No errors. This version can be activated{warns.length ? " once you acknowledge the warnings" : ""}.</p> : (
        <div className="notice error"><p><strong>{errs.length} error{errs.length > 1 ? "s" : ""} block activation</strong></p><ul>{errs.map((e) => <li key={e.message}>{e.message}</li>)}</ul></div>
      )}
      {warns.length > 0 && <div className="notice warning"><p><strong>Warnings</strong></p><ul>{warns.map((e) => <li key={e.message}>{e.message}</li>)}</ul></div>}
      <p className="hint">Default route: anything no rule covers, and anything with missing, uncertain or conflicting information, is amber. Complaints and welfare concerns are always red.</p>
      {check.boundaryCases.length > 0 && (
        <div>
          <h3>Boundary cases</h3>
          <p className="hint">What the engine would decide at each threshold, assuming every record is found and consistent.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>{CATEGORY_CONFIG[category].numeric ? CATEGORY_CONFIG[category].numeric!.label : "Case"}</th><th>Result</th><th>Rule</th></tr></thead>
            <tbody>{check.boundaryCases.map((c) => <tr key={c.label}><td>{c.label}</td><td><span className={`badge ${c.colour}`}>{c.colour}</span></td><td><code>{c.matchedRuleId}</code></td></tr>)}</tbody>
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
  const tri = (label: string, v: string, set: (x: "" | "yes" | "no" | "unsure") => void, id: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={v} onChange={(e) => set(e.target.value as "" | "yes" | "no" | "unsure")}>
        <option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option><option value="unsure">Not sure</option>
      </select>
    </div>
  );
  async function run() {
    setError(null);
    setResult(null);
    const def = definition();
    if (!def) return setError("Fix the form errors first.");
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
      });
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed.");
    }
  }
  const cat = definition()?.category;
  return (
    <section className="card">
      <h2>Test with a sample request</h2>
      <p className="hint">Runs the real engine on this version with sample evidence where the booking, payment and tutor slot are all found and consistent. Nothing is saved.</p>
      <div className="grid grid-3">
        {cat === "refund" && <div className="field"><label htmlFor="t-amount">Amount (AUD)</label><input id="t-amount" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>}
        {cat === "payment_extension" && <div className="field"><label htmlFor="t-days">Extra days</label><input id="t-days" type="text" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></div>}
        {cat === "lesson_change" && tri("Fees affected", impact, setImpact, "t-impact")}
        {tri("Complaint", complaint, setComplaint, "t-complaint")}
        {tri("Welfare concern", welfare, setWelfare, "t-welfare")}
      </div>
      <button className="btn secondary" type="button" onClick={run}>Run test</button>
      {error && <p className="notice error" role="alert" style={{ marginTop: "0.75rem" }}>{error}</p>}
      {result && (
        <div className={`banner ${result.colour}`} style={{ marginTop: "0.75rem" }} role="status">
          <span className="icon" aria-hidden="true">{result.colour === "green" ? "✓" : result.colour === "amber" ? "!" : "■"}</span>
          <div><h2>{result.colour.toUpperCase()}: {result.outcomeLabel}</h2><p>{result.explanation}</p><p><code>{result.matchedRuleId}</code></p></div>
        </div>
      )}
    </section>
  );
}

export function RuleEditor({ versionId, initial, version }: { versionId: string; initial: PolicyDefinition; version: number }) {
  const router = useRouter();
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
  const unitHint = config.numeric?.unit === "cents" ? "AUD, e.g. 50.00" : "whole days";

  const build = () => fromUi(category, title, required, rules);
  const update = (i: number, patch: Partial<UiRule>) => { setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setCheck(null); };

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try { await fn(); } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "Failed." }); } finally { setBusy(false); }
  }
  const runCheck = () => act(async () => {
    const b = build();
    if (!b.def) throw new Error(b.errors.join(" "));
    setCheck(await post("/api/policies/check", { definition: b.def }));
  });
  const save = () => act(async () => {
    const b = build();
    if (!b.def) throw new Error(b.errors.join(" "));
    const json = await post(`/api/policies/${versionId}`, { definition: b.def }, "PUT");
    setCheck(json.check);
    setMessage({ kind: "success", text: "Draft saved. It is not active." });
    router.refresh();
  });
  const activate = () => act(async () => {
    const b = build();
    if (!b.def) throw new Error(b.errors.join(" "));
    await post(`/api/policies/${versionId}`, { definition: b.def }, "PUT");
    await post(`/api/policies/${versionId}/activate`, { note: activateNote, acknowledgeWarnings: ack });
    setMessage({ kind: "success", text: "Activated. New requests now use this version. Past decisions keep the version they used." });
    router.refresh();
  });
  const remove = () => act(async () => {
    if (!window.confirm("Delete this draft? Active and archived versions are not affected.")) return;
    await post(`/api/policies/${versionId}`, {}, "DELETE");
    router.push("/knowledge#rules");
  });

  return (
    <div className="stack">
      <section className="card">
        <h2>Draft version {version}</h2>
        <div className="field"><label htmlFor="title">Title</label><input id="title" type="text" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></div>
        <fieldset>
          <legend>Facts that must be confirmed before green</legend>
          {config.allowedFacts.map((f) => (
            <label className="check" key={f}>
              <input type="checkbox" checked={required.includes(f)} onChange={(e) => { setRequired(e.target.checked ? [...required, f] : required.filter((x) => x !== f)); setCheck(null); }} />
              {FACT_LABELS[f]}
            </label>
          ))}
        </fieldset>
      </section>

      {rules.map((r, i) => (
        <section key={i} className={`rule-card ${r.colour}`} aria-label={`Rule ${i + 1}`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Rule {i + 1}</h3>
            <div className="row">
              <button className="btn secondary small" type="button" disabled={i === 0} onClick={() => setRules((rs) => { const c = [...rs]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; })}>Move up</button>
              <button className="btn secondary small" type="button" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} disabled={rules.length === 1}>Remove</button>
            </div>
          </div>
          <div className="grid grid-2" style={{ marginTop: "0.5rem" }}>
            <div className="field"><label htmlFor={`label-${i}`}>Name</label><input id={`label-${i}`} type="text" value={r.label} maxLength={120} onChange={(e) => update(i, { label: e.target.value })} /></div>
            <div className="field"><label htmlFor={`id-${i}`}>Rule ID</label><input id={`id-${i}`} type="text" value={r.id} maxLength={60} onChange={(e) => update(i, { id: e.target.value.toLowerCase() })} /></div>
            {config.numeric && (
              <>
                <div className="field"><label htmlFor={`min-${i}`}>{config.numeric.label}: at least</label><p className="hint">{unitHint}. Blank means no lower limit.</p><input id={`min-${i}`} type="text" value={r.minText} onChange={(e) => update(i, { minText: e.target.value })} /></div>
                <div className="field">
                  <label htmlFor={`max-${i}`}>Upper limit</label>
                  <p className="hint">{unitHint}. Blank means no upper limit.</p>
                  <div className="row">
                    <select aria-label="Upper limit type" value={r.maxInclusive ? "lte" : "lt"} onChange={(e) => update(i, { maxInclusive: e.target.value === "lte" })} style={{ width: "auto" }}>
                      <option value="lte">up to and including</option><option value="lt">below</option>
                    </select>
                    <input id={`max-${i}`} type="text" value={r.maxText} onChange={(e) => update(i, { maxText: e.target.value })} style={{ flex: 1, width: "auto" }} />
                  </div>
                </div>
              </>
            )}
            {config.usesFinancialImpact && (
              <div className="field"><label htmlFor={`fi-${i}`}>Fees affected</label>
                <select id={`fi-${i}`} value={r.financialImpact} onChange={(e) => update(i, { financialImpact: e.target.value as "" | "yes" | "no" })}>
                  <option value="">Either</option><option value="no">No</option><option value="yes">Yes</option>
                </select></div>
            )}
            <div className="field"><label htmlFor={`colour-${i}`}>Decision colour</label>
              <select id={`colour-${i}`} value={r.colour} onChange={(e) => update(i, { colour: e.target.value as Colour })}>
                {COLOURS.map((c) => <option key={c} value={c}>{c === "green" ? "Green: admin may proceed" : c === "amber" ? "Yellow: clarify or owner approves" : "Red: owner only"}</option>)}
              </select></div>
          </div>
          <fieldset>
            <legend>Permitted actions</legend>
            <div className="choices">
              {ACTIONS.map((a) => (
                <label className="choice" key={a}><input type="checkbox" checked={r.actions.includes(a)} onChange={(e) => update(i, { actions: e.target.checked ? [...r.actions, a] : r.actions.filter((x) => x !== a) })} />{ACTION_LABELS[a]}</label>
              ))}
            </div>
          </fieldset>
          <div className="field"><label htmlFor={`steps-${i}`}>Next steps (one per line)</label><textarea id={`steps-${i}`} value={r.stepsText} onChange={(e) => update(i, { stepsText: e.target.value })} /></div>
          <div className="field"><label htmlFor={`esc-${i}`}>Escalation instructions</label><input id={`esc-${i}`} type="text" value={r.escalation} maxLength={500} onChange={(e) => update(i, { escalation: e.target.value })} /></div>
        </section>
      ))}
      <div className="row">
        <button className="btn secondary" type="button" disabled={rules.length >= 20} onClick={() => setRules((rs) => [...rs, { id: `${category}.rule_${rs.length + 1}`, label: "New rule", minText: "", maxText: "", maxInclusive: true, financialImpact: "", colour: "amber", actions: ["send_to_owner"], stepsText: "", escalation: "" }])}>Add a rule</button>
      </div>

      <section className="card stack">
        <h2>Check, save and activate</h2>
        {message && <p className={`notice ${message.kind}`} role="status">{message.text}</p>}
        <div className="row">
          <button className="btn secondary" type="button" onClick={runCheck} disabled={busy}>Check for gaps and overlaps</button>
          <button className="btn" type="button" onClick={save} disabled={busy}>Save draft</button>
          <button className="btn danger" type="button" onClick={remove} disabled={busy}>Delete draft</button>
        </div>
        {check && <CheckView check={check} category={category} />}
        <div className="field">
          <label htmlFor="activate-note">Why are you activating this version?</label>
          <textarea id="activate-note" value={activateNote} maxLength={1000} onChange={(e) => setActivateNote(e.target.value)} />
        </div>
        <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have read any warnings and checked the boundary cases.</label>
        <button className="btn" type="button" onClick={activate} disabled={busy || !activateNote.trim()}>Activate this version</button>
        <p className="hint">Activating archives the current active version. Past decisions keep the exact version they used. Only you can activate rules; AI cannot.</p>
      </section>

      <TestArea definition={() => build().def ?? null} />
    </div>
  );
}

// ---- Describe a Rule -------------------------------------------------------------

type Proposal = { mode: "live_ai" | "simulated"; modeNote: string; definition: PolicyDefinition; ambiguities: string[]; check: PolicyCheck };

export function DescribeRule() {
  const router = useRouter();
  const [category, setCategory] = useState<PolicyCategory>("refund");
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    setBusy(true); setError(null); setProposal(null);
    try { setProposal(await post("/api/policies/describe", { category, instruction })); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed."); }
    finally { setBusy(false); }
  }
  async function saveDraft() {
    if (!proposal) return;
    setBusy(true); setError(null);
    try {
      const json = await post("/api/policies", { category, definition: proposal.definition, note: `From description: ${instruction}`.slice(0, 1000), source: proposal.mode === "live_ai" ? "ai_proposal" : "owner" });
      router.push(`/rules/${json.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed."); setBusy(false); }
  }
  const fmt = (cat: PolicyCategory, v: number | null) => (v === null ? "no limit" : CATEGORY_CONFIG[cat].numeric?.unit === "cents" ? formatAud(v) : `${v} days`);

  return (
    <div className="stack">
      <section className="card">
        <div className="field"><label htmlFor="cat">Request category</label>
          <select id="cat" value={category} onChange={(e) => setCategory(e.target.value as PolicyCategory)}>
            {POLICY_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_CONFIG[c].label}</option>)}
          </select></div>
        <div className="field"><label htmlFor="instr">Describe the rule in your own words</label>
          <p className="hint">For example: &ldquo;Admin can refund up to $60 if there is no complaint. $60 to $250 needs my approval. Anything over $250 is my call.&rdquo;</p>
          <textarea id="instr" value={instruction} maxLength={2000} onChange={(e) => setInstruction(e.target.value)} /></div>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="btn" type="button" onClick={propose} disabled={busy || instruction.trim().length < 10}>{busy ? "Working…" : "Propose a draft"}</button>
      </section>
      {proposal && (
        <section className="card stack">
          <div className="row"><span className="badge info">{proposal.mode === "live_ai" ? "Live AI" : "Simulated (no AI)"}</span><small>{proposal.modeNote}</small></div>
          <h2>{proposal.definition.title}</h2>
          <ul>{proposal.definition.rules.map((r) => (
            <li key={r.id}><span className={`badge ${r.colour}`}>{r.colour}</span> {r.label}{r.range ? `: from ${fmt(category, r.range.min)} ${r.range.maxInclusive ? "up to and including" : "below"} ${fmt(category, r.range.max)}` : ""}{r.financialImpact ? `, fees affected: ${r.financialImpact}` : ""}</li>
          ))}</ul>
          {proposal.ambiguities.length > 0 && <div className="notice warning"><p><strong>Check these before saving</strong></p><ul>{proposal.ambiguities.map((a) => <li key={a}>{a}</li>)}</ul></div>}
          <CheckView check={proposal.check} category={category} />
          <p>Saving creates an inactive draft. You can edit and test it, and only you can activate it.</p>
          <button className="btn" type="button" onClick={saveDraft} disabled={busy}>Save as draft and edit</button>
        </section>
      )}
    </div>
  );
}
