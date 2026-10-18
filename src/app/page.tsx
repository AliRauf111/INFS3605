import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { listRequests, type RequestRow } from "@/lib/data/queries";
import { RequestsTable } from "@/components/RequestsTable";
import { LoadError } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requirePageUser();
  let rows: RequestRow[];
  try {
    rows = await listRequests({ limit: 200 });
  } catch (e) {
    return <LoadError error={e} />;
  }
  const count = (f: (r: RequestRow) => boolean) => rows.filter(f).length;
  const awaiting = count((r) => r.status === "awaiting_owner");
  const clarify = count((r) => r.status === "needs_clarification" || r.status === "more_info_requested");
  const ready = count((r) => r.status === "ready" || r.status === "approved" || r.status === "declined");
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Hello, {user.displayName.split(" ")[0]}</h1>
          <p className="muted">Check a request against the owner&apos;s rules before acting on it.</p>
        </div>
        <Link className="btn" href="/requests">Start a new request</Link>
      </div>
      <div className="grid grid-3">
        <div className="card"><div className="stat">{awaiting}</div><div>Waiting for the owner</div>{user.role === "owner" && awaiting > 0 && <Link href="/owner">Open the owner queue</Link>}</div>
        <div className="card"><div className="stat">{clarify}</div><div>Need clarification</div></div>
        <div className="card"><div className="stat">{ready}</div><div>Ready for the admin to act on and record</div></div>
      </div>
      <section>
        <h2>Recent requests</h2>
        <RequestsTable rows={rows.slice(0, 8)} />
        <p><Link href="/requests">See all requests</Link></p>
      </section>
    </div>
  );
}
