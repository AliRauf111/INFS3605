import { describe, expect, it } from "vitest";
import { bookedPercent, hoursByDay, monthSeries, monthWeekStarts, niceMax, pointsChange, weekSeries } from "@/lib/overview/capacity";
import { cardLine, countGroups, groupOf, pendingRequests, twoDigits, type CardRow } from "@/lib/overview/status-cards";
import { ruleLines } from "@/lib/overview/rules";

describe("Overview status cards", () => {
  const row = (status: CardRow["status"], extra: Partial<CardRow> = {}): CardRow => ({
    id: Math.random().toString(36), request_type: "refund", status, decision: "amber", amount_cents: 5000, reference_id: "BK-1",
    created_at: "2026-10-01T00:00:00Z", missing: 0, welfare: false, complaint: false, ...extra,
  });

  it("groups statuses into owner review, more information and ready for admin", () => {
    expect(groupOf("review_required")).toBe("owner");
    expect(groupOf("awaiting_owner")).toBe("owner");
    expect(groupOf("more_info_requested")).toBe("info");
    expect(groupOf("approved")).toBe("ready");
    expect(groupOf("closed")).toBeNull();
    expect(countGroups([row("ready"), row("closed"), row("needs_clarification"), row("awaiting_owner")])).toEqual({ owner: 1, info: 1, ready: 1 });
  });

  it("lists every pending request, owner decisions first, welfare first within a group", () => {
    const rows = [row("ready", { id: "r" }), row("awaiting_owner", { id: "o" }), row("review_required", { id: "w", welfare: true, created_at: "2026-10-09T00:00:00Z" }), row("closed", { id: "c" })];
    expect(pendingRequests(rows).map((r) => r.id)).toEqual(["w", "o", "r"]);
  });

  it("shows two-digit counts and never shows welfare wording", () => {
    expect(twoDigits(3)).toBe("03");
    expect(twoDigits(12)).toBe("12");
    expect(cardLine(row("review_required", { welfare: true, context: "Private family detail" }))).not.toMatch(/Private/);
  });
});

describe("Overview capacity chart", () => {
  // 2026-11-02 is a Monday. 23:00Z the day before is 10:00 in Sydney (UTC+11).
  it("adds booked and free hours per Sydney day and leaves out free time on an away day", () => {
    const data = [
      { tutor_id: "T-01", starts_at: "2026-11-01T23:00:00Z", ends_at: "2026-11-02T01:00:00Z", status: "booked" as const },
      { tutor_id: "T-01", starts_at: "2026-11-02T02:00:00Z", ends_at: "2026-11-02T03:00:00Z", status: "free" as const },
      { tutor_id: "T-02", starts_at: "2026-11-03T02:00:00Z", ends_at: "2026-11-03T04:00:00Z", status: "free" as const },
    ];
    const away = [{ tutor_id: "T-02", starts_on: "2026-11-03", ends_on: "2026-11-03" }];
    expect(hoursByDay(data, away, ["2026-11-02", "2026-11-03"])).toEqual({ booked: [2, 0], offered: [3, 0] });
    const week = weekSeries(data, [], "2026-11-02");
    expect(week.labels[0]).toBe("Mon");
    expect(week.offered.slice(0, 2)).toEqual([3, 2]);
    expect(week.percent).toBe(40);
  });

  it("splits a month into its weeks and works out percentages and changes", () => {
    expect(monthWeekStarts("2026-10-29")).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(monthSeries([], [], "2026-10-29").labels).toEqual(["Wk 1", "Wk 2", "Wk 3", "Wk 4", "Wk 5"]);
    expect(bookedPercent([0], [0])).toBeNull();
    expect(pointsChange(50, 42)).toBe(8);
    expect(pointsChange(50, null)).toBeNull();
  });

  it("picks a scale top that splits into three even steps", () => {
    expect(niceMax(4)).toBe(6);
    expect(niceMax(50)).toBe(60);
    expect(niceMax(59) % 3).toBe(0);
    expect(niceMax(0)).toBeGreaterThan(0);
  });
});

describe("Overview rules card", () => {
  it("reads the team's limits from the owner's active rule sets", () => {
    const lines = ruleLines([
      { category: "payment_extension", definition: { rules: [{ colour: "green", range: { max: 7 } }, { colour: "amber", range: { max: 30 } }] } },
      { category: "refund", definition: { rules: [{ colour: "green", range: { max: 5000 } }] } },
    ]);
    expect(lines).toEqual(["Payment extensions up to 7 days", "Refunds under $50 handled by the team"]);
    expect(ruleLines([])).toEqual([]);
  });
});
