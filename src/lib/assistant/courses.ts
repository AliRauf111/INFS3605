import {
  COURSES,
  SUBJECT_AREAS,
  canTeach,
  findCourses,
  formatSelection,
  levelName,
  type LanguageLevel,
  type YearLevel,
} from "@/lib/catalogue/hsc";
import type { Block } from "./logic";

// Compass AI answers "who teaches X" and "do we offer X" from the HSC catalogue and the
// tutors' recorded courses. This is a lookup, not AI, and it uses the same exact-match
// rule as the Subjects page: the course and year must match, never just the code.

export type CourseFacts = {
  ready: boolean;
  tutors: Array<{ id: string; name: string }>;
  tutorCourses: Array<{ tutor_id: string; course_id: string; year_level: YearLevel; course_level: string }>;
  offered: Record<string, boolean>;
};

const CODE = /\b([a-z]{3})(101[12])\b/i;

function codeIn(text: string) {
  const m = CODE.exec(text);
  if (!m) return null;
  const code = m[0].toUpperCase();
  const a = SUBJECT_AREAS.find((x) => x.codes[11] === code || x.codes[12] === code);
  return a ? { area: a, code, year: (code.endsWith("1011") ? 11 : 12) as YearLevel } : null;
}

export function yearIn(text: string): YearLevel | null {
  const m = /\b(?:year|yr|y)\s*(11|12)\b/i.exec(text);
  if (m) return Number(m[1]) as YearLevel;
  return codeIn(text)?.year ?? null;
}

function levelIn(text: string): LanguageLevel | null {
  const m = /\b(beginners|continuers|extension)\b/i.exec(text);
  return m ? (m[1].toLowerCase() as LanguageLevel) : null;
}

/** A question about who teaches or whether the business offers an HSC course. */
export function isCourseQuestion(text: string): boolean {
  const asks = /\b(who|teach|teaches|teaching|offer|offers|offered|do we have)\b/i.test(text);
  const request = /\b(refund|money back|reschedul\w*|move|cancel\w*|pay|payment|lesson)\b/i.test(text);
  return asks && !request && (findCourses(text).length > 0 || codeIn(text) !== null || areaIn(text) !== null);
}

function areaIn(text: string) {
  const t = text.toLowerCase().replace(/\bmaths?\b/g, "mathematics");
  return SUBJECT_AREAS.find((a) => new RegExp(`\\b${a.name.toLowerCase()}\\b`).test(t)) ?? null;
}

export function courseAnswer(text: string, facts: CourseFacts): Block[] {
  const blocks: Block[] = [];
  const link = { label: "Open Subjects", href: "/subjects" };
  const found = findCourses(text).slice(0, 2);
  const code = codeIn(text);

  // A category code on its own covers several courses, so it can't say who can teach.
  if (found.length === 0 && code) {
    const names = COURSES.filter((c) => c.areaId === code.area.id && c.years.includes(code.year)).map((c) => c.name);
    blocks.push({ kind: "text", text: `${code.code} is the Year ${code.year} ${code.area.name} code. It covers ${names.length} courses, so a tutor who teaches one of them can't be assumed to teach the others. Which course do you mean?` });
    blocks.push({ kind: "found", items: names, links: [link] });
    return blocks;
  }

  const year = yearIn(text);
  // A subject area alone ("who teaches maths?") is too broad to name a tutor.
  const broad = found.length === 0 ? areaIn(text) : null;
  if (broad) {
    const names = COURSES.filter((c) => c.areaId === broad.id && (!year || c.years.includes(year))).map((c) => `${c.name} (Year ${year ?? c.years.join(" and ")})`);
    blocks.push({ kind: "text", text: `${broad.name} has ${names.length} courses${year ? ` in Year ${year}` : ""}, and tutors are matched course by course. Which one do you mean?` });
    blocks.push({ kind: "found", items: names, links: [link] });
    return blocks;
  }
  const level = levelIn(text);
  if (!facts.ready) {
    blocks.push({ kind: "notice", tone: "warning", text: "Tutors' courses aren't set up in the database yet, so I can't say who teaches it. The owner can run the subject catalogue update in Supabase." });
  }
  const items: string[] = [];
  for (const crs of found) {
    const years = year ? [year] : [...crs.years];
    for (const y of years) {
      if (!crs.years.includes(y)) {
        items.push(`${crs.name} isn't a Year ${y} course. It runs in Year ${crs.years.join(" and ")} only.`);
        continue;
      }
      const lvl = crs.kind === "language" ? (level === "extension" && y === 11 ? null : level) : null;
      const label = formatSelection({ year: y, courseId: crs.id, level: lvl });
      const offered = facts.offered[`${crs.id}|${y}`];
      let who: string[];
      if (crs.kind === "language" && !lvl) {
        who = facts.tutors.flatMap((t) => {
          const levels = facts.tutorCourses.filter((c) => c.tutor_id === t.id && c.course_id === crs.id && c.year_level === y).map((c) => levelName(c.course_level));
          return levels.length ? [`${t.name} (${levels.join(", ")})`] : [];
        });
      } else {
        who = facts.tutors
          .filter((t) =>
            canTeach(
              facts.tutorCourses.filter((c) => c.tutor_id === t.id).map((c) => ({ courseId: c.course_id, year: c.year_level, level: c.course_level })),
              { courseId: crs.id, year: y, level: lvl },
            ),
          )
          .map((t) => t.name);
      }
      const offerText = offered ? "offered." : "not offered by the business yet.";
      const whoText = who.length ? `Taught by ${who.join(", ")}.` : "No tutor is recorded as teaching it.";
      items.push(facts.ready ? `${label}: ${offerText} ${whoText}` : label);
    }
  }
  const lang = found.find((c) => c.kind === "language");
  blocks.push({ kind: "text", text: found.length > 1 ? "Here's what the subject catalogue says about those courses." : "Here's what the subject catalogue says." });
  blocks.push({
    kind: "found",
    items,
    links: [link],
    note: lang && !level ? "Languages also have a level. Say Beginners, Continuers or Extension for an exact match." : !year ? "Say Year 11 or Year 12 for one year only." : undefined,
  });
  return blocks;
}
