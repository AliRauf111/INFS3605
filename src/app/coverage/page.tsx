import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { coverageData } from "@/lib/data/queries";
import { FACT_TEXT, RULE_REASON_LABELS } from "@/lib/coverage/logic";
import { REQUEST_TYPES, type RequestType } from "@/lib/domain/types";
import { EmptyState, LoadError } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { SuggestionControls, RefreshSuggestions } from "./SuggestionControls";
import { IntegrationsSection } from "@/app/settings/integrations/IntegrationsSection";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("coverage.title") };
}

export default async function CoveragePage() {
  const user = await requirePageUser();
  const { t, fmt } = await getI18n();
  const pct = (x: number) => fmt.number(x, { style: "percent", maximumFractionDigits: 0 });
  const reason = (rule: string) => (RULE_REASON_LABELS[rule] ? t(`coverage.reason.${rule.replace(".", "_") as "default_missing_information"}`) : t("coverage.ownerRule", { rule }));
  const factText = (f: string) => (FACT_TEXT[f] ? t(`coverage.fact.${f as "amount"}`) : f);
  const statusText = (s: string) => (s === "open" || s === "drafted" || s === "dismissed" ? t(`coverage.suggestionStatus.${s}`) : s);
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
      <PageHeader>
        <h1>{t("coverage.title")}</h1>
        <p className="muted">{t("coverage.intro", { count: m.total })}</p>
      </PageHeader>
      {m.total === 0 ? <EmptyState title={t("requests.table.emptyActive")}><p>{t("coverage.metricsAppear")}</p></EmptyState> : (
        <>
          <div className="grid grid-3">
            <div className="card"><div className="stat">{pct(m.withinPolicyShare)}</div><div>{t("coverage.withinRules")}</div><small>{t("coverage.withinRulesText", { n: m.withinPolicy, count: m.total })}</small></div>
            <div className="card"><div className="stat">{pct(m.greenShare)}</div><div>{t("domain.colourShort.green")}</div><small>{t("coverage.greenText", { n: m.green, count: m.total })}</small></div>
            <div className="card"><div className="stat">{fmt.number(m.awaitingOwner)}</div><div>{t("coverage.waiting")}</div><small>{t("coverage.waitingText")}</small></div>
          </div>

          <section className="card">
            <h2>{t("coverage.byCategory")}</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>{t("coverage.category")}</th><th>{t("domain.colourShort.green")}</th><th>{t("domain.colourShort.amber")}</th><th>{t("domain.colourShort.red")}</th></tr></thead>
              <tbody>{m.byCategory.map(([cat, c]) => <tr key={cat}><td>{(REQUEST_TYPES as readonly string[]).includes(cat) ? t(`domain.requestType.${cat as RequestType}`) : cat}</td><td>{fmt.number(c.green)}</td><td>{fmt.number(c.amber)}</td><td>{fmt.number(c.red)}</td></tr>)}</tbody>
            </table></div>
          </section>

          <div className="grid grid-2">
            <section className="card">
              <h2>{t("coverage.amberReasons")}</h2>
              <p className="hint">{t("coverage.amberReasonsHint")}</p>
              {m.amberReasons.length ? <ul>{m.amberReasons.map(([r, n]) => <li key={r}>{reason(r)}: {fmt.number(n)}</li>)}</ul> : <p className="muted">{t("coverage.noAmber")}</p>}
            </section>
            <section className="card">
              <h2>{t("coverage.missing")}</h2>
              <p className="hint">{t("coverage.missingHint")}</p>
              {m.missingFacts.length ? <ul>{m.missingFacts.map(([f, n]) => <li key={f}>{factText(f)}: {fmt.number(n)}</li>)}</ul> : <p className="muted">{t("coverage.nothingMissing")}</p>}
            </section>
            <section className="card">
              <h2>{t("coverage.overridden")}</h2>
              <p className="hint">{t("coverage.overriddenHint")}</p>
              {m.overrides.length ? <ul>{m.overrides.map(([r, n]) => <li key={r}>{reason(r)}: {fmt.number(n)}</li>)}</ul> : <p className="muted">{t("coverage.noExceptions")}</p>}
            </section>
          </div>
        </>
      )}

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{t("coverage.suggestions")}</h2>
          {user.role === "owner" && <RefreshSuggestions pending={pending.length} />}
        </div>
        <p className="hint">{t("coverage.suggestionsHint")}</p>
        {open.length === 0 && <p className="muted">{t("coverage.noOpen")}{pending.length ? ` ${t("coverage.newPatterns", { count: pending.length })}` : ""}</p>}
        {data.suggestions.map((s) => (
          <article key={s.id} className="rule-card">
            <p lang="en" dir="auto">{s.summary}</p>
            <p><small>{t("coverage.basedOn")} {s.based_on_request_ids.map((id, i) => <span key={id}>{i > 0 && ", "}<Link href={`/requests/${id}`}>{t("coverage.caseN", { n: i + 1 })}</Link></span>)} · {fmt.dateTime(s.created_at)} · <span className="badge">{statusText(s.status)}</span></small></p>
            {s.status === "drafted" && s.draft_policy_version_id && <p><Link href={`/rules/${s.draft_policy_version_id}`}>{t("coverage.openDraft")}</Link></p>}
            {user.role === "owner" && s.status === "open" && <SuggestionControls id={s.id} />}
          </article>
        ))}
      </section>

      <IntegrationsSection />
    </div>
  );
}
