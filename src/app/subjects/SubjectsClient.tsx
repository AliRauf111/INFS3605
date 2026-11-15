"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SubjectPicker } from "@/components/SubjectPicker";
import { selectionLabel } from "@/lib/catalogue/label";
import { useI18n } from "@/components/i18n/I18nProvider";
import {
  EMPTY_SELECTION,
  canTeach,
  course,
  validateSelection,
  type Selection,
  type YearLevel,
} from "@/lib/catalogue/hsc";
import type { BookingCourse, FreeSlot, TutorCourse } from "@/lib/data/catalogue";

// The interactive parts of the Subjects page. Every save goes through /api/catalogue,
// which checks the role and the catalogue again on the server.

async function save(body: unknown, fallback: string) {
  const res = await fetch("/api/catalogue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? fallback);
  return json as { label?: string };
}

const pickOf = (s: Selection) => ({ year: s.year ?? 0, areaId: s.areaId ?? "", courseId: s.courseId ?? "", level: s.level, qualification: s.qualification });

function useSaver() {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const run = async (body: unknown, done: () => string) => {
    setBusy(true);
    setMsg(null);
    try {
      await save(body, t("subjects.saveFailed"));
      setMsg({ tone: "success", text: done() });
      router.refresh();
      return true;
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : t("subjects.saveFailed") });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const note = msg && (
    <p className={msg.tone === "error" ? "error-text" : "notice success picker-note"} role={msg.tone === "error" ? "alert" : "status"}>
      {msg.text}
    </p>
  );
  return { busy, run, note };
}


/** Find tutors who teach exactly the chosen course and year. */
export function FindTutor({
  tutors,
  tutorCourses,
  offered,
  freeSlots,
}: {
  tutors: Array<{ id: string; name: string }>;
  tutorCourses: TutorCourse[];
  offered: Record<string, boolean>;
  freeSlots: FreeSlot[];
}) {
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const { t, fmt } = useI18n();
  const slotText = (iso: string) => fmt.date(iso, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const v = validateSelection(sel);
  const teachesOf = (id: string) => tutorCourses.filter((tc) => tc.tutor_id === id).map((tc) => ({ courseId: tc.course_id, year: tc.year_level, level: tc.course_level }));
  const matches = v.ok ? tutors.filter((tu) => canTeach(teachesOf(tu.id), { courseId: v.value.courseId, year: v.value.year, level: v.value.level })) : [];
  // Tutors who share the category code but not the course: shown so nobody mistakes them for a match.
  const near = v.ok
    ? tutors.filter((tu) => !matches.includes(tu) && tutorCourses.some((c) => c.tutor_id === tu.id && c.category_code === v.value.code))
    : [];
  return (
    <div className="stack">
      <SubjectPicker value={sel} onChange={setSel} offered={offered} legend={t("subjects.whatNeed")} />
      {v.ok && (
        <div role="status" aria-live="polite" className="stack">
          {!offered[`${v.value.courseId}|${v.value.year}`] && <p className="notice warning">{t("subjects.notOfferedYet")}</p>}
          <h3 style={{ margin: 0 }}>
            {matches.length ? t("subjects.tutorsTeach", { count: matches.length, course: selectionLabel(v.value, t) }) : t("subjects.noTutorTeaches", { course: selectionLabel(v.value, t) })}
          </h3>
          {matches.length > 0 && (
            <ul className="match-list">
              {matches.map((tu) => {
                const slots = freeSlots.filter((s) => s.tutor_id === tu.id).slice(0, 3);
                return (
                  <li key={tu.id}>
                    <strong><bdi>{tu.name}</bdi></strong> <span className="muted">(<bdi>{tu.id}</bdi>)</span>
                    <div className="sub">{slots.length ? t("subjects.nextFree", { list: fmt.list(slots.map((s) => slotText(s.starts_at))) }) : t("subjects.noFreeSlots")}</div>
                  </li>
                );
              })}
            </ul>
          )}
          {near.length > 0 && (
            <>
              <p className="hint">{t("subjects.nearHint", { code: v.value.code })}</p>
              <ul className="match-list near">
                {near.map((tu) => (
                  <li key={tu.id}>
                    <strong><bdi>{tu.name}</bdi></strong>
                    <div className="sub">
                      {t("subjects.teaches", {
                        list: tutorCourses
                          .filter((c) => c.tutor_id === tu.id && c.category_code === v.value.code)
                          .map((c) => course(c.course_id)?.name ?? c.course_id)
                          .join(", "),
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The owner adds an exact course and year to a tutor's profile. */
export function AddTutorCourse({ tutors }: { tutors: Array<{ id: string; name: string }> }) {
  const [tutorId, setTutorId] = useState(tutors[0]?.id ?? "");
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const { busy, run, note } = useSaver();
  const { t } = useI18n();
  const v = validateSelection(sel);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.ok) return;
        const name = tutors.find((tu) => tu.id === tutorId)?.name ?? tutorId;
        const course = selectionLabel(v.value, t);
        if (await run({ action: "tutor_add", tutorId, pick: pickOf(sel) }, () => t("subjects.added", { course, name }))) setSel(EMPTY_SELECTION);
      }}
    >
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="tutor-pick">{t("subjects.col.tutor")}</label>
        <select id="tutor-pick" value={tutorId} onChange={(e) => setTutorId(e.target.value)}>
          {tutors.map((tu) => <option key={tu.id} value={tu.id}>{tu.name}</option>)}
        </select>
      </div>
      <SubjectPicker value={sel} onChange={setSel} legend={t("subjects.canTeach")} />
      {!v.ok && sel.courseId && <p className="error-text" lang="en">{v.error}</p>}
      <div className="row">
        <button className="btn" type="submit" disabled={busy || !v.ok}>{t("subjects.addToTutorButton")}</button>
        {note}
      </div>
    </form>
  );
}

/** Admins and the owner record which course a student is studying. */
export function AddStudentCourse({ families }: { families: Array<{ id: string; student_name: string }> }) {
  const [familyId, setFamilyId] = useState(families[0]?.id ?? "");
  const [student, setStudent] = useState(families[0]?.student_name ?? "");
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const { busy, run, note } = useSaver();
  const { t } = useI18n();
  const v = validateSelection(sel);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.ok || !student.trim()) return;
        const course = selectionLabel(v.value, t);
        if (await run({ action: "student_add", familyId, studentName: student.trim(), pick: pickOf(sel) }, () => t("subjects.savedFor", { course, name: student.trim() }))) setSel(EMPTY_SELECTION);
      }}
    >
      <div className="picker-grid">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="family-pick">{t("subjects.family")}</label>
          <select
            id="family-pick"
            value={familyId}
            onChange={(e) => {
              setFamilyId(e.target.value);
              setStudent(families.find((f) => f.id === e.target.value)?.student_name ?? "");
            }}
          >
            {families.map((f) => <option key={f.id} value={f.id}>{f.id}: {f.student_name}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="student-name">{t("subjects.studentName")}</label>
          <input id="student-name" type="text" dir="auto" maxLength={80} value={student} onChange={(e) => setStudent(e.target.value)} />
        </div>
      </div>
      <SubjectPicker value={sel} onChange={setSel} legend={t("subjects.studying")} />
      <div className="row">
        <button className="btn" type="submit" disabled={busy || !v.ok || !student.trim()}>{t("subjects.saveCourse")}</button>
        {note}
      </div>
    </form>
  );
}

/** Links a booking to the exact course it covers. */
export function SetBookingCourse({ bookings, offered, tutorNames }: { bookings: BookingCourse[]; offered: Record<string, boolean>; tutorNames: Record<string, string> }) {
  const active = bookings.filter((b) => b.status !== "cancelled");
  const [bookingId, setBookingId] = useState(active[0]?.id ?? "");
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const { busy, run, note } = useSaver();
  const { t } = useI18n();
  const v = validateSelection(sel);
  const b = active.find((x) => x.id === bookingId);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.ok) return;
        const course = selectionLabel(v.value, t);
        if (await run({ action: "booking_set", bookingId, pick: pickOf(sel) }, () => t("subjects.nowCovers", { id: bookingId, course }))) setSel(EMPTY_SELECTION);
      }}
    >
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="booking-pick">{t("subjects.col.booking")}</label>
        <select id="booking-pick" value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
          {active.map((x) => <option key={x.id} value={x.id}>{t("subjects.bookingOption", { id: x.id, subject: x.subject, tutor: tutorNames[x.tutor_id] ?? x.tutor_id })}</option>)}
        </select>
        {b && <p className="hint">{t("subjects.bookingHint", { tutor: tutorNames[b.tutor_id] ?? b.tutor_id })}</p>}
      </div>
      <SubjectPicker value={sel} onChange={setSel} offered={offered} legend={t("subjects.bookingCovers")} />
      <div className="row">
        <button className="btn" type="submit" disabled={busy || !v.ok}>{t("subjects.linkCourse")}</button>
        {b?.course_id && (
          <button className="btn secondary" type="button" disabled={busy} onClick={() => run({ action: "booking_set", bookingId, pick: null }, () => t("subjects.unlinked", { id: bookingId }))}>
            {t("subjects.unlink")}
          </button>
        )}
        {note}
      </div>
    </form>
  );
}

/** A small remove button for a tutor's or student's course. */
export function RemoveLink({ id, kind, label }: { id: string; kind: "tutor" | "student"; label: string }) {
  const { busy, run, note } = useSaver();
  const { t } = useI18n();
  return (
    <span className="row">
      <button className="btn secondary small" type="button" disabled={busy} aria-label={t("subjects.removeLabel", { label })} onClick={() => run({ action: `${kind}_remove`, id }, () => t("subjects.removed"))}>
        {t("common.remove")}
      </button>
      {note}
    </span>
  );
}

/** The owner switches a course on or off for the business. */
export function OfferToggle({ courseId, year, offered }: { courseId: string; year: YearLevel; offered: boolean }) {
  const { busy, run, note } = useSaver();
  const { t } = useI18n();
  const name = `${course(courseId)?.name} · ${t("subjects.year", { year })}`;
  return (
    <span className="row">
      <button
        type="button"
        className={`btn small offer-toggle ${offered ? "" : "secondary"}`}
        aria-pressed={offered}
        aria-label={offered ? t("subjects.offeredSwitchOff", { name }) : t("subjects.notOfferedSwitchOn", { name })}
        disabled={busy}
        onClick={() => run({ action: "offer", courseId, year, offered: !offered }, () => (offered ? t("subjects.switchedOff", { name }) : t("subjects.switchedOn", { name })))}
      >
        {offered ? t("subjects.offered") : t("subjects.notOffered")}
      </button>
      {note}
    </span>
  );
}

