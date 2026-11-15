import { describe, expect, it } from "vitest";
import { addMonths, dayFromParam, dayLabel, lessonStatus, monthFromParam, monthGrid, monthLabel, moveDay, subjectIcon, timeParts } from "@/lib/schedule/calendar";

describe("Schedule month calendar", () => {
  it("lays October 2026 out Monday to Sunday with the days either side", () => {
    const weeks = monthGrid("2026-10");
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toBe("2026-09-28");
    expect(weeks[0][3]).toBe("2026-10-01");
    expect(weeks[4][6]).toBe("2026-11-01");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("covers a month that starts on a Monday and one that needs six rows", () => {
    expect(monthGrid("2027-02")[0][0]).toBe("2027-02-01");
    expect(monthGrid("2026-08")).toHaveLength(6);
  });

  it("reads the month and day from the address, falling back to today", () => {
    expect(monthFromParam("2026-11", "2026-10-30")).toBe("2026-11");
    expect(monthFromParam("2026-13", "2026-10-30")).toBe("2026-10");
    expect(monthFromParam(undefined, "2026-10-30")).toBe("2026-10");
    expect(dayFromParam("2026-10-30")).toBe("2026-10-30");
    expect(dayFromParam("2026-02-30")).toBeNull();
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthLabel("2026-10")).toBe("October 2026");
  });

  it("gives each day a screen reader label", () => {
    expect(dayLabel("2026-10-30", 2)).toBe("Friday 30 October, 2 lessons");
    expect(dayLabel("2026-10-30", 1, "2026-10-30")).toBe("Friday 30 October, today, 1 lesson");
    expect(dayLabel("2026-10-31", 0)).toBe("Saturday 31 October, no lessons");
  });

  it("moves between days with the arrow keys, Home and End", () => {
    expect(moveDay("2026-10-30", "ArrowRight")).toBe("2026-10-31");
    expect(moveDay("2026-10-01", "ArrowLeft")).toBe("2026-09-30");
    expect(moveDay("2026-10-30", "ArrowDown")).toBe("2026-11-06");
    expect(moveDay("2026-10-30", "ArrowUp")).toBe("2026-10-23");
    expect(moveDay("2026-10-30", "Home")).toBe("2026-10-26");
    expect(moveDay("2026-10-30", "End")).toBe("2026-11-01");
    expect(moveDay("2026-10-30", "a")).toBeNull();
  });

  it("shows lesson times in Sydney and a worded status", () => {
    expect(timeParts("2026-10-30T07:15:00Z")).toEqual({ time: "6:15", period: "pm" });
    expect(subjectIcon("Year 9 Maths")).toEqual({ letter: "M", cls: "math" });
    expect(subjectIcon("Year 8 Science")).toEqual({ letter: "S", cls: "sci" });
    expect(lessonStatus("scheduled", true)).toEqual({ label: "Cover needed", warn: true });
    expect(lessonStatus("scheduled", false).label).toBe("Confirmed");
    expect(lessonStatus("completed", true).label).toBe("Completed");
    expect(lessonStatus("cancelled", false).label).toBe("Cancelled");
  });
});
