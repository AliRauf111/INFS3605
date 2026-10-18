import { describe, expect, it } from "vitest";
import { friendlyTime, nextStep, progressHeading, requestProgress, ruleName } from "@/lib/domain/progress";

describe("request progress", () => {
  it("puts a red request waiting to be sent at owner review", () => {
    const steps = requestProgress("review_required", false);
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming"]);
    expect(progressHeading(steps)).toEqual({ title: "Step 3 of 4: owner review", aside: "One step after this one" });
  });
  it("skips owner review for green requests", () => {
    const steps = requestProgress("ready", false);
    expect(steps[2].state).toBe("skipped");
    expect(progressHeading(steps)).toEqual({ title: "Step 4 of 4: recorded", aside: "This is the last step" });
  });
  it("holds at the rule check while facts are missing", () => {
    expect(progressHeading(requestProgress("needs_clarification", false)).title).toBe("Step 2 of 4: rule check");
  });
  it("finishes when closed", () => {
    const steps = requestProgress("closed", true);
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(nextStep("closed").pending).toBe("");
  });
});

describe("labels", () => {
  it("names known rules and tidies unknown ones", () => {
    expect(ruleName("safety.complaint")).toBe("Safety complaint");
    expect(ruleName("refund.custom_big_one")).toBe("Custom big one");
  });
  it("says today and yesterday in Sydney time", () => {
    const now = new Date("2026-10-19T03:00:00Z"); // 2pm in Sydney
    expect(friendlyTime("2026-10-19T00:13:00Z", now)).toMatch(/^Today, 11:13/);
    expect(friendlyTime("2026-10-18T00:13:00Z", now)).toMatch(/^Yesterday/);
    expect(friendlyTime("2026-10-12T09:19:00Z", now)).toMatch(/^12 Oct, 8:19/);
  });
});
