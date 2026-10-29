import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { listRequests, rowWorkflow, withWorkflowState, type RequestRow } from "@/lib/data/queries";
import type { Queue } from "@/lib/workflow/next-step";
import { classesForRequests, type RequestClass } from "@/lib/data/catalogue";
import { QueueTable } from "@/components/QueueTable";
import { LoadError } from "@/components/ui";
import { friendlyTime } from "@/lib/domain/progress";
import { PageHeader } from "@/components/PageHeader";
import { FilterLink } from "@/components/FilterLink";
import { Icon, type IconName } from "@/components/Icons";
import { OpenCompassButton } from "@/components/OpenCompassButton";
import { CompassAvatar } from "@/components/assistant/CompassAvatar";
import { LIGHT_PARAM, LIGHT_WORD, filterByLight, lightFromParam, summariseLights } from "@/lib/overview/lights";
import { upcomingLessons } from "@/lib/insights/data";
import { isAway } from "@/lib/insights/logic";
import { sydneyDate, sydneyToday } from "@/lib/workflows/dates";
import type { Colour } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

// Overview: what needs doing now. Three traffic-light cards filter the request list, which
// keeps its next-step tabs; beside it sit Compass AI and the next lessons on the timetable.
// Filters live in the address bar, so they work without scripts and survive a refresh.
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
const LIGHT_ICON: Record<Colour, IconName> = { red: "stop", amber: "alert", green: "check" };

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function href(params: { light?: Colour | null; tab?: string }): string {
  const q = new URLSearchParams();
  if (params.light) q.set("light", LIGHT_PARAM[params.light]);
  if (params.tab && params.tab !== "all") q.set("tab", params.tab);
  const s = q.toString();
  return `/${s ? `?${s}` : ""}#requests`;
}

const timeFmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short" });

export default async function Overview({ searchParams }: { searchParams: Promise<{ tab?: string; light?: string; removed?: string }> }) {
  const user = await requirePageUser();
  const { tab, light: lightParam, removed } = await searchParams;
  const owner = user.role === "owner";
  const TABS = owner ? OWNER_TABS : ADMIN_TABS;
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  const light = lightFromParam(lightParam);
  const now = new Date();
  let rows: RequestRow[];
  let lessons: Awaited<ReturnType<typeof upcomingLessons>>;
  try {
    [rows, lessons] = await Promise.all([withWorkflowState(await listRequests({ limit: 200 })), upcomingLessons(now, 5)]);
  } catch (e) {
    return <LoadError error={e} />;
  }
  const asLight = (r: RequestRow) => ({ decision: r.decision, status: r.status, missing: r.missing_count ?? 0, reviewStartedAt: r.owner_review_started_at, welfare: r.welfare_status === "yes" });
  const lights = summariseLights(rows.map(asLight), user.role);
  const byLight = filterByLight(rows.map((r) => ({ ...asLight(r), row: r })), light).map((x) => x.row);
  const queueOf = new Map(rows.map((r) => [r.id, rowWorkflow(r, user.role).queue]));
  const inTab = (t: Tab) => (t.queues ? byLight.filter((r) => t.queues!.includes(queueOf.get(r.id)!)) : byLight);
  const count = (key: string) => inTab(TABS.find((t) => t.key === key)!).length;
  const matching = inTab(active);
  const shown = matching.slice(0, SHOW);
  let classes: Map<string, RequestClass>;
  try {
    classes = await classesForRequests(shown);
  } catch (e) {
    return <LoadError error={e} />;
  }
  const today = now.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long" });
  const latest = rows.reduce<string | null>((max, r) => {
    const t = r.updated_at && r.updated_at > r.created_at ? r.updated_at : r.created_at;
    return !max || t > max ? t : max;
  }, null);
  const updated = latest ? friendlyTime(latest, now).replace(/^Today, /, "").replace(/^Yesterday/, "yesterday") : null;
  const lightWord = light ? LIGHT_WORD[light] : null;
  const todayIso = sydneyToday(now);

  return (
    <div className="stack dash">
      {removed && (
        <div className="notice success" role="status">
          Request removed from the list. You can find it again under <Link href="/requests?removed=1">Removed Requests</Link>.
        </div>
      )}
      {/* Display and Accessibility sits where Ask Compass AI used to be; New Request stays rightmost. */}
      <PageHeader
        a11y="first"
        className="overview-head"
        actions={<>
          <span className="head-date" data-secondary="">{today}</span>
          <Link className="btn" href="/requests"><Icon name="plus" /> New Request</Link>
        </>}
      >
        <p className="kicker">Your Day, in Focus</p>
        <h1>{greeting(now)}, {user.displayName.split(" ")[0]} <span className="h1-spark" aria-hidden="true"><Icon name="sparkle" size={22} /></span></h1>
        <p className="muted">A calmer view of your tutoring requests. Take it one decision at a time.</p>
      </PageHeader>

      <section aria-labelledby="lights-heading">
        <h2 id="lights-heading" className="sr-only">Requests by Rule Result</h2>
        <div className="lights">
          {lights.map((l) => (
            <FilterLink key={l.colour} href={href({ light: light === l.colour ? null : l.colour, tab: active.key })} target="requests" current={light === l.colour} className={`light-card ${l.colour}`}>
              <span className="light-top">
                <span className="light-dot" aria-hidden="true" />
                <span className="light-word">{l.word}</span>
                <span className="light-title">· {l.title}</span>
                <span className="light-icon" aria-hidden="true"><Icon name={LIGHT_ICON[l.colour]} /></span>
              </span>
              <span className="light-count">{l.count}</span>
              <span className="light-text" data-secondary="">{l.text}</span>
              <span className="light-foot">
                <span>{l.count === 0 ? "None open" : l.yours === 0 ? "None need you right now" : `${l.yours} ${l.yours === 1 ? "needs" : "need"} your next step`}</span>
                <span className="light-cta">{light === l.colour ? "Showing" : "View Requests"} <Icon name="arrow" size={16} /></span>
              </span>
            </FilterLink>
          ))}
        </div>
      </section>

      <div className="overview-grid">
        <section id="requests" className="card requests-card" aria-labelledby="requests-heading" data-compass-avoid="">
          <div className="card-head">
            <div>
              <h2 id="requests-heading">Requests</h2>
              <p className="hint" data-secondary="">{updated && latest ? <>Newest first. Updated <time dateTime={latest}>{updated}</time>.</> : "Newest first."}</p>
            </div>
            <Link className="btn secondary small" href="/requests">View All Requests</Link>
          </div>
          {light && (
            <div className={`filter-bar ${light}`} role="status">
              <span className="light-dot" aria-hidden="true" />
              <span>Showing <strong>{lightWord}</strong> requests that are still open.</span>
              <FilterLink href={href({ tab: active.key })} target="requests" className="link-btn">Show All Requests</FilterLink>
            </div>
          )}
          <nav className="tabs" aria-label="Filter requests by next step">
            {TABS.map((t) => (
              <FilterLink key={t.key} href={href({ light, tab: t.key })} target="requests" current={t.key === active.key} className="tab">
                {t.label} <span className="tab-count">{count(t.key)}</span>
              </FilterLink>
            ))}
          </nav>
          {shown.length === 0 ? (
            <div className="empty" role="status">
              <span className="empty-icon" aria-hidden="true"><Icon name={light ? LIGHT_ICON[light] : "requests"} /></span>
              <h3>
                {rows.length === 0
                  ? "No requests yet"
                  : light && active.key !== "all"
                    ? `No ${lightWord?.toLowerCase()} requests under “${active.label}”`
                    : light
                      ? `No open ${lightWord?.toLowerCase()} requests`
                      : "Nothing here right now"}
              </h3>
              <p className="muted">
                {rows.length === 0
                  ? "Start the first request with Quick Capture or the Guided Wizard."
                  : light
                    ? "Nothing with this rule result is waiting. Requests that are closed keep their colour in their history."
                    : "Try another filter, or start a new request."}
              </p>
              <div className="row">
                {rows.length === 0 ? <Link className="btn" href="/requests">Start a Request</Link> : null}
                {light || active.key !== "all" ? <FilterLink href={href({})} target="requests" className="btn secondary">Show All Requests</FilterLink> : null}
              </div>
            </div>
          ) : (
            <QueueTable rows={shown} now={now} classes={classes} role={user.role} />
          )}
          <div className="queue-foot">
            <span className="hint">Showing {shown.length} of {matching.length} {light ? `${lightWord?.toLowerCase()} ` : ""}{active.key === "all" ? "requests" : `“${active.label.toLowerCase()}” requests`}</span>
            <Link href="/requests">View all requests <Icon name="arrow" size={16} /></Link>
          </div>
        </section>

        <div className="overview-side" data-compass-avoid="">
          <section className="card compass-card" aria-labelledby="compass-card-heading">
            <p className="kicker"><Icon name="sparkle" size={16} /> Compass AI</p>
            <div className="compass-card-art" aria-hidden="true"><CompassAvatar size={92} /></div>
            <h2 id="compass-card-heading">Less chasing. More teaching.</h2>
            <p className="muted">Ask what needs your attention, or start a lesson change, payment extension or tutor absence. Compass follows the owner&apos;s rules, and you confirm every change.</p>
            <OpenCompassButton className="btn compass-card-btn" />
          </section>

          <section className="card lessons-card" aria-labelledby="lessons-heading">
            <div className="card-head">
              <div>
                <h2 id="lessons-heading">Coming Up</h2>
                <p className="hint" data-secondary="">The next lessons on the timetable, Sydney time.</p>
              </div>
              <Link className="icon-link" href="/knowledge#lessons" aria-label="All upcoming lessons in the Knowledge Hub"><Icon name="arrow" /></Link>
            </div>
            {lessons === null ? (
              <p className="muted">The lesson timetable isn&apos;t set up in this database yet.</p>
            ) : lessons.lessons.length === 0 ? (
              <p className="muted">No lessons on the timetable.</p>
            ) : (
              <ul className="lesson-list">
                {lessons.lessons.map((l, i) => {
                  const day = sydneyDate(l.starts_at);
                  const away = isAway(lessons.absences, l.tutor_id, day);
                  const subject = l.bookings?.subject ?? "Lesson";
                  return (
                    <li key={l.id}>
                      <span className="lesson-time">
                        <strong>{timeFmt.format(new Date(l.starts_at))}</strong>
                        <span>{day === todayIso ? "Today" : dayFmt.format(new Date(l.starts_at))}</span>
                      </span>
                      <span className={`lesson-mark tint-${["lilac", "blue", "rose"][i % 3]}`} aria-hidden="true">{subject.replace(/^Year \d+\s*/, "").charAt(0) || "L"}</span>
                      <span className="lesson-text">
                        <strong>{subject}</strong>
                        <span>{l.bookings?.families?.student_name ?? "Student"} · {l.tutors?.name ?? l.tutor_id}</span>
                      </span>
                      <span className={`lesson-state${away ? " away" : ""}`}>{away ? "Tutor away" : "Scheduled"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card rules-card" aria-labelledby="rules-heading">
            <div className="card-head">
              <div>
                <h2 id="rules-heading">What the Colours Mean</h2>
                <p className="hint" data-secondary="">The owner&apos;s rules decide the colour. Approval never rewrites it.</p>
              </div>
              <Link className="icon-link" href="/knowledge#rules" aria-label="The owner's rules in the Knowledge Hub"><Icon name="arrow" /></Link>
            </div>
            <ul className="legend" aria-label="What the colours mean">
              {lights.map((l) => (
                <li key={l.colour} className={l.colour}>
                  <span className="light-dot" aria-hidden="true" />
                  <span><strong>{l.word}:</strong> {l.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
