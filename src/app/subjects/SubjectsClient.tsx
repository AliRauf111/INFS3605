"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SubjectPicker } from "@/components/SubjectPicker";
import {
  EMPTY_SELECTION,
  canTeach,
  course,
  formatSelection,
  validateSelection,
  type Selection,
  type YearLevel,
} from "@/lib/catalogue/hsc";
import type { BookingCourse, FreeSlot, TutorCourse } from "@/lib/data/catalogue";

// The interactive parts of the Subjects page. Every save goes through /api/catalogue,
// which checks the role and the catalogue again on the server.

async function save(body: unknown) {
  const res = await fetch("/api/catalogue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "That change couldn't be saved.");
  return json as { label?: string };
}

const pickOf = (s: Selection) => ({ year: s.year ?? 0, areaId: s.areaId ?? "", courseId: s.courseId ?? "", level: s.level, qualification: s.qualification });

function useSaver() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const run = async (body: unknown, done: (label?: string) => string) => {
    setBusy(true);
    setMsg(null);
    try {
      const j = await save(body);
      setMsg({ tone: "success", text: done(j.label) });
      router.refresh();
      return true;
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "That change couldn't be saved." });
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

const slotText = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

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
  const v = validateSelection(sel);
  const teachesOf = (id: string) => tutorCourses.filter((t) => t.tutor_id === id).map((t) => ({ courseId: t.course_id, year: t.year_level, level: t.course_level }));
  const matches = v.ok ? tutors.filter((t) => canTeach(teachesOf(t.id), { courseId: v.value.courseId, year: v.value.year, level: v.value.level })) : [];
  // Tutors who share the category code but not the course: shown so nobody mistakes them for a match.
  const near = v.ok
    ? tutors.filter((t) => !matches.includes(t) && tutorCourses.some((c) => c.tutor_id === t.id && c.category_code === v.value.code))
    : [];
  return (
    <div className="stack">
      <SubjectPicker value={sel} onChange={setSel} offered={offered} legend="What does the student need?" />
      {v.ok && (
        <div role="status" aria-live="polite" className="stack">
          {!offered[`${v.value.courseId}|${v.value.year}`] && <p className="notice warning">The business doesn&rsquo;t offer this course yet. The owner can switch it on in the catalogue below.</p>}
          <h3 style={{ margin: 0 }}>
            {matches.length ? `${matches.length} tutor${matches.length > 1 ? "s" : ""} teach${matches.length > 1 ? "" : "es"} ${formatSelection(v.value)}` : `No tutor is recorded as teaching ${formatSelection(v.value)}`}
          </h3>
          {matches.length > 0 && (
            <ul className="match-list">
              {matches.map((t) => {
                const slots = freeSlots.filter((s) => s.tutor_id === t.id).slice(0, 3);
                return (
                  <li key={t.id}>
                    <strong>{t.name}</strong> <span className="muted">({t.id})</span>
                    <div className="sub">{slots.length ? `Next free: ${slots.map((s) => slotText(s.starts_at)).join(", ")}` : "No free slots recorded."}</div>
                  </li>
                );
              })}
            </ul>
          )}
          {near.length > 0 && (
            <>
              <p className="hint">These tutors teach other {v.value.code} courses but not this one, so they are not a match:</p>
              <ul className="match-list near">
                {near.map((t) => (
                  <li key={t.id}>
                    <strong>{t.name}</strong>
                    <div className="sub">
                      Teaches{" "}
                      {tutorCourses
                        .filter((c) => c.tutor_id === t.id && c.category_code === v.value.code)
                        .map((c) => course(c.course_id)?.name ?? c.course_id)
                        .join(", ")}
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
  const v = validateSelection(sel);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.ok) return;
        const name = tutors.find((t) => t.id === tutorId)?.name ?? tutorId;
        if (await run({ action: "tutor_add", tutorId, pick: pickOf(sel) }, (label) => `Added ${label} to ${name}.`)) setSel(EMPTY_SELECTION);
      }}
    >
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="tutor-pick">Tutor</label>
        <select id="tutor-pick" value={tutorId} onChange={(e) => setTutorId(e.target.value)}>
          {tutors.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <SubjectPicker value={sel} onChange={setSel} legend="Course they can teach" />
      {!v.ok && sel.courseId && <p className="error-text">{v.error}</p>}
      <div className="row">
        <button className="btn" type="submit" disabled={busy || !v.ok}>Add to tutor</button>
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
  const v = validateSelection(sel);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.ok || !student.trim()) return;
        if (await run({ action: "student_add", familyId, studentName: student.trim(), pick: pickOf(sel) }, (label) => `Saved ${label} for ${student.trim()}.`)) setSel(EMPTY_SELECTION);
      }}
    >
      <div className="picker-grid">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="family-pick">Family</label>
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
          <label htmlFor="student-name">Student name</label>
          <input id="student-name" type="text" maxLength={80} value={student} onChange={(e) => setStudent(e.target.value)} />
        </div>
      </div>
      <SubjectPicker value={sel} onChange={setSel} legend="Course they are studying" />
      <div className="row">
        <button className="btn" type="submit" disabled={busy || !v.ok || !student.trim()}>Save course</button>
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
  const v = validateSelection(sel);
  const b = active.find((x) => x.id === bookingId);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.ok) return;
        if (await run({ action: "booking_set", bookingId, pick: pickOf(sel) }, (label) => `${bookingId} now covers ${label}.`)) setSel(EMPTY_SELECTION);
      }}
    >
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="booking-pick">Booking</label>
        <select id="booking-pick" value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
          {active.map((x) => <option key={x.id} value={x.id}>{x.id}: {x.subject} with {tutorNames[x.tutor_id] ?? x.tutor_id}</option>)}
        </select>
        {b && <p className="hint">The course must be one the business offers and {tutorNames[b.tutor_id] ?? b.tutor_id} teaches, in that exact year.</p>}
      </div>
      <SubjectPicker value={sel} onChange={setSel} offered={offered} legend="Course this booking covers" />
      <div className="row">
        <button className="btn" type="submit" disabled={busy || !v.ok}>Link course</button>
        {b?.course_id && (
          <button className="btn secondary" type="button" disabled={busy} onClick={() => run({ action: "booking_set", bookingId, pick: null }, () => `${bookingId} is no longer linked to a course.`)}>
            Unlink current course
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
  return (
    <span className="row">
      <button className="btn secondary small" type="button" disabled={busy} aria-label={`Remove ${label}`} onClick={() => run({ action: `${kind}_remove`, id }, () => "Removed.")}>
        Remove
      </button>
      {note}
    </span>
  );
}

/** The owner switches a course on or off for the business. */
export function OfferToggle({ courseId, year, offered }: { courseId: string; year: YearLevel; offered: boolean }) {
  const { busy, run, note } = useSaver();
  const name = `${course(courseId)?.name} Year ${year}`;
  return (
    <span className="row">
      <button
        type="button"
        className={`btn small offer-toggle ${offered ? "" : "secondary"}`}
        aria-pressed={offered}
        aria-label={`${name}: ${offered ? "offered. Switch off" : "not offered. Switch on"}`}
        disabled={busy}
        onClick={() => run({ action: "offer", courseId, year, offered: !offered }, () => (offered ? `${name} switched off.` : `${name} switched on.`))}
      >
        {offered ? "Offered" : "Not Offered"}
      </button>
      {note}
    </span>
  );
}

