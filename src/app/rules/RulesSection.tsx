import Link from "next/link";
import type { SessionUser } from "@/lib/auth/session";
import type { listPolicyVersions } from "@/lib/data/queries";
import { CATEGORY_CONFIG, POLICY_CATEGORIES, describeRange } from "@/lib/engine/policy";
import { ColourBadge, formatDateTime } from "@/components/ui";
import { NewDraftButton } from "./RulesClient";

type Versions = Awaited<ReturnType<typeof listPolicyVersions>>;

// The owner's rules, shown at the top of the Knowledge hub
export function RulesSection({ user, versions }: { user: Pick<SessionUser, "role">; versions: Versions }) {
  return (
    <section id="rules" className="stack" aria-labelledby="rules-heading">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 id="rules-heading">Rules</h2>
          <p className="muted">The owner&apos;s policies, by request type. Complaints and welfare concerns are always red, before these rules are checked.</p>
        </div>
        {user.role === "owner" && <Link className="btn" href="/rules/describe">Describe a rule</Link>}
      </div>
      {user.role !== "owner" && <p className="notice info">You can read the rules. Only the owner can edit or activate them.</p>}
      {POLICY_CATEGORIES.map((cat) => {
        const list = versions.filter((v) => v.category === cat);
        const active = list.find((v) => v.status === "active");
        return (
          <section key={cat} className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{CATEGORY_CONFIG[cat].label}</h3>
              {user.role === "owner" && active && <NewDraftButton category={cat} copyFromId={active.id} label="New draft from the active version" />}
            </div>
            {active ? (
              <div>
                <p><span className="badge green">Active</span> <Link href={`/rules/${active.id}`}>{active.definition.title}, version {active.version}</Link> <small>since {formatDateTime(active.activated_at)}</small></p>
                <ul>{active.definition.rules.map((r) => <li key={r.id}><ColourBadge colour={r.colour} /> {r.label}{r.range ? `: ${describeRange(cat, r.range)}` : ""}{r.financialImpact ? ` (fees affected: ${r.financialImpact})` : ""}</li>)}</ul>
              </div>
            ) : <p className="notice warning">No active version. Every {cat.replace("_", " ")} request is amber until one is activated.</p>}
            <details>
              <summary>All versions ({list.length})</summary>
              <ul>{list.map((v) => <li key={v.id}><Link href={`/rules/${v.id}`}>Version {v.version}</Link> <span className="badge">{v.status}</span> <small>{v.source === "seed" ? "seed" : v.source.replace("_", " ")}, created {formatDateTime(v.created_at)}{v.change_note ? `: ${v.change_note}` : ""}</small></li>)}</ul>
            </details>
          </section>
        );
      })}
    </section>
  );
}
