import { draftCheckIn } from "./logic";
import type { ConcernCategory, LessonOutcome, RetentionConcern, RetentionLesson } from "./types";

// The fictional demo records for the Student Retention Agent. The students and parents are
// the Payments module's demo families (billing_students ST-01 to ST-10), so nobody is
// recorded twice. Lessons are given as days before today (a negative number is a lesson
// still to come), so the demo always looks current. The same plan builds the SQL seed and
// the unit tests, which keeps the two in step.

export const DEMO_BUSINESS = "Tutor Compass";
export const DEMO_OWNER = "Alex Chen";

type Period = { from: number; to: number; n: number; set?: Record<number, LessonOutcome> };
type Plan = { studentId: string; subject: string; tutor: string; periods: Period[]; extra?: Array<[number, LessonOutcome]>; upcoming: number[] };

/** n days spread evenly from `from` to `to` days ago. Index 0 is the most recent. */
export function spread(from: number, to: number, n: number): number[] {
  if (n <= 1) return [from];
  return Array.from({ length: n }, (_, i) => Math.round(from + (i * (to - from)) / (n - 1)));
}

const PLANS: Plan[] = [
  // High: four family cancellations and a missed lesson this month, attendance 91% down to 58%, two open concerns.
  { studentId: "ST-01", subject: "Year 9 Mathematics", tutor: "Priya Shah", upcoming: [2, 5], periods: [
    { from: 1, to: 30, n: 12, set: { 1: "cancelled_family", 3: "cancelled_family", 5: "no_show", 6: "cancelled_family", 9: "cancelled_family" } },
    { from: 31, to: 90, n: 22, set: { 4: "cancelled_family", 15: "cancelled_family" } },
  ] },
  // Settled: every lesson attended.
  { studentId: "ST-02", subject: "Year 7 English", tutor: "Tom Becker", upcoming: [4], periods: [{ from: 1, to: 30, n: 4 }, { from: 31, to: 90, n: 9 }] },
  // Had a run of cancellations about five weeks ago; a check-in followed and attendance recovered.
  { studentId: "ST-03", subject: "Year 12 Physics", tutor: "Aisha Rahman", upcoming: [1], periods: [
    { from: 1, to: 24, n: 7 },
    { from: 26, to: 55, n: 8, set: { 2: "cancelled_family", 3: "cancelled_family", 6: "cancelled_family" } },
    { from: 56, to: 90, n: 10 },
  ] },
  // Medium: lessons moved twice and now fortnightly, nothing booked, one concern about the exam block.
  { studentId: "ST-04", subject: "Year 11 Chemistry", tutor: "Aisha Rahman", upcoming: [], periods: [{ from: 31, to: 90, n: 9 }],
    extra: [[8, "attended"], [22, "attended"], [15, "rescheduled"], [19, "rescheduled"]] },
  // Medium: two lessons missed without notice, attendance 93% down to 71%, one open concern.
  { studentId: "ST-05", subject: "Year 10 Mathematics", tutor: "Priya Shah", upcoming: [3], periods: [
    { from: 1, to: 30, n: 7, set: { 1: "no_show", 4: "no_show" } },
    { from: 31, to: 90, n: 14, set: { 6: "no_show" } },
  ] },
  // Settled after a check-in ten days ago that hasn't had a reply yet.
  { studentId: "ST-06", subject: "Year 8 Mathematics", tutor: "Priya Shah", upcoming: [6], periods: [{ from: 1, to: 30, n: 4 }, { from: 31, to: 90, n: 9, set: { 0: "cancelled_family" } }] },
  // High: two cancellations and a missed lesson, attendance 94% down to 67%, a concern about fit, nothing booked.
  { studentId: "ST-07", subject: "Year 11 English", tutor: "Tom Becker", upcoming: [], periods: [
    { from: 1, to: 30, n: 9, set: { 0: "cancelled_family", 4: "cancelled_family", 6: "no_show" } },
    { from: 31, to: 90, n: 17, set: { 8: "cancelled_family" } },
  ] },
  { studentId: "ST-08", subject: "Year 6 Reading", tutor: "Tom Becker", upcoming: [2], periods: [{ from: 1, to: 30, n: 4 }, { from: 31, to: 90, n: 8 }] },
  // A tutor cancellation never counts against the family.
  { studentId: "ST-09", subject: "Year 9 Science", tutor: "Aisha Rahman", upcoming: [5], periods: [{ from: 1, to: 30, n: 4, set: { 2: "cancelled_tutor" } }, { from: 31, to: 90, n: 9 }] },
  // Former student: not enrolled, so not monitored.
  { studentId: "ST-10", subject: "Year 10 Mathematics", tutor: "Priya Shah", upcoming: [], periods: [{ from: 61, to: 90, n: 4 }] },
];

export type DemoLesson = { studentId: string; daysAgo: number; subject: string; tutor: string; outcome: LessonOutcome };

export function demoLessons(): DemoLesson[] {
  const out: DemoLesson[] = [];
  for (const p of PLANS) {
    for (const per of p.periods) {
      spread(per.from, per.to, per.n).forEach((daysAgo, i) => out.push({ studentId: p.studentId, daysAgo, subject: p.subject, tutor: p.tutor, outcome: per.set?.[i] ?? "attended" }));
    }
    for (const [daysAgo, outcome] of p.extra ?? []) out.push({ studentId: p.studentId, daysAgo, subject: p.subject, tutor: p.tutor, outcome });
    for (const d of p.upcoming) out.push({ studentId: p.studentId, daysAgo: -d, subject: p.subject, tutor: p.tutor, outcome: "scheduled" });
  }
  return out;
}

export type DemoConcern = { studentId: string; daysAgo: number; category: ConcernCategory; summary: string; resolvedDaysAgo: number | null; confidential?: boolean };

export const DEMO_CONCERNS: DemoConcern[] = [
  { studentId: "ST-01", daysAgo: 12, category: "scheduling", summary: "Priya asked whether Aarav's Thursday lesson could start later because of soccer training.", resolvedDaysAgo: null },
  { studentId: "ST-01", daysAgo: 6, category: "progress", summary: "Priya said the last two homework sets felt too hard and Aarav is losing confidence.", resolvedDaysAgo: null },
  { studentId: "ST-07", daysAgo: 9, category: "tutor_fit", summary: "Tom wondered whether the pace of Jack's English lessons suits him before his exams.", resolvedDaysAgo: null },
  { studentId: "ST-04", daysAgo: 14, category: "scheduling", summary: "Mei Lin asked about fewer lessons during Chloe's exam block.", resolvedDaysAgo: null },
  { studentId: "ST-05", daysAgo: 8, category: "communication", summary: "Fatima asked for a short update after each lesson so she can help Omar at home.", resolvedDaysAgo: null },
  { studentId: "ST-05", daysAgo: 8, category: "other", summary: "Fatima mentioned a private family matter. Keep any contact gentle and don't refer to it.", resolvedDaysAgo: null, confidential: true },
  { studentId: "ST-03", daysAgo: 35, category: "scheduling", summary: "Daniel said Liam's part-time job clashed with Wednesday lessons.", resolvedDaysAgo: 23 },
  { studentId: "ST-06", daysAgo: 14, category: "cost", summary: "Sarah asked whether a fortnightly plan was possible.", resolvedDaysAgo: 9 },
];

export type DemoMessage = {
  studentId: string;
  contactId: string;
  channel: "email" | "sms";
  recipient: string;
  address: string;
  daysAgo: number;
  subject: string | null;
  body: string;
  responseDaysAgo: number | null;
  responseNote: string | null;
  followUp: "scheduled" | "resolved";
  followUpDaysAgo: number;
};

/** Two earlier check-ins, so Tracking and Outcomes has history from the first visit. */
export function demoMessages(): DemoMessage[] {
  const liam = draftCheckIn({ channel: "email", parentName: "Daniel O'Brien", studentName: "Liam O'Brien", subject: "Year 12 Physics", tutorName: "Aisha Rahman", business: DEMO_BUSINESS, signoff: DEMO_OWNER, topics: ["scheduling"], variant: 0 });
  const oliver = draftCheckIn({ channel: "sms", parentName: "Sarah Chen", studentName: "Oliver Chen", subject: "Year 8 Mathematics", tutorName: "Priya Shah", business: DEMO_BUSINESS, signoff: DEMO_OWNER, topics: ["cost"], variant: 0 });
  return [
    { studentId: "ST-03", contactId: "BC-02", channel: "email", recipient: "Daniel O'Brien", address: "daniel.obrien@example.com", daysAgo: 25, ...liam,
      responseDaysAgo: 23, responseNote: "Daniel replied that Saturday mornings suit Liam better. Lessons moved to Saturdays.", followUp: "resolved", followUpDaysAgo: 18 },
    { studentId: "ST-06", contactId: "BC-05", channel: "sms", recipient: "Sarah Chen", address: "+61 412 555 105", daysAgo: 10, ...oliver,
      responseDaysAgo: null, responseNote: null, followUp: "scheduled", followUpDaysAgo: 3 },
  ];
}

/** The demo records as the app reads them, dated from `today`. Used by the tests. */
export function demoRecords(today: string): { lessons: RetentionLesson[]; concerns: RetentionConcern[] } {
  const day = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  return {
    lessons: demoLessons().map((l, i) => ({ id: `L${i}`, studentId: l.studentId, date: day(l.daysAgo), subject: l.subject, tutorName: l.tutor, outcome: l.outcome, note: null })),
    concerns: DEMO_CONCERNS.map((c, i) => ({
      id: `C${i}`, studentId: c.studentId, raisedOn: day(c.daysAgo), category: c.category, summary: c.summary,
      status: c.resolvedDaysAgo === null ? "open" : "resolved", confidential: Boolean(c.confidential), resolvedOn: c.resolvedDaysAgo === null ? null : day(c.resolvedDaysAgo),
    })),
  };
}

// SQL --------------------------------------------------------------------------------------------

const q = (s: string | null) => (s === null ? "null" : `'${s.replace(/'/g, "''")}'`);
const dayExpr = (daysAgo: number) => (daysAgo === 0 ? "d" : daysAgo > 0 ? `d - ${daysAgo}` : `d + ${-daysAgo}`);

/** The seed and reset functions, written to supabase/retention-demo.sql by npm run retention:generate. */
export function demoSql(): string {
  const lessons = demoLessons().map((l) => `    (${q(l.studentId)}, ${dayExpr(l.daysAgo)}, ${q(l.subject)}, ${q(l.tutor)}, ${q(l.outcome)})`).join(",\n");
  const concerns = DEMO_CONCERNS.map((c) => `    (${q(c.studentId)}, ${dayExpr(c.daysAgo)}, ${q(c.category)}, ${q(c.summary)}, ${q(c.resolvedDaysAgo === null ? "open" : "resolved")}, ${c.confidential ? "true" : "false"}, ${c.resolvedDaysAgo === null ? "null" : dayExpr(c.resolvedDaysAgo)})`).join(",\n");
  const messages = demoMessages().map((m) => {
    const sent = `((${dayExpr(m.daysAgo)})::timestamp + time '10:00') at time zone 'Australia/Sydney'`;
    const approved = `((${dayExpr(m.daysAgo)})::timestamp + time '09:45') at time zone 'Australia/Sydney'`;
    const response = m.responseDaysAgo === null ? "null" : `((${dayExpr(m.responseDaysAgo)})::timestamp + time '16:20') at time zone 'Australia/Sydney'`;
    return `  insert into public.retention_messages (student_id, contact_id, channel, recipient_name, address, subject, body, status, version, prepared_by, approved_by, approved_at, approved_hash, sent_by, sent_at, delivery_status, delivery_detail, response_status, response_at, response_note, follow_up, follow_up_on, mode, created_at, updated_at)
  values (${q(m.studentId)}, ${q(m.contactId)}, ${q(m.channel)}, ${q(m.recipient)}, ${q(m.address)}, ${q(m.subject)}, ${q(m.body)}, 'sent', 2, v_owner, v_owner, ${approved},
          public.retention_message_hash(${q(m.channel)}, ${q(m.address)}, ${q(m.subject)}, ${q(m.body)}), v_owner, ${sent}, 'simulated', 'Demo mode: simulated, nothing was sent',
          ${m.responseDaysAgo === null ? "'none'" : "'received'"}, ${response}, ${q(m.responseNote)}, ${q(m.followUp)}, ${dayExpr(m.followUpDaysAgo)}, 'demo', ${approved}, ${response === "null" ? sent : response});`;
  }).join("\n");
  return `-- Generated by scripts/build-retention-demo.ts from src/lib/retention/demo-data.ts. Do not edit by hand.
-- Run with: npm run retention:generate
--
-- Fictional demo records for the Student Retention Agent, dated from today in Sydney, and
-- the reset the website calls with the main demo reset. Only rows labelled
-- 'fictional_demo' are ever removed.

create or replace function public.retention_demo_seed() returns void
language plpgsql as $$
declare
  d date := (now() at time zone 'Australia/Sydney')::date;
  v_owner uuid := (select id from public.app_users where role = 'owner' order by created_at limit 1);
begin
  -- The students and parents come from the Payments demo. Without them there is nothing to add.
  if not exists (select 1 from public.billing_students where id = 'ST-01' and data_label = 'fictional_demo') then
    return;
  end if;

  insert into public.retention_lessons (student_id, lesson_date, subject, tutor_name, outcome) values
${lessons};

  insert into public.retention_concerns (student_id, raised_on, category, summary, status, confidential, resolved_on) values
${concerns};

${messages}

  insert into public.retention_events (kind, detail, student_id, mode, created_at)
  select 'simulated', format('Demo history: a check-in to %s was simulated. Nothing was sent.', m.recipient_name), m.student_id, 'demo', m.sent_at
  from public.retention_messages m where m.data_label = 'fictional_demo';

  insert into public.retention_settings (id) values (1) on conflict (id) do nothing;
end $$;

-- Puts the retention demo back as it started.
create or replace function public.reset_retention_demo() returns jsonb
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('tutor_compass_retention_reset'));
  delete from public.retention_events where data_label = 'fictional_demo';
  delete from public.retention_messages where data_label = 'fictional_demo';
  delete from public.retention_alert_state where data_label = 'fictional_demo';
  delete from public.retention_dismissals where data_label = 'fictional_demo';
  delete from public.retention_runs where data_label = 'fictional_demo';
  delete from public.retention_concerns where data_label = 'fictional_demo';
  delete from public.retention_lessons where data_label = 'fictional_demo';
  perform public.retention_demo_seed();
  return jsonb_build_object('resetAt', now(), 'lessons', (select count(*) from public.retention_lessons where data_label = 'fictional_demo'));
end $$;

revoke all on function public.retention_demo_seed() from public, anon, authenticated;
revoke all on function public.reset_retention_demo() from public, anon, authenticated;

-- First load: add the demo records if there are none yet.
do $$
begin
  insert into public.retention_settings (id) values (1) on conflict (id) do nothing;
  if not exists (select 1 from public.retention_lessons) then
    perform public.retention_demo_seed();
  end if;
end $$;
`;
}
