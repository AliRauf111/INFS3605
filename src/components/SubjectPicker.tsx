"use client";
import { useId, useState } from "react";
import {
  SUBJECT_AREAS,
  YEAR_LEVELS,
  area,
  changeSelection,
  course,
  coursesFor,
  formatSelection,
  levelsFor,
  searchCatalogue,
  type Selection,
  type YearLevel,
} from "@/lib/catalogue/hsc";

// Year level, then subject area, then course. The category code follows the year and
// area on its own, and a course that stops fitting is cleared with a short note. A quick
// search box jumps straight to a course and year. Every control is a native input or
// select, so it works with a keyboard, a screen reader and on a phone.

export function SubjectPicker({
  value,
  onChange,
  offered,
  legend = "Course",
}: {
  value: Selection;
  onChange: (next: Selection) => void;
  /** When given, courses the business doesn't offer are marked. */
  offered?: Record<string, boolean>;
  legend?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [cleared, setCleared] = useState<string | null>(null);
  const update = (patch: Partial<Selection>) => {
    const { selection, cleared } = changeSelection(value, patch);
    setCleared(cleared);
    onChange(selection);
  };
  const results = searchCatalogue(query, 8);
  const crs = value.courseId ? course(value.courseId) : undefined;
  const code = value.year && value.areaId ? area(value.areaId)?.codes[value.year] : null;
  const options = value.year && value.areaId ? coursesFor(value.areaId, value.year) : [];
  const notOffered = (courseId: string) => offered && value.year && !offered[`${courseId}|${value.year}`];

  return (
    <fieldset className="picker">
      <legend>{legend}</legend>

      <div className="field">
        <label htmlFor={`${id}-find`}>Quick find</label>
        <input
          id={`${id}-find`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="For example: maths advanced 11, or MTH1012"
          autoComplete="off"
          aria-describedby={`${id}-find-hint`}
        />
        <p className="hint" id={`${id}-find-hint`}>Type a course name, a nickname such as ext 1, a year or a category code.</p>
        {query.trim() && (
          <ul className="picker-results" aria-label="Matching courses">
            {results.length === 0 && <li className="muted">No course matches that.</li>}
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
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="picker-grid">
        <div className="field">
          <span className="label" id={`${id}-year`}>Year level</span>
          <div className="choices" role="radiogroup" aria-labelledby={`${id}-year`}>
            {YEAR_LEVELS.map((y) => (
              <label key={y} className="choice">
                <input type="radio" name={`${id}-year`} checked={value.year === y} onChange={() => update({ year: y as YearLevel })} />
                Year {y}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor={`${id}-area`}>Subject area</label>
          <select id={`${id}-area`} value={value.areaId ?? ""} onChange={(e) => update({ areaId: (e.target.value || null) as Selection["areaId"] })}>
            <option value="">Choose a subject area</option>
            {SUBJECT_AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {value.year ? ` · ${a.codes[value.year]}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${id}-course`}>Course</label>
          <select
            id={`${id}-course`}
            value={value.courseId ?? ""}
            disabled={!options.length}
            onChange={(e) => update({ courseId: e.target.value || null })}
            aria-describedby={`${id}-course-hint`}
          >
            <option value="">{options.length ? "Choose a course" : "Choose a year and area first"}</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {notOffered(c.id) ? " (not offered)" : ""}
              </option>
            ))}
          </select>
          <p className="hint" id={`${id}-course-hint`}>{crs?.note ?? "Only courses that run in the chosen year are listed."}</p>
        </div>

        {crs?.kind === "language" && value.year && (
          <div className="field">
            <label htmlFor={`${id}-level`}>Language level</label>
            <select id={`${id}-level`} value={value.level ?? ""} onChange={(e) => update({ level: (e.target.value || null) as Selection["level"] })}>
              <option value="">Choose a level</option>
              {levelsFor(value.year).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <p className="hint">{value.level ? levelsFor(value.year).find((l) => l.id === value.level)?.note : "Beginners, Continuers or, in Year 12, Extension."}</p>
          </div>
        )}

        {crs?.kind === "vet" && (
          <div className="field">
            <label htmlFor={`${id}-qual`}>Qualification (optional)</label>
            <input id={`${id}-qual`} type="text" maxLength={120} value={value.qualification} onChange={(e) => update({ qualification: e.target.value })} placeholder="For example: Certificate II in Hospitality" />
          </div>
        )}
      </div>

      <div role="status" aria-live="polite">
        {cleared && <p className="notice warning picker-note">{cleared}</p>}
        <p className="picker-summary">
          {crs && value.year ? (
            <strong>{formatSelection({ year: value.year, courseId: crs.id, level: value.level, qualification: value.qualification })}</strong>
          ) : code ? (
            <>Category code <strong>{code}</strong>. Now choose a course.</>
          ) : (
            "Nothing chosen yet."
          )}
        </p>
      </div>
    </fieldset>
  );
}
