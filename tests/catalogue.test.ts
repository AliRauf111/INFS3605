import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COURSES,
  EMPTY_SELECTION,
  SUBJECT_AREAS,
  canTeach,
  categoryCode,
  changeSelection,
  coursesFor,
  findCourses,
  formatSelection,
  searchCatalogue,
  validateSelection,
} from "@/lib/catalogue/hsc";
import { catalogueSql } from "@/lib/catalogue/sql";
import { courseAnswer, isCourseQuestion, yearIn } from "@/lib/assistant/courses";

describe("HSC catalogue codes", () => {
  it("has exactly the ten subject areas and codes", () => {
    expect(SUBJECT_AREAS.map((a) => [a.name, a.codes[11], a.codes[12]])).toEqual([
      ["English", "ENG1011", "ENG1012"],
      ["Mathematics", "MTH1011", "MTH1012"],
      ["Science", "SCI1011", "SCI1012"],
      ["Business and humanities", "BHU1011", "BHU1012"],
      ["History", "HIS1011", "HIS1012"],
      ["Technology and design", "TDE1011", "TDE1012"],
      ["Creative arts", "CAR1011", "CAR1012"],
      ["Health and community", "HCO1011", "HCO1012"],
      ["Languages", "LAN1011", "LAN1012"],
      ["Vocational education", "VET1011", "VET1012"],
    ]);
  });

  it("gives each course its own id and a valid area", () => {
    const ids = COURSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COURSES) expect(SUBJECT_AREAS.some((a) => a.id === c.areaId)).toBe(true);
  });

  it("returns the code for the year and area", () => {
    expect(categoryCode("mathematics", 11)).toBe("MTH1011");
    expect(categoryCode("mathematics", 12)).toBe("MTH1012");
    expect(categoryCode("vocational", 12)).toBe("VET1012");
    expect(categoryCode("nope", 11)).toBeNull();
  });

  it("reflects which year each course runs in", () => {
    const y11 = coursesFor("mathematics", 11).map((c) => c.id);
    const y12 = coursesFor("mathematics", 12).map((c) => c.id);
    expect(y11).toEqual(["maths_standard", "maths_advanced", "maths_extension_1"]);
    expect(y12).toEqual(["maths_standard_1", "maths_standard_2", "maths_advanced", "maths_extension_1", "maths_extension_2"]);
    for (const id of ["english_extension_2", "maths_extension_2", "science_extension", "history_extension", "music_extension", "english_extension_1"]) {
      expect(COURSES.find((c) => c.id === id)?.years).toEqual([12]);
    }
    expect(COURSES.find((c) => c.id === "english_extension")?.years).toEqual([11]);
  });
});

describe("selections", () => {
  it("formats a selection the agreed way", () => {
    expect(formatSelection({ year: 11, courseId: "maths_advanced" })).toBe("Mathematics Advanced · Year 11 · MTH1011");
    expect(formatSelection({ year: 12, courseId: "lang_french", level: "continuers" })).toBe("French Continuers · Year 12 · LAN1012");
    expect(formatSelection({ year: 11, courseId: "vet_hospitality", qualification: "Certificate II in Hospitality" })).toBe("Hospitality (Certificate II in Hospitality) · Year 11 · VET1011");
  });

  it("keeps a course that still fits when the year changes, and the code follows", () => {
    const start = { ...EMPTY_SELECTION, year: 11 as const, areaId: "mathematics" as const, courseId: "maths_advanced" };
    const { selection, cleared } = changeSelection(start, { year: 12 });
    expect(selection.courseId).toBe("maths_advanced");
    expect(cleared).toBeNull();
    const v = validateSelection(selection);
    expect(v.ok && v.value.code).toBe("MTH1012");
  });

  it("clears a course that no longer fits and says why", () => {
    const start = { ...EMPTY_SELECTION, year: 12 as const, areaId: "mathematics" as const, courseId: "maths_extension_2" };
    const toY11 = changeSelection(start, { year: 11 });
    expect(toY11.selection.courseId).toBeNull();
    expect(toY11.cleared).toMatch(/Mathematics Extension 2 isn't a Year 11 course/);
    const newArea = changeSelection(start, { areaId: "science" });
    expect(newArea.selection.courseId).toBeNull();
    expect(newArea.cleared).toMatch(/isn't in Science/);
  });

  it("clears a language Extension level when moving to Year 11", () => {
    const start = { ...EMPTY_SELECTION, year: 12 as const, areaId: "languages" as const, courseId: "lang_japanese", level: "extension" as const };
    const r = changeSelection(start, { year: 11 });
    expect(r.selection.courseId).toBe("lang_japanese");
    expect(r.selection.level).toBeNull();
    expect(r.cleared).toMatch(/Year 12 only/);
  });

  it("rejects combinations that can't be saved", () => {
    expect(validateSelection({ year: 11, areaId: "mathematics", courseId: "maths_extension_2" }).ok).toBe(false);
    expect(validateSelection({ year: 12, areaId: "science", courseId: "maths_advanced" }).ok).toBe(false);
    expect(validateSelection({ year: 11, areaId: "languages", courseId: "lang_french", level: "extension" }).ok).toBe(false);
    expect(validateSelection({ year: 11, areaId: "languages", courseId: "lang_french", level: null }).ok).toBe(false);
    expect(validateSelection({ year: 11, areaId: "mathematics", courseId: "maths_advanced", level: "beginners" }).ok).toBe(false);
    expect(validateSelection({ year: 10 as never, areaId: "mathematics", courseId: "maths_advanced" }).ok).toBe(false);
    const ok = validateSelection({ year: 12, areaId: "languages", courseId: "lang_french", level: "extension", qualification: "" });
    expect(ok).toEqual({ ok: true, value: { year: 12, areaId: "languages", code: "LAN1012", courseId: "lang_french", level: "extension", qualification: "" } });
  });
});

describe("matching tutors", () => {
  const priya = [
    { courseId: "maths_standard_2", year: 12 as const },
    { courseId: "maths_advanced", year: 11 as const },
  ];
  it("needs the exact course and year, not just the code", () => {
    expect(canTeach(priya, { courseId: "maths_advanced", year: 11 })).toBe(true);
    expect(canTeach(priya, { courseId: "maths_advanced", year: 12 })).toBe(false); // same course, other year
    expect(canTeach(priya, { courseId: "maths_extension_2", year: 12 })).toBe(false); // same MTH1012 code, other course
  });
  it("needs the language level to match", () => {
    const t = [{ courseId: "lang_french", year: 12 as const, level: "continuers" }];
    expect(canTeach(t, { courseId: "lang_french", year: 12, level: "continuers" })).toBe(true);
    expect(canTeach(t, { courseId: "lang_french", year: 12, level: "extension" })).toBe(false);
  });
});

describe("search", () => {
  it("finds courses by name, nickname, year and code", () => {
    expect(searchCatalogue("maths advanced 11").map((r) => r.label)).toEqual(["Mathematics Advanced · Year 11 · MTH1011"]);
    expect(searchCatalogue("ext 2").some((r) => r.courseId === "maths_extension_2" && r.year === 12)).toBe(true);
    expect(searchCatalogue("hms").map((r) => r.courseId)).toContain("health_movement_science");
    expect(findCourses("does anyone teach english extension 1?").map((c) => c.id)).toEqual(["english_extension_1"]);
  });
});

describe("Compass AI course answers", () => {
  const facts = {
    ready: true,
    tutors: [
      { id: "T-01", name: "Priya Shah" },
      { id: "T-02", name: "Tom Becker" },
    ],
    tutorCourses: [
      { tutor_id: "T-01", course_id: "maths_advanced", year_level: 12 as const, course_level: "" },
      { tutor_id: "T-01", course_id: "maths_standard_2", year_level: 12 as const, course_level: "" },
    ],
    offered: { "maths_advanced|12": true },
  };
  it("spots course questions but not requests", () => {
    expect(isCourseQuestion("Who teaches Maths Advanced Year 12?")).toBe(true);
    expect(isCourseQuestion("Can we move Ravi's Maths Advanced lesson?")).toBe(false);
    expect(isCourseQuestion("Refund for Leo please")).toBe(false);
    expect(yearIn("who teaches MTH1012 stuff")).toBe(12);
  });
  it("names only tutors who teach the exact course and year", () => {
    const blocks = courseAnswer("Who teaches Maths Advanced Year 12?", facts);
    const found = blocks.find((b) => b.kind === "found");
    expect(found && found.kind === "found" && found.items).toEqual(["Mathematics Advanced · Year 12 · MTH1012: offered. Taught by Priya Shah."]);
    const ext = courseAnswer("who teaches maths ext 2 year 12", facts).find((b) => b.kind === "found");
    expect(ext && ext.kind === "found" && ext.items[0]).toMatch(/not offered by the business yet\. No tutor is recorded as teaching it\./);
  });
  it("won't treat a bare code as one course", () => {
    const blocks = courseAnswer("who teaches MTH1012?", facts);
    expect(blocks[0]).toMatchObject({ kind: "text" });
    expect(blocks[0].kind === "text" && blocks[0].text).toMatch(/covers 5 courses/);
  });
  it("says when a course doesn't run in that year", () => {
    const found = courseAnswer("who teaches maths extension 2 year 11", facts).find((b) => b.kind === "found");
    expect(found && found.kind === "found" && found.items[0]).toMatch(/isn't a Year 11 course/);
  });
});

describe("generated SQL", () => {
  it("matches supabase/catalogue.sql (run npm run catalogue:generate after editing hsc.ts)", () => {
    expect(readFileSync("supabase/catalogue.sql", "utf8")).toBe(catalogueSql());
  });
  it("is in the one-paste setup file", () => {
    expect(readFileSync("supabase/setup-everything.sql", "utf8")).toContain(catalogueSql().trim().split("\n").slice(4, 6).join("\n"));
  });
});

describe("search ranking", () => {
  it("puts the named course first and matches numbers as whole words", () => {
    expect(searchCatalogue("english ext 1").map((r) => r.label)).toEqual(["English Extension 1 · Year 12 · ENG1012"]);
    expect(searchCatalogue("MTH1012")[0].label).toMatch(/· Year 12 · MTH1012$/);
  });
});
