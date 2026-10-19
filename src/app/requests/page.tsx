import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { aiConfigured } from "@/lib/ai/client";
import { listRequests, type ListView } from "@/lib/data/queries";
import { RequestsTable, type TableRow } from "@/components/RequestsTable";
import { removalNeedsOwner } from "@/lib/domain/progress";
import { LoadError } from "@/components/ui";
import { STATUSES, STATUS_LABELS, type RequestStatus } from "@/lib/domain/types";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests" };

export default async function Requests({ searchParams }: { searchParams: Promise<{ status?: string; removed?: string; archived?: string }> }) {
  const user = await requirePageUser();
  const live = aiConfigured();
  const { status, removed: removedParam, archived: archivedParam } = await searchParams;
  const view: ListView = removedParam === "1" ? "removed" : archivedParam === "1" ? "archived" : "active";
  const filter = STATUSES.includes(status as RequestStatus) ? (status as RequestStatus) : undefined;
  let rows: TableRow[];
  try {
    const all = await listRequests({ status: filter ? [filter] : undefined, limit: 200, view });
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
    <div className="stack">
      <PageHeader>
        <h1>Requests</h1>
        <p className="muted">Start a new request, or find one you have already saved.</p>
      </PageHeader>
      <div className="entry-grid">
        <section className="card entry-card" aria-labelledby="wizard-heading">
          <h2 id="wizard-heading">Guided Wizard</h2>
          <p>Create a request in five simple steps.</p>
          <Link className="btn" href="/requests/new/wizard">Start the wizard</Link>
        </section>
        <section className="card entry-card" aria-labelledby="capture-heading">
          <h2 id="capture-heading">Quick Capture</h2>
          <p>Turn a parent or tutor message into a request.</p>
          <Link className="btn" href="/requests/new/intake">Capture a message</Link>
          <span className="badge info entry-note">{live ? "Live AI is configured" : "Simulated mode: keyword rules, no AI"}</span>
        </section>
      </div>
      <section className="stack" aria-labelledby="saved-heading">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h2 id="saved-heading" style={{ margin: 0 }}>{view === "removed" ? "Removed Requests" : view === "archived" ? "Archived Requests" : "Saved Requests"}</h2>
          <form className="row" method="get">
            {view === "removed" && <input type="hidden" name="removed" value="1" />}
            {view === "archived" && <input type="hidden" name="archived" value="1" />}
            <label htmlFor="status" className="sr-only">Filter by status</label>
            <select id="status" name="status" defaultValue={filter ?? ""} style={{ maxWidth: 280 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <button className="btn secondary small" type="submit">Filter</button>
          </form>
        </div>
        {view === "removed" && <p className="hint">These were taken off the lists. Their full record is kept, and you can put them back.</p>}
        {view === "archived" && <p className="hint">Archived requests keep their details and decision history. Restore one to return it to the lists.</p>}
        {/* The key resets the selection whenever the view or the filter changes. */}
        <RequestsTable key={`${view}:${filter ?? "all"}`} rows={rows} view={view} />
        <p className="hint saved-links">
          {view !== "active" && <Link href="/requests">Back to Saved Requests</Link>}
          {view !== "archived" && <Link href="/requests?archived=1">Show Archived Requests</Link>}
          {view !== "removed" && <Link href="/requests?removed=1">Show Removed Requests</Link>}
        </p>
      </section>
    </div>
  );
}
