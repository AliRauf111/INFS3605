import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { aiConfigured } from "@/lib/ai/client";
import { listRequests, type ListView } from "@/lib/data/queries";
import { RequestsTable, type TableRow } from "@/components/RequestsTable";
import { removalNeedsOwner } from "@/lib/domain/progress";
import { LoadError } from "@/components/ui";
import { STATUSES, type RequestStatus } from "@/lib/domain/types";
import { getI18n } from "@/lib/i18n/server";
import { PageHeader } from "@/components/PageHeader";
import { GROUP_STATUSES, groupFromParam } from "@/lib/overview/status-cards";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.requests") };
}

export default async function Requests({ searchParams }: { searchParams: Promise<{ status?: string; group?: string; removed?: string; archived?: string }> }) {
  const user = await requirePageUser();
  const live = aiConfigured();
  const { t, fmt } = await getI18n();
  const { status, group: groupParam, removed: removedParam, archived: archivedParam } = await searchParams;
  const view: ListView = removedParam === "1" ? "removed" : archivedParam === "1" ? "archived" : "active";
  const filter = STATUSES.includes(status as RequestStatus) ? (status as RequestStatus) : undefined;
  // The Overview's status cards link here with a group of statuses.
  const group = filter ? null : groupFromParam(groupParam);
  let rows: TableRow[];
  try {
    const all = await listRequests({ status: filter ? [filter] : group ? GROUP_STATUSES[group] : undefined, limit: 200, view });
    // Only what the table shows goes to the browser.
    rows = all.map((r) => ({
      id: r.id,
      request_type: r.request_type,
      amount_cents: r.amount_cents,
      reference_id: r.reference_id,
      decision: r.decision,
      status: r.status,
      created_at: r.created_at,
      locked: user.role !== "owner" && removalNeedsOwner(r.status, r.welfare_status),
    }));
  } catch (e) {
    return <LoadError error={e} />;
  }
  return (
    <div className="stack requests-page">
      <PageHeader>
        <h1>{t("nav.requests")}</h1>
        <p className="muted">{t("requests.intro")}</p>
      </PageHeader>
      <div className="entry-grid">
        <section className="card entry-card" aria-labelledby="wizard-heading">
          <h2 id="wizard-heading">{t("shell.footer.guidedWizard")}</h2>
          <p>{t("requests.wizardText")}</p>
          <Link className="btn" href="/requests/new/wizard">{t("requests.startWizard")}</Link>
        </section>
        <section className="card entry-card" aria-labelledby="capture-heading">
          <h2 id="capture-heading">{t("shell.footer.quickCapture")}</h2>
          <p>{t("requests.captureText")}</p>
          <Link className="btn" href="/requests/new/intake">{t("requests.captureMessage")}</Link>
          <span className="badge info entry-note">{live ? t("requests.liveAi") : t("requests.simulated")}</span>
        </section>
      </div>
      <section className="stack" aria-labelledby="saved-heading">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h2 id="saved-heading" style={{ margin: 0 }}>{view === "removed" ? t("requests.removedHeading") : view === "archived" ? t("requests.archivedHeading") : t("requests.savedHeading")}</h2>
          <form className="row filter-form" method="get">
            {view === "removed" && <input type="hidden" name="removed" value="1" />}
            {view === "archived" && <input type="hidden" name="archived" value="1" />}
            <label htmlFor="status" className="sr-only">{t("requests.filterByStatus")}</label>
            <select id="status" name="status" defaultValue={filter ?? ""} style={{ maxWidth: 280 }}>
              <option value="">{t("requests.all")}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`domain.status.${s}`)}</option>)}
            </select>
            <button className="btn secondary small" type="submit">{t("requests.filter")}</button>
          </form>
        </div>
        {group && (
          <p className="filter-note" role="status">
            {t("requests.showingGroup")} <strong>{t(`domain.group.${group}`)}</strong>: {fmt.list(GROUP_STATUSES[group].map((s) => t(`domain.status.${s}`)))}. <Link href="/requests">{t("overview.showAllRequests")}</Link>
          </p>
        )}
        {view === "removed" && <p className="hint">{t("requests.removedHint")}</p>}
        {view === "archived" && <p className="hint">{t("requests.archivedHint")}</p>}
        {/* The key resets the selection whenever the view or the filter changes. */}
        <RequestsTable key={`${view}:${filter ?? group ?? "all"}`} rows={rows} view={view} />
        <p className="hint saved-links">
          {view !== "active" && <Link href="/requests">{t("requests.backToSaved")}</Link>}
          {view !== "archived" && <Link href="/requests?archived=1">{t("requests.showArchived")}</Link>}
          {view !== "removed" && <Link href="/requests?removed=1">{t("requests.showRemoved")}</Link>}
        </p>
      </section>
    </div>
  );
}
