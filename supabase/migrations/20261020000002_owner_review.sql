-- Owner review: the owner reviews requests directly instead of being asked to send them
-- to themselves, and nothing goes to the owner while required details are missing.
--
-- * requests.owner_review_started_at / _by record when the owner pressed Start Review.
--   Opening a request never changes it; only the explicit Start Review does.
-- * start_owner_review records that once (repeat clicks change nothing).
-- * add_owner_handling_note records the owner's handling notes and next steps on a red or
--   welfare request as an event, without changing its status.
-- * transition_request is replaced with role and missing-detail checks:
--     - send_to_owner is refused for the owner and while required details are missing;
--     - the owner can approve, decline or ask for information on review_required,
--       more_info_requested, awaiting_owner, and needs_clarification once details are
--       complete, without an admin sending it first;
--     - approve is refused while the latest rule check has missing details;
--     - an admin can never make an owner decision.
-- Safe to run more than once.

alter table public.requests
  add column if not exists owner_review_started_at timestamptz,
  add column if not exists owner_review_started_by uuid references public.app_users (id);

alter table public.request_events drop constraint if exists request_events_event_type_check;
alter table public.request_events add constraint request_events_event_type_check check (event_type in (
  'created', 'reevaluated', 'sent_to_owner', 'owner_approved', 'owner_declined',
  'owner_requested_info', 'admin_replied', 'admin_recorded', 'closed',
  'removed_from_list', 'restored_to_list', 'archived', 'unarchived', 'class_changed',
  'owner_review_started', 'owner_handling_note'
));

-- How many required details the latest rule check says are missing. "policy" and
-- "request_type" are not details anyone can fill in, so they don't count.
create or replace function public.request_missing_count(p_request_id uuid) returns integer
language sql stable as $$
  select coalesce((
    select count(*)::integer
    from public.requests r
    join public.decisions d on d.id = r.current_decision_id
    cross join lateral jsonb_array_elements(coalesce(d.result->'missing', '[]'::jsonb)) m
    where r.id = p_request_id and coalesce(m->>'fact', '') not in ('policy', 'request_type')
  ), 0)
$$;

create or replace function public.transition_request(
  p_request_id uuid, p_actor uuid, p_action text, p_note text
) returns jsonb
language plpgsql as $$
declare
  v_role text := public.actor_role(p_actor);
  v_from text[];
  v_to text;
  v_event text;
  v_owner_only boolean := false;
  v_old_status text;
  v_missing integer;
  v_owner_from constant text[] := array['review_required', 'needs_clarification', 'more_info_requested', 'awaiting_owner'];
begin
  if v_role is null then raise exception 'forbidden: unknown user'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'reason_required: a note or reason is required'; end if;
  if char_length(p_note) > 4000 then raise exception 'invalid_input: note is too long'; end if;

  case p_action
    when 'send_to_owner' then
      v_from := array['review_required', 'needs_clarification', 'more_info_requested']; v_to := 'awaiting_owner'; v_event := 'sent_to_owner';
    when 'approve' then
      v_from := v_owner_from; v_to := 'approved'; v_event := 'owner_approved'; v_owner_only := true;
    when 'decline' then
      v_from := v_owner_from; v_to := 'declined'; v_event := 'owner_declined'; v_owner_only := true;
    when 'request_info' then
      v_from := v_owner_from; v_to := 'more_info_requested'; v_event := 'owner_requested_info'; v_owner_only := true;
    when 'record_and_close' then
      v_from := array['ready', 'approved', 'declined']; v_to := 'closed'; v_event := 'closed';
    else
      raise exception 'invalid_input: unknown action %', p_action;
  end case;

  if v_owner_only and v_role <> 'owner' then
    raise exception 'forbidden: only the owner can do this';
  end if;
  if p_action = 'send_to_owner' and v_role = 'owner' then
    raise exception 'forbidden: the owner reviews requests directly and does not send them to themselves';
  end if;

  select status into v_old_status from public.requests where id = p_request_id for update;
  if not found then raise exception 'not_found'; end if;

  v_missing := public.request_missing_count(p_request_id);
  if v_missing > 0 and v_old_status = any (array['review_required', 'needs_clarification', 'more_info_requested', 'awaiting_owner']) then
    if p_action = 'send_to_owner' then
      raise exception 'missing_details: complete the missing details before sending this to the owner';
    end if;
    if p_action = 'approve' then
      raise exception 'missing_details: complete the missing details before approving';
    end if;
    if v_owner_only and v_old_status = 'needs_clarification' then
      raise exception 'missing_details: complete the missing details before the owner reviews this';
    end if;
  end if;

  -- The status check and the update happen together, so a second click finds the
  -- status already changed and does nothing.
  update public.requests set status = v_to, updated_at = now()
  where id = p_request_id and status = any (v_from);
  if not found then
    raise exception 'invalid_transition: cannot % a request that is %', p_action, v_old_status;
  end if;

  insert into public.request_events (request_id, event_type, actor_id, actor_role, from_status, to_status, note)
  values (p_request_id, v_event, p_actor, v_role, v_old_status, v_to, p_note);

  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (p_actor, v_role, 'request.' || p_action, 'request', p_request_id::text,
          jsonb_build_object('from', v_old_status, 'to', v_to));

  return jsonb_build_object('id', p_request_id, 'status', v_to);
end $$;

-- The owner starts reviewing a request. Records who and when, once. It changes no status,
-- and it leaves updated_at alone so prepared Compass proposals stay valid.
create or replace function public.start_owner_review(p_request_id uuid, p_actor uuid) returns jsonb
language plpgsql as $$
declare
  v_role text := public.actor_role(p_actor);
  v_row record;
begin
  if v_role is null then raise exception 'forbidden: unknown user'; end if;
  if v_role <> 'owner' then raise exception 'forbidden: only the owner can start a review'; end if;

  select id, status, owner_review_started_at, owner_review_started_by into v_row
  from public.requests where id = p_request_id for update;
  if not found then raise exception 'not_found'; end if;

  if v_row.owner_review_started_at is not null then
    return jsonb_build_object('id', p_request_id, 'status', v_row.status, 'started_at', v_row.owner_review_started_at,
                              'started_by', v_row.owner_review_started_by, 'already', true);
  end if;
  if v_row.status <> all (array['review_required', 'needs_clarification', 'more_info_requested', 'awaiting_owner']) then
    raise exception 'invalid_transition: a request that is % cannot be reviewed', v_row.status;
  end if;
  if v_row.status = 'needs_clarification' and public.request_missing_count(p_request_id) > 0 then
    raise exception 'missing_details: complete the missing details before the owner reviews this';
  end if;

  update public.requests set owner_review_started_at = now(), owner_review_started_by = p_actor
  where id = p_request_id;

  insert into public.request_events (request_id, event_type, actor_id, actor_role, from_status, to_status, note)
  values (p_request_id, 'owner_review_started', p_actor, v_role, v_row.status, v_row.status, 'Owner started the review.');

  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (p_actor, v_role, 'request.start_review', 'request', p_request_id::text, jsonb_build_object('status', v_row.status));

  return jsonb_build_object('id', p_request_id, 'status', v_row.status, 'started_at', now(), 'started_by', p_actor, 'already', false);
end $$;

-- The owner records how they are handling a request, with next steps. No status change.
create or replace function public.add_owner_handling_note(p_request_id uuid, p_actor uuid, p_note text) returns jsonb
language plpgsql as $$
declare
  v_role text := public.actor_role(p_actor);
  v_status text;
  v_event uuid;
begin
  if v_role is null then raise exception 'forbidden: unknown user'; end if;
  if v_role <> 'owner' then raise exception 'forbidden: only the owner can record handling notes'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'reason_required: a note is required'; end if;
  if char_length(p_note) > 4000 then raise exception 'invalid_input: note is too long'; end if;

  select status into v_status from public.requests where id = p_request_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_status <> all (array['review_required', 'needs_clarification', 'more_info_requested', 'awaiting_owner']) then
    raise exception 'invalid_transition: handling notes can only be added while the owner is reviewing';
  end if;

  insert into public.request_events (request_id, event_type, actor_id, actor_role, from_status, to_status, note)
  values (p_request_id, 'owner_handling_note', p_actor, v_role, v_status, v_status, btrim(p_note))
  returning id into v_event;

  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (p_actor, v_role, 'request.handling_note', 'request', p_request_id::text, jsonb_build_object('status', v_status));

  return jsonb_build_object('id', p_request_id, 'status', v_status, 'event_id', v_event);
end $$;

-- Only the server (service role) may call these functions.
revoke all on function public.request_missing_count(uuid) from public, anon, authenticated;
revoke all on function public.transition_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.start_owner_review(uuid, uuid) from public, anon, authenticated;
revoke all on function public.add_owner_handling_note(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.request_missing_count(uuid) to service_role;
grant execute on function public.transition_request(uuid, uuid, text, text) to service_role;
grant execute on function public.start_owner_review(uuid, uuid) to service_role;
grant execute on function public.add_owner_handling_note(uuid, uuid, text) to service_role;
