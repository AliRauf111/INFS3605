import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { coverageData } from "@/lib/data/queries";
import { FACT_TEXT, RULE_REASON_LABELS } from "@/lib/coverage/logic";
import { REQUEST_TYPE_LABELS, type RequestType } from "@/lib/domain/types";
import { EmptyState, LoadError, formatDateTime } from "@/components/ui";
import { SuggestionControls, RefreshSuggestions } from "./SuggestionControls";
import { IntegrationsSection } from "@/app/settings/integrations/IntegrationsSection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coverage" };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const reason = (rule: string) => RULE_REASON_LABELS[rule] ?? `Owner rule ${rule}`;

export default async function CoveragePage() {
  const user = await requirePageUser();
  let data;
  try {
    data = await coverageData();
  } catch (e) {
    return <LoadError error={e} />;
  }
  const m = data.metrics;
  const open = data.suggestions.filter((s) => s.status === "open");
  const pending = data.candidates.filter((c) => !data.suggestions.some((s) => s.summary === c.summary));
  return (
    <div className="stack">
      <h1>Rule coverage</h1>
      <p className="muted">Calculated from the {m.total} saved requests when this page loads. These figures count records; they do not estimate time saved.</p>
      {m.total === 0 ? <EmptyState title="No requests yet"><p>Metrics appear once requests are saved.</p></EmptyState> : (
        <>
          <div className="grid grid-3">
            <div className="card"><div className="stat">{pct(m.withinPolicyShare)}</div><div>Handled within existing owner rules</div><small>{m.withinPolicy} of {m.total} requests matched an owner rule, rather than a default amber route or a safety rule.</small></div>
            <div className="card"><div className="stat">{pct(m.greenShare)}</div><div>Green</div><small>{m.green} of {m.total} requests could follow approved steps without the owner.</small></div>
            <div className="card"><div className="stat">{m.awaitingOwner}</div><div>Waiting for owner review</div><small>Status is &ldquo;waiting for owner&rdquo; right now.</small></div>
          </div>

          <section className="card">
            <h2>Requests by category and colour</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>Category</th><th>Green</th><th>Amber</th><th>Red</th></tr></thead>
              <tbody>{m.byCategory.map(([cat, c]) => <tr key={cat}><td>{REQUEST_TYPE_LABELS[cat as RequestType] ?? cat}</td><td>{c.green}</td><td>{c.amber}</td><td>{c.red}</td></tr>)}</tbody>
            </table></div>
          </section>

          <div className="grid grid-2">
            <section className="card">
              <h2>Common reasons for amber</h2>
              <p className="hint">The rule or default route behind each amber decision.</p>
              {m.amberReasons.length ? <ul>{m.amberReasons.map(([r, n]) => <li key={r}>{reason(r)}: {n}</li>)}</ul> : <p className="muted">No amber requests.</p>}
            </section>
            <section className="card">
              <h2>Repeated missing information</h2>
              <p className="hint">Facts that were missing or uncertain in the current decision of each request.</p>
              {m.missingFacts.length ? <ul>{m.missingFacts.map(([f, n]) => <li key={f}>{FACT_TEXT[f] ?? f}: {n}</li>)}</ul> : <p className="muted">Nothing missing.</p>}
            </section>
            <section className="card">
              <h2>Frequently overridden rules</h2>
              <p className="hint">Amber or red decisions the owner then approved as an exception, by rule.</p>
              {m.overrides.length ? <ul>{m.overrides.map(([r, n]) => <li key={r}>{reason(r)}: {n}</li>)}</ul> : <p className="muted">No owner exceptions yet.</p>}
            </section>
          </div>
        </>
      )}

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Rule suggestions</h2>
          {user.role === "owner" && <RefreshSuggestions pending={pending.length} />}
        </div>
        <p className="hint">Found by looking for at least two owner approvals of the same amber or red rule with no complaint or welfare concern. Suggestions use pattern analysis, not AI. They stay inactive until the owner turns one into a draft, tests it and activates it. Past exceptions are not treated as general permission.</p>
        {open.length === 0 && <p className="muted">No open suggestions.{pending.length ? ` ${pending.length} new pattern${pending.length > 1 ? "s" : ""} found; the owner can add ${pending.length > 1 ? "them" : "it"}.` : ""}</p>}
        {data.suggestions.map((s) => (
          <article key={s.id} className="rule-card">
            <p>{s.summary}</p>
            <p><small>Based on: {s.based_on_request_ids.map((id, i) => <span key={id}>{i > 0 && ", "}<Link href={`/requests/${id}`}>case {i + 1}</Link></span>)} · {formatDateTime(s.created_at)} · <span className="badge">{s.status}</span></small></p>
            {s.status === "drafted" && s.draft_policy_version_id && <p><Link href={`/rules/${s.draft_policy_version_id}`}>Open the draft</Link></p>}
            {user.role === "owner" && s.status === "open" && <SuggestionControls id={s.id} />}
          </article>
        ))}
      </section>

      <IntegrationsSection />
    </div>
  );
}
