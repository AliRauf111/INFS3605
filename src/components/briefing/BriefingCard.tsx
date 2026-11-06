"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";
import { cardStatus } from "@/lib/briefing/logic";
import { periodLabel } from "@/lib/briefing/text";
import type { BriefingView } from "@/lib/briefing/types";

// "Your Weekly Briefing" on the Overview, under Over to You. It shows this week's saved
// briefing straight away; when there isn't one yet (for example just after the demo reset)
// it asks the server to work it out and shows Generating Briefing meanwhile. It only
// summarises and links to the full page, so it never repeats What Needs My Attention?.

export function BriefingCard({ initial }: { initial: BriefingView | null }) {
  const { t, fmt } = useI18n();
  const [view, setView] = useState<BriefingView | null>(initial);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (initial) return;
    let live = true;
    fetch("/api/briefing", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { view: BriefingView }) : Promise.reject(new Error(String(r.status)))))
      .then((r) => live && setView(r.view))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [initial]);

  const status = cardStatus(view, !view && !failed);
  const tile = (label: string, value: string | null, tone?: "red" | "amber" | "green") => (
    <div className={`wb-tile${tone ? ` ${tone}` : ""}`}>
      <strong>{value ?? <span className="wb-hidden">{t("briefing.card.hidden")}</span>}</strong>
      <span>{label}</span>
    </div>
  );

  return (
    <section className="card weekly-card" aria-labelledby="weekly-card-h" aria-busy={status === "generating" && !failed}>
      <div className="card-head">
        <div>
          <h2 id="weekly-card-h">{t("briefing.card.heading")}</h2>
          <p className="caption">{view ? periodLabel(view.period, t, fmt) : t("briefing.card.caption")}</p>
        </div>
        <Link className="round-btn" href="/briefing" aria-label={t("briefing.card.view")}><Icon name="external" /></Link>
      </div>
      {failed ? (
        <p className="caption" role="status">{t("briefing.card.failed")}</p>
      ) : (
        <>
          <span className={`wb-status ${status}`} role="status"><i aria-hidden="true" />{t(`briefing.card.status.${status}`)}</span>
          {view ? (
            <>
              <p className="wb-generated">{t("briefing.card.generated", { when: fmt.friendly(view.generatedAt, new Date(), true) })}</p>
              <div className="wb-tiles">
                {tile(t("briefing.card.overdue"), view.financeHidden ? null : fmt.number(view.headline.overdueInvoices), view.headline.overdueInvoices ? "red" : undefined)}
                {tile(t("briefing.card.enquiries"), fmt.number(view.headline.unanswered), view.headline.unanswered ? "amber" : undefined)}
                {tile(t("briefing.card.completed"), fmt.number(view.headline.tasksCompleted), "green")}
                {tile(t("briefing.card.recommended"), fmt.number(view.headline.recommendations))}
              </div>
            </>
          ) : (
            <div className="wb-tiles" aria-hidden="true">{[0, 1, 2, 3].map((i) => <div key={i} className="wb-tile wb-sk" />)}</div>
          )}
        </>
      )}
      <Link className="btn dark wb-view" href="/briefing">{t("briefing.card.view")} <Icon name="arrow" /></Link>
    </section>
  );
}
