import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { catalogueData, offerKey } from "@/lib/data/catalogue";
import { COURSES, SUBJECT_AREAS, UNRESOLVED, canTeach, formatSelection, type YearLevel } from "@/lib/catalogue/hsc";
import { LoadError } from "@/components/ui";
import { AddStudentCourse, AddTutorCourse, FindTutor, OfferToggle, RemoveLink, SetBookingCourse } from "./SubjectsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subjects" };

const SOURCES = [
  { href: "https://curriculum.nsw.edu.au/learning-areas/tas/enterprise-computing-11-12-2022/content", label: "NSW Curriculum: Enterprise Computing" },
  { href: "https://www.nsw.gov.au/education-and-training/nesa/news/all/new-hms-and-hms-life-skills-11-12", label: "NESA: Health and Movement Science" },
  { href: "https://www.nsw.gov.au/education-and-training/nesa/curriculum/languages/continuers", label: "NESA: Continuers languages" },
];

export default async function SubjectsPage() {
  const user = await requirePageUser();
  let data;
  try {
    data = await catalogueData();
  } catch (e) {
    return <LoadError error={e} />;
  }
  const owner = user.role === "owner";
  const tutorNames = Object.fromEntries(data.tutors.map((t) => [t.id, t.name]));
  const label = (x: { course_id: string; year_level: YearLevel; course_level: string; qualification: string }) =>
    formatSelection({ year: x.year_level, courseId: x.course_id, level: x.course_level, qualification: x.qualification });
  const offeredCount = Object.values(data.offered).filter(Boolean).length;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Subjects</h1>
          <p className="muted" style={{ margin: 0 }}>
            NSW HSC courses for Years 11 and 12. Codes such as MTH1011 are Tutor Compass category codes, not NESA course numbers. A tutor only matches when they teach the exact course and year.
          </p>
        </div>
      </div>

      {!data.ready && (
        <div className="notice warning" role="status">
          <p><strong>The database needs the subject catalogue update.</strong> Until then you can browse the catalogue, but nothing can be saved.</p>
          <p>In Supabase, open the SQL Editor and run <span className="code">supabase/migrations/20261019000002_hsc_catalogue.sql</span>, then <span className="code">supabase/catalogue.sql</span>. Both are safe to run again.</p>
        </div>
      )}

      <section className="card stack" aria-labelledby="find-h">
        <h2 id="find-h" style={{ margin: 0 }}>Find a tutor</h2>
        <p className="hint">Choose the student&rsquo;s course. Sharing a category code is not enough: a tutor for Mathematics Standard 2 is not a match for Mathematics Advanced.</p>
        <FindTutor tutors={data.tutors} tutorCourses={data.tutorCourses} offered={data.offered} freeSlots={data.freeSlots} />
      </section>

      <div className="grid grid-2">
        <section className="card stack" aria-labelledby="tutors-h">
          <h2 id="tutors-h" style={{ margin: 0 }}>Tutors</h2>
          <p className="hint">The exact courses and years each tutor teaches. {owner ? "Only you can change these." : "Only the owner can change these."}</p>
          {data.tutors.map((t) => {
            const rows = data.tutorCourses.filter((c) => c.tutor_id === t.id);
            return (
              <div key={t.id}>
                <h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem" }}>{t.name}</h3>
                {rows.length ? (
                  <ul className="course-list">
                    {rows.map((r) => (
                      <li key={r.id}>
                        <span>{label(r)}</span>
                        {owner && <RemoveLink id={r.id} kind="tutor" label={`${label(r)} from ${t.name}`} />}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>No Year 11 or 12 courses recorded.</p>
                )}
              </div>
            );
          })}
          {owner && data.ready && data.tutors.length > 0 && (
            <details>
              <summary>Add a course to a tutor</summary>
              <AddTutorCourse tutors={data.tutors} />
            </details>
          )}
        </section>

        <section className="card stack" aria-labelledby="students-h">
          <h2 id="students-h" style={{ margin: 0 }}>Students</h2>
          <p className="hint">The courses each student is studying, kept with their family record.</p>
          {data.studentCourses.length ? (
            <ul className="course-list">
              {data.studentCourses.map((r) => (
                <li key={r.id}>
                  <span>
                    <strong>{r.student_name}</strong> <span className="muted">({r.family_id})</span>
                    <br />
                    {label(r)}
                  </span>
                  <RemoveLink id={r.id} kind="student" label={`${label(r)} for ${r.student_name}`} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No courses recorded yet.</p>
          )}
          {data.ready && data.families.length > 0 && (
            <details>
              <summary>Add a student&rsquo;s course</summary>
              <AddStudentCourse families={data.families} />
            </details>
          )}
        </section>
      </div>

      <section className="card stack" aria-labelledby="bookings-h">
        <h2 id="bookings-h" style={{ margin: 0 }}>Bookings</h2>
        <p className="hint">Bookings keep their original subject text. Linking one to an exact course lets Tutor Compass check the tutor really teaches it.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Booking</th><th>Subject on file</th><th>Tutor</th><th>Exact course</th><th>Tutor check</th></tr>
            </thead>
            <tbody>
              {data.bookings.map((b) => {
                const linked = b.course_id && b.year_level ? { course_id: b.course_id, year_level: b.year_level, course_level: b.course_level, qualification: b.qualification } : null;
                const ok =
                  linked &&
                  canTeach(
                    data.tutorCourses.filter((t) => t.tutor_id === b.tutor_id).map((t) => ({ courseId: t.course_id, year: t.year_level, level: t.course_level })),
                    { courseId: linked.course_id, year: linked.year_level, level: linked.course_level },
                  );
                return (
                  <tr key={b.id}>
                    <td>{b.id}</td>
                    <td>{b.subject}</td>
                    <td>{tutorNames[b.tutor_id] ?? b.tutor_id}</td>
                    <td>{linked ? label(linked) : <span className="muted">Not linked</span>}</td>
                    <td>{linked ? (ok ? <span className="badge green">Teaches it</span> : <span className="badge amber">Not recorded</span>) : <span className="muted">Not checked</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.ready && data.bookings.length > 0 && (
          <details>
            <summary>Link a booking to a course</summary>
            <SetBookingCourse bookings={data.bookings} offered={data.offered} tutorNames={tutorNames} />
          </details>
        )}
      </section>

      <section className="card stack" aria-labelledby="catalogue-h">
        <h2 id="catalogue-h" style={{ margin: 0 }}>Catalogue</h2>
        <p className="hint">
          The full list of {COURSES.length} courses. {offeredCount} course and year pairs are switched on for this business.{" "}
          {owner ? "Switch a course on when the business starts offering it." : "Only the owner can switch courses on or off."} The list itself is kept in <span className="code">src/lib/catalogue/hsc.ts</span>.
        </p>
        {SUBJECT_AREAS.map((a) => (
          <div key={a.id} className="area-block">
            <h3>{a.name} <span className="muted code">{a.codes[11]} · {a.codes[12]}</span></h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Course</th><th>Year 11 ({a.codes[11]})</th><th>Year 12 ({a.codes[12]})</th></tr>
                </thead>
                <tbody>
                  {COURSES.filter((c) => c.areaId === a.id).map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.name}
                        {c.note && <div className="sub">{c.note}</div>}
                      </td>
                      {([11, 12] as const).map((y) => {
                        const on = Boolean(data.offered[offerKey(c.id, y)]);
                        return (
                          <td key={y}>
                            {!c.years.includes(y) ? (
                              <span className="muted">Not a Year {y} course</span>
                            ) : owner && data.ready ? (
                              <OfferToggle courseId={c.id} year={y} offered={on} />
                            ) : (
                              <span className={`badge ${on ? "green" : ""}`}>{on ? "Offered" : "Not offered"}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="open-h">
        <h2 id="open-h">Not yet confirmed</h2>
        <p className="hint">Details that weren&rsquo;t checked course by course. They are noted here rather than guessed.</p>
        <ul>{UNRESOLVED.map((u) => <li key={u}>{u}</li>)}</ul>
        <p className="hint">
          Checked against:{" "}
          {SOURCES.map((s, i) => (
            <span key={s.href}>{i > 0 && " · "}<a href={s.href} target="_blank" rel="noreferrer">{s.label}</a></span>
          ))}
          . Ask Compass AI things like &ldquo;who teaches Maths Advanced Year 12?&rdquo; or see the <Link href="/knowledge">Knowledge Hub</Link> for owner rules.
        </p>
      </section>
    </div>
  );
}
