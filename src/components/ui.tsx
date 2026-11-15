import { makeFormat, type Format } from "@/lib/i18n/format";

// Shared pieces. The components are client components (see ui-client.tsx) so they follow
// the chosen language; formatDateTime stays here so server code can call it too.
import { LoadErrorView } from "./ui-client";

export { ColourBadge, DataBadge, DecisionBanner, EmptyState, StatusBadge } from "./ui-client";

/** A page that couldn't load its data. Takes the error on the server and passes on only its message. */
export function LoadError({ error }: { error: unknown }) {
  return <LoadErrorView message={error instanceof Error ? error.message : typeof error === "string" ? error : null} />;
}

/** Date and time in Sydney, in the reader's language when a format is passed. */
export function formatDateTime(iso: string | null | undefined, fmt: Format = makeFormat()): string {
  return fmt.dateTime(iso);
}
