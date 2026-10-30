"use client";
import { type Colour, type DataLabel, type RequestStatus, DATA_LABELS, STATUSES } from "@/lib/domain/types";
import { PageActions } from "@/components/PageHeader";
import { useI18n } from "@/components/i18n/I18nProvider";

// Small presentational pieces shared by many pages. Client components so they follow the
// chosen language straight away; the stored values (colour, status) are never translated,
// only the words shown for them.

const ICONS: Record<Colour, string> = { green: "✓", amber: "!", red: "■" };

export function DecisionBanner({ colour, title, explanation }: { colour: Colour; title?: string; explanation?: string }) {
  const { t } = useI18n();
  return (
    <section className={`banner ${colour}`} aria-label={t("domain.decisionLabel", { colour: t(`domain.colourShort.${colour}`) })}>
      <span className="icon" aria-hidden="true">{ICONS[colour]}</span>
      <div>
        <h2>{t(`domain.colour.${colour}`)}</h2>
        {title && <p><strong>{title}</strong></p>}
        {explanation && <p>{explanation}</p>}
      </div>
    </section>
  );
}

export function ColourBadge({ colour }: { colour: Colour }) {
  const { t } = useI18n();
  return (
    <span className={`badge ${colour}`}>
      <span aria-hidden="true">{ICONS[colour]}</span> {t(`domain.colourShort.${colour}`)}
    </span>
  );
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useI18n();
  return <span className="badge">{(STATUSES as readonly string[]).includes(status) ? t(`domain.status.${status}`) : status}</span>;
}

export function DataBadge({ label }: { label: string }) {
  const { t } = useI18n();
  return <span className="badge info">{(DATA_LABELS as readonly string[]).includes(label) ? t(`domain.dataLabel.${label as DataLabel}`) : label}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card" role="status">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function LoadErrorView({ message }: { message: string | null }) {
  const { t } = useI18n();
  return (
    <>
      {/* The page's own header didn't render, so keep its Accessibility button here. */}
      <PageActions className="page-actions-solo" />
      <div className="notice error" role="alert">
        <p><strong>{t("common.loadErrorTitle")}</strong></p>
        <p>{message ?? t("common.unknownError")}</p>
        <p><a href="">{t("common.tryAgain")}</a></p>
      </div>
    </>
  );
}
