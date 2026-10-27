-- Checks for the demo reset (supabase/migrations/20261027000001_demo_reset.sql and
-- supabase/demo-dataset.sql). Run against a database with the migrations and the demo
-- data loaded. Everything runs in one transaction and is rolled back at the end, so it
-- leaves no trace. Any failed check stops with an error.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/demo-reset.sql

begin;

-- A fingerprint of every demo record, without generated ids. Inside one transaction now()
-- doesn't move, so two resets must give exactly the same fingerprint.
create or replace function pg_temp.fingerprint() returns text
language plpgsql as $$
declare
  t text;
  v text;
  acc text := '';
begin
  foreach t in array array[
    'families', 'tutors', 'bookings', 'payments', 'tutor_availability', 'knowledge_articles', 'policy_versions',
    'requests', 'decisions', 'evidence_snapshots', 'request_events', 'drafts', 'lessons', 'payment_reminders',
    'tutor_absences', 'agent_sessions', 'agent_proposals', 'agent_workflows', 'rule_suggestions', 'audit_events',
    'ai_activity', 'course_offerings', 'tutor_courses', 'student_courses'
  ] loop
    execute format(
      'select coalesce(md5(string_agg(x::text, %L order by x::text)), %L) from (select (to_jsonb(r) - %L - %L - %L) as x from public.%I r) s',
      '|', 'empty', case when t in ('decisions', 'evidence_snapshots', 'request_events', 'drafts', 'payment_reminders', 'tutor_absences', 'agent_proposals', 'agent_workflows', 'rule_suggestions', 'audit_events', 'ai_activity', 'tutor_courses', 'student_courses') then 'id' else '-' end,
      'decision_id', 'draft_policy_version_id', t)
      into v;
    acc := acc || t || ':' || v || ' ';
  end loop;
  return acc;
end $$;

create temporary table t_state (k text primary key, v text);

-- 1. The demo starts in the right shape whatever day it is.
do $$
declare d date; dow int;
begin
  for i in 0..6 loop
    d := date '2026-10-26' + i; -- Monday 26 October 2026, then each day of that week
    dow := extract(isodow from d);
    if extract(isodow from public.demo_day('next_monday', 0, d)) <> 1 or public.demo_day('next_monday', 0, d) <= d or public.demo_day('next_monday', 0, d) > d + 7 then
      raise exception 'FAIL 1: next Monday is wrong for %', d;
    end if;
    if extract(isodow from public.demo_day('next_thursday', 0, d)) <> 4 or public.demo_day('next_thursday', 0, d) <= d or public.demo_day('next_thursday', 0, d) > d + 7 then
      raise exception 'FAIL 1: next Thursday is wrong for %', d;
    end if;
  end loop;
  raise notice 'PASS 1: next Monday and next Thursday are right for every day of the week';
end $$;

-- Non-demo records, to prove the reset never touches them.
insert into public.families (id, parent_name, student_name, data_label) values ('FAM-90', 'Live Parent', 'Live Student', 'live_connected');
insert into public.tutors (id, name, subjects, data_label) values ('T-90', 'Live Tutor', array['Maths'], 'live_connected');
insert into public.bookings (id, family_id, tutor_id, subject, lessons_purchased, lessons_used, price_cents, status, data_label)
values ('BK-9090', 'FAM-90', 'T-90', 'Year 10 Maths', 10, 1, 50000, 'active', 'live_connected');
insert into public.payments (id, booking_id, invoice_ref, amount_cents, status, due_date, data_label)
values ('PAY-9090', 'BK-9090', 'INV-990', 50000, 'pending', public.demo_today() + 10, 'live_connected');
insert into public.tutor_availability (id, tutor_id, starts_at, ends_at, status, data_label)
values ('SLOT-9090', 'T-90', now() + interval '3 days', now() + interval '3 days 1 hour', 'booked', 'live_connected');
insert into public.lessons (id, booking_id, tutor_id, slot_id, starts_at, ends_at, data_label)
select 'LSN-9090', 'BK-9090', 'T-90', 'SLOT-9090', starts_at, ends_at, 'live_connected' from public.tutor_availability where id = 'SLOT-9090';
insert into public.policy_versions (id, category, version, status, definition, source, data_label)
select '00000000-0000-4000-8000-000000009091', category, 90, 'archived', definition, 'owner', 'live_connected'
from public.policy_versions where id = '00000000-0000-4000-8000-000000000101';
insert into public.requests
select (jsonb_populate_record(null::public.requests, to_jsonb(r) || jsonb_build_object(
  'id', '00000000-0000-4000-8000-000000009090', 'data_label', 'live_connected', 'current_decision_id', null,
  'policy_version_id', '00000000-0000-4000-8000-000000009091', 'reference_id', 'BK-9090', 'booking_id', 'BK-9090'))).*
from public.requests r where id = '00000000-0000-4000-8000-000000000201';
insert into public.tutor_absences (tutor_id, starts_on, ends_on, note, data_label) values ('T-90', public.demo_today() + 20, public.demo_today() + 21, 'Live', 'live_connected');

create temporary table t_live as
select 'family' k, to_jsonb(f)::text v from public.families f where id = 'FAM-90'
union all select 'tutor', to_jsonb(t)::text from public.tutors t where id = 'T-90'
union all select 'booking', to_jsonb(b)::text from public.bookings b where id = 'BK-9090'
union all select 'payment', to_jsonb(p)::text from public.payments p where id = 'PAY-9090'
union all select 'slot', to_jsonb(s)::text from public.tutor_availability s where id = 'SLOT-9090'
union all select 'lesson', to_jsonb(l)::text from public.lessons l where id = 'LSN-9090'
union all select 'request', to_jsonb(r)::text from public.requests r where id = '00000000-0000-4000-8000-000000009090'
union all select 'absence', (to_jsonb(a) - 'id')::text from public.tutor_absences a where tutor_id = 'T-90'
union all select 'policy', to_jsonb(p)::text from public.policy_versions p where id = '00000000-0000-4000-8000-000000009091';

-- 2. A reset gives the original dataset, ready for the class demo script.
do $$
declare v jsonb; d date := public.demo_today();
begin
  v := public.reset_demo_data();
  if (v->>'lessons')::int <> 6 or (v->>'requests')::int < 7 then raise exception 'FAIL 2: unexpected counts %', v; end if;
  -- Lesson Change: BK-1042 has exactly one upcoming lesson, LSN-4001, next week's Thursday, holding its slot.
  if (select count(*) from public.lessons where booking_id = 'BK-1042' and status = 'scheduled' and starts_at > now()) <> 1
     or not exists (select 1 from public.lessons l join public.tutor_availability s on s.id = l.slot_id
                    where l.id = 'LSN-4001' and l.booking_id = 'BK-1042' and l.tutor_id = 'T-01' and s.status = 'booked'
                      and s.starts_at = l.starts_at and (l.starts_at at time zone 'Australia/Sydney')::date = public.demo_day('next_monday', 3)) then
    raise exception 'FAIL 2: LSN-4001 is not the one upcoming lesson on BK-1042';
  end if;
  -- Priya is free on Tuesday afternoon, at least a day away, for an hour.
  if (select count(*) from public.tutor_availability where tutor_id = 'T-01' and status = 'free' and starts_at > now() + interval '24 hours'
        and extract(isodow from starts_at at time zone 'Australia/Sydney') = 2
        and extract(hour from starts_at at time zone 'Australia/Sydney') between 12 and 16
        and ends_at - starts_at = interval '1 hour') < 2 then
    raise exception 'FAIL 2: no free Tuesday afternoon times for Priya';
  end if;
  -- Tutor Absence: Tom's only lesson on the next Thursday is LSN-4003, and Nadia is free then.
  if (select array_agg(id) from public.lessons where tutor_id = 'T-02' and (starts_at at time zone 'Australia/Sydney')::date = public.demo_day('next_thursday', 0)) <> array['LSN-4003']
     or not exists (select 1 from public.tutor_availability s join public.lessons l on l.id = 'LSN-4003'
                    where s.tutor_id = 'T-04' and s.status = 'free' and s.starts_at = l.starts_at and s.ends_at = l.ends_at) then
    raise exception 'FAIL 2: LSN-4003 or Nadia''s cover time is missing';
  end if;
  -- Payment Extension: INV-507 is unpaid and due in three days, with its reminders.
  if not exists (select 1 from public.payments where invoice_ref = 'INV-507' and status = 'pending' and due_date = d + 3)
     or (select count(*) from public.payment_reminders where payment_id = 'PAY-2008' and status = 'scheduled') <> 2 then
    raise exception 'FAIL 2: INV-507 is not in its starting state';
  end if;
  insert into t_state values ('first', pg_temp.fingerprint());
  raise notice 'PASS 2: the original dataset is ready for Lesson Change, Payment Extension and Tutor Absence';
end $$;

-- 3. Change everything the website can change, then reset.
do $$
declare
  v_admin uuid := (select id from public.app_users where role = 'admin' order by id limit 1);
  v_owner uuid := (select id from public.app_users where role = 'owner' order by id limit 1);
begin
  -- Timetable: Leo's lesson moved, Priya's Tuesday slot booked, Tom away, a slot removed.
  update public.tutor_availability set status = 'free' where id = 'SLOT-3002';
  update public.tutor_availability set status = 'booked' where id = 'SLOT-3001';
  update public.lessons l set slot_id = 'SLOT-3001', starts_at = s.starts_at, ends_at = s.ends_at, updated_by = v_admin
    from public.tutor_availability s where l.id = 'LSN-4001' and s.id = 'SLOT-3001';
  update public.lessons set tutor_id = 'T-04' where id = 'LSN-4003';
  insert into public.tutor_absences (tutor_id, starts_on, ends_on, note, created_by) values ('T-02', public.demo_day('next_thursday', 0), public.demo_day('next_thursday', 0), 'Unwell', v_admin);
  delete from public.tutor_availability where id = 'SLOT-3016';
  -- Payment extension: due date moved and reminders replaced.
  update public.payments set original_due_date = due_date, due_date = due_date + 14, updated_at = now() + interval '1 minute' where id = 'PAY-2008';
  update public.payment_reminders set status = 'cancelled', cancelled_at = now() where payment_id = 'PAY-2008';
  insert into public.payment_reminders (payment_id, remind_on, kind, created_by) values ('PAY-2008', public.demo_today() + 14, 'before_due', v_admin);
  -- Requests: statuses, owner decisions, archived and removed, a new request, its events and drafts.
  update public.requests set status = 'closed', archived_at = now(), archived_by = v_owner where id = '00000000-0000-4000-8000-000000000201';
  update public.requests set hidden_at = now(), hidden_by = v_admin where id = '00000000-0000-4000-8000-000000000202';
  update public.requests set status = 'approved' where id = '00000000-0000-4000-8000-000000000203';
  insert into public.requests
  select (jsonb_populate_record(null::public.requests, to_jsonb(r) || jsonb_build_object('id', '00000000-0000-4000-8000-000000000999', 'current_decision_id', null, 'created_by', v_admin))).*
  from public.requests r where id = '00000000-0000-4000-8000-000000000203';
  insert into public.request_events (request_id, event_type, actor_id, actor_role, note) values ('00000000-0000-4000-8000-000000000203', 'owner_approved', v_owner, 'owner', 'Approved in demo');
  insert into public.drafts (request_id, kind, body, generated_by, updated_by) values ('00000000-0000-4000-8000-000000000999', 'parent_response', 'Hello', 'edited', v_admin);
  -- Rules and procedures edited.
  update public.knowledge_articles set body = 'Edited in demo', version = version + 1 where id = 'KB-03';
  insert into public.policy_versions (category, version, status, definition, change_note, source, created_by)
  select category, version + 1, 'draft', definition, 'Demo edit', 'owner', v_owner from public.policy_versions where category = 'refund' and status = 'active';
  -- Subjects page.
  update public.course_offerings set offered = not offered where course_id = 'maths_advanced' and year_level = 12;
  delete from public.tutor_courses where tutor_id = 'T-01' and course_id = 'maths_standard';
  update public.bookings set lessons_used = lessons_used + 1 where id = 'BK-1042';
  -- Compass: a chat, a workflow run, a proposal and logs.
  insert into public.agent_sessions (session_key, user_id, state) values (gen_random_uuid(), v_admin, '{"focus":"x"}');
  insert into public.agent_workflows (workflow, created_by, status, stage, state) values ('lesson_change', v_admin, 'waiting', 'waiting_family', '{}');
  insert into public.agent_proposals (created_by, created_role, action_type, target_type, target_id, inputs, input_hash, preconditions, preview, required_role, expires_at)
  values (v_admin, 'admin', 'request.send_to_owner', 'request', '00000000-0000-4000-8000-000000000203', '{}', repeat('c', 64), '{}', '{}', 'staff', now() + interval '15 minutes');
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id) values (v_admin, 'admin', 'demo.test', 'request', 'x');
  insert into public.ai_activity (session_key, event_type, state, mode, summary) values (gen_random_uuid(), 'decision_completed', 'completed', 'simulated', 'Demo');

  if pg_temp.fingerprint() = (select v from t_state where k = 'first') then raise exception 'FAIL 3: the changes did not change the fingerprint'; end if;
  perform public.reset_demo_data();
  if pg_temp.fingerprint() <> (select v from t_state where k = 'first') then
    raise exception 'FAIL 3: reset did not restore the original dataset. Before: % After: %', (select v from t_state where k = 'first'), pg_temp.fingerprint();
  end if;
  if exists (select 1 from public.requests where id = '00000000-0000-4000-8000-000000000999') then raise exception 'FAIL 3: a request made in the demo survived'; end if;
  raise notice 'PASS 3: every demo change is undone by a reset';
end $$;

-- 4. Resetting again and again gives the same dataset.
do $$
begin
  for i in 1..3 loop
    perform public.reset_demo_data();
    if pg_temp.fingerprint() <> (select v from t_state where k = 'first') then raise exception 'FAIL 4: reset % differs', i; end if;
  end loop;
  raise notice 'PASS 4: repeated resets give the same dataset';
end $$;

-- 5. Records that aren't fictional demo data are never changed or removed.
do $$
declare n int;
begin
  select count(*) into n from t_live t where t.v <> coalesce((
    select case t.k
      when 'family' then (select to_jsonb(f)::text from public.families f where id = 'FAM-90')
      when 'tutor' then (select to_jsonb(x)::text from public.tutors x where id = 'T-90')
      when 'booking' then (select to_jsonb(b)::text from public.bookings b where id = 'BK-9090')
      when 'payment' then (select to_jsonb(p)::text from public.payments p where id = 'PAY-9090')
      when 'slot' then (select to_jsonb(s)::text from public.tutor_availability s where id = 'SLOT-9090')
      when 'lesson' then (select to_jsonb(l)::text from public.lessons l where id = 'LSN-9090')
      when 'request' then (select to_jsonb(r)::text from public.requests r where id = '00000000-0000-4000-8000-000000009090')
      when 'absence' then (select (to_jsonb(a) - 'id')::text from public.tutor_absences a where tutor_id = 'T-90')
      when 'policy' then (select to_jsonb(p)::text from public.policy_versions p where id = '00000000-0000-4000-8000-000000009091')
    end), 'missing');
  if n > 0 or (select count(*) from t_live) <> 9 then raise exception 'FAIL 5: % non-demo records changed', n; end if;
  raise notice 'PASS 5: non-demo records are untouched';
end $$;

-- 6. A real request that uses a demo rule stops the reset, and nothing changes.
do $$
declare before text := pg_temp.fingerprint();
begin
  update public.requests set policy_version_id = '00000000-0000-4000-8000-000000000101' where id = '00000000-0000-4000-8000-000000009090';
  update public.lessons set status = 'cancelled' where id = 'LSN-4002';
  begin
    perform public.reset_demo_data();
    raise exception 'FAIL 6: the reset ran';
  exception when others then
    if sqlerrm not like 'demo_reset_blocked%' then raise; end if;
  end;
  if (select status from public.lessons where id = 'LSN-4002') <> 'cancelled' then raise exception 'FAIL 6: a blocked reset changed data'; end if;
  update public.requests set policy_version_id = '00000000-0000-4000-8000-000000009091' where id = '00000000-0000-4000-8000-000000009090';
  perform public.reset_demo_data();
  raise notice 'PASS 6: a blocked reset changes nothing';
end $$;

-- 7. Only the server can reset.
do $$
begin
  if has_function_privilege('anon', 'public.reset_demo_data()', 'execute')
     or has_function_privilege('authenticated', 'public.reset_demo_data()', 'execute')
     or has_function_privilege('anon', 'public.demo_seed()', 'execute') then
    raise exception 'FAIL 7: a browser role can reset the demo';
  end if;
  raise notice 'PASS 7: only the server can reset the demo';
end $$;

rollback;
