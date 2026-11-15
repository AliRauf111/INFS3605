-- Fictional demo data for the Compass workflows (Lesson Change, Payment Extension and
-- Tutor Absence). All people, lessons, slots and invoices here are fictional. Run after
-- seed.sql and catalogue.sql. Safe to run more than once: rows that already exist are
-- left alone, and nothing is added for a booking or tutor that isn't there.
-- Times are set from the day this file is run, so the lessons are always upcoming.

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
       ((current_date + v.days) + v.at) at time zone 'Australia/Sydney',
       ((current_date + v.days) + v.at + interval '1 hour') at time zone 'Australia/Sydney',
       v.status
from (values
  ('SLOT-3006', 'T-01', 3, time '16:00', 'booked'),
  ('SLOT-3007', 'T-02', 2, time '16:00', 'booked'),
  ('SLOT-3008', 'T-02', 3, time '17:00', 'booked'),
  ('SLOT-3009', 'T-03', 4, time '15:30', 'booked'),
  ('SLOT-3010', 'T-01', 8, time '16:00', 'booked'),
  ('SLOT-3011', 'T-04', 2, time '16:00', 'free'),
  ('SLOT-3012', 'T-04', 3, time '17:00', 'free'),
  ('SLOT-3013', 'T-05', 3, time '16:00', 'free'),
  ('SLOT-3014', 'T-05', 6, time '17:00', 'free'),
  ('SLOT-3015', 'T-02', 9, time '16:00', 'free'),
  ('SLOT-3016', 'T-02', 10, time '17:00', 'free'),
  ('SLOT-3017', 'T-01', 7, time '16:00', 'free')
) as v (id, tutor_id, days, at, status)
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
select 'PAY-2008', 'BK-1045', 'INV-507', 35000, 'pending', null, current_date + 3, 'Invoice', now()
where exists (select 1 from public.bookings where id = 'BK-1045')
on conflict (id) do nothing;

-- The current reminder schedules (recorded only; nothing is sent).
insert into public.payment_reminders (payment_id, remind_on, kind)
select v.payment_id, v.remind_on, v.kind
from (values
  ('PAY-2004', current_date + 1, 'overdue'),
  ('PAY-2008', current_date + 3, 'due_today'),
  ('PAY-2008', current_date + 6, 'overdue')
) as v (payment_id, remind_on, kind)
where exists (select 1 from public.payments p where p.id = v.payment_id and p.status in ('pending', 'overdue'))
  and not exists (select 1 from public.payment_reminders r where r.payment_id = v.payment_id);
