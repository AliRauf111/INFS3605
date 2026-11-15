-- Demo reset: every full page load in demo mode starts from the same original demo data.
--
-- The original demo dataset is defined once, in public.demo_seed() (generated from the
-- seed files by `npm run demo:generate`, see supabase/demo-dataset.sql). The website
-- calls public.reset_demo_data() before it renders a page that was loaded or refreshed in
-- the browser. That throws away every change made to fictional demo records since the
-- last load (bookings, lessons, slots, requests, decisions, owner reviews, rules,
-- absences, payment extensions, reminders, Compass chats and workflow runs) and adds the
-- original records back, with dates worked out again from today in Sydney.
--
-- Only rows labelled 'fictional_demo' are ever removed. Rows labelled 'live_connected' or
-- 'imported' are never touched. Tables that had no label get one here, and as before
-- everything the app creates is labelled 'fictional_demo' unless it says otherwise.
-- Safe to run more than once.

-- Dates for the demo ----------------------------------------------------------------------
-- Today in Sydney. The workflows use the same day (src/lib/workflows/dates.ts).
create or replace function public.demo_today() returns date
language sql stable as $$
  select (now() at time zone 'Australia/Sydney')::date
$$;

-- A demo day, counted from an anchor so each demo lesson always lands on the weekday the
-- class demo script expects, whatever day the demo is run:
--   'today'          today in Sydney
--   'next_monday'    the Monday of next week (a week away when today is a Monday)
--   'next_thursday'  the next Thursday after today, which is what "Thursday" means in Compass
drop function if exists public.demo_day(text, integer);
create or replace function public.demo_day(p_anchor text, p_offset integer, p_today date default public.demo_today()) returns date
language sql stable as $$
  select case p_anchor
    when 'today' then p_today
    when 'next_monday' then p_today + (8 - extract(isodow from p_today)::integer)
    when 'next_thursday' then p_today + coalesce(nullif((4 - extract(dow from p_today)::integer + 7) % 7, 0), 7)
  end + p_offset
$$;

-- A Sydney wall-clock time on a demo day.
create or replace function public.demo_at(p_anchor text, p_offset integer, p_time time) returns timestamptz
language sql stable as $$
  select (public.demo_day(p_anchor, p_offset) + p_time) at time zone 'Australia/Sydney'
$$;

-- Labels on the tables that had none ------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'policy_versions', 'rule_suggestions', 'audit_events', 'ai_activity', 'course_offerings',
    'agent_sessions', 'agent_proposals', 'agent_workflows', 'payment_reminders', 'tutor_absences'
  ] loop
    execute format(
      'alter table public.%I add column if not exists data_label text not null default %L check (data_label in (%L, %L, %L))',
      t, 'fictional_demo', 'live_connected', 'imported', 'fictional_demo');
  end loop;
end $$;

-- Placeholder until supabase/demo-dataset.sql replaces it with the real dataset.
do $$
begin
  if to_regprocedure('public.demo_seed()') is null then
    execute $f$create function public.demo_seed() returns void language plpgsql as $b$
      begin raise exception 'demo_seed_missing: run supabase/demo-dataset.sql'; end $b$
    $f$;
  end if;
end $$;

-- The reset -------------------------------------------------------------------------------
-- Everything happens in one transaction, so a page never sees half-reset data: readers see
-- the old records until the new ones are committed. A lock makes two resets at the same
-- moment run one after the other.
create or replace function public.reset_demo_data() returns jsonb
language plpgsql as $$
declare
  v_kept jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('tutor_compass_demo_reset'));

  -- A real record that relies on a demo rule would lose it, so stop and change nothing.
  if exists (select 1 from public.requests r join public.policy_versions p on p.id = r.policy_version_id
             where r.data_label <> 'fictional_demo' and p.data_label = 'fictional_demo')
     or exists (select 1 from public.decisions d join public.policy_versions p on p.id = d.policy_version_id
                join public.requests r on r.id = d.request_id
                where r.data_label <> 'fictional_demo' and p.data_label = 'fictional_demo') then
    raise exception 'demo_reset_blocked: a request that is not demo data uses a demo rule version, so the demo was not reset';
  end if;

  -- Children first. Decisions, evidence, events, drafts and AI activity for a request go
  -- with the request; tutor and student courses go with their tutor or family.
  delete from public.agent_proposals where data_label = 'fictional_demo';
  delete from public.agent_workflows where data_label = 'fictional_demo';
  delete from public.agent_sessions where data_label = 'fictional_demo';
  delete from public.payment_reminders where data_label = 'fictional_demo';
  delete from public.tutor_absences where data_label = 'fictional_demo';
  delete from public.lessons where data_label = 'fictional_demo';
  delete from public.rule_suggestions where data_label = 'fictional_demo';
  delete from public.ai_activity where data_label = 'fictional_demo';
  delete from public.audit_events where data_label = 'fictional_demo';
  update public.requests set current_decision_id = null where data_label = 'fictional_demo' and current_decision_id is not null;
  delete from public.requests where data_label = 'fictional_demo';
  delete from public.policy_versions where data_label = 'fictional_demo';
  delete from public.knowledge_articles where data_label = 'fictional_demo';
  delete from public.payments where data_label = 'fictional_demo';
  delete from public.tutor_availability where data_label = 'fictional_demo';
  delete from public.bookings where data_label = 'fictional_demo';
  delete from public.families where data_label = 'fictional_demo';
  delete from public.tutors where data_label = 'fictional_demo';
  delete from public.course_offerings where data_label = 'fictional_demo';

  perform public.demo_seed();

  select jsonb_build_object(
    'requests', (select count(*) from public.requests where data_label <> 'fictional_demo'),
    'bookings', (select count(*) from public.bookings where data_label <> 'fictional_demo'),
    'lessons', (select count(*) from public.lessons where data_label <> 'fictional_demo')
  ) into v_kept;

  return jsonb_build_object(
    'resetAt', now(),
    'today', public.demo_today(),
    'lessons', (select count(*) from public.lessons where data_label = 'fictional_demo'),
    'requests', (select count(*) from public.requests where data_label = 'fictional_demo'),
    'keptNonDemo', v_kept
  );
end $$;

-- Only the server (secret key) can reset or reseed.
revoke all on function public.reset_demo_data() from public, anon, authenticated;
revoke all on function public.demo_seed() from public, anon, authenticated;
revoke all on function public.demo_today() from public, anon, authenticated;
revoke all on function public.demo_day(text, integer, date) from public, anon, authenticated;
revoke all on function public.demo_at(text, integer, time) from public, anon, authenticated;
