-- Checks for the Compass workflows (supabase/migrations/20261021000001_compass_workflows.sql):
-- booking.reschedule, invoice.extend_due_date and tutor.record_absence. Run against a
-- database with the migrations, the demo data and supabase/demo-workflows.sql loaded.
-- Everything runs in one transaction and is rolled back at the end, so it leaves no trace.
-- Any failed check stops with an error.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/compass-workflows.sql

begin;

create temporary table t_ids (k text primary key, v uuid);
insert into t_ids values
  ('admin', (select id from public.app_users where role = 'admin' order by id limit 1)),
  ('owner', (select id from public.app_users where role = 'owner' order by id limit 1)),
  ('lesson_req', (select id from public.requests where request_type = 'lesson_change' order by created_at limit 1)),
  ('pay_req', (select id from public.requests where request_type = 'payment_extension' order by created_at limit 1));

create or replace function pg_temp.k(p text) returns uuid language sql as $$ select v from t_ids where k = p $$;

do $$
begin
  if pg_temp.k('lesson_req') is null or pg_temp.k('pay_req') is null
     or not exists (select 1 from public.lessons where id = 'LSN-4001')
     or not exists (select 1 from public.payments where id = 'PAY-2008') then
    raise exception 'SETUP: load the demo data and supabase/demo-workflows.sql first';
  end if;
end $$;

-- Turn the sample requests into the ones each check needs. Rolled back at the end.
create or replace function pg_temp.set_request(p_id uuid, p_status text, p_booking text, p_facts jsonb) returns void
language sql as $$
  update public.requests set status = p_status, booking_id = p_booking, confirmed_facts = coalesce(confirmed_facts, '{}'::jsonb) || p_facts, updated_at = now()
   where id = p_id;
$$;

-- A pending proposal with preconditions that match the records as they are now.
create or replace function pg_temp.propose(p_by uuid, p_action text, p_target uuid, p_inputs jsonb) returns uuid
language plpgsql as $$
declare v_id uuid; r public.requests; l public.lessons; s public.tutor_availability; pay public.payments; v_pre jsonb; v_overlaps int;
begin
  if p_action = 'tutor.record_absence' then
    select count(*) into v_overlaps from public.tutor_absences
     where tutor_id = p_inputs->>'tutorId' and status = 'recorded'
       and starts_on <= (p_inputs->>'endsOn')::date and ends_on >= (p_inputs->>'startsOn')::date;
    v_pre := jsonb_build_object('workflow', jsonb_build_object('absenceOverlaps', v_overlaps));
    insert into public.agent_proposals (created_by, created_role, action_type, target_type, target_id, inputs, input_hash, preconditions, preview, required_role, expires_at)
    values (p_by, public.actor_role(p_by), p_action, 'tutor', null, p_inputs, repeat('b', 64), v_pre, '{}'::jsonb, 'staff', now() + interval '15 minutes')
    returning id into v_id;
    return v_id;
  end if;
  select * into r from public.requests where id = p_target;
  v_pre := jsonb_build_object('status', r.status, 'currentDecisionId', r.current_decision_id, 'updatedAt', r.updated_at, 'archivedAt', null, 'hiddenAt', null);
  if p_action = 'booking.reschedule' then
    select * into l from public.lessons where id = p_inputs->>'lessonId';
    select * into s from public.tutor_availability where id = p_inputs->>'newSlotId';
    v_pre := v_pre || jsonb_build_object('workflow', jsonb_build_object('lessonUpdatedAt', l.updated_at, 'slotStartsAt', s.starts_at, 'slotStatus', s.status));
  elsif p_action = 'invoice.extend_due_date' then
    select * into pay from public.payments where id = p_inputs->>'paymentId';
    v_pre := v_pre || jsonb_build_object('workflow', jsonb_build_object('dueDate', pay.due_date, 'paymentStatus', pay.status, 'paymentUpdatedAt', pay.updated_at));
  end if;
  insert into public.agent_proposals (created_by, created_role, action_type, target_type, target_id, inputs, input_hash, preconditions, preview, required_role, expires_at)
  values (p_by, public.actor_role(p_by), p_action, 'request', p_target, p_inputs, repeat('a', 64), v_pre, '{}'::jsonb, 'staff', now() + interval '15 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- 1. A lesson can't move until the rules or the owner have cleared the request.
do $$
declare v_id uuid; v_res jsonb; v_before timestamptz := (select starts_at from public.lessons where id = 'LSN-4001');
begin
  perform pg_temp.set_request(pg_temp.k('lesson_req'), 'awaiting_owner', 'BK-1042', jsonb_build_object('proposedSlotId', 'SLOT-3001'));
  v_id := pg_temp.propose(pg_temp.k('admin'), 'booking.reschedule', pg_temp.k('lesson_req'), jsonb_build_object('lessonId', 'LSN-4001', 'newSlotId', 'SLOT-3001'));
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if v_res->>'code' <> 'failed' or v_res->>'error' not like 'invalid_transition:%' then raise exception 'FAIL 1: expected invalid_transition, got %', v_res; end if;
  if (select starts_at from public.lessons where id = 'LSN-4001') <> v_before then raise exception 'FAIL 1: lesson moved'; end if;
  if (select status from public.tutor_availability where id = 'SLOT-3001') <> 'free' then raise exception 'FAIL 1: slot booked'; end if;
  raise notice 'PASS 1: no move while the request waits for the owner';
end $$;

-- 2. Only the person who prepared the move can confirm it.
do $$
declare v_id uuid; v_failed boolean := false;
begin
  perform pg_temp.set_request(pg_temp.k('lesson_req'), 'ready', 'BK-1042', jsonb_build_object('proposedSlotId', 'SLOT-3001'));
  v_id := pg_temp.propose(pg_temp.k('admin'), 'booking.reschedule', pg_temp.k('lesson_req'), jsonb_build_object('lessonId', 'LSN-4001', 'newSlotId', 'SLOT-3001'));
  begin
    perform public.execute_agent_proposal(v_id, pg_temp.k('owner'), '{}'::jsonb);
  exception when others then v_failed := sqlerrm like 'forbidden:%';
  end;
  if not v_failed then raise exception 'FAIL 2: someone else confirmed the move'; end if;
  update public.agent_proposals set status = 'cancelled' where id = v_id;
  raise notice 'PASS 2: only the preparer can confirm a move';
end $$;

-- 3. A change to the lesson after the preview makes it stale, and nothing moves.
do $$
declare v_id uuid; v_res jsonb;
begin
  v_id := pg_temp.propose(pg_temp.k('admin'), 'booking.reschedule', pg_temp.k('lesson_req'), jsonb_build_object('lessonId', 'LSN-4001', 'newSlotId', 'SLOT-3001'));
  update public.lessons set updated_at = now() + interval '1 second' where id = 'LSN-4001';
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if v_res->>'code' <> 'stale' or not (v_res->'changed' ? 'lesson') then raise exception 'FAIL 3: expected stale lesson, got %', v_res; end if;
  if (select slot_id from public.lessons where id = 'LSN-4001') <> 'SLOT-3002' then raise exception 'FAIL 3: lesson moved'; end if;
  raise notice 'PASS 3: a changed lesson makes the preview stale';
end $$;

-- 4. A time that isn't on the request is refused.
do $$
declare v_id uuid; v_res jsonb;
begin
  perform pg_temp.set_request(pg_temp.k('lesson_req'), 'ready', 'BK-1042', jsonb_build_object('proposedSlotId', 'SLOT-3001'));
  v_id := pg_temp.propose(pg_temp.k('admin'), 'booking.reschedule', pg_temp.k('lesson_req'), jsonb_build_object('lessonId', 'LSN-4001', 'newSlotId', 'SLOT-3017'));
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if v_res->>'code' <> 'failed' or v_res->>'error' not like 'invalid_input:%' then raise exception 'FAIL 4: expected invalid_input, got %', v_res; end if;
  raise notice 'PASS 4: only the time on the request can be booked';
end $$;

-- 5. A cover tutor needs the owner's approval, even when the request is Ready.
do $$
declare v_id uuid; v_res jsonb;
begin
  perform pg_temp.set_request(pg_temp.k('lesson_req'), 'ready', 'BK-1043', jsonb_build_object('proposedSlotId', 'SLOT-3011'));
  v_id := pg_temp.propose(pg_temp.k('admin'), 'booking.reschedule', pg_temp.k('lesson_req'), jsonb_build_object('lessonId', 'LSN-4003', 'newSlotId', 'SLOT-3011'));
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if v_res->>'code' <> 'failed' or v_res->>'error' not like 'forbidden:%' then raise exception 'FAIL 5: expected forbidden, got %', v_res; end if;
  if (select tutor_id from public.lessons where id = 'LSN-4003') <> 'T-02' then raise exception 'FAIL 5: tutor changed'; end if;
  raise notice 'PASS 5: a cover tutor without owner approval is refused';
end $$;

-- 6. With owner approval the cover goes ahead: lesson, slots, request, history and audit all change together.
do $$
declare v_id uuid; v_res jsonb; v_again jsonb;
begin
  perform pg_temp.set_request(pg_temp.k('lesson_req'), 'approved', 'BK-1043', jsonb_build_object('proposedSlotId', 'SLOT-3011'));
  v_id := pg_temp.propose(pg_temp.k('admin'), 'booking.reschedule', pg_temp.k('lesson_req'), jsonb_build_object('lessonId', 'LSN-4003', 'newSlotId', 'SLOT-3011'));
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if (v_res->>'ok')::boolean is not true then raise exception 'FAIL 6: %', v_res; end if;
  if (select tutor_id || ' ' || slot_id from public.lessons where id = 'LSN-4003') <> 'T-04 SLOT-3011' then raise exception 'FAIL 6: lesson not moved'; end if;
  if (select status from public.tutor_availability where id = 'SLOT-3011') <> 'booked' then raise exception 'FAIL 6: new slot not booked'; end if;
  if (select status from public.tutor_availability where id = 'SLOT-3007') <> 'free' then raise exception 'FAIL 6: old slot not freed'; end if;
  if (select status from public.requests where id = pg_temp.k('lesson_req')) <> 'closed' then raise exception 'FAIL 6: request not closed'; end if;
  if not exists (select 1 from public.request_events where request_id = pg_temp.k('lesson_req') and to_status = 'closed' and note like '%No message was sent%') then raise exception 'FAIL 6: no history note'; end if;
  if not exists (select 1 from public.audit_events where action = 'lesson.reschedule' and entity_id = 'LSN-4003') then raise exception 'FAIL 6: no lesson audit'; end if;
  if not exists (select 1 from public.audit_events where action = 'agent.booking.reschedule' and entity_id = v_id::text) then raise exception 'FAIL 6: no proposal audit'; end if;
  v_again := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if (v_again->>'duplicate')::boolean is not true then raise exception 'FAIL 6: second confirm ran again: %', v_again; end if;
  raise notice 'PASS 6: an approved cover is applied once and read back';
end $$;

-- 7. A due date moves only by the extra days on the request, and the reminders are replaced.
do $$
declare v_id uuid; v_res jsonb; v_due date := (select due_date from public.payments where id = 'PAY-2008');
begin
  perform pg_temp.set_request(pg_temp.k('pay_req'), 'ready', 'BK-1045', jsonb_build_object('extensionDays', 7));
  v_id := pg_temp.propose(pg_temp.k('admin'), 'invoice.extend_due_date', pg_temp.k('pay_req'),
    jsonb_build_object('paymentId', 'PAY-2008', 'extensionDays', 14, 'newDueDate', v_due + 14, 'reminders', '[]'::jsonb));
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if v_res->>'code' <> 'failed' or v_res->>'error' not like 'invalid_input:%' then raise exception 'FAIL 7: wrong days accepted: %', v_res; end if;
  v_id := pg_temp.propose(pg_temp.k('admin'), 'invoice.extend_due_date', pg_temp.k('pay_req'),
    jsonb_build_object('paymentId', 'PAY-2008', 'extensionDays', 7, 'newDueDate', v_due + 7,
      'reminders', jsonb_build_array(jsonb_build_object('date', v_due + 4, 'kind', 'before_due'), jsonb_build_object('date', v_due + 7, 'kind', 'due_today'), jsonb_build_object('date', v_due + 10, 'kind', 'overdue'))));
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if (v_res->>'ok')::boolean is not true then raise exception 'FAIL 7: %', v_res; end if;
  if (select due_date from public.payments where id = 'PAY-2008') <> v_due + 7 then raise exception 'FAIL 7: due date not moved'; end if;
  if (select original_due_date from public.payments where id = 'PAY-2008') <> v_due then raise exception 'FAIL 7: original due date lost'; end if;
  if (select count(*) from public.payment_reminders where payment_id = 'PAY-2008' and status = 'scheduled') <> 3 then raise exception 'FAIL 7: reminders not replaced'; end if;
  if exists (select 1 from public.payment_reminders where payment_id = 'PAY-2008' and status = 'scheduled' and delivery <> 'not_connected') then raise exception 'FAIL 7: a reminder claims delivery'; end if;
  if (select status from public.requests where id = pg_temp.k('pay_req')) <> 'closed' then raise exception 'FAIL 7: request not closed'; end if;
  raise notice 'PASS 7: due date and reminder schedule changed together';
end $$;

-- 8. An invoice changed since the preview makes it stale.
do $$
declare v_id uuid; v_res jsonb; v_due date := (select due_date from public.payments where id = 'PAY-2004');
begin
  perform pg_temp.set_request(pg_temp.k('pay_req'), 'approved', (select booking_id from public.payments where id = 'PAY-2004'), jsonb_build_object('extensionDays', 7));
  v_id := pg_temp.propose(pg_temp.k('admin'), 'invoice.extend_due_date', pg_temp.k('pay_req'),
    jsonb_build_object('paymentId', 'PAY-2004', 'extensionDays', 7, 'newDueDate', v_due + 7, 'reminders', '[]'::jsonb));
  update public.payments set updated_at = now() + interval '1 second' where id = 'PAY-2004';
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if v_res->>'code' <> 'stale' or not (v_res->'changed' ? 'invoice') then raise exception 'FAIL 8: expected stale invoice, got %', v_res; end if;
  raise notice 'PASS 8: a changed invoice makes the preview stale';
end $$;

-- 9. Absences: recorded once, overlaps refused, and a new overlap since the preview is stale.
do $$
declare v_a uuid; v_b uuid; v_res jsonb;
begin
  v_a := pg_temp.propose(pg_temp.k('admin'), 'tutor.record_absence', null, jsonb_build_object('tutorId', 'T-05', 'startsOn', current_date + 40, 'endsOn', current_date + 41, 'note', 'Test'));
  v_b := pg_temp.propose(pg_temp.k('owner'), 'tutor.record_absence', null, jsonb_build_object('tutorId', 'T-05', 'startsOn', current_date + 41, 'endsOn', current_date + 42, 'note', 'Test'));
  v_res := public.execute_agent_proposal(v_a, pg_temp.k('admin'), '{}'::jsonb);
  if (v_res->>'ok')::boolean is not true or v_res->'result'->>'absenceId' is null then raise exception 'FAIL 9: %', v_res; end if;
  if not exists (select 1 from public.audit_events where action = 'tutor.record_absence' and detail->>'tutor' = 'T-05') then raise exception 'FAIL 9: no audit'; end if;
  v_res := public.execute_agent_proposal(v_b, pg_temp.k('owner'), '{}'::jsonb);
  if v_res->>'code' <> 'stale' then raise exception 'FAIL 9: overlap since preview not stale: %', v_res; end if;
  v_b := pg_temp.propose(pg_temp.k('owner'), 'tutor.record_absence', null, jsonb_build_object('tutorId', 'T-05', 'startsOn', current_date + 41, 'endsOn', current_date + 42, 'note', 'Test'));
  v_res := public.execute_agent_proposal(v_b, pg_temp.k('owner'), '{}'::jsonb);
  if v_res->>'code' <> 'failed' or v_res->>'error' not like 'invalid_input:%' then raise exception 'FAIL 9: overlap accepted: %', v_res; end if;
  if (select count(*) from public.tutor_absences where tutor_id = 'T-05' and status = 'recorded' and starts_on >= current_date + 40) <> 1 then raise exception 'FAIL 9: wrong number of absences'; end if;
  raise notice 'PASS 9: absences are recorded once and never overlap';
end $$;

-- 10. A slot taken by another lesson can never be double booked, and a tutor away can't be booked.
do $$
declare v_id uuid; v_res jsonb;
begin
  insert into public.tutor_absences (tutor_id, starts_on, ends_on, note, created_by)
  values ('T-01', (select (starts_at at time zone 'Australia/Sydney')::date from public.tutor_availability where id = 'SLOT-3017'),
          (select (starts_at at time zone 'Australia/Sydney')::date from public.tutor_availability where id = 'SLOT-3017'), 'Test', pg_temp.k('admin'));
  perform pg_temp.set_request(pg_temp.k('lesson_req'), 'ready', 'BK-1046', jsonb_build_object('proposedSlotId', 'SLOT-3017'));
  v_id := pg_temp.propose(pg_temp.k('admin'), 'booking.reschedule', pg_temp.k('lesson_req'), jsonb_build_object('lessonId', 'LSN-4006', 'newSlotId', 'SLOT-3017'));
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if v_res->>'code' <> 'failed' or v_res->>'error' not like '%away%' then raise exception 'FAIL 10: tutor away was booked: %', v_res; end if;
  if (select status from public.tutor_availability where id = 'SLOT-3017') <> 'free' then raise exception 'FAIL 10: slot changed'; end if;
  raise notice 'PASS 10: a tutor recorded as away is never booked';
end $$;

-- 11. Only the server can call the workflow functions.
do $$
begin
  if has_function_privilege('anon', 'public.apply_lesson_change(uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.apply_invoice_extension(uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.record_tutor_absence(uuid, jsonb)', 'execute') then
    raise exception 'FAIL 11: a browser role can call a workflow function';
  end if;
  raise notice 'PASS 11: workflow functions are server only';
end $$;

rollback;
