// The NSW HSC subject catalogue for Years 11 and 12: the one source of truth.
//
// Subject areas carry Tutor Compass's own category codes (ENG1011 and so on). These are
// NOT official NESA course numbers. Each area has one code per year. Courses sit under an
// area and keep their own ids, so "Mathematics Advanced" and "Mathematics Standard 2"
// never become interchangeable just because they share MTH1012.
//
// Which year each course runs in follows NESA Stage 6 syllabuses (checked October 2026).
// Anything not confirmed is marked in UNRESOLVED below rather than guessed.
//
// supabase/catalogue.sql is generated from this file (npm run catalogue:generate), and a
// test fails if the two drift apart.

export const YEAR_LEVELS = [11, 12] as const;
export type YearLevel = (typeof YEAR_LEVELS)[number];

export type AreaId =
  | "english"
  | "mathematics"
  | "science"
  | "business_humanities"
  | "history"
  | "technology_design"
  | "creative_arts"
  | "health_community"
  | "languages"
  | "vocational";

export type SubjectArea = { id: AreaId; name: string; codes: Record<YearLevel, string> };

export const SUBJECT_AREAS: readonly SubjectArea[] = [
  { id: "english", name: "English", codes: { 11: "ENG1011", 12: "ENG1012" } },
  { id: "mathematics", name: "Mathematics", codes: { 11: "MTH1011", 12: "MTH1012" } },
  { id: "science", name: "Science", codes: { 11: "SCI1011", 12: "SCI1012" } },
  { id: "business_humanities", name: "Business and humanities", codes: { 11: "BHU1011", 12: "BHU1012" } },
  { id: "history", name: "History", codes: { 11: "HIS1011", 12: "HIS1012" } },
  { id: "technology_design", name: "Technology and design", codes: { 11: "TDE1011", 12: "TDE1012" } },
  { id: "creative_arts", name: "Creative arts", codes: { 11: "CAR1011", 12: "CAR1012" } },
  { id: "health_community", name: "Health and community", codes: { 11: "HCO1011", 12: "HCO1012" } },
  { id: "languages", name: "Languages", codes: { 11: "LAN1011", 12: "LAN1012" } },
  { id: "vocational", name: "Vocational education", codes: { 11: "VET1011", 12: "VET1012" } },
];

/** language: also needs a course level. vet: a broad stream; the qualification is stored separately. */
export type CourseKind = "course" | "language" | "vet";

export type Course = {
  id: string;
  areaId: AreaId;
  name: string;
  kind: CourseKind;
  years: readonly YearLevel[];
  /** Shown beside the course where it matters, e.g. which Year 12 courses it leads to. */
  note?: string;
};

const both = [11, 12] as const;
const y11 = [11] as const;
const y12 = [12] as const;

const c = (areaId: AreaId, id: string, name: string, years: readonly YearLevel[], note?: string, kind: CourseKind = "course"): Course => ({
  id,
  areaId,
  name,
  kind,
  years,
  ...(note ? { note } : {}),
});

const LANGUAGES = ["Arabic", "Chinese", "French", "German", "Hindi", "Italian", "Japanese", "Korean", "Spanish"];
const VET_STREAMS = ["Hospitality", "Construction", "Business Services", "Retail Services", "Information and Digital Technology"];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export const COURSES: readonly Course[] = [
  // English
  c("english", "english_studies", "English Studies", both),
  c("english", "english_standard", "English Standard", both),
  c("english", "english_advanced", "English Advanced", both),
  c("english", "english_eald", "English EAL/D", both),
  c("english", "english_extension", "English Extension", y11, "Year 11 course. Leads into English Extension 1 in Year 12."),
  c("english", "english_extension_1", "English Extension 1", y12, "Year 12 course. Follows Year 11 English Extension."),
  c("english", "english_extension_2", "English Extension 2", y12, "Year 12 only."),
  // Mathematics
  c("mathematics", "maths_standard", "Mathematics Standard", y11, "Year 11 common course. Leads into Mathematics Standard 1 or Standard 2 in Year 12."),
  c("mathematics", "maths_standard_1", "Mathematics Standard 1", y12, "Year 12 course. Follows Year 11 Mathematics Standard."),
  c("mathematics", "maths_standard_2", "Mathematics Standard 2", y12, "Year 12 course. Follows Year 11 Mathematics Standard."),
  c("mathematics", "maths_advanced", "Mathematics Advanced", both),
  c("mathematics", "maths_extension_1", "Mathematics Extension 1", both),
  c("mathematics", "maths_extension_2", "Mathematics Extension 2", y12, "Year 12 only."),
  // Science
  c("science", "biology", "Biology", both),
  c("science", "chemistry", "Chemistry", both),
  c("science", "physics", "Physics", both),
  c("science", "earth_environmental_science", "Earth and Environmental Science", both),
  c("science", "investigating_science", "Investigating Science", both),
  c("science", "science_extension", "Science Extension", y12, "Year 12 only."),
  // Business and humanities
  c("business_humanities", "business_studies", "Business Studies", both),
  c("business_humanities", "economics", "Economics", both),
  c("business_humanities", "legal_studies", "Legal Studies", both),
  c("business_humanities", "geography", "Geography", both),
  c("business_humanities", "aboriginal_studies", "Aboriginal Studies", both),
  c("business_humanities", "society_culture", "Society and Culture", both),
  c("business_humanities", "studies_of_religion", "Studies of Religion", both, "NESA runs this as Studies of Religion I (1 unit) and II (2 units). Not split here yet."),
  // History
  c("history", "ancient_history", "Ancient History", both),
  c("history", "modern_history", "Modern History", both),
  c("history", "history_extension", "History Extension", y12, "Year 12 only."),
  // Technology and design
  c("technology_design", "software_engineering", "Software Engineering", both),
  c("technology_design", "enterprise_computing", "Enterprise Computing", both),
  c("technology_design", "engineering_studies", "Engineering Studies", both),
  c("technology_design", "design_technology", "Design and Technology", both),
  c("technology_design", "industrial_technology", "Industrial Technology", both),
  c("technology_design", "food_technology", "Food Technology", both),
  c("technology_design", "agriculture", "Agriculture", both),
  c("technology_design", "textiles_design", "Textiles and Design", both),
  // Creative arts
  c("creative_arts", "visual_arts", "Visual Arts", both),
  c("creative_arts", "drama", "Drama", both),
  c("creative_arts", "dance", "Dance", both),
  c("creative_arts", "music_1", "Music 1", both),
  c("creative_arts", "music_2", "Music 2", both),
  c("creative_arts", "music_extension", "Music Extension", y12, "Year 12 only."),
  // Health and community
  c("health_community", "health_movement_science", "Health and Movement Science", both, "Replaced PDHPE. Taught from 2025; first HSC exam in 2026."),
  c("health_community", "community_family_studies", "Community and Family Studies", both),
  // Languages: the level (Beginners, Continuers, Extension) is stored separately.
  ...LANGUAGES.map((l) => c("languages", `lang_${slug(l)}`, l, both, undefined, "language")),
  // Vocational education: broad streams. The qualification is stored separately.
  ...VET_STREAMS.map((v) => c("vocational", `vet_${slug(v)}`, v, both, "Broad VET stream. Record the specific qualification separately.", "vet")),
];

export type LanguageLevel = "beginners" | "continuers" | "extension";

export const LANGUAGE_LEVELS: ReadonlyArray<{ id: LanguageLevel; name: string; years: readonly YearLevel[]; note: string }> = [
  { id: "beginners", name: "Beginners", years: both, note: "Not every language has a Beginners course. Check NESA before offering it." },
  { id: "continuers", name: "Continuers", years: both, note: "Offered by NESA for all nine languages here." },
  { id: "extension", name: "Extension", years: y12, note: "Year 12 only, studied alongside Continuers." },
];

/** Details we could not confirm, shown on the Subjects page instead of guessing. */
export const UNRESOLVED: readonly string[] = [
  "Language levels: NESA offers Continuers for all nine languages listed. Beginners, Extension, Heritage, In Context and Literature courses vary by language and are not checked per language here.",
  "Studies of Religion is stored as one course. NESA splits it into Studies of Religion I (1 unit) and II (2 units).",
  "VET streams are broad. Specific qualifications and units of competency are stored as free text, not checked against training.gov.au.",
  "Eligibility rules (for example which Year 11 course a student must finish before a Year 12 course) are noted on each course but not enforced.",
];

// --- Lookups --------------------------------------------------------------------------

const AREA_BY_ID = new Map(SUBJECT_AREAS.map((a) => [a.id, a]));
const COURSE_BY_ID = new Map(COURSES.map((x) => [x.id, x]));

export const isYearLevel = (v: unknown): v is YearLevel => v === 11 || v === 12;
export const area = (id: string) => AREA_BY_ID.get(id as AreaId);
export const course = (id: string) => COURSE_BY_ID.get(id);

/** The Tutor Compass category code for a subject area in a year, e.g. MTH1011. */
export function categoryCode(areaId: string, year: YearLevel): string | null {
  return area(areaId)?.codes[year] ?? null;
}

/** Courses in an area that actually run in that year. */
export function coursesFor(areaId: string, year: YearLevel): Course[] {
  return COURSES.filter((x) => x.areaId === areaId && x.years.includes(year));
}

export function levelsFor(year: YearLevel) {
  return LANGUAGE_LEVELS.filter((l) => l.years.includes(year));
}

export const levelName = (id: string | null | undefined) => LANGUAGE_LEVELS.find((l) => l.id === id)?.name ?? "";

// --- Selections -----------------------------------------------------------------------

/** What a student takes, a tutor teaches or a booking covers. */
export type Selection = {
  year: YearLevel | null;
  areaId: AreaId | null;
  courseId: string | null;
  level: LanguageLevel | null;
  qualification: string;
};

export const EMPTY_SELECTION: Selection = { year: null, areaId: null, courseId: null, level: null, qualification: "" };

export type ValidSelection = { year: YearLevel; areaId: AreaId; code: string; courseId: string; level: LanguageLevel | null; qualification: string };

/** Checks a selection is a real course in that year. The database checks the same thing. */
export function validateSelection(s: Partial<Selection>): { ok: true; value: ValidSelection } | { ok: false; error: string } {
  if (!isYearLevel(s.year)) return { ok: false, error: "Choose Year 11 or Year 12." };
  const a = s.areaId ? area(s.areaId) : undefined;
  if (!a) return { ok: false, error: "Choose a subject area." };
  const crs = s.courseId ? course(s.courseId) : undefined;
  if (!crs) return { ok: false, error: "Choose a course." };
  if (crs.areaId !== a.id) return { ok: false, error: `${crs.name} isn't in ${a.name}.` };
  if (!crs.years.includes(s.year)) return { ok: false, error: `${crs.name} isn't a Year ${s.year} course.` };
  let level: LanguageLevel | null = null;
  if (crs.kind === "language") {
    const l = LANGUAGE_LEVELS.find((x) => x.id === s.level);
    if (!l) return { ok: false, error: "Choose the language level: Beginners, Continuers or Extension." };
    if (!l.years.includes(s.year)) return { ok: false, error: `${l.name} is a Year 12 course only.` };
    level = l.id;
  } else if (s.level) {
    return { ok: false, error: "Only language courses have a level." };
  }
  const qualification = crs.kind === "vet" ? (s.qualification ?? "").trim().slice(0, 120) : "";
  if (crs.kind !== "vet" && (s.qualification ?? "").trim()) return { ok: false, error: "Only VET streams have a qualification." };
  return { ok: true, value: { year: s.year, areaId: a.id, code: a.codes[s.year], courseId: crs.id, level, qualification } };
}

/**
 * Applies a change from the picker. When the year or area changes, the code follows,
 * and a course that no longer fits is cleared with a note saying what to pick again.
 */
export function changeSelection(prev: Selection, patch: Partial<Selection>): { selection: Selection; cleared: string | null } {
  const next: Selection = { ...prev, ...patch };
  let cleared: string | null = null;
  if (next.courseId) {
    const crs = course(next.courseId);
    const fits = crs && crs.areaId === next.areaId && next.year !== null && crs.years.includes(next.year);
    if (!fits) {
      const reason =
        crs && next.year !== null && crs.areaId === next.areaId
          ? `${crs.name} isn't a Year ${next.year} course`
          : crs && next.areaId
            ? `${crs.name} isn't in ${area(next.areaId)?.name ?? "that area"}`
            : "that course doesn't fit";
      cleared = `${reason}, so it was cleared. Choose a course again.`;
      next.courseId = null;
      next.level = null;
      next.qualification = "";
    }
  }
  const crs = next.courseId ? course(next.courseId) : undefined;
  if (crs?.kind !== "language") next.level = null;
  else if (next.level && next.year !== null && !LANGUAGE_LEVELS.find((l) => l.id === next.level)?.years.includes(next.year)) {
    next.level = null;
    cleared = cleared ?? `Extension is Year 12 only, so the level was cleared. Choose a level again.`;
  }
  if (crs?.kind !== "vet") next.qualification = "";
  return { selection: next, cleared };
}

/** "Mathematics Advanced · Year 11 · MTH1011", with the language level or VET qualification when there is one. */
export function formatSelection(s: { year: YearLevel; courseId: string; level?: string | null; qualification?: string | null }): string {
  const crs = course(s.courseId);
  if (!crs) return "Unknown course";
  const name = [crs.name, crs.kind === "language" ? levelName(s.level) : ""].filter(Boolean).join(" ");
  const qual = crs.kind === "vet" && s.qualification ? ` (${s.qualification})` : "";
  return `${name}${qual} · Year ${s.year} · ${categoryCode(crs.areaId, s.year)}`;
}

// --- Matching tutors ------------------------------------------------------------------

export type Teaching = { courseId: string; year: YearLevel; level?: string | null };

/**
 * Can this tutor teach exactly this? The course and year must match. For languages the
 * level must match too. Sharing a category code is never enough.
 */
export function canTeach(teaches: readonly Teaching[], need: Teaching): boolean {
  const needsLevel = course(need.courseId)?.kind === "language";
  return teaches.some((t) => t.courseId === need.courseId && t.year === need.year && (!needsLevel || (t.level ?? "") === (need.level ?? "")));
}

// --- Search ---------------------------------------------------------------------------

const ALIASES: Record<string, string[]> = {
  maths_advanced: ["maths advanced", "math advanced", "2 unit maths", "advanced maths"],
  maths_extension_1: ["maths ext 1", "ext 1 maths", "extension 1 maths", "3 unit maths"],
  maths_extension_2: ["maths ext 2", "ext 2 maths", "extension 2 maths", "4 unit maths"],
  maths_standard: ["maths standard", "standard maths", "general maths"],
  maths_standard_1: ["maths standard 1", "standard 1 maths"],
  maths_standard_2: ["maths standard 2", "standard 2 maths"],
  english_eald: ["eal/d", "eald", "esl"],
  english_extension_1: ["english ext 1", "ext 1 english"],
  english_extension_2: ["english ext 2", "ext 2 english"],
  earth_environmental_science: ["earth and environmental", "earth science", "ees"],
  community_family_studies: ["cafs"],
  health_movement_science: ["hms", "pdhpe"],
  software_engineering: ["software", "sdd"],
  design_technology: ["d&t", "design and tech"],
  vet_information_and_digital_technology: ["idt", "it vet"],
};

const norm = (s: string) => s.toLowerCase().replace(/mathematics/g, "maths").replace(/[^a-z0-9/&]+/g, " ").trim();

/** Courses whose name or a common nickname appears in the text, longest match first. */
export function findCourses(text: string): Course[] {
  const t = ` ${norm(text)} `;
  const hits: Array<{ crs: Course; len: number }> = [];
  for (const crs of COURSES) {
    const names = [norm(crs.name), ...(ALIASES[crs.id] ?? [])];
    const best = names.filter((n) => t.includes(` ${n} `)).sort((a, b) => b.length - a.length)[0];
    if (best) hits.push({ crs, len: best.length });
  }
  hits.sort((a, b) => b.len - a.len);
  // Drop shorter matches contained in a longer one ("English Extension" inside "English Extension 1").
  const kept: typeof hits = [];
  for (const h of hits) {
    if (!kept.some((k) => norm(k.crs.name).includes(norm(h.crs.name)) && k.crs.areaId === h.crs.areaId && k.len > h.len)) kept.push(h);
  }
  return kept.map((h) => h.crs);
}

/** Search for the picker: every course and year that matches the words typed. */
export function searchCatalogue(query: string, limit = 12): Array<{ courseId: string; year: YearLevel; label: string }> {
  const words = norm(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  // A year can be typed as 11 or 12, or come from a category code such as mth1012.
  const codeYear = words.map((w) => /^[a-z]{3}101([12])$/.exec(w)?.[1]).find(Boolean);
  const yearWord = words.find((w) => w === "11" || w === "12") ?? (codeYear ? `1${codeYear}` : undefined);
  const rest = words.filter((w) => w !== yearWord && w !== "year" && w !== "yr");
  const out: Array<{ courseId: string; year: YearLevel; label: string }> = [];
  for (const crs of COURSES) {
    const hay = `${norm(crs.name)} ${(ALIASES[crs.id] ?? []).join(" ")} ${norm(area(crs.areaId)?.name ?? "")} ${Object.values(area(crs.areaId)?.codes ?? {}).join(" ").toLowerCase()}`;
    const tokens = hay.split(" ");
    // Numbers must match a whole word, so "ext 1" doesn't also find Extension 2 through its code.
    if (!rest.every((w) => (/^\d+$/.test(w) ? tokens.includes(w) : hay.includes(w)))) continue;
    for (const y of crs.years) {
      if (yearWord && String(y) !== yearWord) continue;
      out.push({ courseId: crs.id, year: y, label: `${crs.name} · Year ${y} · ${categoryCode(crs.areaId, y)}` });
    }
  }
  // Courses named exactly (or by a nickname) come first.
  const exact = findCourses(query).map((x) => x.id);
  const rank = (id: string) => (exact.includes(id) ? exact.indexOf(id) : exact.length);
  return out.sort((a, b) => rank(a.courseId) - rank(b.courseId)).slice(0, limit);
}
