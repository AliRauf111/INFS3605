import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { listRequests, rowWorkflow, withWorkflowState, type RequestRow } from "@/lib/data/queries";
import type { Queue } from "@/lib/workflow/next-step";
import { classesForRequests, type RequestClass } from "@/lib/data/catalogue";
import { QueueTable } from "@/components/QueueTable";
import { EmptyState, LoadError } from "@/components/ui";
import { friendlyTime } from "@/lib/domain/progress";
import { PageHeader } from "@/components/PageHeader";
import { FilterLink } from "@/components/FilterLink";

export const dynamic = "force-dynamic";

// Tabs filter the recent list through the address bar, so they work without scripts.
// Which tab a request sits in comes from the shared next-step rules, so it always matches
// the Next Step column and the button on the request page.
type Tab = { key: string; label: string; queues: Queue[] | null };
const ADMIN_TABS: Tab[] = [
  { key: "all", label: "All", queues: null },
  { key: "record", label: "Ready to Record", queues: ["record"] },
  { key: "send", label: "Send to Owner", queues: ["send"] },
  { key: "owner", label: "Waiting for Owner", queues: ["owner"] },
  { key: "clarify", label: "Needs Clarification", queues: ["clarify"] },
];
const OWNER_TABS: Tab[] = [
  { key: "all", label: "All", queues: null },
  { key: "review", label: "Requires Your Review", queues: ["review"] },
  { key: "clarify", label: "Needs Clarification", queues: ["clarify"] },
  { key: "record", label: "Ready to Record", queues: ["record"] },
];
const SHOW = 8;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tab?: string; removed?: string }> }) {
  const user = await requirePageUser();
  const { tab, removed } = await searchParams;
  const owner = user.role === "owner";
  const TABS = owner ? OWNER_TABS : ADMIN_TABS;
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  let rows: RequestRow[];
  try {
    rows = await withWorkflowState(await listRequests({ limit: 200 }));
  } catch (e) {
    return <LoadError error={e} />;
  }
  const queueOf = new Map(rows.map((r) => [r.id, rowWorkflow(r, user.role).queue]));
  const inTab = (t: Tab) => (t.queues ? rows.filter((r) => t.queues!.includes(queueOf.get(r.id)!)) : rows);
  const count = (key: string) => inTab(TABS.find((t) => t.key === key)!).length;
  const now = new Date();
  const today = now.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const tiles = owner
    ? [
        { key: "review", icon: "wait", title: "Requires Your Review", count: count("review"), text: "Sent to you, or flagged by the rules for your review. Start the review when you're ready.", mine: true },
        { key: "clarify", icon: "warn", title: "Needs Clarification", count: count("clarify"), text: "Missing details. These need completing before anyone decides.", mine: false },
        { key: "record", icon: "ok", title: "Ready to Record", count: count("record"), text: "Inside the rules or decided. The admin team acts and logs the outcome.", mine: false },
      ]
    : [
        { key: "record", icon: "ok", title: "Ready to Record", count: count("record"), text: "Inside the rules or decided. Act on them and log the outcome.", mine: true },
        { key: "send", icon: "send", title: "Send to Owner", count: count("send"), text: "Details complete. The rules say the owner must see these first.", mine: true },
        { key: "clarify", icon: "warn", title: "Needs Clarification", count: count("clarify"), text: "Missing details. Complete them before it moves on.", mine: true },
        { key: "owner", icon: "wait", title: "Waiting for Owner", count: count("owner"), text: "Nothing to do yet. You'll see the decision here.", mine: false },
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

  const tileBody = (t: (typeof tiles)[number]) => (
    <>
      <span className="qt-bg" aria-hidden="true" />
      <div className="qt-head">
        <span className={`qt-icon ${t.icon}`} aria-hidden="true" />
        <span>{t.title}</span>
        {t.key === startHere && <span className="qt-badge">Start here</span>}
      </div>
      <div className="qt-count">{t.count}</div>
      <p>{t.text}</p>
    </>
  );

  return (
    <div className="stack dash">
      {removed && (
        <div className="notice success" role="status">
          Request removed from the list. You can find it again under <Link href="/requests?removed=1">Removed Requests</Link>.
        </div>
      )}
      {/* Dashboard exception: Accessibility sits just before New Request, which stays rightmost. */}
      <PageHeader a11y="first" actions={<Link className="btn" href="/requests"><span aria-hidden="true">+</span> New Request</Link>}>
        <h1>Dashboard</h1>
        <p className="muted">Hi {user.displayName.split(" ")[0]}. {today}.</p>
      </PageHeader>

      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading" className="section-title">Your Queue</h2>
        <div className={`queue${tiles.length === 3 ? " three" : ""}`}>
          {tiles.map((t) => (
            <FilterLink key={t.key} href={`/?tab=${t.key}#recent`} target="recent" current={t.key === active.key} className={`queue-tile ${t.key === startHere ? "start" : ""}`}>
              {tileBody(t)}
            </FilterLink>
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
              <FilterLink key={t.key} href={t.key === "all" ? "/#recent" : `/?tab=${t.key}#recent`} target="recent" current={t.key === active.key} className="tab">
                {t.label} <span className="tab-count">{count(t.key)}</span>
              </FilterLink>
            ))}
          </nav>
          {shown.length === 0 ? (
            <EmptyState title={rows.length === 0 ? "No requests yet" : "Nothing here right now"}>
              {rows.length === 0 && <p><Link href="/requests">Start the first request</Link>.</p>}
            </EmptyState>
          ) : (
            <QueueTable rows={shown} now={now} classes={classes} role={user.role} />
          )}
          <div className="queue-foot">
            <span className="hint">Showing {shown.length} of {inTab(active).length} {active.key === "all" ? "requests" : `“${active.label.toLowerCase()}” requests`}</span>
            <Link href="/requests">View all requests</Link>
          </div>
        </div>
        <ul className="legend" aria-label="What the colours mean">
          <li><span className="rule-tag-icon lg green" aria-hidden="true" />Green: inside the rules, you can act and record it.</li>
          <li><span className="rule-tag-icon lg amber" aria-hidden="true" />Amber: {owner ? "you approve first" : "the owner approves first"}, once any missing details are complete.</li>
          <li><span className="rule-tag-icon lg red" aria-hidden="true" />Red: {owner ? "you review these yourself" : "send to the owner"} and take no action yet.</li>
        </ul>
      </section>
    </div>
  );
}
