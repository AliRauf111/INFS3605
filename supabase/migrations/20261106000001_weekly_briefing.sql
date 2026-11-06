-- Weekly Owner Briefing Agent (Tutor Compass).
--
-- Adds what the briefing needs that Tutor Compass didn't already store:
--   * briefing_communications: parent and tutor emails and texts the briefing reads. In demo
--     mode these are fictional Gmail and SMS records. Live mode doesn't read them until a
--     Gmail inbox and SMS provider are connected for the briefing.
--   * owner_briefings: every briefing that was generated, so earlier ones can be read again
--     without being worked out a second time.
--   * briefing_settings: the owner's schedule, sections, recipient and thresholds.
--   * briefing_deliveries: each email attempt, with one row per scheduled slot and recipient,
--     so a retried job can never send the same weekly briefing twice.
--   * briefing_events: the audit trail.
--
-- Everything else the briefing reads (invoices, requests, lessons, absences, workflows,
-- proposals and agent activity) comes from the existing tables, unchanged.
--
-- Demo data is labelled 'fictional_demo' and is put back by public.reset_briefing_demo(),
-- which the website calls with the main demo reset. Nothing labelled 'live_connected' or
-- 'imported' is ever removed. Safe to run more than once.

-- Communications ------------------------------------------------------------------------
create table if not exists public.briefing_communications (
  id text primary key check (id ~ '^MSG-[0-9A-Za-z-]{2,40}$'),
  channel text not null check (channel in ('gmail', 'sms')),
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_kind text not null default 'parent' check (sender_kind in ('parent', 'tutor', 'new_family', 'business')),
  contact_name text not null check (char_length(contact_name) between 1 and 120),
  family_id text,
  student_name text,
  category text not null check (category in ('lesson_change', 'billing', 'enrolment', 'tutor_absence', 'general', 'reminder')),
  subject text not null check (char_length(subject) between 1 and 200),
  snippet text not null default '' check (char_length(snippet) <= 400),
  received_at timestamptz not null,
  status text not null check (status in ('unanswered', 'awaiting_owner', 'answered', 'resolved')),
  answered_at timestamptz,
  delivery_status text check (delivery_status is null or delivery_status in ('delivered', 'failed', 'pending')),
  request_id uuid references public.requests (id) on delete set null,
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  synced_at timestamptz not null default now()
);
create index if not exists briefing_communications_time_idx on public.briefing_communications (data_label, received_at desc);

-- Settings ------------------------------------------------------------------------------
-- One row per kind of data: 'fictional_demo' for the demo, 'live_connected' for real use.
create table if not exists public.briefing_settings (
  id text primary key check (id in ('fictional_demo', 'live_connected')),
  enabled boolean not null default false,
  send_day smallint not null default 1 check (send_day between 1 and 7), -- ISO: 1 Monday, 7 Sunday
  send_time time not null default '08:00',
  time_zone text not null default 'Australia/Sydney' check (time_zone = 'Australia/Sydney'),
  sections text[] not null default array['summary', 'finance', 'communications', 'lessons', 'completed', 'recommendations'],
  recipient_id uuid references public.app_users (id) on delete set null,
  admin_finance boolean not null default false,
  thresholds jsonb not null default '{"overdueRedDays":14,"overdueRedCount":3,"enquiryAmberHours":24,"enquiryRedHours":72,"coverRedHours":48}'::jsonb,
  updated_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (sections <@ array['summary', 'finance', 'communications', 'lessons', 'completed', 'recommendations'])
);

-- Generated briefings -----------------------------------------------------------------------
create table if not exists public.owner_briefings (
  id uuid primary key default gen_random_uuid(),
  period_key date not null,               -- the Sydney day the reporting period ends on
  period_start timestamptz not null,
  period_end timestamptz not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.app_users (id) on delete set null,
  trigger text not null check (trigger in ('page', 'manual', 'schedule', 'compass', 'seed')),
  status text not null default 'ready' check (status in ('ready', 'failed')),
  overall text not null check (overall in ('action_required', 'attention', 'up_to_date')),
  headline jsonb not null,                -- the figures compared week on week
  detail jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  mode text not null check (mode in ('demo', 'live')),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  check (period_end > period_start)
);
create unique index if not exists owner_briefings_one_per_day on public.owner_briefings (data_label, period_key);
create index if not exists owner_briefings_recent_idx on public.owner_briefings (data_label, period_key desc);

-- Email deliveries ----------------------------------------------------------------------------
create table if not exists public.briefing_deliveries (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid references public.owner_briefings (id) on delete set null,
  slot_key text not null check (char_length(slot_key) between 1 and 80),
  kind text not null check (kind in ('scheduled', 'manual')),
  recipient text not null check (char_length(recipient) between 3 and 320),
  status text not null check (status in ('sending', 'simulated', 'accepted', 'failed', 'skipped')),
  provider_id text,
  detail text not null default '' check (char_length(detail) <= 500),
  attempts integer not null default 1 check (attempts >= 1),
  actor_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create unique index if not exists briefing_deliveries_once on public.briefing_deliveries (data_label, slot_key, lower(recipient));
create index if not exists briefing_deliveries_recent_idx on public.briefing_deliveries (data_label, created_at desc);

create table if not exists public.briefing_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (char_length(kind) <= 60),
  detail text not null check (char_length(detail) <= 1000),
  actor_id uuid references public.app_users (id) on delete set null,
  briefing_id uuid,
  created_at timestamptz not null default now(),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create index if not exists briefing_events_recent_idx on public.briefing_events (data_label, created_at desc);

-- Only the server (secret key) reads or writes any of this.
alter table public.briefing_communications enable row level security;
alter table public.briefing_settings enable row level security;
alter table public.owner_briefings enable row level security;
alter table public.briefing_deliveries enable row level security;
alter table public.briefing_events enable row level security;

-- Claim one delivery ------------------------------------------------------------------------
-- Returns the delivery id when this caller may send, or null when the slot was already sent
-- (or is being sent) to this recipient. A failed attempt, or one stuck in 'sending' for 15
-- minutes, may be retried. The unique index makes this safe when two jobs run at once.
create or replace function public.claim_briefing_delivery(
  p_label text, p_slot text, p_kind text, p_recipient text, p_briefing uuid, p_actor uuid
) returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.briefing_deliveries (slot_key, kind, recipient, status, briefing_id, actor_id, data_label)
  values (p_slot, p_kind, p_recipient, 'sending', p_briefing, p_actor, p_label)
  on conflict (data_label, slot_key, lower(recipient)) do update
    set status = 'sending', attempts = public.briefing_deliveries.attempts + 1, briefing_id = excluded.briefing_id,
        actor_id = excluded.actor_id, detail = '', updated_at = now()
    where public.briefing_deliveries.status in ('failed', 'skipped')
       or (public.briefing_deliveries.status = 'sending' and public.briefing_deliveries.updated_at < now() - interval '15 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- Demo data -----------------------------------------------------------------------------------
create or replace function public.briefing_demo_seed() returns void
language plpgsql as $$
declare
  v_owner uuid := (select id from public.app_users where role = 'owner' order by created_at limit 1);
  d date := (now() at time zone 'Australia/Sydney')::date;
begin
  insert into public.briefing_settings (id, enabled, send_day, send_time, recipient_id)
  values ('fictional_demo', true, 1, '08:00', v_owner)
  on conflict (id) do nothing;

  -- Parent, tutor and new-family messages. Times are relative to now, so the demo always
  -- has a "this week" and a "last week".
  insert into public.briefing_communications
    (id, channel, direction, sender_kind, contact_name, family_id, student_name, category, subject, snippet, received_at, status, answered_at, delivery_status, request_id)
  values
    -- Still waiting for a reply this week
    ('MSG-B01', 'gmail', 'inbound', 'parent', 'Grace Nguyen', 'FAM-01', 'Leo Nguyen', 'lesson_change', 'Moving Leo''s Thursday lesson', 'Could Leo''s Thursday lesson move to Friday afternoon next week? He has a school concert.', now() - interval '5 hours', 'unanswered', null, null, null),
    ('MSG-B02', 'gmail', 'inbound', 'parent', 'Daniel O''Brien', null, 'Liam O''Brien', 'billing', 'Question about invoice INV-2043', 'Hi, I think INV-2043 has one more lesson on it than Liam had. Can someone check before I pay?', now() - interval '4 days 2 hours', 'unanswered', null, null, null),
    ('MSG-B03', 'sms', 'inbound', 'parent', 'Mei Lin', 'FAM-03', 'Jasper Lin', 'lesson_change', 'Text: later start for Jasper', 'Can Jasper start 30 mins later on Tuesdays from next week? Footy training runs late.', now() - interval '27 hours', 'unanswered', null, null, null),
    ('MSG-B04', 'gmail', 'inbound', 'new_family', 'Lauren Fisher', null, 'Zoe Fisher', 'enrolment', 'Year 10 Chemistry tutoring enquiry', 'We''re looking for weekly Chemistry help for Zoe in Year 10. Do you have any after-school times?', now() - interval '31 hours', 'unanswered', null, null, null),
    ('MSG-B05', 'gmail', 'inbound', 'parent', 'Sophie Martin', 'FAM-07', 'Ella Martin', 'billing', 'Refund after the timetable change', 'Following up on the $75 refund I asked about after Ella''s lessons moved.', now() - interval '2 days', 'awaiting_owner', null, null, (select r.id from public.requests r where r.id = '00000000-0000-4000-8000-000000000202')),
    ('MSG-B06', 'gmail', 'inbound', 'parent', 'Hannah Patel', 'FAM-04', 'Ravi Patel', 'lesson_change', 'Ravi''s lessons during the HSC trial exams', 'Ravi has trial exams in two weeks. Could we swap two lessons for one longer revision session?', now() - interval '9 hours', 'unanswered', null, null, null),
    ('MSG-B07', 'sms', 'inbound', 'new_family', 'Omar Haddad', null, 'Sami Haddad', 'enrolment', 'Text: Saturday Year 6 Maths', 'Hi, do you have Saturday morning spots for Year 6 maths? Thanks, Omar', now() - interval '50 hours', 'unanswered', null, null, null),
    ('MSG-B08', 'sms', 'inbound', 'tutor', 'Tom Becker', null, null, 'tutor_absence', 'Text: Tom may be away next Thursday', 'Heads up, I have a medical appointment next Thursday afternoon and may not make my lessons.', now() - interval '20 hours', 'unanswered', null, null, null),
    -- Answered this week
    ('MSG-B10', 'gmail', 'inbound', 'parent', 'Grace Nguyen', 'FAM-01', 'Leo Nguyen', 'general', 'Homework help between lessons', 'Is it OK for Leo to email Priya a question between lessons?', now() - interval '6 days', 'answered', now() - interval '5 days 21 hours', null, null),
    ('MSG-B11', 'gmail', 'inbound', 'parent', 'Rachel Brown', null, 'Ethan Brown', 'billing', 'Paying INV-2048', 'Can I pay INV-2048 by bank transfer?', now() - interval '5 days', 'answered', now() - interval '4 days 20 hours', null, null),
    ('MSG-B12', 'sms', 'inbound', 'parent', 'Hannah Patel', 'FAM-04', 'Ravi Patel', 'general', 'Text: running late', 'Ravi running 10 mins late today, sorry!', now() - interval '4 days', 'resolved', now() - interval '3 days 23 hours', null, null),
    ('MSG-B13', 'gmail', 'inbound', 'new_family', 'Ben Carter', null, 'Ivy Carter', 'enrolment', 'Year 3 reading support', 'Do you tutor reading for Year 3? Ivy is a little behind.', now() - interval '3 days', 'answered', now() - interval '2 days 18 hours', null, null),
    ('MSG-B14', 'gmail', 'inbound', 'parent', 'Mei Lin', 'FAM-03', 'Jasper Lin', 'billing', 'Receipt for last term', 'Could you resend last term''s receipt for our records?', now() - interval '2 days 6 hours', 'answered', now() - interval '2 days 2 hours', null, null),
    -- Texts Tutor Compass sent this week
    ('MSG-B15', 'sms', 'outbound', 'business', 'Grace Nguyen', 'FAM-01', 'Leo Nguyen', 'reminder', 'Text: lesson reminder', 'Reminder: Leo''s Year 9 Maths lesson is tomorrow at 7:15 pm.', now() - interval '2 days', 'resolved', null, 'delivered', null),
    ('MSG-B16', 'sms', 'outbound', 'business', 'Hannah Patel', 'FAM-04', 'Ravi Patel', 'reminder', 'Text: lesson reminder', 'Reminder: Ravi''s Year 12 Maths lesson is tomorrow at 6:15 pm.', now() - interval '1 day', 'resolved', null, 'failed', null),
    -- Last week: more enquiries and slower replies
    ('MSG-A01', 'gmail', 'inbound', 'parent', 'Grace Nguyen', 'FAM-01', 'Leo Nguyen', 'lesson_change', 'Swap Leo''s lesson', 'Can we swap this week''s lesson to Wednesday?', now() - interval '13 days', 'answered', now() - interval '11 days 20 hours', null, null),
    ('MSG-A02', 'gmail', 'inbound', 'parent', 'Daniel Okafor', 'FAM-02', 'Amara Okafor', 'general', 'Book recommendations', 'Any book suggestions for Amara over the holidays?', now() - interval '12 days', 'answered', now() - interval '10 days 22 hours', null, null),
    ('MSG-A03', 'sms', 'inbound', 'parent', 'Mei Lin', 'FAM-03', 'Jasper Lin', 'billing', 'Text: invoice question', 'Is the Term 4 invoice coming soon?', now() - interval '12 days 4 hours', 'answered', now() - interval '11 days', null, null),
    ('MSG-A04', 'gmail', 'inbound', 'new_family', 'Priya Raman', null, 'Kiran Raman', 'enrolment', 'Year 8 Science tutoring', 'Looking for Science tutoring for Kiran, Year 8.', now() - interval '11 days', 'answered', now() - interval '9 days 20 hours', null, null),
    ('MSG-A05', 'gmail', 'inbound', 'parent', 'Hannah Patel', 'FAM-04', 'Ravi Patel', 'lesson_change', 'Extra lesson before trials', 'Could Ravi have an extra lesson before his trials?', now() - interval '10 days 6 hours', 'answered', now() - interval '9 days', null, null),
    ('MSG-A06', 'gmail', 'inbound', 'parent', 'Sophie Martin', 'FAM-07', 'Noah Martin', 'general', 'Noah''s progress', 'How is Noah going with his English?', now() - interval '10 days', 'answered', now() - interval '8 days 16 hours', null, null),
    ('MSG-A07', 'sms', 'inbound', 'parent', 'Grace Nguyen', 'FAM-01', 'Leo Nguyen', 'general', 'Text: parking', 'Where is the best place to park for lessons?', now() - interval '9 days 3 hours', 'resolved', now() - interval '8 days 22 hours', null, null),
    ('MSG-A08', 'gmail', 'inbound', 'new_family', 'Chris Walker', null, 'Max Walker', 'enrolment', 'HSC English Advanced', 'Do you have an HSC English Advanced tutor for Max?', now() - interval '8 days 6 hours', 'answered', now() - interval '7 days 2 hours', null, null),
    ('MSG-A09', 'sms', 'outbound', 'business', 'Mei Lin', 'FAM-03', 'Jasper Lin', 'reminder', 'Text: lesson reminder', 'Reminder: Jasper''s Year 8 Science lesson is tomorrow at 6:15 pm.', now() - interval '9 days', 'resolved', null, 'delivered', null)
  on conflict (id) do nothing;

  -- Unlink the refund enquiry if the demo request isn't there (for example on a new database).
  update public.briefing_communications set request_id = null
  where data_label = 'fictional_demo' and request_id is not null
    and not exists (select 1 from public.requests r where r.id = briefing_communications.request_id);

  -- Three earlier briefings, so history and week-on-week comparison have something to show.
  -- They hold the figures as they stood then (fictional), not a re-calculation.
  insert into public.owner_briefings (period_key, period_start, period_end, generated_at, trigger, overall, headline, recommendations, sources, warnings, mode, data_label)
  select d - w.days_ago,
         ((d - w.days_ago - 6)::timestamp) at time zone 'Australia/Sydney',
         ((d - w.days_ago)::timestamp + time '08:00') at time zone 'Australia/Sydney',
         ((d - w.days_ago)::timestamp + time '08:00') at time zone 'Australia/Sydney',
         'seed', w.overall, w.headline::jsonb, w.recs::jsonb,
         '[{"id":"xero","state":"demo"},{"id":"gmail","state":"demo"},{"id":"sms","state":"demo"},{"id":"compass","state":"demo"}]'::jsonb,
         '[]'::jsonb, 'demo', 'fictional_demo'
  from (values
    (7, 'action_required',
     '{"activeStudents":6,"overdueInvoices":7,"overdueCents":134000,"outstandingCents":152000,"over14Invoices":3,"unanswered":11,"awaitingOwner":2,"upcomingLessons":15,"tasksCompleted":4,"cancellations":1,"enquiriesReceived":9,"avgResponseHours":26,"recommendations":4}',
     '[{"kind":"overdue","priority":"red"},{"kind":"enquiries","priority":"red"},{"kind":"decisions","priority":"amber"},{"kind":"lesson_changes","priority":"amber"}]'),
    (14, 'attention',
     '{"activeStudents":6,"overdueInvoices":5,"overdueCents":102000,"outstandingCents":138000,"over14Invoices":2,"unanswered":7,"awaitingOwner":1,"upcomingLessons":14,"tasksCompleted":6,"cancellations":0,"enquiriesReceived":7,"avgResponseHours":19,"recommendations":3}',
     '[{"kind":"overdue","priority":"amber"},{"kind":"enquiries","priority":"amber"},{"kind":"decisions","priority":"amber"}]'),
    (21, 'attention',
     '{"activeStudents":5,"overdueInvoices":3,"overdueCents":66000,"outstandingCents":118000,"over14Invoices":1,"unanswered":5,"awaitingOwner":1,"upcomingLessons":13,"tasksCompleted":5,"cancellations":2,"enquiriesReceived":6,"avgResponseHours":15,"recommendations":2}',
     '[{"kind":"overdue","priority":"amber"},{"kind":"enquiries","priority":"amber"}]')
  ) as w (days_ago, overall, headline, recs)
  on conflict (data_label, period_key) do nothing;

  -- Earlier weekly emails, simulated (nothing was really sent in the demo).
  insert into public.briefing_deliveries (briefing_id, slot_key, kind, recipient, status, detail, created_at, updated_at, data_label)
  select b.id, 'weekly:' || to_char(b.period_key, 'YYYY-MM-DD'), 'scheduled', 'owner@tutorcompass.example', 'simulated',
         'Demo mode: the email was simulated. Nothing was sent.', b.generated_at, b.generated_at, 'fictional_demo'
  from public.owner_briefings b
  where b.data_label = 'fictional_demo' and b.trigger = 'seed'
  on conflict do nothing;

  -- Checks Compass ran this week and last week (fictional). They count towards "What Compass
  -- Completed This Week" only as checks and drafts, never as finished actions.
  if to_regclass('public.ai_activity') is not null then
    insert into public.ai_activity (session_key, event_type, state, mode, summary, detail, created_at, data_label)
    select '00000000-0000-4000-8000-00000000b001'::uuid, v.kind, 'completed', 'system', v.summary,
           '{"seed":"briefing"}'::jsonb, now() - v.ago, 'fictional_demo'
    from (values
      ('availability_checked', 'Checked Priya Shah''s free times for a lesson change (fictional).', interval '1 day 3 hours'),
      ('availability_checked', 'Checked Tom Becker''s Thursday lessons (fictional).', interval '20 hours'),
      ('availability_checked', 'Checked Aisha Rahman''s free times for a new enrolment (fictional).', interval '2 days 5 hours'),
      ('availability_checked', 'Checked Saturday morning times for Year 6 Maths (fictional).', interval '3 days 1 hour'),
      ('availability_checked', 'Checked free times for an extra revision lesson (fictional).', interval '4 days 6 hours'),
      ('draft_prepared', 'Drafted a reply about a lesson change (fictional). Nothing was sent.', interval '1 day 2 hours'),
      ('draft_prepared', 'Drafted a reply to a new enrolment enquiry (fictional). Nothing was sent.', interval '2 days 4 hours'),
      ('draft_prepared', 'Drafted a reply about a receipt (fictional). Nothing was sent.', interval '2 days 3 hours'),
      ('availability_checked', 'Checked free times for a lesson swap (fictional).', interval '12 days 20 hours'),
      ('availability_checked', 'Checked free times for an extra lesson (fictional).', interval '10 days 4 hours'),
      ('draft_prepared', 'Drafted a reply about an invoice (fictional). Nothing was sent.', interval '11 days 22 hours')
    ) as v (kind, summary, ago);
  end if;
end $$;

-- Puts the briefing demo back as it started. Called by the website with the main demo reset.
create or replace function public.reset_briefing_demo() returns jsonb
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('tutor_compass_briefing_reset'));
  delete from public.briefing_deliveries where data_label = 'fictional_demo';
  delete from public.briefing_events where data_label = 'fictional_demo';
  delete from public.owner_briefings where data_label = 'fictional_demo';
  delete from public.briefing_communications where data_label = 'fictional_demo';
  delete from public.briefing_settings where id = 'fictional_demo';
  if to_regclass('public.ai_activity') is not null then
    delete from public.ai_activity where data_label = 'fictional_demo' and detail->>'seed' = 'briefing';
  end if;
  perform public.briefing_demo_seed();
  return jsonb_build_object('resetAt', now(), 'communications', (select count(*) from public.briefing_communications where data_label = 'fictional_demo'));
end $$;

revoke all on function public.claim_briefing_delivery(text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.briefing_demo_seed() from public, anon, authenticated;
revoke all on function public.reset_briefing_demo() from public, anon, authenticated;

-- First load: add the demo briefing data if there is none yet.
do $$
begin
  if not exists (select 1 from public.briefing_settings where id = 'fictional_demo') then
    perform public.briefing_demo_seed();
  end if;
end $$;
