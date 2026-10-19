import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { aiConfigured } from "@/lib/ai/client";
import { listRequests } from "@/lib/data/queries";
import { RequestsTable } from "@/components/RequestsTable";
import { LoadError } from "@/components/ui";
import { STATUSES, STATUS_LABELS, type RequestStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests" };

export default async function Requests({ searchParams }: { searchParams: Promise<{ status?: string; removed?: string }> }) {
  await requirePageUser();
  const live = aiConfigured();
  const { status, removed: removedParam } = await searchParams;
  const removed = removedParam === "1";
  const filter = STATUSES.includes(status as RequestStatus) ? (status as RequestStatus) : undefined;
  let rows;
  try {
    rows = await listRequests({ status: filter ? [filter] : undefined, limit: 200, removed });
  } catch (e) {
    return <LoadError error={e} />;
  }
  return (
    <div className="stack">
      <div>
        <h1>Requests</h1>
        <p className="muted">Start a new request, or find one you have already saved.</p>
      </div>
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
          <h2 id="saved-heading" style={{ margin: 0 }}>{removed ? "Removed requests" : "Saved requests"}</h2>
          <form className="row" method="get">
            {removed && <input type="hidden" name="removed" value="1" />}
            <label htmlFor="status" className="sr-only">Filter by status</label>
            <select id="status" name="status" defaultValue={filter ?? ""} style={{ maxWidth: 280 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <button className="btn secondary small" type="submit">Filter</button>
          </form>
        </div>
        {removed && <p className="hint">These were taken off the lists. Open one to see its full record or put it back.</p>}
        <RequestsTable rows={rows} />
        <p className="hint">
          {removed ? <Link href="/requests">Back to saved requests</Link> : <Link href="/requests?removed=1">Show removed requests</Link>}
        </p>
      </section>
    </div>
  );
}
