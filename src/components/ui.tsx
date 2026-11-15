import {
  COLOUR_LABELS,
  COLOUR_SHORT,
  DATA_LABEL_TEXT,
  STATUS_LABELS,
  type Colour,
  type DataLabel,
  type RequestStatus,
} from "@/lib/domain/types";
import { PageActions } from "@/components/PageHeader";

// Small presentational pieces shared by many pages.

const ICONS: Record<Colour, string> = { green: "✓", amber: "!", red: "■" };

export function DecisionBanner({ colour, title, explanation }: { colour: Colour; title?: string; explanation?: string }) {
  return (
    <section className={`banner ${colour}`} aria-label={`Decision: ${COLOUR_SHORT[colour]}`}>
      <span className="icon" aria-hidden="true">{ICONS[colour]}</span>
      <div>
        <h2>{COLOUR_LABELS[colour]}</h2>
        {title && <p><strong>{title}</strong></p>}
        {explanation && <p>{explanation}</p>}
      </div>
    </section>
  );
}

export function ColourBadge({ colour }: { colour: Colour }) {
  return (
    <span className={`badge ${colour}`}>
      <span aria-hidden="true">{ICONS[colour]}</span> {COLOUR_SHORT[colour]}
    </span>
  );
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className="badge">{STATUS_LABELS[status] ?? status}</span>;
}

export function DataBadge({ label }: { label: string }) {
  return <span className="badge info">{DATA_LABEL_TEXT[label as DataLabel] ?? label}</span>;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Not recorded";
  return new Date(iso).toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card" role="status">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function LoadError({ error }: { error: unknown }) {
  return (
    <>
      {/* The page's own header didn't render, so keep its Accessibility button here. */}
      <PageActions className="page-actions-solo" />
      <div className="notice error" role="alert">
        <p><strong>This page could not load its data.</strong></p>
        <p>{error instanceof Error ? error.message : "Unknown error"}</p>
        <p><a href="">Try again</a></p>
      </div>
    </>
  );
}
