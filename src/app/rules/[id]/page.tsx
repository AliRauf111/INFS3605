import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/page";
import { getPolicyVersion, userNames } from "@/lib/data/queries";
import { CATEGORY_CONFIG, categoryLabel, describeRange, factLabel, type PolicyCategory } from "@/lib/engine/policy";
import { validatePolicy } from "@/lib/engine/validate-policy";
import { ColourBadge } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { NewDraftButton, RuleEditor } from "../RulesClient";
import { ReadOnlyTest } from "./ReadOnlyTest";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("rules.versionTitle") };
}

export default async function RuleVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { t, fmt } = await getI18n();
  const v = await getPolicyVersion((await params).id);
  if (!v) notFound();
  const names = await userNames();
  const cat = v.category as PolicyCategory;
  const def = v.definition;
  const check = validatePolicy(def);
  const editable = v.status === "draft" && user.role === "owner";
  return (
    <div className="stack">
      <PageHeader actions={<Link className="btn secondary" href="/knowledge#rules">{t("rules.allRules")}</Link>}>
        <h1 dir="auto">{def.title}</h1>
        <p className="muted">
          {categoryLabel(cat, t)}, {t("rules.versionLower", { version: v.version })} <span className="badge">{v.status === "draft" || v.status === "active" || v.status === "archived" ? t(`rules.status.${v.status}`) : v.status}</span> · {v.created_by ? t("rules.createdBy", { when: fmt.dateTime(v.created_at), name: names.get(v.created_by) ?? "" }) : t("rules.created", { when: fmt.dateTime(v.created_at) })}
          {v.activated_at && ` · ${v.activated_by ? t("rules.activatedBy", { when: fmt.dateTime(v.activated_at), name: names.get(v.activated_by) ?? "" }) : t("rules.activatedAt", { when: fmt.dateTime(v.activated_at) })}`}
          {v.archived_at && ` · ${t("rules.archivedAt", { when: fmt.dateTime(v.archived_at) })}`}
        </p>
        {v.change_note && <p>{t("rules.note")} <span dir="auto">{v.change_note}</span></p>}
      </PageHeader>
      {editable ? (
        <RuleEditor versionId={v.id} initial={def} version={v.version} />
      ) : (
        <>
          {v.status === "draft" && <p className="notice info">{t("rules.draftReadOnly")}</p>}
          {v.status !== "draft" && <p className="notice info">{v.status === "active" ? t("rules.activeLocked") : t("rules.archivedLocked")}{user.role === "owner" ? ` ${t("rules.createDraftToChange")}` : ""}</p>}
          {user.role === "owner" && v.status !== "draft" && <NewDraftButton category={cat} copyFromId={v.id} label={t("rules.newDraftFromThis")} />}
          <section className="card">
            <h2>{t("rules.requiredFacts")}</h2>
            <ul>{def.requiredFacts.map((f) => <li key={f}>{factLabel(f, t)}</li>)}</ul>
          </section>
          {def.rules.map((r) => (
            <section key={r.id} className={`rule-card ${r.colour}`}>
              <h3><span dir="auto">{r.label}</span> <ColourBadge colour={r.colour} /></h3>
              <dl className="facts">
                <dt>{t("rules.ruleId")}</dt><dd><code>{r.id}</code></dd>
                {CATEGORY_CONFIG[cat].numeric && <><dt>{t(`rules.numeric.${cat as "refund"}`)}</dt><dd>{describeRange(cat, r.range, t, fmt)}</dd></>}
                {r.financialImpact && <><dt>{t("request.feesAffected")}</dt><dd>{t(`domain.triState.${r.financialImpact}`)}</dd></>}
                <dt>{t("request.permittedActions")}</dt><dd>{fmt.list(r.permittedActions.map((a) => t(`domain.action.${a}`))) || t("common.none")}</dd>
                <dt>{t("rules.nextSteps")}</dt><dd dir="auto">{r.nextSteps.length ? <ol>{r.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol> : t("common.none")}</dd>
                <dt>{t("request.escalation")}</dt><dd dir="auto">{r.escalation || t("common.none")}</dd>
              </dl>
            </section>
          ))}
          <section className="card">
            <h2>{t("rules.checks")}</h2>
            {check.issues.length === 0 ? <p>{t("rules.noGaps")}</p> : <ul>{check.issues.map((i) => <li key={i.message}><strong>{i.level === "error" ? t("rules.levelError") : t("rules.levelWarning")}:</strong> <span lang="en">{i.message}</span></li>)}</ul>}
          </section>
          <ReadOnlyTest definition={def} />
        </>
      )}
    </div>
  );
}
