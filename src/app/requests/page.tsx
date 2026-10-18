import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { aiConfigured } from "@/lib/ai/client";
import { listRequests } from "@/lib/data/queries";
import { RequestsTable } from "@/components/RequestsTable";
import { LoadError } from "@/components/ui";
import { STATUSES, STATUS_LABELS, type RequestStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests" };

export default async function Requests({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requirePageUser();
  const live = aiConfigured();
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
      <div>
        <h1>Requests</h1>
        <p className="muted">Start a new request, or find one you have already saved. Nothing is decided until you confirm the facts.</p>
      </div>
      <div className="grid grid-2">
        <section className="card">
          <h2>Guided wizard</h2>
          <p>Answer five short steps. Best when you already know the details.</p>
          <Link className="btn" href="/requests/new/wizard">Start the wizard</Link>
        </section>
        <section className="card">
          <h2>Paste a message</h2>
          <p>Paste a parent or tutor message and review the suggested answers before anything is checked.</p>
          <p><span className="badge info">{live ? "Live AI is configured" : "Simulated mode: keyword rules, no AI"}</span></p>
          <Link className="btn" href="/requests/new/intake">Paste a message</Link>
        </section>
      </div>
      <section className="stack" aria-labelledby="saved-heading">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h2 id="saved-heading" style={{ margin: 0 }}>Saved requests</h2>
          <form className="row" method="get">
            <label htmlFor="status" className="sr-only">Filter by status</label>
            <select id="status" name="status" defaultValue={filter ?? ""} style={{ maxWidth: 280 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <button className="btn secondary small" type="submit">Filter</button>
          </form>
        </div>
        <RequestsTable rows={rows} />
      </section>
    </div>
  );
}
