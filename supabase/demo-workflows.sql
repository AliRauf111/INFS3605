-- Fictional demo data for the Compass workflows (Lesson Change, Payment Extension and
-- Tutor Absence). All people, lessons, slots and invoices here are fictional. Run after
-- seed.sql and catalogue.sql. Safe to run more than once: rows that already exist are
-- left alone, and nothing is added for a booking or tutor that isn't there.
-- Times are set in Sydney from the day this file is run (public.demo_at), so the lessons
-- are always upcoming and land on the weekdays the class demo script uses:
--   * Tom's lesson LSN-4003 is on the next Thursday, with Nadia free at the same time, so
--     "can't teach on Thursday" finds exactly one lesson with a cover tutor.
--   * Leo's lesson LSN-4001 (SLOT-3002 in seed.sql) is next week's Thursday, and Priya is
--     free on that Tuesday afternoon (SLOT-3001 and SLOT-3018), so "move to Tuesday
--     afternoon" offers Tuesday first.
-- The whole demo dataset is put back this way on every page load in demo mode (see
-- supabase/migrations/20261027000001_demo_reset.sql).

-- Two cover tutors.
insert into public.tutors (id, name, subjects) values
  ('T-04', 'Nadia Hassan', array['English']),
  ('T-05', 'Daniel Kim', array['Maths'])
on conflict (id) do nothing;

insert into public.tutor_courses (tutor_id, course_id, year_level)
select v.tutor_id, v.course_id, v.year_level
from (values ('T-04', 'english_standard', 11), ('T-04', 'english_standard', 12), ('T-04', 'english_advanced', 11), ('T-04', 'english_advanced', 12),
             ('T-05', 'maths_advanced', 11), ('T-05', 'maths_advanced', 12), ('T-05', 'maths_standard', 11), ('T-05', 'maths_standard_2', 12))
     as v (tutor_id, course_id, year_level)
where exists (select 1 from public.tutors t where t.id = v.tutor_id)
  and exists (select 1 from public.hsc_course_years y where y.course_id = v.course_id and y.year_level = v.year_level)
on conflict do nothing;

-- Tutor calendar: slots held by upcoming lessons, cover tutors' free times and later free times.
insert into public.tutor_availability (id, tutor_id, starts_at, ends_at, status)
select v.id, v.tutor_id,
       public.demo_at(v.anchor, v.days, v.at),
       public.demo_at(v.anchor, v.days, v.at) + interval '1 hour',
       v.status
from (values
  ('SLOT-3006', 'T-01', 'next_monday', 0, time '16:00', 'booked'),
  ('SLOT-3007', 'T-02', 'next_thursday', 0, time '16:00', 'booked'),
  ('SLOT-3008', 'T-02', 'next_thursday', 1, time '17:00', 'booked'),
  ('SLOT-3009', 'T-03', 'next_monday', 2, time '15:30', 'booked'),
  ('SLOT-3010', 'T-01', 'next_monday', 4, time '16:00', 'booked'),
  ('SLOT-3011', 'T-04', 'next_thursday', 0, time '16:00', 'free'),
  ('SLOT-3012', 'T-04', 'next_thursday', 1, time '17:00', 'free'),
  ('SLOT-3013', 'T-05', 'next_monday', 0, time '16:00', 'free'),
  ('SLOT-3014', 'T-05', 'next_monday', 4, time '16:00', 'free'),
  ('SLOT-3015', 'T-02', 'next_thursday', 6, time '16:00', 'free'),
  ('SLOT-3016', 'T-02', 'next_thursday', 7, time '17:00', 'free'),
  ('SLOT-3017', 'T-01', 'next_monday', 7, time '16:00', 'free'),
  ('SLOT-3018', 'T-01', 'next_monday', 1, time '15:00', 'free')
) as v (id, tutor_id, anchor, days, at, status)
where exists (select 1 from public.tutors t where t.id = v.tutor_id)
on conflict (id) do nothing;

-- Upcoming lessons. Each one holds its tutor's booked slot.
insert into public.lessons (id, booking_id, tutor_id, slot_id, starts_at, ends_at)
select v.id, v.booking_id, s.tutor_id, s.id, s.starts_at, s.ends_at
from (values
  ('LSN-4001', 'BK-1042', 'SLOT-3002'),
  ('LSN-4002', 'BK-1045', 'SLOT-3006'),
  ('LSN-4003', 'BK-1043', 'SLOT-3007'),
  ('LSN-4004', 'BK-1047', 'SLOT-3008'),
  ('LSN-4005', 'BK-1044', 'SLOT-3009'),
  ('LSN-4006', 'BK-1046', 'SLOT-3010')
) as v (id, booking_id, slot_id)
join public.tutor_availability s on s.id = v.slot_id
join public.bookings b on b.id = v.booking_id and b.tutor_id = s.tutor_id
on conflict (id) do nothing;

-- A second unpaid invoice, due in three days.
insert into public.payments (id, booking_id, invoice_ref, amount_cents, status, paid_at, due_date, method, last_synced_at)
select 'PAY-2008', 'BK-1045', 'INV-507', 35000, 'pending', null, public.demo_today() + 3, 'Invoice', now()
where exists (select 1 from public.bookings where id = 'BK-1045')
on conflict (id) do nothing;

-- The current reminder schedules (recorded only; nothing is sent).
insert into public.payment_reminders (payment_id, remind_on, kind)
select v.payment_id, v.remind_on, v.kind
from (values
  ('PAY-2004', public.demo_today() + 1, 'overdue'),
  ('PAY-2008', public.demo_today() + 3, 'due_today'),
  ('PAY-2008', public.demo_today() + 6, 'overdue')
) as v (payment_id, remind_on, kind)
where exists (select 1 from public.payments p where p.id = v.payment_id and p.status in ('pending', 'overdue'))
  and not exists (select 1 from public.payment_reminders r where r.payment_id = v.payment_id);

-- A realistic month of regular weekly lessons for the Schedule calendar, from the start of
-- this month (Sydney) to the end of next month. Lessons before today are marked completed.
-- They are kept clear of the walkthroughs above: no upcoming extra lessons for BK-1042, so
-- Lesson Change still finds exactly one; none for T-02 on Thursdays, so Tutor Absence still
-- finds one lesson; and evening or Saturday times that never overlap the free slots above.
insert into public.lessons (id, booking_id, tutor_id, slot_id, starts_at, ends_at, status)
select 'LSN-' || to_char(d.day, 'YYMMDD') || p.n,
       p.booking_id, b.tutor_id, null,
       (d.day + p.at) at time zone 'Australia/Sydney',
       (d.day + p.at) at time zone 'Australia/Sydney' + interval '1 hour',
       case when d.day < public.demo_today() then 'completed' else 'scheduled' end
from generate_series(date_trunc('month', public.demo_today()::timestamp)::date,
                     (date_trunc('month', public.demo_today()::timestamp) + interval '2 months - 1 day')::date,
                     interval '1 day') as g(ts)
cross join lateral (select g.ts::date as day) as d
join (values
  (1, 1, 'BK-1045', time '18:15'), (1, 2, 'BK-1043', time '19:15'),
  (2, 1, 'BK-1044', time '18:15'), (2, 2, 'BK-1047', time '19:15'),
  (3, 1, 'BK-1046', time '18:15'), (3, 2, 'BK-1042', time '19:15'), (3, 3, 'BK-1047', time '20:15'),
  (4, 1, 'BK-1045', time '18:15'), (4, 2, 'BK-1044', time '19:15'),
  (5, 1, 'BK-1043', time '18:15'), (5, 2, 'BK-1046', time '19:15'),
  (6, 1, 'BK-1047', time '09:30'), (6, 2, 'BK-1042', time '10:45'), (6, 3, 'BK-1044', time '12:00')
) as p (dow, n, booking_id, at) on p.dow = extract(isodow from d.day)
join public.bookings b on b.id = p.booking_id
where not (p.booking_id = 'BK-1042' and d.day >= public.demo_today())
on conflict (id) do nothing;
