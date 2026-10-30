"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icons";
import { GROUP_SIGNAL, STATUS_GROUPS, twoDigits, type StatusGroup } from "@/lib/overview/status-cards";
import { useI18n } from "@/components/i18n/I18nProvider";

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
  reference: string | null;
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
  const { t } = useI18n();
  const label = (g: StatusGroup) => t(`domain.group.${g}`);
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
      <section className="traffic-summary" aria-label={t("overview.filterLabel")}>
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
              aria-label={t("overview.cardLabel", { group: label(g), count: n })}
              onClick={() => choose(on ? null : g)}
            >
              <span className="traffic-label"><i aria-hidden="true" />{label(g)}</span>
              <span className="traffic-main">
                <span className="traffic-number">{twoDigits(n)}</span>
                <span className="traffic-icon"><Icon name={GROUP_ICON[g]} /></span>
              </span>
              <span className="traffic-bottom">
                <span>{texts[g]}</span>
                <span className="traffic-action">{on ? t("overview.showing") : t("overview.viewRequests")} <Icon name="arrow" /></span>
              </span>
            </button>
          );
        })}
      </section>

      <div className="dashboard-grid overview-dashboard">
        <section className="card attention-card" id="overviewRequests" aria-labelledby="overviewRequestsHeading">
          <div className="card-head">
            <div>
              <h2 id="overviewRequestsHeading" ref={heading} tabIndex={-1}>{t("overview.overToYou")}</h2>
              <p className="caption" aria-live="polite">
                {filter ? t("overview.groupCount", { group: label(filter), count: list.length }) : t("overview.humanTouch")}
              </p>
            </div>
            <span className="count" aria-hidden="true">{twoDigits(list.length)}</span>
          </div>
          {filter && (
            <button type="button" className="clear-status-filter" onClick={() => { choose(null); heading.current?.focus({ preventScroll: true }); }}>
              <Icon name="close" /> {t("overview.showAllRequests")}
            </button>
          )}
          {shown.length ? (
            shown.map((tile) => (
              <Link key={tile.id} href={`/requests/${tile.id}`} className={`request-tile ${tile.colour}`}>
                <div className="tile-top"><span>{tile.type}</span><Icon name="external" /></div>
                <h3>{tile.title}</h3>
                <p dir="auto">{tile.line}</p>
                <span className={`request-signal signal-${GROUP_SIGNAL[tile.group]}`}><i aria-hidden="true" />{label(tile.group)}</span>
                <div className="tile-footer">
                  <span className="tile-meta"><Icon name="clock" />{tile.reference ? <><bdi>{tile.reference}</bdi> · </> : null}<span className="tile-when">{tile.when}</span></span>
                  <span className={`avatar ${AVATAR[tile.colour]}`} title={tile.who ? t("overview.student", { name: tile.who }) : undefined} aria-label={tile.who ? t("overview.studentLabel", { name: tile.who }) : undefined} role={tile.who ? "img" : undefined} aria-hidden={tile.who ? undefined : true}>{tile.initials}</span>
                </div>
              </Link>
            ))
          ) : (
            <div className="empty-state status-empty">
              <Icon name={filter ? GROUP_ICON[filter] : "check"} />
              <p>{filter ? t(`domain.groupEmpty.${filter}`) : t("overview.allCaughtUp")}</p>
              <small>{filter ? t("overview.chooseAnother") : t("overview.everyDealtWith")}</small>
            </div>
          )}
          <Link className="full-text-btn" href={filter ? `/requests?group=${filter}` : "/requests"}>
            {list.length > shown.length ? t("overview.viewAllCount", { count: list.length }) : t("overview.viewAll")} <Icon name="arrow" />
          </Link>
        </section>
        {children}
      </div>
    </>
  );
}
