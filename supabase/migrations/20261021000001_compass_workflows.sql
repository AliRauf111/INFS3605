-- Compass workflows: Lesson Change, Payment Extension and Tutor Absence.
--
-- Each workflow ends in a real, checked change to Tutor Compass's own records, never a
-- message to a family or tutor and never a payment:
--   * booking.reschedule      moves one scheduled lesson to a free slot (same tutor, or an
--                             owner-approved cover tutor) and closes the linked request.
--   * invoice.extend_due_date moves an unpaid invoice's due date, replaces its reminder
--                             schedule (recorded only: nothing is sent) and closes the
--                             linked request.
--   * tutor.record_absence    records when a tutor is unavailable, so their slots are no
--                             longer offered.
-- The first two need a saved request that the owner's rules made Ready for Admin, or that
-- the owner approved. Every change still goes through agent_proposals and
-- execute_agent_proposal: the person confirms the exact preview, and the database checks
-- role, status and the records again under a lock before anything changes.
-- Safe to run more than once. It adds tables and columns and changes no existing data.

-- Scheduled lessons ----------------------------------------------------------------
-- One row per lesson on a booking. A scheduled lesson holds its tutor's slot.
create table if not exists public.lessons (
  id text primary key check (id ~ '^LSN-[0-9]{3,8}$'),
  booking_id text not null references public.bookings (id),
  tutor_id text not null references public.tutors (id),
  slot_id text references public.tutor_availability (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  data_label text not null default 'fictional_demo'
    check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id),
  check (ends_at > starts_at)
);
create index if not exists lessons_booking_idx on public.lessons (booking_id, starts_at);
create index if not exists lessons_tutor_idx on public.lessons (tutor_id, starts_at);
-- A slot can hold only one scheduled lesson.
create unique index if not exists lessons_one_per_slot on public.lessons (slot_id) where slot_id is not null and status = 'scheduled';

-- Invoices ---------------------------------------------------------------------------
-- When the invoice last changed in Tutor Compass, and the due date it started with.
alter table public.payments
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists original_due_date date;

-- Reminder schedule for an unpaid invoice. Tutor Compass records the schedule only. It is
-- not connected to email or SMS, so nothing here is ever sent.
create table if not exists public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  payment_id text not null references public.payments (id),
  remind_on date not null,
  kind text not null check (kind in ('before_due', 'due_today', 'overdue')),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  delivery text not null default 'not_connected' check (delivery in ('not_connected')),
  created_by uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index if not exists payment_reminders_payment_idx on public.payment_reminders (payment_id, remind_on);

-- Tutor absences ----------------------------------------------------------------------
create table if not exists public.tutor_absences (
  id uuid primary key default gen_random_uuid(),
  tutor_id text not null references public.tutors (id),
  starts_on date not null,
  ends_on date not null,
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'recorded' check (status in ('recorded', 'cancelled')),
  created_by uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 60)
);
create index if not exists tutor_absences_tutor_idx on public.tutor_absences (tutor_id, starts_on);

-- Is this tutor recorded as away at this moment (Sydney date)?
create or replace function public.tutor_is_absent(p_tutor text, p_at timestamptz) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.tutor_absences a
    where a.tutor_id = p_tutor and a.status = 'recorded'
      and (p_at at time zone 'Australia/Sydney')::date between a.starts_on and a.ends_on
  )
$$;

-- Compass workflow runs ----------------------------------------------------------------
-- Where a Lesson Change, Payment Extension or Tutor Absence workflow is up to, so it can
-- be continued from any chat and listed under What Needs My Attention. The records and
-- the request stay the source of truth; this only remembers the person's choices.
create table if not exists public.agent_workflows (
  id uuid primary key default gen_random_uuid(),
  workflow text not null check (workflow in ('lesson_change', 'payment_extension', 'tutor_absence')),
  created_by uuid not null references public.app_users (id) on delete cascade,
  session_key uuid,
  status text not null default 'active' check (status in ('active', 'waiting', 'completed', 'cancelled')),
  stage text not null default 'start' check (char_length(stage) <= 60),
  summary text not null default '' check (char_length(summary) <= 300),
  state jsonb not null default '{}'::jsonb,
  request_id uuid references public.requests (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_workflows_user_idx on public.agent_workflows (created_by, status, updated_at desc);

-- Proposals: the three new actions -------------------------------------------------------
alter table public.agent_proposals drop constraint if exists agent_proposals_action_type_check;
alter table public.agent_proposals add constraint agent_proposals_action_type_check check (action_type in (
  'request.create', 'request.send_to_owner', 'request.approve', 'request.decline',
  'request.request_info', 'request.record_outcome', 'draft.save',
  'booking.reschedule', 'invoice.extend_due_date', 'tutor.record_absence'
));
alter table public.agent_proposals drop constraint if exists agent_proposals_target_type_check;
alter table public.agent_proposals add constraint agent_proposals_target_type_check
  check (target_type in ('request', 'new_request', 'tutor'));

-- Move a lesson for a request the rules or the owner have cleared. Called only from
-- execute_agent_proposal, inside its transaction.
create or replace function public.apply_lesson_change(p_request_id uuid, p_actor uuid, p_inputs jsonb) returns jsonb
language plpgsql as $$
declare
  v_role text := public.actor_role(p_actor);
  v_req record;
  v_lesson public.lessons;
  v_slot public.tutor_availability;
  v_booking public.bookings;
  v_old_tutor text;
  v_new_tutor text;
  v_fmt constant text := 'Dy FMDD Mon FMHH12:MI am';
  v_note text;
begin
  if v_role is null then raise exception 'forbidden: unknown user'; end if;
  select id, request_type, status, booking_id, confirmed_facts into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'not_found: request not found'; end if;
  if v_req.request_type <> 'lesson_change' then raise exception 'invalid_input: this request is not a lesson change'; end if;
  if v_req.status not in ('ready', 'approved') then
    raise exception 'invalid_transition: the lesson can only be moved once the rules allow it or the owner approves (the request is %)', v_req.status;
  end if;
  if v_req.confirmed_facts->>'proposedSlotId' is distinct from p_inputs->>'newSlotId' then
    raise exception 'invalid_input: the new time is not the one on the request';
  end if;

  select * into v_lesson from public.lessons where id = p_inputs->>'lessonId' for update;
  if not found then raise exception 'not_found: lesson not found'; end if;
  if v_lesson.booking_id is distinct from v_req.booking_id then raise exception 'invalid_input: the lesson is not on this booking'; end if;
  if v_lesson.status <> 'scheduled' then raise exception 'invalid_transition: the lesson is %', v_lesson.status; end if;

  select * into v_slot from public.tutor_availability where id = p_inputs->>'newSlotId' for update;
  if not found then raise exception 'not_found: time slot not found'; end if;
  if v_slot.status <> 'free' then raise exception 'stale_update: that time is no longer free'; end if;
  if v_slot.starts_at <= now() then raise exception 'invalid_input: that time has already passed'; end if;
  if public.tutor_is_absent(v_slot.tutor_id, v_slot.starts_at) then raise exception 'invalid_input: the tutor is recorded as away at that time'; end if;

  select * into v_booking from public.bookings where id = v_lesson.booking_id;
  -- A different tutor is a cover arrangement. The rules never make that routine, so only an owner approval allows it.
  if v_slot.tutor_id <> v_booking.tutor_id and v_req.status <> 'approved' then
    raise exception 'forbidden: a different tutor needs the owner''s approval';
  end if;
  if exists (
    select 1 from public.lessons l join public.bookings b on b.id = l.booking_id
    where b.family_id = v_booking.family_id and l.status = 'scheduled' and l.id <> v_lesson.id
      and l.starts_at < v_slot.ends_at and l.ends_at > v_slot.starts_at
  ) then
    raise exception 'invalid_input: the family already has a lesson at that time';
  end if;

  v_old_tutor := (select name from public.tutors where id = v_lesson.tutor_id);
  v_new_tutor := (select name from public.tutors where id = v_slot.tutor_id);

  update public.tutor_availability set status = 'booked' where id = v_slot.id and status = 'free';
  if not found then raise exception 'stale_update: that time is no longer free'; end if;
  if v_lesson.slot_id is not null then
    update public.tutor_availability set status = 'free' where id = v_lesson.slot_id;
  end if;
  update public.lessons
     set tutor_id = v_slot.tutor_id, slot_id = v_slot.id, starts_at = v_slot.starts_at, ends_at = v_slot.ends_at,
         updated_at = now(), updated_by = p_actor
   where id = v_lesson.id;

  v_note := format('Lesson %s moved in Tutor Compass from %s with %s to %s with %s.%s No message was sent to the family or tutor.',
    v_lesson.id,
    to_char(v_lesson.starts_at at time zone 'Australia/Sydney', v_fmt), v_old_tutor,
    to_char(v_slot.starts_at at time zone 'Australia/Sydney', v_fmt), v_new_tutor,
    case when coalesce(p_inputs->>'agreement', '') <> '' then ' ' || (p_inputs->>'agreement') else '' end);

  update public.requests set status = 'closed', updated_at = now() where id = p_request_id;
  insert into public.request_events (request_id, event_type, actor_id, actor_role, from_status, to_status, note)
  values (p_request_id, 'closed', p_actor, v_role, v_req.status, 'closed', left(v_note, 4000));
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (p_actor, v_role, 'lesson.reschedule', 'lesson', v_lesson.id,
          jsonb_build_object('request', p_request_id, 'from_slot', v_lesson.slot_id, 'to_slot', v_slot.id,
                             'from_tutor', v_lesson.tutor_id, 'to_tutor', v_slot.tutor_id,
                             'from', v_lesson.starts_at, 'to', v_slot.starts_at));

  return jsonb_build_object('id', p_request_id, 'status', 'closed', 'lessonId', v_lesson.id,
    'before', jsonb_build_object('slotId', v_lesson.slot_id, 'tutorId', v_lesson.tutor_id, 'startsAt', v_lesson.starts_at),
    'after', jsonb_build_object('slotId', v_slot.id, 'tutorId', v_slot.tutor_id, 'startsAt', v_slot.starts_at));
end $$;

-- Give an unpaid invoice more time and replace its reminder schedule.
create or replace function public.apply_invoice_extension(p_request_id uuid, p_actor uuid, p_inputs jsonb) returns jsonb
language plpgsql as $$
declare
  v_role text := public.actor_role(p_actor);
  v_req record;
  v_pay public.payments;
  v_days integer := (p_inputs->>'extensionDays')::integer;
  v_new date := (p_inputs->>'newDueDate')::date;
  v_status text;
  v_rem jsonb;
  v_count integer := 0;
begin
  if v_role is null then raise exception 'forbidden: unknown user'; end if;
  select id, request_type, status, booking_id, confirmed_facts into v_req from public.requests where id = p_request_id for update;
  if not found then raise exception 'not_found: request not found'; end if;
  if v_req.request_type <> 'payment_extension' then raise exception 'invalid_input: this request is not a payment extension'; end if;
  if v_req.status not in ('ready', 'approved') then
    raise exception 'invalid_transition: the due date can only change once the rules allow it or the owner approves (the request is %)', v_req.status;
  end if;
  if (v_req.confirmed_facts->>'extensionDays')::integer is distinct from v_days then
    raise exception 'invalid_input: the extra days are not the ones on the request';
  end if;

  select * into v_pay from public.payments where id = p_inputs->>'paymentId' for update;
  if not found then raise exception 'not_found: invoice not found'; end if;
  if v_pay.booking_id is distinct from v_req.booking_id then raise exception 'invalid_input: the invoice is not on this booking'; end if;
  if v_pay.status not in ('pending', 'overdue') then raise exception 'invalid_transition: the invoice is %', v_pay.status; end if;
  if v_pay.due_date is null then raise exception 'invalid_input: the invoice has no due date'; end if;
  if v_new is distinct from v_pay.due_date + v_days then raise exception 'invalid_input: the new due date does not match the extra days'; end if;

  v_status := case when v_new >= current_date then 'pending' else v_pay.status end;
  update public.payments
     set original_due_date = coalesce(original_due_date, due_date), due_date = v_new, status = v_status, updated_at = now()
   where id = v_pay.id;

  update public.payment_reminders set status = 'cancelled', cancelled_at = now()
   where payment_id = v_pay.id and status = 'scheduled';
  for v_rem in select * from jsonb_array_elements(coalesce(p_inputs->'reminders', '[]'::jsonb)) loop
    if (v_rem->>'date')::date not between v_new - 7 and v_new + 14 then
      raise exception 'invalid_input: a reminder date is too far from the new due date';
    end if;
    insert into public.payment_reminders (payment_id, remind_on, kind, created_by)
    values (v_pay.id, (v_rem->>'date')::date, v_rem->>'kind', p_actor);
    v_count := v_count + 1;
  end loop;

  update public.requests set status = 'closed', updated_at = now() where id = p_request_id;
  insert into public.request_events (request_id, event_type, actor_id, actor_role, from_status, to_status, note)
  values (p_request_id, 'closed', p_actor, v_role, v_req.status, 'closed',
          format('Invoice %s (%s) due date moved in Tutor Compass from %s to %s, %s extra days. %s reminders scheduled in Tutor Compass only. Nothing was sent to the family.',
                 v_pay.invoice_ref, v_pay.id, to_char(v_pay.due_date, 'FMDD Mon YYYY'), to_char(v_new, 'FMDD Mon YYYY'), v_days, v_count));
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (p_actor, v_role, 'invoice.extend_due_date', 'payment', v_pay.id,
          jsonb_build_object('request', p_request_id, 'from', v_pay.due_date, 'to', v_new, 'days', v_days, 'reminders', v_count));

  return jsonb_build_object('id', p_request_id, 'status', 'closed', 'paymentId', v_pay.id,
    'before', jsonb_build_object('dueDate', v_pay.due_date, 'status', v_pay.status),
    'after', jsonb_build_object('dueDate', v_new, 'status', v_status), 'reminders', v_count);
end $$;

-- Record that a tutor is unavailable. It changes no lesson by itself.
create or replace function public.record_tutor_absence(p_actor uuid, p_inputs jsonb) returns jsonb
language plpgsql as $$
declare
  v_role text := public.actor_role(p_actor);
  v_start date := (p_inputs->>'startsOn')::date;
  v_end date := (p_inputs->>'endsOn')::date;
  v_id uuid;
begin
  if v_role is null then raise exception 'forbidden: unknown user'; end if;
  if not exists (select 1 from public.tutors where id = p_inputs->>'tutorId') then raise exception 'not_found: tutor not found'; end if;
  if v_start is null or v_end is null or v_end < v_start then raise exception 'invalid_input: check the dates'; end if;
  if v_end - v_start > 60 then raise exception 'invalid_input: record absences of up to 60 days at a time'; end if;
  if exists (select 1 from public.tutor_absences where tutor_id = p_inputs->>'tutorId' and status = 'recorded'
             and starts_on <= v_end and ends_on >= v_start) then
    raise exception 'invalid_input: an absence is already recorded for some of these dates';
  end if;
  insert into public.tutor_absences (tutor_id, starts_on, ends_on, note, created_by)
  values (p_inputs->>'tutorId', v_start, v_end, left(coalesce(p_inputs->>'note', ''), 500), p_actor)
  returning id into v_id;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (p_actor, v_role, 'tutor.record_absence', 'tutor_absence', v_id::text,
          jsonb_build_object('tutor', p_inputs->>'tutorId', 'from', v_start, 'to', v_end));
  return jsonb_build_object('absenceId', v_id, 'tutorId', p_inputs->>'tutorId', 'startsOn', v_start, 'endsOn', v_end);
end $$;

-- execute_agent_proposal, now with the three workflow actions. Everything from the
-- earlier version is kept: creator and role checks, expiry, duplicate confirms and the
-- request checks. The workflow actions also compare the lesson, slot or invoice with the
-- preview under a lock, so a change made since then makes the proposal stale.
create or replace function public.execute_agent_proposal(p_id uuid, p_actor uuid, p_payload jsonb)
returns jsonb
language plpgsql as $$
declare
  v_p public.agent_proposals;
  v_role text;
  v_pre jsonb;
  v_row jsonb;
  v_changed text[] := '{}';
  v_result jsonb;
  v_draft_at timestamptz;
  v_kind text;
  v_lesson public.lessons;
  v_slot public.tutor_availability;
  v_pay public.payments;
  v_overlaps integer;
begin
  select * into v_p from public.agent_proposals where id = p_id for update;
  if not found then raise exception 'not_found: proposal not found'; end if;
  if v_p.created_by <> p_actor then
    raise exception 'forbidden: only the person who prepared this can confirm it';
  end if;
  if v_p.status = 'succeeded' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'result', v_p.result);
  end if;
  if v_p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', v_p.status, 'result', v_p.result);
  end if;
  if v_p.expires_at <= now() then
    update public.agent_proposals set status = 'expired', updated_at = now() where id = p_id;
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  v_role := public.actor_role(p_actor);
  if v_role is null then raise exception 'forbidden: unknown user'; end if;
  if v_p.required_role = 'owner' and v_role <> 'owner' then
    raise exception 'forbidden: only the owner can confirm this decision';
  end if;

  v_pre := v_p.preconditions;
  if v_p.target_type = 'request' then
    select to_jsonb(r) into v_row from public.requests r where r.id = v_p.target_id for update;
    if v_row is null then raise exception 'not_found: request not found'; end if;
    if v_row->>'status' is distinct from v_pre->>'status' then v_changed := array_append(v_changed, 'status'); end if;
    if v_row->>'current_decision_id' is distinct from v_pre->>'currentDecisionId' then v_changed := array_append(v_changed, 'decision'); end if;
    if (v_row->>'updated_at')::timestamptz is distinct from (v_pre->>'updatedAt')::timestamptz then v_changed := array_append(v_changed, 'updated'); end if;
    if (v_row->>'archived_at' is null) <> (v_pre->>'archivedAt' is null) then v_changed := array_append(v_changed, 'archived'); end if;
    if (v_row->>'hidden_at' is null) <> (v_pre->>'hiddenAt' is null) then v_changed := array_append(v_changed, 'removed'); end if;
    if v_p.action_type = 'draft.save' then
      v_kind := v_p.inputs->>'kind';
      select updated_at into v_draft_at from public.drafts where request_id = v_p.target_id and kind = v_kind for update;
      if v_draft_at is distinct from (v_pre->>'draftUpdatedAt')::timestamptz then v_changed := array_append(v_changed, 'draft'); end if;
    end if;
    if v_p.action_type = 'booking.reschedule' then
      select * into v_lesson from public.lessons where id = v_p.inputs->>'lessonId' for update;
      if not found or v_lesson.status <> 'scheduled' or v_lesson.updated_at is distinct from (v_pre->'workflow'->>'lessonUpdatedAt')::timestamptz then
        v_changed := array_append(v_changed, 'lesson');
      end if;
      select * into v_slot from public.tutor_availability where id = v_p.inputs->>'newSlotId' for update;
      if not found or v_slot.status <> 'free' or v_slot.starts_at is distinct from (v_pre->'workflow'->>'slotStartsAt')::timestamptz then
        v_changed := array_append(v_changed, 'slot');
      end if;
    end if;
    if v_p.action_type = 'invoice.extend_due_date' then
      select * into v_pay from public.payments where id = v_p.inputs->>'paymentId' for update;
      if not found or v_pay.due_date is distinct from (v_pre->'workflow'->>'dueDate')::date
         or v_pay.status is distinct from v_pre->'workflow'->>'paymentStatus'
         or v_pay.updated_at is distinct from (v_pre->'workflow'->>'paymentUpdatedAt')::timestamptz then
        v_changed := array_append(v_changed, 'invoice');
      end if;
    end if;
  elsif v_p.action_type = 'request.create' then
    -- The server re-ran the engine just now. Its inputs and outcome must match the preview.
    if p_payload->'request'->'confirmed_facts' is distinct from v_p.inputs->'facts' then
      raise exception 'invalid_input: the facts do not match the confirmed preview';
    end if;
    if p_payload->'request'->>'decision' is distinct from v_pre->'decision'->>'colour'
       or p_payload->'request'->>'matched_rule_id' is distinct from v_pre->'decision'->>'matchedRuleId' then
      v_changed := array_append(v_changed, 'decision');
    end if;
  elsif v_p.action_type = 'tutor.record_absence' then
    select count(*) into v_overlaps from public.tutor_absences
     where tutor_id = v_p.inputs->>'tutorId' and status = 'recorded'
       and starts_on <= (v_p.inputs->>'endsOn')::date and ends_on >= (v_p.inputs->>'startsOn')::date;
    if v_overlaps <> coalesce((v_pre->'workflow'->>'absenceOverlaps')::integer, 0) then v_changed := array_append(v_changed, 'absence'); end if;
  end if;

  if cardinality(v_changed) > 0 then
    update public.agent_proposals
       set status = 'stale', result = jsonb_build_object('changed', to_jsonb(v_changed)), updated_at = now()
     where id = p_id;
    return jsonb_build_object('ok', false, 'code', 'stale', 'changed', to_jsonb(v_changed));
  end if;

  begin
    case v_p.action_type
      when 'request.create' then
        v_result := public.create_request(
          p_payload || jsonb_build_object('idempotency_key', p_id, 'actor_id', p_actor, 'intake_method', 'ai_intake')
        );
      when 'request.send_to_owner' then
        v_result := public.transition_request(v_p.target_id, p_actor, 'send_to_owner', v_p.inputs->>'note');
      when 'request.approve' then
        v_result := public.transition_request(v_p.target_id, p_actor, 'approve', v_p.inputs->>'note');
      when 'request.decline' then
        v_result := public.transition_request(v_p.target_id, p_actor, 'decline', v_p.inputs->>'note');
      when 'request.request_info' then
        v_result := public.transition_request(v_p.target_id, p_actor, 'request_info', v_p.inputs->>'note');
      when 'request.record_outcome' then
        v_result := public.transition_request(v_p.target_id, p_actor, 'record_and_close', v_p.inputs->>'note');
      when 'draft.save' then
        insert into public.drafts (request_id, kind, body, generated_by, updated_by, updated_at)
        values (v_p.target_id, v_kind, v_p.inputs->>'body', coalesce(v_p.inputs->>'generatedBy', 'edited'), p_actor, now())
        on conflict (request_id, kind) do update
          set body = excluded.body, generated_by = excluded.generated_by, updated_by = excluded.updated_by, updated_at = now();
        v_result := jsonb_build_object('id', v_p.target_id, 'kind', v_kind, 'saved', true);
      when 'booking.reschedule' then
        v_result := public.apply_lesson_change(v_p.target_id, p_actor, v_p.inputs);
      when 'invoice.extend_due_date' then
        v_result := public.apply_invoice_extension(v_p.target_id, p_actor, v_p.inputs);
      when 'tutor.record_absence' then
        v_result := public.record_tutor_absence(p_actor, v_p.inputs);
    end case;
  exception when others then
    -- Nothing from the business change is kept. The proposal records why it failed.
    update public.agent_proposals
       set status = 'failed', result = jsonb_build_object('error', sqlerrm), confirmed_by = p_actor, confirmed_at = now(), updated_at = now()
     where id = p_id;
    return jsonb_build_object('ok', false, 'code', 'failed', 'error', sqlerrm);
  end;

  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (p_actor, v_role, 'agent.' || v_p.action_type, 'agent_proposal', p_id::text,
          jsonb_build_object('target', coalesce(v_p.target_id::text, v_result->>'id', v_result->>'absenceId'), 'input_hash', v_p.input_hash,
                             'prepared_by_role', v_p.created_role, 'result', v_result));

  update public.agent_proposals
     set status = 'succeeded', confirmed_by = p_actor, confirmed_at = now(), result = v_result, updated_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'result', v_result);
end $$;

-- Activity kinds for workflow steps.
alter table public.ai_activity drop constraint if exists ai_activity_event_type_check;
alter table public.ai_activity add constraint ai_activity_event_type_check check (event_type in (
  'details_extracted', 'clarification_needed', 'booking_retrieved', 'payment_found',
  'availability_checked', 'policy_retrieved', 'missing_information', 'confirmation_required',
  'decision_completed', 'draft_prepared', 'owner_review_created', 'rule_proposed',
  'suggestion_prepared', 'ai_unavailable',
  'records_retrieved', 'briefing_prepared', 'proposal_prepared', 'proposal_confirmed',
  'proposal_cancelled', 'sensitive_case_routed',
  'workflow_started', 'workflow_step', 'workflow_completed'
));

alter table public.lessons enable row level security;
alter table public.payment_reminders enable row level security;
alter table public.tutor_absences enable row level security;
alter table public.agent_workflows enable row level security;

-- Only the server (service role) may call these functions.
revoke all on function public.tutor_is_absent(text, timestamptz) from public, anon, authenticated;
revoke all on function public.apply_lesson_change(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.apply_invoice_extension(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_tutor_absence(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.execute_agent_proposal(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tutor_is_absent(text, timestamptz) to service_role;
grant execute on function public.apply_lesson_change(uuid, uuid, jsonb) to service_role;
grant execute on function public.apply_invoice_extension(uuid, uuid, jsonb) to service_role;
grant execute on function public.record_tutor_absence(uuid, jsonb) to service_role;
grant execute on function public.execute_agent_proposal(uuid, uuid, jsonb) to service_role;
