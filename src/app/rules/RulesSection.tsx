import Link from "next/link";
import type { SessionUser } from "@/lib/auth/session";
import type { listPolicyVersions } from "@/lib/data/queries";
import { POLICY_CATEGORIES, categoryLabel, describeRange } from "@/lib/engine/policy";
import { ColourBadge } from "@/components/ui";
import { NewDraftButton } from "./RulesClient";
import { getI18n } from "@/lib/i18n/server";

const VERSION_STATUSES = ["draft", "active", "archived"] as const;

type Versions = Awaited<ReturnType<typeof listPolicyVersions>>;

// The owner's rules, shown at the top of the Knowledge Hub
export async function RulesSection({ user, versions }: { user: Pick<SessionUser, "role">; versions: Versions }) {
  const { t, fmt } = await getI18n();
  const statusText = (s: string) => ((VERSION_STATUSES as readonly string[]).includes(s) ? t(`rules.status.${s as "draft"}`) : s);
  const sourceText = (s: string) => (s === "seed" || s === "owner" || s === "ai_proposal" ? t(`rules.source.${s}`) : s.replace("_", " "));
  return (
    <section id="rules" className="stack" aria-labelledby="rules-heading">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 id="rules-heading">{t("rules.heading")}</h2>
          <p className="muted">{t("rules.intro")}</p>
        </div>
        {user.role === "owner" && <Link className="btn" href="/rules/describe">{t("rules.describeRule")}</Link>}
      </div>
      {user.role !== "owner" && <p className="notice info">{t("rules.readOnly")}</p>}
      {POLICY_CATEGORIES.map((cat) => {
        const list = versions.filter((v) => v.category === cat);
        const active = list.find((v) => v.status === "active");
        return (
          <section key={cat} className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{categoryLabel(cat, t)}</h3>
              {user.role === "owner" && active && <NewDraftButton category={cat} copyFromId={active.id} label={t("rules.newDraftFromActive")} />}
            </div>
            {active ? (
              <div>
                <p><span className="badge lilac">{t("rules.status.active")}</span> <Link href={`/rules/${active.id}`}><span dir="auto">{active.definition.title}</span>, {t("rules.versionLower", { version: active.version })}</Link> <small>{t("rules.since", { when: fmt.dateTime(active.activated_at) })}</small></p>
                <ul>{active.definition.rules.map((r) => <li key={r.id}><ColourBadge colour={r.colour} /> <span dir="auto">{r.label}</span>{r.range ? `: ${describeRange(cat, r.range, t, fmt)}` : ""}{r.financialImpact ? ` (${t("request.feesAffectedValue", { value: t(`domain.triState.${r.financialImpact}`) })})` : ""}</li>)}</ul>
              </div>
            ) : <p className="notice warning">{t("rules.noActive", { category: categoryLabel(cat, t) })}</p>}
            <details>
              <summary>{t("rules.allVersions", { count: list.length })}</summary>
              <ul>{list.map((v) => <li key={v.id}><Link href={`/rules/${v.id}`}>{t("rules.version", { version: v.version })}</Link> <span className="badge">{statusText(v.status)}</span> <small>{t("rules.sourceCreated", { source: sourceText(v.source), when: fmt.dateTime(v.created_at) })}{v.change_note ? <>: <span dir="auto">{v.change_note}</span></> : ""}</small></li>)}</ul>
            </details>
          </section>
        );
      })}
    </section>
  );
}
