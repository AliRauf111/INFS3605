"use client";
import type { ActivityRow } from "@/lib/agent/activity";
import { useI18n } from "@/components/i18n/I18nProvider";

const STATE_ICON = { completed: "✓", pending: "…", blocked: "!", failed: "✕" } as const;

// Shows events the server actually recorded. It does not show model reasoning. The summary
// of each step is the server's own log text and is shown as recorded.
export function ActivityPanel({ rows, title }: { rows: ActivityRow[]; title?: string }) {
  const { t, fmt } = useI18n();
  const heading = title ?? t("activity.title");
  return (
    <section className="card" aria-label={heading}>
      <h2>{heading}</h2>
      <p className="hint">{t("activity.hint")}</p>
      {rows.length === 0 ? (
        <p className="muted">{t("activity.none")}</p>
      ) : (
        <ol className="timeline">
          {rows.map((r) => (
            <li key={r.id}>
              <span className={`state-icon state-${r.state}`} aria-hidden="true">{STATE_ICON[r.state]}</span>
              <div>
                <div lang="en" dir="auto">{r.summary}</div>
                <small>
                  {t(`activity.state.${r.state}`)} · {t(`activity.mode.${r.mode}`)} · {fmt.dateTime(r.created_at)}
                  {typeof r.detail?.source === "string" ? ` · ${t("activity.source", { source: `${r.detail.source}${typeof r.detail.id === "string" ? ` ${r.detail.id}` : ""}` })}` : ""}
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
