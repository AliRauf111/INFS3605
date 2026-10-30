"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SubjectPicker } from "@/components/SubjectPicker";
import { EMPTY_SELECTION, course, validateSelection, type Selection, type YearLevel } from "@/lib/catalogue/hsc";
import type { RequestClass as ClassLabel } from "@/lib/data/catalogue";
import { useI18n } from "@/components/i18n/I18nProvider";

// The class this request is about, under Details. Admins and the owner can choose or
// change it, for example when an older request had no class or its booking covers a
// different course. Saving only changes the class: the facts and decision stay as they are.

type Saved = { courseId: string; year: YearLevel; level: string; qualification: string; label: ClassLabel };

export function RequestClass({ requestId, saved, fromBooking, notSetUp }: {
  requestId: string;
  saved: Saved | null;
  fromBooking: { bookingId: string; label: ClassLabel } | null;
  notSetUp: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = saved?.label ?? fromBooking?.label ?? null;

  function start() {
    const crs = saved ? course(saved.courseId) : undefined;
    setSel(saved && crs
      ? { year: saved.year, areaId: crs.areaId, courseId: saved.courseId, level: (saved.level || null) as Selection["level"], qualification: saved.qualification }
      : EMPTY_SELECTION);
    setError(null);
    setEditing(true);
  }

  async function save(pick: Selection | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/catalogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "request_class_set",
          requestId,
          pick: pick && { year: pick.year ?? 0, areaId: pick.areaId ?? "", courseId: pick.courseId ?? "", level: pick.level, qualification: pick.qualification },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? t("requestClass.saveFailed"));
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("requestClass.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const valid = validateSelection(sel).ok;

  return (
    <div className="rq-class">
      {shown ? (
        <div>
          <span className="class-code"><bdi>{shown.code}</bdi></span>
          <div className="class-subject">{shown.subject}</div>
          <div className="sub">{t("subjects.year", { year: shown.year })}{!saved && fromBooking ? ` · ${t("requestClass.fromBooking", { id: fromBooking.bookingId })}` : ""}</div>
        </div>
      ) : (
        <span className="muted">{t("requestClass.none")}</span>
      )}
      {notSetUp ? (
        <p className="hint">{t("requestClass.notSetUp")}</p>
      ) : editing ? (
        <form
          className="stack rq-class-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save(sel);
          }}
        >
          <SubjectPicker value={sel} onChange={setSel} legend={t("requestClass.legend")} />
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="row">
            <button className="btn small" type="submit" disabled={busy || !valid}>{busy ? t("common.saving") : t("requestClass.save")}</button>
            <button className="btn secondary small" type="button" disabled={busy} onClick={() => setEditing(false)}>{t("common.cancel")}</button>
          </div>
        </form>
      ) : (
        <div className="row rq-class-actions">
          <button type="button" className="link-btn" onClick={start}>{saved ? t("requestClass.change") : t("requestClass.choose")}</button>
          {saved && <button type="button" className="link-btn" disabled={busy} onClick={() => save(null)}>{t("requestClass.remove")}</button>}
          {error && <p className="error-text" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
