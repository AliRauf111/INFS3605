import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { catalogueData, offerKey } from "@/lib/data/catalogue";
import { COURSES, SUBJECT_AREAS, UNRESOLVED, canTeach, type YearLevel } from "@/lib/catalogue/hsc";
import { selectionLabel } from "@/components/SubjectPicker";
import { getI18n } from "@/lib/i18n/server";
import { LoadError } from "@/components/ui";
import { AddStudentCourse, AddTutorCourse, FindTutor, OfferToggle, RemoveLink, SetBookingCourse } from "./SubjectsClient";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.subjects") };
}

const SOURCES = [
  { href: "https://curriculum.nsw.edu.au/learning-areas/tas/enterprise-computing-11-12-2022/content", label: "NSW Curriculum: Enterprise Computing" },
  { href: "https://www.nsw.gov.au/education-and-training/nesa/news/all/new-hms-and-hms-life-skills-11-12", label: "NESA: Health and Movement Science" },
  { href: "https://www.nsw.gov.au/education-and-training/nesa/curriculum/languages/continuers", label: "NESA: Continuers languages" },
];

export default async function SubjectsPage() {
  const user = await requirePageUser();
  const { t } = await getI18n();
  let data;
  try {
    data = await catalogueData();
  } catch (e) {
    return <LoadError error={e} />;
  }
  const owner = user.role === "owner";
  const tutorNames = Object.fromEntries(data.tutors.map((tu) => [tu.id, tu.name]));
  const label = (x: { course_id: string; year_level: YearLevel; course_level: string; qualification: string }) =>
    selectionLabel({ year: x.year_level, courseId: x.course_id, level: x.course_level, qualification: x.qualification }, t);
  const offeredCount = Object.values(data.offered).filter(Boolean).length;

  return (
    <div className="stack">
      <PageHeader>
        <h1>{t("nav.subjects")}</h1>
        <p className="muted" style={{ margin: 0 }}>{t("subjects.intro")}</p>
      </PageHeader>

      {!data.ready && (
        <div className="notice warning" role="status">
          <p><strong>{t("subjects.needsUpdate")}</strong> {t("subjects.needsUpdateText")}</p>
          <p>{t("subjects.runSqlStart")} <span className="code">supabase/migrations/20261019000002_hsc_catalogue.sql</span>, {t("subjects.runSqlThen")} <span className="code">supabase/catalogue.sql</span>. {t("subjects.runSqlSafe")}</p>
        </div>
      )}

      <section className="card stack" aria-labelledby="find-h">
        <h2 id="find-h" style={{ margin: 0 }}>{t("subjects.findTutor")}</h2>
        <p className="hint">{t("subjects.findTutorHint")}</p>
        <FindTutor tutors={data.tutors} tutorCourses={data.tutorCourses} offered={data.offered} freeSlots={data.freeSlots} />
      </section>

      <div className="grid grid-2">
        <section className="card stack" aria-labelledby="tutors-h">
          <h2 id="tutors-h" style={{ margin: 0 }}>{t("subjects.tutors")}</h2>
          <p className="hint">{t("subjects.tutorsHint")} {owner ? t("subjects.onlyYou") : t("subjects.onlyOwner")}</p>
          {data.tutors.map((tu) => {
            const rows = data.tutorCourses.filter((c) => c.tutor_id === tu.id);
            return (
              <div key={tu.id}>
                <h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem" }}><bdi>{tu.name}</bdi></h3>
                {rows.length ? (
                  <ul className="course-list">
                    {rows.map((r) => (
                      <li key={r.id}>
                        <span lang="en">{label(r)}</span>
                        {owner && <RemoveLink id={r.id} kind="tutor" label={t("subjects.fromTutor", { course: label(r), name: tu.name })} />}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>{t("subjects.noTutorCourses")}</p>
                )}
              </div>
            );
          })}
          {owner && data.ready && data.tutors.length > 0 && (
            <details>
              <summary>{t("subjects.addToTutor")}</summary>
              <AddTutorCourse tutors={data.tutors} />
            </details>
          )}
        </section>

        <section className="card stack" aria-labelledby="students-h">
          <h2 id="students-h" style={{ margin: 0 }}>{t("subjects.students")}</h2>
          <p className="hint">{t("subjects.studentsHint")}</p>
          {data.studentCourses.length ? (
            <ul className="course-list">
              {data.studentCourses.map((r) => (
                <li key={r.id}>
                  <span>
                    <strong><bdi>{r.student_name}</bdi></strong> <span className="muted">(<bdi>{r.family_id}</bdi>)</span>
                    <br />
                    <span lang="en">{label(r)}</span>
                  </span>
                  <RemoveLink id={r.id} kind="student" label={t("subjects.forStudent", { course: label(r), name: r.student_name })} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{t("subjects.noCourses")}</p>
          )}
          {data.ready && data.families.length > 0 && (
            <details>
              <summary>{t("subjects.addStudentCourse")}</summary>
              <AddStudentCourse families={data.families} />
            </details>
          )}
        </section>
      </div>

      <section className="card stack" aria-labelledby="bookings-h">
        <h2 id="bookings-h" style={{ margin: 0 }}>{t("subjects.bookings")}</h2>
        <p className="hint">{t("subjects.bookingsHint")}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t("subjects.col.booking")}</th><th>{t("subjects.col.subject")}</th><th>{t("subjects.col.tutor")}</th><th>{t("subjects.col.course")}</th><th>{t("subjects.col.check")}</th></tr>
            </thead>
            <tbody>
              {data.bookings.map((b) => {
                const linked = b.course_id && b.year_level ? { course_id: b.course_id, year_level: b.year_level, course_level: b.course_level, qualification: b.qualification } : null;
                const ok =
                  linked &&
                  canTeach(
                    data.tutorCourses.filter((tc) => tc.tutor_id === b.tutor_id).map((tc) => ({ courseId: tc.course_id, year: tc.year_level, level: tc.course_level })),
                    { courseId: linked.course_id, year: linked.year_level, level: linked.course_level },
                  );
                return (
                  <tr key={b.id}>
                    <td><bdi>{b.id}</bdi></td>
                    <td dir="auto">{b.subject}</td>
                    <td><bdi>{tutorNames[b.tutor_id] ?? b.tutor_id}</bdi></td>
                    <td>{linked ? <span lang="en">{label(linked)}</span> : <span className="muted">{t("subjects.notLinked")}</span>}</td>
                    <td>{linked ? (ok ? <span className="badge lilac">{t("subjects.teachesIt")}</span> : <span className="badge">{t("subjects.notRecorded")}</span>) : <span className="muted">{t("subjects.notChecked")}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.ready && data.bookings.length > 0 && (
          <details>
            <summary>{t("subjects.linkBooking")}</summary>
            <SetBookingCourse bookings={data.bookings} offered={data.offered} tutorNames={tutorNames} />
          </details>
        )}
      </section>

      <section className="card stack" aria-labelledby="catalogue-h">
        <h2 id="catalogue-h" style={{ margin: 0 }}>{t("subjects.catalogue")}</h2>
        <p className="hint">
          {t("subjects.catalogueCount", { count: COURSES.length })} {t("subjects.offeredCount", { count: offeredCount })}{" "}
          {owner ? t("subjects.switchOn") : t("subjects.ownerSwitches")}
        </p>
        {SUBJECT_AREAS.map((a) => (
          <div key={a.id} className="area-block">
            <h3>{t(`catalogue.area.${a.id}`)} <span className="muted code">{a.codes[11]} · {a.codes[12]}</span></h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t("subjects.col.course")}</th><th>{t("subjects.yearCode", { year: 11, code: a.codes[11] })}</th><th>{t("subjects.yearCode", { year: 12, code: a.codes[12] })}</th></tr>
                </thead>
                <tbody>
                  {COURSES.filter((c) => c.areaId === a.id).map((c) => (
                    <tr key={c.id}>
                      <td lang="en">
                        {c.name}
                        {c.note && <div className="sub">{c.note}</div>}
                      </td>
                      {([11, 12] as const).map((y) => {
                        const on = Boolean(data.offered[offerKey(c.id, y)]);
                        return (
                          <td key={y}>
                            {!c.years.includes(y) ? (
                              <span className="muted">{t("subjects.notYearCourse", { year: y })}</span>
                            ) : owner && data.ready ? (
                              <OfferToggle courseId={c.id} year={y} offered={on} />
                            ) : (
                              <span className={`badge ${on ? "lilac" : ""}`}>{on ? t("subjects.offered") : t("subjects.notOffered")}</span>
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
        <h2 id="open-h">{t("subjects.notConfirmed")}</h2>
        <p className="hint">{t("subjects.notConfirmedHint")}</p>
        <ul lang="en">{UNRESOLVED.map((u) => <li key={u}>{u}</li>)}</ul>
        <p className="hint">
          {t("subjects.checkedAgainst")}{" "}
          {SOURCES.map((s, i) => (
            <span key={s.href}>{i > 0 && " · "}<a href={s.href} target="_blank" rel="noreferrer" lang="en">{s.label}</a></span>
          ))}
          . {t("subjects.askCompass")} <Link href="/knowledge">{t("nav.knowledgeHub")}</Link>.
        </p>
      </section>
    </div>
  );
}
