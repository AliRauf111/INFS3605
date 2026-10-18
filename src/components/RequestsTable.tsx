import Link from "next/link";
import type { RequestRow } from "@/lib/data/queries";
import { formatAud } from "@/lib/domain/money";
import { REQUEST_TYPE_LABELS } from "@/lib/domain/types";
import { ColourBadge, EmptyState, StatusBadge, formatDateTime } from "./ui";

export function RequestsTable({ rows }: { rows: RequestRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No requests yet">
        <p>Requests appear here once they are saved. <Link href="/requests/new/wizard">Create the first one</Link>.</p>
      </EmptyState>
    );
  }
  return (
    <>
    {/* Phones get a simple list; wider screens get the full table. */}
    <ul className="request-cards" aria-label="Requests, newest first">
      {rows.map((r) => (
        <li key={r.id} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Link href={`/requests/${r.id}`}><strong>{REQUEST_TYPE_LABELS[r.request_type]}{r.amount_cents === null ? "" : `, ${formatAud(r.amount_cents)}`}</strong></Link>
            <ColourBadge colour={r.decision} />
          </div>
          <p className="hint">{r.reference_id ?? "No reference"} · {formatDateTime(r.created_at)}</p>
          <StatusBadge status={r.status} />
        </li>
      ))}
    </ul>
    <div className="table-wrap request-table">
      <table>
        <caption className="sr-only">Requests, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Created</th>
            <th scope="col">Type</th>
            <th scope="col">Amount</th>
            <th scope="col">Reference</th>
            <th scope="col">Decision</th>
            <th scope="col">Rule</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/requests/${r.id}`}>{formatDateTime(r.created_at)}</Link></td>
              <td>{REQUEST_TYPE_LABELS[r.request_type]}</td>
              <td>{r.amount_cents === null ? <span className="muted">None</span> : formatAud(r.amount_cents)}</td>
              <td>{r.reference_id ?? <span className="muted">None</span>}</td>
              <td><ColourBadge colour={r.decision} /></td>
              <td><code>{r.matched_rule_id}</code><br /><small>{r.policy_version}</small></td>
              <td><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
