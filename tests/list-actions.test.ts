import { describe, expect, it } from "vitest";
import { planListAction, type ListState } from "@/lib/actions/list-actions-logic";

const NOW = "2026-10-19T10:00:00.000Z";
const base: ListState = { status: "ready", welfare_status: "no", hidden_at: null, archived_at: null };

describe("planListAction", () => {
  it("archives only the list columns", () => {
    const plan = planListAction("archive", base, "admin", "u1", NOW);
    expect(plan).toEqual({ kind: "update", patch: { archived_at: NOW, archived_by: "u1" }, event: "archived" });
  });

  it("never touches the decision, status or money", () => {
    for (const action of ["archive", "remove"] as const) {
      const plan = planListAction(action, base, "owner", "u1", NOW);
      if (plan.kind !== "update") throw new Error("expected an update");
      expect(Object.keys(plan.patch).sort()).toEqual(action === "archive" ? ["archived_at", "archived_by"] : ["hidden_at", "hidden_by"]);
    }
  });

  it("skips requests already in the asked-for state, so repeats are safe", () => {
    expect(planListAction("archive", { ...base, archived_at: NOW }, "admin", "u1", NOW).kind).toBe("skip");
    expect(planListAction("unarchive", base, "admin", "u1", NOW).kind).toBe("skip");
    expect(planListAction("remove", { ...base, hidden_at: NOW }, "admin", "u1", NOW).kind).toBe("skip");
    expect(planListAction("restore", base, "admin", "u1", NOW).kind).toBe("skip");
  });

  it("keeps owner-only requests for the owner", () => {
    const waiting = { ...base, status: "awaiting_owner" as const };
    const welfare = { ...base, welfare_status: "yes" };
    for (const s of [waiting, welfare]) {
      expect(planListAction("archive", s, "admin", "u1", NOW).kind).toBe("refuse");
      expect(planListAction("remove", s, "admin", "u1", NOW).kind).toBe("refuse");
      expect(planListAction("archive", s, "owner", "u1", NOW).kind).toBe("update");
      expect(planListAction("remove", s, "owner", "u1", NOW).kind).toBe("update");
    }
  });

  it("lets anyone restore or put back", () => {
    const waiting = { ...base, status: "awaiting_owner" as const, archived_at: NOW, hidden_at: NOW };
    expect(planListAction("unarchive", waiting, "admin", "u1", NOW).kind).toBe("update");
    expect(planListAction("restore", waiting, "admin", "u1", NOW).kind).toBe("update");
  });

  it("won't archive a removed request until it is put back", () => {
    expect(planListAction("archive", { ...base, hidden_at: NOW }, "owner", "u1", NOW).kind).toBe("refuse");
  });
});
