import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { listRequests, type RequestRow } from "@/lib/data/queries";
import { classesForRequests, type RequestClass } from "@/lib/data/catalogue";
import { QueueTable } from "@/components/QueueTable";
import { EmptyState, LoadError } from "@/components/ui";
import type { RequestStatus } from "@/lib/domain/types";
import { friendlyTime } from "@/lib/domain/progress";
import { A11yTrigger } from "@/components/a11y/A11yPanel";

export const dynamic = "force-dynamic";

// Tabs filter the recent list through the address bar, so they work without scripts.
const TABS: { key: string; label: string; statuses: RequestStatus[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "record", label: "Ready to record", statuses: ["ready", "approved", "declined"] },
  { key: "send", label: "Send to Owner", statuses: ["review_required"] },
  { key: "owner", label: "Waiting for Owner", statuses: ["awaiting_owner"] },
  { key: "clarify", label: "Needs Clarification", statuses: ["needs_clarification", "more_info_requested"] },
];
const SHOW = 8;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tab?: string; removed?: string }> }) {
  const user = await requirePageUser();
  const { tab, removed } = await searchParams;
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  let rows: RequestRow[];
  try {
    rows = await listRequests({ limit: 200 });
  } catch (e) {
    return <LoadError error={e} />;
  }
  const inTab = (t: (typeof TABS)[number]) => (t.statuses ? rows.filter((r) => t.statuses!.includes(r.status)) : rows);
  const count = (key: string) => inTab(TABS.find((t) => t.key === key)!).length;
  const now = new Date();
  const today = now.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const owner = user.role === "owner";
  const tiles = [
    { key: "record", icon: "ok", title: "Ready to record", count: count("record"), text: "Inside the rules or decided. Act on them and log the outcome.", mine: !owner },
    { key: "send", icon: "send", title: "Send to Owner", count: count("send"), text: "The rules say the owner must see these first.", mine: !owner },
    { key: "clarify", icon: "warn", title: "Needs Clarification", count: count("clarify"), text: "Missing details. Ask the family before it moves on.", mine: !owner },
    {
      key: "owner",
      icon: "wait",
      title: "Waiting for Owner",
      count: count("owner"),
      text: owner ? "Waiting on your decision in Approval Alley." : "Nothing to do yet. You'll see the decision here.",
      mine: owner,
    },
  ];
  const startHere = tiles.find((t) => t.mine && t.count > 0)?.key;
  const shown = inTab(active).slice(0, SHOW);
  let classes: Map<string, RequestClass>;
  try {
    classes = await classesForRequests(shown);
  } catch (e) {
    return <LoadError error={e} />;
  }
  // When the newest change to any request happened, from the saved data itself.
  const latest = rows.reduce<string | null>((max, r) => {
    const t = r.updated_at && r.updated_at > r.created_at ? r.updated_at : r.created_at;
    return !max || t > max ? t : max;
  }, null);
  const updated = latest ? friendlyTime(latest, now).replace(/^Today, /, "").replace(/^Yesterday/, "yesterday") : null;

  return (
    <div className="stack dash">
      {removed && (
        <div className="notice success" role="status">
          Request removed from the list. You can find it again under <Link href="/requests?removed=1">Removed Requests</Link>.
        </div>
      )}
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Hi {user.displayName.split(" ")[0]}. {today}.</p>
        </div>
        <div className="page-actions">
          <A11yTrigger variant="page" />
          <Link className="btn" href="/requests"><span aria-hidden="true">+</span> New Request</Link>
        </div>
      </div>

      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading" className="section-title">Your Queue</h2>
        <div className="queue">
          {tiles.map((t) => (
            <Link key={t.key} href={t.key === "owner" && owner ? "/owner" : `/?tab=${t.key}#recent`} className={`queue-tile ${t.key === startHere ? "start" : ""}`}>
              <span className="qt-bg" aria-hidden="true" />
              <div className="qt-head">
                <span className={`qt-icon ${t.icon}`} aria-hidden="true" />
                <span>{t.title}</span>
                {t.key === startHere && <span className="qt-badge">Start here</span>}
              </div>
              <div className="qt-count">{t.count}</div>
              <p>{t.text}</p>
            </Link>
          ))}
        </div>
      </section>

      <section id="recent" aria-labelledby="recent-heading">
        <div className="section-row">
          <h2 id="recent-heading" className="section-title">Recent Requests</h2>
          {updated && latest && <span className="hint" data-secondary="">Updated <time dateTime={latest}>{updated}</time></span>}
        </div>
        <div className="card queue-card" data-compass-avoid="">
          <nav className="tabs" aria-label="Filter recent requests">
            {TABS.map((t) => (
              <Link key={t.key} href={t.key === "all" ? "/#recent" : `/?tab=${t.key}#recent`} aria-current={t.key === active.key ? "page" : undefined} className="tab">
                {t.label} <span className="tab-count">{count(t.key)}</span>
              </Link>
            ))}
          </nav>
          {shown.length === 0 ? (
            <EmptyState title={rows.length === 0 ? "No requests yet" : "Nothing here right now"}>
              {rows.length === 0 && <p><Link href="/requests">Start the first request</Link>.</p>}
            </EmptyState>
          ) : (
            <QueueTable rows={shown} now={now} classes={classes} />
          )}
          <div className="queue-foot">
            <span className="hint">Showing {shown.length} of {inTab(active).length} {active.key === "all" ? "requests" : `“${active.label.toLowerCase()}” requests`}</span>
            <Link href="/requests">View all requests</Link>
          </div>
        </div>
        <ul className="legend" aria-label="What the colours mean">
          <li><span className="rule-tag-icon lg green" aria-hidden="true" />Green: inside the rules, you can act and record it.</li>
          <li><span className="rule-tag-icon lg amber" aria-hidden="true" />Amber: the owner approves first.</li>
          <li><span className="rule-tag-icon lg red" aria-hidden="true" />Red: send to the owner and take no action yet.</li>
        </ul>
      </section>
    </div>
  );
}
