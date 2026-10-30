"use client";
import { useId, useState } from "react";
import {
  SUBJECT_AREAS,
  YEAR_LEVELS,
  area,
  changeSelection,
  course,
  coursesFor,
  categoryCode,
  levelsFor,
  searchCatalogue,
  type Selection,
  type YearLevel,
} from "@/lib/catalogue/hsc";
import { useI18n } from "@/components/i18n/I18nProvider";
import { selectionLabel } from "@/lib/catalogue/label";

// Course and level names are the official HSC course titles, so they stay in English in
// every language (marked lang="en"). Subject areas and everything around them translate.

export { selectionLabel };

// Year level, then subject area, then course. The category code follows the year and
// area on its own, and a course that stops fitting is cleared with a short note. A quick
// search box jumps straight to a course and year. Every control is a native input or
// select, so it works with a keyboard, a screen reader and on a phone.

export function SubjectPicker({
  value,
  onChange,
  offered,
  legend,
}: {
  value: Selection;
  onChange: (next: Selection) => void;
  /** When given, courses the business doesn't offer are marked. */
  offered?: Record<string, boolean>;
  legend?: string;
}) {
  const id = useId();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [cleared, setCleared] = useState<string | null>(null);
  const update = (patch: Partial<Selection>) => {
    const { selection, cleared } = changeSelection(value, patch);
    setCleared(cleared && value.courseId ? t("picker.cleared", { course: course(value.courseId)?.name ?? "" }) : null);
    onChange(selection);
  };
  const results = searchCatalogue(query, 8);
  const crs = value.courseId ? course(value.courseId) : undefined;
  const code = value.year && value.areaId ? area(value.areaId)?.codes[value.year] : null;
  const options = value.year && value.areaId ? coursesFor(value.areaId, value.year) : [];
  const notOffered = (courseId: string) => offered && value.year && !offered[`${courseId}|${value.year}`];

  return (
    <fieldset className="picker">
      <legend>{legend ?? t("picker.course")}</legend>

      <div className="field">
        <label htmlFor={`${id}-find`}>{t("picker.quickFind")}</label>
        <input
          id={`${id}-find`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("picker.findPlaceholder")}
          autoComplete="off"
          aria-describedby={`${id}-find-hint`}
        />
        <p className="hint" id={`${id}-find-hint`}>{t("picker.findHint")}</p>
        {query.trim() && (
          <ul className="picker-results" aria-label={t("picker.matching")}>
            {results.length === 0 && <li className="muted">{t("picker.noMatch")}</li>}
            {results.map((r) => (
              <li key={`${r.courseId}-${r.year}`}>
                <button
                  type="button"
                  className="picker-result"
                  onClick={() => {
                    const c = course(r.courseId)!;
                    setCleared(null);
                    onChange({ ...changeSelection(value, { year: r.year, areaId: c.areaId, courseId: c.id }).selection });
                    setQuery("");
                  }}
                >
                  <span lang="en">{selectionLabel({ year: r.year, courseId: r.courseId }, t)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="picker-grid">
        <div className="field">
          <span className="label" id={`${id}-year`}>{t("picker.yearLevel")}</span>
          <div className="choices" role="radiogroup" aria-labelledby={`${id}-year`}>
            {YEAR_LEVELS.map((y) => (
              <label key={y} className="choice">
                <input type="radio" name={`${id}-year`} checked={value.year === y} onChange={() => update({ year: y as YearLevel })} />
                {t("subjects.year", { year: y })}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor={`${id}-area`}>{t("picker.subjectArea")}</label>
          <select id={`${id}-area`} value={value.areaId ?? ""} onChange={(e) => update({ areaId: (e.target.value || null) as Selection["areaId"] })}>
            <option value="">{t("picker.chooseArea")}</option>
            {SUBJECT_AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {t(`catalogue.area.${a.id}`)}
                {value.year ? ` · ${a.codes[value.year]}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${id}-course`}>{t("picker.course")}</label>
          <select
            id={`${id}-course`}
            value={value.courseId ?? ""}
            disabled={!options.length}
            onChange={(e) => update({ courseId: e.target.value || null })}
            aria-describedby={`${id}-course-hint`}
          >
            <option value="">{options.length ? t("picker.chooseCourse") : t("picker.chooseYearArea")}</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {notOffered(c.id) ? ` ${t("picker.notOffered")}` : ""}
              </option>
            ))}
          </select>
          <p className="hint" id={`${id}-course-hint`}>{crs?.note ? <span lang="en">{crs.note}</span> : t("picker.courseHint")}</p>
        </div>

        {crs?.kind === "language" && value.year && (
          <div className="field">
            <label htmlFor={`${id}-level`}>{t("picker.languageLevel")}</label>
            <select id={`${id}-level`} value={value.level ?? ""} onChange={(e) => update({ level: (e.target.value || null) as Selection["level"] })}>
              <option value="">{t("picker.chooseLevel")}</option>
              {levelsFor(value.year).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <p className="hint">{value.level ? <span lang="en">{levelsFor(value.year).find((l) => l.id === value.level)?.note}</span> : t("picker.levelHint")}</p>
          </div>
        )}

        {crs?.kind === "vet" && (
          <div className="field">
            <label htmlFor={`${id}-qual`}>{t("picker.qualification")}</label>
            <input id={`${id}-qual`} type="text" maxLength={120} value={value.qualification} onChange={(e) => update({ qualification: e.target.value })} placeholder={t("picker.qualificationPlaceholder")} />
          </div>
        )}
      </div>

      <div role="status" aria-live="polite">
        {cleared && <p className="notice warning picker-note">{cleared}</p>}
        <p className="picker-summary">
          {crs && value.year ? (
            <strong>{selectionLabel({ year: value.year, courseId: crs.id, level: value.level, qualification: value.qualification }, t)}</strong>
          ) : code ? (
            <>{t("picker.categoryCode")} <strong>{code}</strong>. {t("picker.nowChoose")}</>
          ) : (
            t("picker.nothingYet")
          )}
        </p>
      </div>
    </fieldset>
  );
}
