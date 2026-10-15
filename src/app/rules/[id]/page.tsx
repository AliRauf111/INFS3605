import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/page";
import { getPolicyVersion, userNames } from "@/lib/data/queries";
import { ACTION_LABELS } from "@/lib/domain/types";
import { CATEGORY_CONFIG, FACT_LABELS, describeRange, type PolicyCategory } from "@/lib/engine/policy";
import { validatePolicy } from "@/lib/engine/validate-policy";
import { ColourBadge, formatDateTime } from "@/components/ui";
import { NewDraftButton, RuleEditor } from "../RulesClient";
import { ReadOnlyTest } from "./ReadOnlyTest";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rule version" };

export default async function RuleVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const v = await getPolicyVersion((await params).id);
  if (!v) notFound();
  const names = await userNames();
  const cat = v.category as PolicyCategory;
  const def = v.definition;
  const check = validatePolicy(def);
  const editable = v.status === "draft" && user.role === "owner";
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{def.title}</h1>
          <p className="muted">
            {CATEGORY_CONFIG[cat].label}, version {v.version} <span className="badge">{v.status}</span> · created {formatDateTime(v.created_at)}{v.created_by ? ` by ${names.get(v.created_by)}` : ""}
            {v.activated_at && ` · activated ${formatDateTime(v.activated_at)}${v.activated_by ? ` by ${names.get(v.activated_by)}` : ""}`}
            {v.archived_at && ` · archived ${formatDateTime(v.archived_at)}`}
          </p>
          {v.change_note && <p>Note: {v.change_note}</p>}
        </div>
        <Link className="btn secondary small" href="/rules">All rules</Link>
      </div>
      {editable ? (
        <RuleEditor versionId={v.id} initial={def} version={v.version} />
      ) : (
        <>
          {v.status === "draft" && <p className="notice info">This is a draft. Only the owner can edit or activate it.</p>}
          {v.status !== "draft" && <p className="notice info">{v.status === "active" ? "Active" : "Archived"} versions cannot be edited, so past decisions always show the rules they used.{user.role === "owner" ? " Create a new draft to make changes." : ""}</p>}
          {user.role === "owner" && v.status !== "draft" && <NewDraftButton category={cat} copyFromId={v.id} label="Create a new draft from this version" />}
          <section className="card">
            <h2>Required facts for green</h2>
            <ul>{def.requiredFacts.map((f) => <li key={f}>{FACT_LABELS[f]}</li>)}</ul>
          </section>
          {def.rules.map((r) => (
            <section key={r.id} className={`rule-card ${r.colour}`}>
              <h3>{r.label} <ColourBadge colour={r.colour} /></h3>
              <dl className="facts">
                <dt>Rule ID</dt><dd><code>{r.id}</code></dd>
                {CATEGORY_CONFIG[cat].numeric && <><dt>{CATEGORY_CONFIG[cat].numeric!.label}</dt><dd>{describeRange(cat, r.range)}</dd></>}
                {r.financialImpact && <><dt>Fees affected</dt><dd>{r.financialImpact}</dd></>}
                <dt>Permitted actions</dt><dd>{r.permittedActions.map((a) => ACTION_LABELS[a]).join(", ") || "None"}</dd>
                <dt>Next steps</dt><dd>{r.nextSteps.length ? <ol>{r.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol> : "None"}</dd>
                <dt>Escalation</dt><dd>{r.escalation || "None"}</dd>
              </dl>
            </section>
          ))}
          <section className="card">
            <h2>Checks</h2>
            {check.issues.length === 0 ? <p>No gaps, overlaps or errors.</p> : <ul>{check.issues.map((i) => <li key={i.message}><strong>{i.level}:</strong> {i.message}</li>)}</ul>}
          </section>
          <ReadOnlyTest definition={def} />
        </>
      )}
    </div>
  );
}
