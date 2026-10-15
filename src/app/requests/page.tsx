import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { listRequests } from "@/lib/data/queries";
import { RequestsTable } from "@/components/RequestsTable";
import { LoadError } from "@/components/ui";
import { STATUSES, STATUS_LABELS, type RequestStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request log" };

export default async function RequestLog({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requirePageUser();
  const { status } = await searchParams;
  const filter = STATUSES.includes(status as RequestStatus) ? (status as RequestStatus) : undefined;
  let rows;
  try {
    rows = await listRequests({ status: filter ? [filter] : undefined, limit: 200 });
  } catch (e) {
    return <LoadError error={e} />;
  }
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Request log</h1>
          <p className="muted">Every saved request, read from Supabase by the server when this page loads. Refresh to see new rows.</p>
        </div>
        <Link className="btn" href="/requests/new">New request</Link>
      </div>
      <form className="row" method="get">
        <label htmlFor="status" className="sr-only">Filter by status</label>
        <select id="status" name="status" defaultValue={filter ?? ""} style={{ maxWidth: 280 }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <button className="btn secondary small" type="submit">Filter</button>
      </form>
      <RequestsTable rows={rows} />
    </div>
  );
}
