-- Gives each request its own class: the exact HSC course and year it is about. Two
-- requests on the same booking can be about different classes, so the class is saved on
-- the request. The same catalogue trigger as bookings fills in the subject area and the
-- class code (for example MTH1011), and rejects a course that doesn't run in that year.
alter table public.requests
  add column if not exists course_id text,
  add column if not exists year_level smallint,
  add column if not exists area_id text,
  add column if not exists category_code text,
  add column if not exists course_level text not null default '',
  add column if not exists qualification text not null default '',
  add column if not exists class_set_by uuid references public.app_users (id),
  add column if not exists class_set_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'requests_course_year_fk') then
    alter table public.requests add constraint requests_course_year_fk
      foreign key (course_id, year_level) references public.hsc_course_years (course_id, year_level);
  end if;
end $$;

drop trigger if exists requests_course_fill on public.requests;
create trigger requests_course_fill before insert or update of course_id, year_level, course_level, qualification on public.requests
  for each row execute function public.hsc_fill_course();

alter table public.request_events drop constraint if exists request_events_event_type_check;
alter table public.request_events add constraint request_events_event_type_check check (event_type in (
  'created', 'reevaluated', 'sent_to_owner', 'owner_approved', 'owner_declined',
  'owner_requested_info', 'admin_replied', 'admin_recorded', 'closed',
  'removed_from_list', 'restored_to_list', 'archived', 'unarchived', 'class_changed'
));

-- Older requests: copy the class from their booking, but only when the booking is
-- linked to exactly one course. Requests whose class can't be worked out stay empty,
-- and someone can choose the class on the request's page.
update public.requests r
   set course_id = b.course_id, year_level = b.year_level, course_level = b.course_level, qualification = b.qualification
  from public.bookings b
 where r.course_id is null
   and b.course_id is not null
   and b.id = coalesce(r.booking_id, case when r.reference_id ~ '^BK-[0-9]+$' then r.reference_id end);
