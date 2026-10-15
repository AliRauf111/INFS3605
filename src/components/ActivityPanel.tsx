import type { ActivityRow } from "@/lib/agent/activity";
import { formatDateTime } from "./ui";

const STATE_ICON = { completed: "✓", pending: "…", blocked: "!", failed: "✕" } as const;
const MODE_TEXT = { live_ai: "Live AI", simulated: "Simulated (no AI)", system: "Server step" } as const;

// Shows events the server actually recorded. It does not show model reasoning.
export function ActivityPanel({ rows, title = "Agent activity" }: { rows: ActivityRow[]; title?: string }) {
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      <p className="hint">Real steps recorded by the server, in order. Model reasoning is not shown.</p>
      {rows.length === 0 ? (
        <p className="muted">No activity recorded yet.</p>
      ) : (
        <ol className="timeline">
          {rows.map((r) => (
            <li key={r.id}>
              <span className={`state-icon state-${r.state}`} aria-hidden="true">{STATE_ICON[r.state]}</span>
              <div>
                <div>{r.summary}</div>
                <small>
                  {r.state[0].toUpperCase() + r.state.slice(1)} · {MODE_TEXT[r.mode]} · {formatDateTime(r.created_at)}
                  {typeof r.detail?.source === "string" ? ` · source: ${r.detail.source}${typeof r.detail.id === "string" ? ` ${r.detail.id}` : ""}` : ""}
                  {typeof r.detail?.version === "number" ? ` v${r.detail.version}` : ""}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
