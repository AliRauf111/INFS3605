"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icons";
import { GROUP_EMPTY, GROUP_LABEL, GROUP_SIGNAL, STATUS_GROUPS, twoDigits, type StatusGroup } from "@/lib/overview/status-cards";

// The Overview's three status cards and "Over to You". A card filters the list in place
// (press it again, or Show all requests, to clear); the choice is kept in the address as
// ?status=, so a refresh or a shared link opens the same view. The centre and right
// columns come from the server as children.

export type Tile = {
  id: string;
  group: StatusGroup;
  type: string;
  colour: "lavender" | "blue" | "rose";
  title: string;
  line: string;
  when: string;
  initials: string;
  who: string | null;
};

const GROUP_ICON: Record<StatusGroup, IconName> = { owner: "people", info: "info", ready: "check" };
const AVATAR: Record<Tile["colour"], string> = { lavender: "lilac", blue: "blue", rose: "rose" };
const SHOW = 3;

export function OverviewBoard({ tiles, counts, texts, initial, children }: {
  tiles: Tile[];
  counts: Record<StatusGroup, number>;
  texts: Record<StatusGroup, string>;
  initial: StatusGroup | null;
  children: React.ReactNode;
}) {
  const [filter, setFilter] = useState<StatusGroup | null>(initial);
  const heading = useRef<HTMLHeadingElement>(null);
  const list = tiles.filter((t) => !filter || t.group === filter);
  const shown = list.slice(0, SHOW);

  const choose = (g: StatusGroup | null) => {
    setFilter(g);
    const url = new URL(window.location.href);
    if (g) url.searchParams.set("status", g);
    else url.searchParams.delete("status");
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <>
      <section className="traffic-summary" aria-label="Filter overview requests by status">
        {STATUS_GROUPS.map((g) => {
          const n = counts[g];
          const on = filter === g;
          return (
            <button
              key={g}
              type="button"
              className={`traffic-card signal-${GROUP_SIGNAL[g]}${on ? " selected" : ""}`}
              aria-pressed={on}
              aria-controls="overviewRequests"
              aria-label={`${GROUP_LABEL[g]}: ${n} ${n === 1 ? "request" : "requests"}. Filter overview`}
              onClick={() => choose(on ? null : g)}
            >
              <span className="traffic-label"><i aria-hidden="true" />{GROUP_LABEL[g]}</span>
              <span className="traffic-main">
                <span className="traffic-number">{twoDigits(n)}</span>
                <span className="traffic-icon"><Icon name={GROUP_ICON[g]} /></span>
              </span>
              <span className="traffic-bottom">
                <span>{texts[g]}</span>
                <span className="traffic-action">{on ? "Showing" : "View requests"} <Icon name="arrow" /></span>
              </span>
            </button>
          );
        })}
      </section>

      <div className="dashboard-grid overview-dashboard">
        <section className="card attention-card" id="overviewRequests" aria-labelledby="overviewRequestsHeading" data-compass-avoid="">
          <div className="card-head">
            <div>
              <h2 id="overviewRequestsHeading" ref={heading} tabIndex={-1}>Over to You</h2>
              <p className="caption" aria-live="polite">
                {filter ? `${GROUP_LABEL[filter]} · ${list.length} ${list.length === 1 ? "request" : "requests"}` : "A few things that need a human touch"}
              </p>
            </div>
            <span className="count" aria-hidden="true">{twoDigits(list.length)}</span>
          </div>
          {filter && (
            <button type="button" className="clear-status-filter" onClick={() => { choose(null); heading.current?.focus({ preventScroll: true }); }}>
              <Icon name="close" /> Show all requests
            </button>
          )}
          {shown.length ? (
            shown.map((t) => (
              <Link key={t.id} href={`/requests/${t.id}`} className={`request-tile ${t.colour}`}>
                <div className="tile-top"><span>{t.type}</span><Icon name="external" /></div>
                <h3>{t.title}</h3>
                <p>{t.line}</p>
                <span className={`request-signal signal-${GROUP_SIGNAL[t.group]}`}><i aria-hidden="true" />{GROUP_LABEL[t.group]}</span>
                <div className="tile-footer">
                  <span className="tile-meta"><Icon name="clock" />{t.when}</span>
                  <span className={`avatar ${AVATAR[t.colour]}`} title={t.who ? `Student: ${t.who}` : undefined} aria-label={t.who ? `Student ${t.who}` : undefined} role={t.who ? "img" : undefined} aria-hidden={t.who ? undefined : true}>{t.initials}</span>
                </div>
              </Link>
            ))
          ) : (
            <div className="empty-state status-empty">
              <Icon name={filter ? GROUP_ICON[filter] : "check"} />
              <p>{filter ? GROUP_EMPTY[filter] : "You are all caught up."}</p>
              <small>{filter ? "Choose another status or show all requests." : "Every request has been dealt with. Enjoy a little more headspace."}</small>
            </div>
          )}
          <Link className="full-text-btn" href={filter ? `/requests?group=${filter}` : "/requests"}>
            {list.length > shown.length ? `View all ${list.length} requests` : "View all requests"} <Icon name="arrow" />
          </Link>
        </section>
        {children}
      </div>
    </>
  );
}
