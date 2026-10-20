import Link from "next/link";
import { ClickableRow } from "./ClickableRow";
import { rowWorkflow, type RequestRow } from "@/lib/data/queries";
import type { RequestClass } from "@/lib/data/catalogue";
import { formatAud } from "@/lib/domain/money";
import { REQUEST_TYPE_LABELS, type Role } from "@/lib/domain/types";
import { friendlyTime, ruleName } from "@/lib/domain/progress";

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

function ClassCell({ cls }: { cls: RequestClass | undefined }) {
  if (!cls) return <span className="muted no-class">No class linked</span>;
  return (
    <>
      <span className="class-code">{cls.code}</span>
      <div className="sub class-subject">{cls.subject}</div>
      <div className="sub">Year {cls.year}</div>
    </>
  );
}

export function QueueTable({ rows, now, classes, role }: { rows: RequestRow[]; now: Date; classes: Map<string, RequestClass>; role: Role }) {
  return (
    <>
      <div className="queue-table table-wrap">
        <table>
          <caption className="sr-only">Recent requests, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col" className="class-col">Class</th>
              <th scope="col" className="num">Amount</th>
              <th scope="col" className="rule-col">Rule Check</th>
              <th scope="col">Next Step</th>
              <th scope="col">Created</th>
              <th scope="col"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const next = rowWorkflow(r, role);
              return (
                <ClickableRow key={r.id} href={`/requests/${r.id}`}>
                  <td>
                    <Link className="row-link" href={`/requests/${r.id}`}><strong>{r.reference_id ?? "No reference"}</strong></Link>
                    <div className="sub">{REQUEST_TYPE_LABELS[r.request_type]}</div>
                  </td>
                  <td className="class-col"><ClassCell cls={classes.get(r.id)} /></td>
                  <td className="num">{r.amount_cents === null ? <span className="muted" aria-label="No amount">–</span> : formatAud(r.amount_cents)}</td>
                  <td className="rule-col"><RuleTag row={r} /></td>
                  <td><strong>{next.title}</strong><div className="sub">{next.detail}</div></td>
                  <td className="created"><time dateTime={r.created_at}>{friendlyTime(r.created_at, now)}</time></td>
                  <td className="chev" aria-hidden="true"><Chevron /></td>
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="queue-cards" aria-label="Recent requests, newest first">
        {rows.map((r) => {
          const next = rowWorkflow(r, role);
          return (
            <li key={r.id}>
              <Link href={`/requests/${r.id}`}>
                <div className="qc-top">
                  <strong>{r.reference_id ?? "No reference"}</strong>
                  <span>{r.amount_cents === null ? "" : formatAud(r.amount_cents)}</span>
                </div>
                <div className="sub">{REQUEST_TYPE_LABELS[r.request_type]} · <time dateTime={r.created_at}>{friendlyTime(r.created_at, now)}</time></div>
                <div className="qc-class">
                  {classes.get(r.id) ? (
                    <>
                      <span className="class-code">{classes.get(r.id)!.code}</span>
                      <span className="sub">{classes.get(r.id)!.subject} · Year {classes.get(r.id)!.year}</span>
                    </>
                  ) : (
                    <span className="sub">No class linked</span>
                  )}
                </div>
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

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
