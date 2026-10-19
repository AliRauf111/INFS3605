import Link from "next/link";
import { ClickableRow } from "./ClickableRow";
import type { RequestRow } from "@/lib/data/queries";
import { formatAud } from "@/lib/domain/money";
import { REQUEST_TYPE_LABELS } from "@/lib/domain/types";
import { friendlyTime, nextStep, ruleName } from "@/lib/domain/progress";

// The dashboard's request list: what each request is, what the rules said and what
// has to happen next. Each row opens the request. Phones get stacked cards instead.

const COLOUR_WORD = { green: "Green", amber: "Amber", red: "Red" } as const;

export function RuleTag({ row }: { row: RequestRow }) {
  return (
    <span className={`rule-tag ${row.decision}`}>
      <span className="rule-tag-icon" aria-hidden="true" />
      {COLOUR_WORD[row.decision]} · {ruleName(row.matched_rule_id)}
    </span>
  );
}

export function QueueTable({ rows, now }: { rows: RequestRow[]; now: Date }) {
  return (
    <>
      <div className="queue-table table-wrap">
        <table>
          <caption className="sr-only">Recent requests, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col" className="num">Amount</th>
              <th scope="col">Rule check</th>
              <th scope="col">Next step</th>
              <th scope="col">Created</th>
              <th scope="col"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const next = nextStep(r.status);
              return (
                <ClickableRow key={r.id} href={`/requests/${r.id}`}>
                  <td>
                    <Link className="row-link" href={`/requests/${r.id}`}><strong>{r.reference_id ?? "No reference"}</strong></Link>
                    <div className="sub">{REQUEST_TYPE_LABELS[r.request_type]}</div>
                  </td>
                  <td className="num">{r.amount_cents === null ? <span className="muted" aria-label="No amount">–</span> : formatAud(r.amount_cents)}</td>
                  <td><RuleTag row={r} /></td>
                  <td><strong>{next.title}</strong><div className="sub">{next.detail}</div></td>
                  <td>{friendlyTime(r.created_at, now)}</td>
                  <td className="chev" aria-hidden="true">›</td>
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="queue-cards" aria-label="Recent requests, newest first">
        {rows.map((r) => {
          const next = nextStep(r.status);
          return (
            <li key={r.id}>
              <Link href={`/requests/${r.id}`}>
                <div className="qc-top">
                  <strong>{r.reference_id ?? "No reference"}</strong>
                  <span>{r.amount_cents === null ? "" : formatAud(r.amount_cents)}</span>
                </div>
                <div className="sub">{REQUEST_TYPE_LABELS[r.request_type]} · {friendlyTime(r.created_at, now)}</div>
                <RuleTag row={r} />
                <div className="qc-next"><strong>{next.title}</strong> <span className="sub">{next.detail}</span></div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
