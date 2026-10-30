import { categoryCode, course, levelName, type YearLevel } from "@/lib/catalogue/hsc";
import type { Translate } from "@/lib/i18n/core";

// Shared by server pages and client components, so it lives outside any "use client" file.
// Course and level names are the official HSC course titles and stay in English.

/** "Mathematics Advanced · Year 12 · MTH1012", with "Year" in the reader's language. */
export function selectionLabel(s: { year: YearLevel; courseId: string; level?: string | null; qualification?: string | null }, t: Translate): string {
  const crs = course(s.courseId);
  if (!crs) return t("picker.unknownCourse");
  const name = [crs.name, crs.kind === "language" ? levelName(s.level) : ""].filter(Boolean).join(" ");
  const qual = crs.kind === "vet" && s.qualification ? ` (${s.qualification})` : "";
  return `${name}${qual} · ${t("subjects.year", { year: s.year })} · ${categoryCode(crs.areaId, s.year)}`;
}
