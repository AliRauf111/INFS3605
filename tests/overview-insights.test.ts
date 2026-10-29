import { describe, expect, it } from "vitest";
import { filterByLight, lightFromParam, LIGHT_ORDER, LIGHT_PARAM, summariseLights, type LightRow } from "@/lib/overview/lights";
import { lessonsToday, nextWeek, openByNextStep, recentMix, sydneyPeriod, tutorsAvailable, weeklyCapacity, type SlotLite } from "@/lib/insights/logic";
import { MIN_CHOICES, withChoices } from "@/lib/workflows/logic";
import { workspaceGeometry } from "@/lib/assistant/workspace";
import { pickMode } from "@/components/a11y/store";
import { COLOUR_SHORT } from "@/lib/domain/types";

// Thursday 29 October 2026, 12:00 in Sydney (AEDT, UTC+11).
const NOW = new Date("2026-10-29T01:00:00Z");

describe("Overview traffic lights", () => {
  const rows: LightRow[] = [
    { decision: "red", status: "awaiting_owner", missing: 0 },
    { decision: "red", status: "closed", missing: 0 },
    { decision: "amber", status: "needs_clarification", missing: 2 },
    { decision: "amber", status: "approved", missing: 0 },
    { decision: "green", status: "ready", missing: 0 },
  ];

  it("orders the cards Red, Yellow, Green and shows Yellow for the stored amber value", () => {
    expect(LIGHT_ORDER).toEqual(["red", "amber", "green"]);
    expect(summariseLights(rows, "admin").map((l) => l.word)).toEqual(["Red", "Yellow", "Green"]);
    expect(LIGHT_PARAM.amber).toBe("yellow");
    expect(COLOUR_SHORT.amber).toBe("Yellow");
  });

  it("counts current records only, so closed requests drop out", () => {
    expect(summariseLights(rows, "admin").map((l) => l.count)).toEqual([1, 2, 1]);
  });

  it("keeps an approved request in its original colour until the outcome is recorded", () => {
    const yellow = filterByLight(rows, "amber");
    expect(yellow.map((r) => r.status)).toContain("approved");
  });

  it("counts what the signed-in role can act on", () => {
    const admin = summariseLights(rows, "admin");
    const owner = summariseLights(rows, "owner");
    // Waiting for Owner is not the admin's step; the owner can decide it.
    expect(admin[0].yours).toBe(0);
    expect(owner[0].yours).toBe(1);
  });

  it("reads the filter from the address bar, accepting yellow or amber", () => {
    expect(lightFromParam("yellow")).toBe("amber");
    expect(lightFromParam("Amber")).toBe("amber");
    expect(lightFromParam("RED")).toBe("red");
    expect(lightFromParam("blue")).toBeNull();
    expect(lightFromParam(undefined)).toBeNull();
  });

  it("shows every row when no filter is set", () => {
    expect(filterByLight(rows, null)).toHaveLength(rows.length);
    expect(filterByLight(rows, "red")).toHaveLength(1);
  });
});

describe("Insights calculations", () => {
  const p = sydneyPeriod(NOW);

  it("uses the Sydney calendar week, Monday to Sunday", () => {
    expect(p.today).toBe("2026-10-29");
    expect(p.weekStart).toBe("2026-10-26");
    expect(p.weekEnd).toBe("2026-11-01");
    expect(p.recentStart).toBe("2026-09-30");
  });

  it("treats a lesson just after midnight Sydney time as today", () => {
    const lessons = [
      { id: "a", tutor_id: "t1", starts_at: "2026-10-28T13:30:00Z", ends_at: "2026-10-28T14:30:00Z", status: "completed" as const }, // 00:30 today
      { id: "b", tutor_id: "t1", starts_at: "2026-10-29T05:00:00Z", ends_at: "2026-10-29T06:00:00Z", status: "scheduled" as const }, // 16:00 today
      { id: "c", tutor_id: "t2", starts_at: "2026-10-29T06:00:00Z", ends_at: "2026-10-29T07:00:00Z", status: "cancelled" as const },
      { id: "d", tutor_id: "t2", starts_at: "2026-10-29T13:30:00Z", ends_at: "2026-10-29T14:30:00Z", status: "scheduled" as const }, // tomorrow
    ];
    const r = lessonsToday(lessons, p, NOW);
    expect(r.count).toBe(2);
    expect(r.remaining).toBe(1);
    expect(r.next?.id).toBe("b");
  });

  const slot = (tutor: string, day: string, hourUtc: number, len: number, status: SlotLite["status"]): SlotLite => ({
    tutor_id: tutor,
    starts_at: `${day}T${String(hourUtc).padStart(2, "0")}:00:00Z`,
    ends_at: `${day}T${String(hourUtc + len).padStart(2, "0")}:00:00Z`,
    status,
  });

  it("counts tutors with a free slot today who aren't away", () => {
    const slots = [slot("t1", "2026-10-29", 3, 1, "free"), slot("t2", "2026-10-29", 3, 1, "free"), slot("t3", "2026-10-29", 3, 1, "booked")];
    const absences = [{ tutor_id: "t2", starts_on: "2026-10-29", ends_on: "2026-10-30" }];
    expect(tutorsAvailable(["t1", "t2", "t3"], slots, absences, p)).toEqual({ available: 1, total: 3, away: 1 });
  });

  it("says availability is unknown rather than guessing zero", () => {
    expect(tutorsAvailable(["t1"], [], [], p).available).toBeNull();
  });

  it("works out weekly capacity from booked and offered hours, leaving out free time while away", () => {
    const slots = [
      slot("t1", "2026-10-27", 3, 2, "booked"),
      slot("t1", "2026-10-27", 6, 2, "free"),
      slot("t2", "2026-10-30", 3, 4, "free"), // t2 is away on the 30th
      slot("t1", "2026-11-05", 3, 2, "booked"), // next week
    ];
    const c = weeklyCapacity(slots, [{ tutor_id: "t2", starts_on: "2026-10-30", ends_on: "2026-10-30" }], p);
    expect(c.booked).toBe(2);
    expect(c.offered).toBe(4);
    expect(c.percent).toBe(50);
    expect(c.byDay).toHaveLength(7);
  });

  it("can look at next week when nothing is offered this week", () => {
    const n = nextWeek(p);
    expect(n.weekStart).toBe("2026-11-02");
    expect(n.weekEnd).toBe("2026-11-08");
    expect(n.today).toBe(p.today);
    const c = weeklyCapacity([slot("t1", "2026-11-03", 3, 1, "booked"), slot("t1", "2026-11-04", 3, 3, "free")], [], n);
    expect(c.percent).toBe(25);
  });

  it("gives no capacity percentage when nothing is offered", () => {
    expect(weeklyCapacity([], [], p).percent).toBeNull();
  });

  it("counts new requests from the last 30 days by rule result", () => {
    const mix = recentMix(
      [
        { decision: "red", status: "ready", created_at: "2026-10-28T02:00:00Z", missing: 0 },
        { decision: "amber", status: "ready", created_at: "2026-09-30T02:00:00Z", missing: 0 },
        { decision: "green", status: "ready", created_at: "2026-09-29T02:00:00Z", missing: 0 }, // 31 days ago
      ],
      p,
    );
    expect(mix).toEqual({ red: 1, amber: 1, green: 0, total: 2 });
  });

  it("groups open requests by next step for the role, leaving out finished ones", () => {
    const rows = [
      { decision: "amber" as const, status: "needs_clarification" as const, created_at: "", missing: 1 },
      { decision: "green" as const, status: "closed" as const, created_at: "", missing: 0 },
    ];
    const admin = openByNextStep(rows, "admin");
    expect(admin.find((s) => s.queue === "clarify")?.count).toBe(1);
    expect(admin.some((s) => s.queue === "review")).toBe(false);
    expect(openByNextStep(rows, "owner").some((s) => s.queue === "send")).toBe(false);
  });
});

describe("Compass guided questions", () => {
  const cancel = { type: "workflow" as const, runId: "run-1", op: "cancel" as const };

  it("always offers at least three choices", () => {
    const one = withChoices("run-1", [{ label: "Yes", command: { type: "attention" } }], "lesson_change");
    expect(one.length).toBeGreaterThanOrEqual(MIN_CHOICES);
    expect(one.map((o) => o.label)).toEqual(["Yes", "Show the Rules", "Stop Workflow"]);
  });

  it("adds Stop Workflow once and never repeats it", () => {
    const list = withChoices("run-1", [
      { label: "A", command: { type: "attention" } },
      { label: "B", command: { type: "attention" } },
      { label: "Stop Workflow", command: cancel },
    ]);
    expect(list.filter((o) => o.label === "Stop Workflow")).toHaveLength(1);
    expect(list).toHaveLength(3);
  });

  it("leaves a list that already has enough choices alone, apart from Stop", () => {
    const list = withChoices("run-1", [
      { label: "A", command: { type: "attention" } },
      { label: "B", command: { type: "attention" } },
      { label: "C", command: { type: "attention" } },
    ]);
    expect(list.map((o) => o.label)).toEqual(["A", "B", "C", "Stop Workflow"]);
  });
});

describe("Layout beside the navigation rail", () => {
  it("keeps the rail visible beside the Compass workspace on wide screens", () => {
    const g = workspaceGeometry({ width: 1440, height: 900, offsetTop: 0, rail: 88 });
    expect(g.rail).toBe(88);
    expect(g.left).toBe(88 + g.margin);
    expect(g.left + g.width + g.column).toBe(1440);
  });

  it("covers the rail when keeping it would make the workspace too narrow", () => {
    expect(workspaceGeometry({ width: 700, height: 900, offsetTop: 0, rail: 88 }).rail).toBe(0);
    expect(workspaceGeometry({ width: 390, height: 800, offsetTop: 0, rail: 88 }).mode).toBe("full");
  });

  it("opens the accessibility panel as a drawer when the rail leaves too little room", () => {
    expect(pickMode(1200, 100)).toBe("side");
    expect(pickMode(1200, 100, 88)).toBe("modal");
  });
});
