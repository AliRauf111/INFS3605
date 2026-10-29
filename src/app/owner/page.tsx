import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { ownerQueue, rowWorkflow } from "@/lib/data/queries";
import { pendingAccounts, type PendingAccount } from "@/lib/data/access";
import { AccessRequests } from "./AccessRequests";
import { formatAud } from "@/lib/domain/money";
import { REQUEST_TYPE_LABELS, TRI_STATE_LABELS } from "@/lib/domain/types";
import { ColourBadge, EmptyState, LoadError, StatusBadge, formatDateTime } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";

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
  // Only the owner sees new accounts. If the list can't load, the rest of the page still works.
  let accounts: PendingAccount[] = [];
  if (user.role === "owner") accounts = await pendingAccounts().catch(() => []);
  // The shared next-step rules decide which list each request is in, so this page agrees
  // with the dashboard and the request page.
  const owner = user.role === "owner";
  const withWf = items.map((i) => ({ ...i, wf: rowWorkflow(i.request, user.role) }));
  const waiting = withWf.filter((i) => (owner ? i.wf.queue === "review" : i.request.status === "awaiting_owner"));
  const other = withWf.filter((i) => !waiting.includes(i));
  return (
    <div className="stack">
      <PageHeader><h1>Approval Alley</h1></PageHeader>
      {!owner && <p className="notice info">You can see the queue, but only the owner can approve, decline or ask for more information.</p>}
      <h2>{owner ? "Requires Your Review" : "Waiting for a Decision"} ({waiting.length})</h2>
      {waiting.length === 0 && (
        <EmptyState title={owner ? "Nothing needs your review" : "Nothing is waiting for the owner"}>
          <p>{owner ? "Requests appear here when the rules say you need to see them, or when the admin team sends them to you." : "Requests appear here when an admin sends them for review."}</p>
        </EmptyState>
      )}
      {waiting.map(({ request: r, priority, summary, events, wf }) => (
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
            <dt>Prepared summary</dt><dd style={{ whiteSpace: "pre-wrap" }}>{summary ?? <span className="muted">{r.status === "awaiting_owner" ? "None" : "Not sent by the admin team yet"}</span>}</dd>
            {owner && <><dt>Your review</dt><dd>{wf.reviewStarted ? `Started ${formatDateTime(r.owner_review_started_at!)}` : "Not started"}</dd></>}
            <dt>History</dt><dd>{events.length} event{events.length === 1 ? "" : "s"}, created {formatDateTime(r.created_at)}, updated {formatDateTime(r.updated_at)}</dd>
          </dl>
          <p style={{ marginTop: "0.75rem" }}><Link className="btn small" href={`/requests/${r.id}`}>{owner ? (wf.reviewStarted ? "Continue Review" : "Review and Handle") : "View Request"}</Link></p>
        </article>
      ))}
      {accounts.length > 0 && (
        <section className="card" aria-labelledby="access-heading">
          <h2 id="access-heading" style={{ marginTop: 0 }}>New accounts waiting for access ({accounts.length})</h2>
          <p className="hint">These people created an account on the sign-in page. Give access to let them sign in as an admin.</p>
          <AccessRequests accounts={accounts} />
        </section>
      )}
      <h2>{owner ? "Waiting for Missing Details" : "Prepared but Not Yet Sent"} ({other.length})</h2>
      <p className="hint">{owner ? "Required details are missing, so these can't be decided yet. They move to Requires Your Review once the details are complete." : "Yellow and red requests still being clarified or not sent yet."}</p>
      {other.length === 0 ? <p className="muted">None.</p> : (
        <ul>
          {other.map(({ request: r, wf }) => (
            <li key={r.id}><Link href={`/requests/${r.id}`}>{REQUEST_TYPE_LABELS[r.request_type]} {r.reference_id ?? ""}</Link> <ColourBadge colour={r.decision} /> <StatusBadge status={r.status} /> <span className="hint">Next: {wf.title}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
