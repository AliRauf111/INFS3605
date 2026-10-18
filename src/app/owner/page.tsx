import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { ownerQueue } from "@/lib/data/queries";
import { formatAud } from "@/lib/domain/money";
import { REQUEST_TYPE_LABELS, TRI_STATE_LABELS } from "@/lib/domain/types";
import { ColourBadge, EmptyState, LoadError, StatusBadge, formatDateTime } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval Alley" };

const PRIORITY = (p: number) => (p < 10 ? "Urgent: welfare" : p < 20 ? "High: complaint" : p < 30 ? "High: red" : "Normal");

export default async function OwnerQueuePage() {
  const user = await requirePageUser();
  let items;
  try {
    items = await ownerQueue();
  } catch (e) {
    return <LoadError error={e} />;
  }
  const waiting = items.filter((i) => i.request.status === "awaiting_owner");
  const other = items.filter((i) => i.request.status !== "awaiting_owner");
  return (
    <div className="stack">
      <h1>Approval Alley</h1>
      {user.role !== "owner" && <p className="notice info">You can see the queue, but only the owner can approve, decline or ask for more information.</p>}
      <h2>Waiting for a decision ({waiting.length})</h2>
      {waiting.length === 0 && <EmptyState title="Nothing is waiting for the owner"><p>Requests appear here when an admin sends them for review.</p></EmptyState>}
      {waiting.map(({ request: r, priority, summary, events }) => (
        <article key={r.id} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>
              <Link href={`/requests/${r.id}`}>{REQUEST_TYPE_LABELS[r.request_type]}{r.amount_cents !== null ? ` of ${formatAud(r.amount_cents)}` : ""} · {r.reference_id ?? "no reference"}</Link>
            </h3>
            <div className="row"><span className="badge">{PRIORITY(priority)}</span><ColourBadge colour={r.decision} /></div>
          </div>
          <dl className="facts" style={{ marginTop: "0.5rem" }}>
            <dt>Rule</dt><dd><code>{r.matched_rule_id}</code> ({r.policy_version})</dd>
            <dt>Why</dt><dd>{r.decision_reason}</dd>
            <dt>Complaint / welfare</dt><dd>{r.complaint_status ? TRI_STATE_LABELS[r.complaint_status] : "Not answered"} / {r.welfare_status ? TRI_STATE_LABELS[r.welfare_status] : "Not answered"}</dd>
            <dt>Prepared summary</dt><dd style={{ whiteSpace: "pre-wrap" }}>{summary ?? <span className="muted">None</span>}</dd>
            <dt>History</dt><dd>{events.length} event{events.length === 1 ? "" : "s"}, created {formatDateTime(r.created_at)}, updated {formatDateTime(r.updated_at)}</dd>
          </dl>
          <p style={{ marginTop: "0.75rem" }}><Link className="btn small" href={`/requests/${r.id}`}>{user.role === "owner" ? "Review and decide" : "View request"}</Link></p>
        </article>
      ))}
      <h2>Prepared but not yet sent ({other.length})</h2>
      <p className="hint">Amber and red requests the admin is still clarifying or has not sent yet.</p>
      {other.length === 0 ? <p className="muted">None.</p> : (
        <ul>
          {other.map(({ request: r }) => (
            <li key={r.id}><Link href={`/requests/${r.id}`}>{REQUEST_TYPE_LABELS[r.request_type]} {r.reference_id ?? ""}</Link> <ColourBadge colour={r.decision} /> <StatusBadge status={r.status} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}
