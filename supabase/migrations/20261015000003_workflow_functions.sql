-- Database functions for multi-step saves. Each one runs as a single transaction, so a
-- save either fully happens or does not happen at all. The Next.js server checks the
-- user's role first; these functions check it again as a second line of defence.

-- Past decisions and evidence can never be changed or deleted on their own.
create or replace function public.prevent_history_change() returns trigger
language plpgsql as $$
begin
  raise exception 'history_is_read_only: % rows cannot be changed', tg_table_name;
end $$;

create trigger decisions_read_only before update on public.decisions
  for each row execute function public.prevent_history_change();
create trigger evidence_read_only before update on public.evidence_snapshots
  for each row execute function public.prevent_history_change();

-- Only draft policy versions can be edited. Active and archived versions are frozen.
create or replace function public.protect_policy_versions() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' and new.definition is distinct from old.definition then
    raise exception 'policy_frozen: only draft versions can be edited';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'policy_frozen: archived versions cannot be reactivated, copy them into a new draft';
  end if;
  return new;
end $$;

create trigger policy_versions_protect before update on public.policy_versions
  for each row execute function public.protect_policy_versions();

create or replace function public.actor_role(p_actor uuid) returns text
language sql stable as $$
  select role from public.app_users where id = p_actor
$$;

-- Create a request together with its first decision, evidence snapshot and events.
-- Calling it twice with the same idempotency key returns the first request.
create or replace function public.create_request(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_actor uuid := (p->>'actor_id')::uuid;
  v_req jsonb := p->'request';
  v_dec jsonb := p->'decision';
  v_id uuid;
  v_decision_id uuid;
  v_role text;
begin
  v_role := public.actor_role(v_actor);
  if v_role is null then
    raise exception 'forbidden: unknown user';
  end if;

  select id into v_id from public.requests where idempotency_key = v_key;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;

  insert into public.requests (
    request_type, money_involved, amount_cents, complaint_status, welfare_status, reference_id,
    booking_id, context, confirmed_facts, decision, decision_reason, matched_rule_id, policy_version,
    policy_version_id, next_step, status, intake_method, idempotency_key, created_by
  ) values (
    v_req->>'request_type', v_req->>'money_involved', (v_req->>'amount_cents')::integer,
    v_req->>'complaint_status', v_req->>'welfare_status', v_req->>'reference_id', v_req->>'booking_id',
    coalesce(v_req->>'context', ''), v_req->'confirmed_facts', v_req->>'decision', v_req->>'decision_reason',
    v_req->>'matched_rule_id', v_req->>'policy_version', (v_req->>'policy_version_id')::uuid,
    coalesce(v_req->>'next_step', ''), v_req->>'status', p->>'intake_method', v_key, v_actor
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- Another identical submission won the race. Return that one.
    select id into v_id from public.requests where idempotency_key = v_key;
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;

  insert into public.decisions (
    request_id, sequence, colour, matched_rule_id, policy_version, policy_version_id, policy_snapshot,
    facts, result, input_hash, engine_version, reason, created_by
  ) values (
    v_id, 1, v_dec->>'colour', v_dec->>'matched_rule_id', v_dec->>'policy_version',
    (v_dec->>'policy_version_id')::uuid, v_dec->'policy_snapshot', v_dec->'facts', v_dec->'result',
    v_dec->>'input_hash', v_dec->>'engine_version', 'initial', v_actor
  ) returning id into v_decision_id;

  insert into public.evidence_snapshots (decision_id, request_id, records, retrieved_at)
  values (v_decision_id, v_id, p->'evidence', (p->'evidence'->>'retrievedAt')::timestamptz);

  update public.requests set current_decision_id = v_decision_id where id = v_id;

  insert into public.request_events (request_id, event_type, actor_id, actor_role, to_status, note)
  values (v_id, 'created', v_actor, v_role, v_req->>'status',
          format('Saved with decision %s (%s, %s)', v_req->>'decision', v_req->>'matched_rule_id', v_req->>'policy_version'));

  -- Link any agent activity from the intake session to the new request.
  if p ? 'session_key' then
    update public.ai_activity set request_id = v_id
    where session_key = (p->>'session_key')::uuid and request_id is null;
    update public.ai_activity set state = 'completed', summary = 'The admin confirmed the facts and submitted them.'
    where session_key = (p->>'session_key')::uuid and event_type = 'confirmation_required' and state = 'pending';
  end if;

  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (v_actor, v_role, 'request.create', 'request', v_id::text,
          jsonb_build_object('decision', v_req->>'decision', 'rule', v_req->>'matched_rule_id'));

  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

-- Re-run the engine after Sarah clarifies facts. The earlier decision stays in history.
-- expected_decision_id stops two people (or two clicks) from re-evaluating at once.
create or replace function public.reevaluate_request(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_id uuid := (p->>'request_id')::uuid;
  v_actor uuid := (p->>'actor_id')::uuid;
  v_req jsonb := p->'request';
  v_dec jsonb := p->'decision';
  v_role text;
  v_old record;
  v_seq integer;
  v_decision_id uuid;
begin
  v_role := public.actor_role(v_actor);
  if v_role is null then raise exception 'forbidden: unknown user'; end if;

  select * into v_old from public.requests where id = v_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_old.current_decision_id is distinct from (p->>'expected_decision_id')::uuid then
    raise exception 'stale_update: this request changed since you opened it';
  end if;
  if v_old.status not in ('needs_clarification', 'review_required', 'more_info_requested') then
    raise exception 'invalid_transition: facts can only be updated while clarification is open';
  end if;

  select coalesce(max(sequence), 0) + 1 into v_seq from public.decisions where request_id = v_id;

  insert into public.decisions (
    request_id, sequence, colour, matched_rule_id, policy_version, policy_version_id, policy_snapshot,
    facts, result, input_hash, engine_version, reason, created_by
  ) values (
    v_id, v_seq, v_dec->>'colour', v_dec->>'matched_rule_id', v_dec->>'policy_version',
    (v_dec->>'policy_version_id')::uuid, v_dec->'policy_snapshot', v_dec->'facts', v_dec->'result',
    v_dec->>'input_hash', v_dec->>'engine_version', 'clarification', v_actor
  ) returning id into v_decision_id;

  insert into public.evidence_snapshots (decision_id, request_id, records, retrieved_at)
  values (v_decision_id, v_id, p->'evidence', (p->'evidence'->>'retrievedAt')::timestamptz);

  update public.requests set
    money_involved = v_req->>'money_involved',
    amount_cents = (v_req->>'amount_cents')::integer,
    complaint_status = v_req->>'complaint_status',
    welfare_status = v_req->>'welfare_status',
    reference_id = v_req->>'reference_id',
    booking_id = v_req->>'booking_id',
    context = coalesce(v_req->>'context', ''),
    confirmed_facts = v_req->'confirmed_facts',
    decision = v_req->>'decision',
    decision_reason = v_req->>'decision_reason',
    matched_rule_id = v_req->>'matched_rule_id',
    policy_version = v_req->>'policy_version',
    policy_version_id = (v_req->>'policy_version_id')::uuid,
    next_step = coalesce(v_req->>'next_step', ''),
    status = v_req->>'status',
    current_decision_id = v_decision_id,
    decision_count = v_seq,
    updated_at = now()
  where id = v_id;

  insert into public.request_events (request_id, event_type, actor_id, actor_role, from_status, to_status, note)
  values (v_id, case when v_old.status = 'more_info_requested' then 'admin_replied' else 'reevaluated' end,
          v_actor, v_role, v_old.status, v_req->>'status',
          coalesce(nullif(p->>'note', ''), format('Re-evaluated: %s (%s)', v_req->>'decision', v_req->>'matched_rule_id')));

  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (v_actor, v_role, 'request.reevaluate', 'request', v_id::text,
          jsonb_build_object('from', v_old.decision, 'to', v_req->>'decision', 'sequence', v_seq));

  return jsonb_build_object('id', v_id, 'decision_id', v_decision_id, 'sequence', v_seq);
end $$;

-- Move a request through the workflow. Owner approvals change only this request's
-- status. They never touch policies or the original decision.
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
begin
  if v_role is null then raise exception 'forbidden: unknown user'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'reason_required: a note or reason is required'; end if;
  if char_length(p_note) > 4000 then raise exception 'invalid_input: note is too long'; end if;

  case p_action
    when 'send_to_owner' then
      v_from := array['review_required', 'needs_clarification', 'more_info_requested']; v_to := 'awaiting_owner'; v_event := 'sent_to_owner';
    when 'approve' then
      v_from := array['awaiting_owner']; v_to := 'approved'; v_event := 'owner_approved'; v_owner_only := true;
    when 'decline' then
      v_from := array['awaiting_owner']; v_to := 'declined'; v_event := 'owner_declined'; v_owner_only := true;
    when 'request_info' then
      v_from := array['awaiting_owner']; v_to := 'more_info_requested'; v_event := 'owner_requested_info'; v_owner_only := true;
    when 'record_and_close' then
      v_from := array['ready', 'approved', 'declined']; v_to := 'closed'; v_event := 'closed';
    else
      raise exception 'invalid_input: unknown action %', p_action;
  end case;

  if v_owner_only and v_role <> 'owner' then
    raise exception 'forbidden: only the owner can do this';
  end if;

  select status into v_old_status from public.requests where id = p_request_id for update;
  if not found then raise exception 'not_found'; end if;

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

-- Create a new draft policy version. Version numbers are allocated under a lock.
create or replace function public.create_policy_draft(
  p_actor uuid, p_category text, p_definition jsonb, p_note text, p_source text
) returns jsonb
language plpgsql as $$
declare
  v_version integer;
  v_id uuid;
begin
  if public.actor_role(p_actor) is distinct from 'owner' then
    raise exception 'forbidden: only the owner can create rule drafts';
  end if;
  perform pg_advisory_xact_lock(hashtext('policy:' || p_category));
  select coalesce(max(version), 0) + 1 into v_version from public.policy_versions where category = p_category;
  insert into public.policy_versions (category, version, status, definition, change_note, source, created_by)
  values (p_category, v_version, 'draft', p_definition, coalesce(p_note, ''), p_source, p_actor)
  returning id into v_id;
  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (p_actor, 'owner', 'policy.create_draft', 'policy_version', v_id::text,
          jsonb_build_object('category', p_category, 'version', v_version, 'source', p_source));
  return jsonb_build_object('id', v_id, 'version', v_version);
end $$;

-- Activate a validated draft. The previous active version is archived, not deleted.
create or replace function public.activate_policy_version(
  p_version_id uuid, p_actor uuid, p_note text
) returns jsonb
language plpgsql as $$
declare
  v_row public.policy_versions;
  v_previous uuid;
begin
  if public.actor_role(p_actor) is distinct from 'owner' then
    raise exception 'forbidden: only the owner can activate rules';
  end if;
  select * into v_row from public.policy_versions where id = p_version_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.status <> 'draft' then
    raise exception 'invalid_transition: only draft versions can be activated';
  end if;
  perform pg_advisory_xact_lock(hashtext('policy:' || v_row.category));

  update public.policy_versions set status = 'archived', archived_at = now()
  where category = v_row.category and status = 'active'
  returning id into v_previous;

  update public.policy_versions
  set status = 'active', activated_by = p_actor, activated_at = now(),
      change_note = case when coalesce(p_note, '') = '' then change_note else p_note end
  where id = p_version_id;

  insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, detail)
  values (p_actor, 'owner', 'policy.activate', 'policy_version', p_version_id::text,
          jsonb_build_object('category', v_row.category, 'version', v_row.version, 'archived', v_previous));
  return jsonb_build_object('id', p_version_id, 'archived', v_previous);
end $$;

-- Only the server (service role) may call these functions.
revoke all on function public.create_request(jsonb) from public, anon, authenticated;
revoke all on function public.reevaluate_request(jsonb) from public, anon, authenticated;
revoke all on function public.transition_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_policy_draft(uuid, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.activate_policy_version(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.actor_role(uuid) from public, anon, authenticated;
grant execute on function public.create_request(jsonb) to service_role;
grant execute on function public.reevaluate_request(jsonb) to service_role;
grant execute on function public.transition_request(uuid, uuid, text, text) to service_role;
grant execute on function public.create_policy_draft(uuid, text, jsonb, text, text) to service_role;
grant execute on function public.activate_policy_version(uuid, uuid, text) to service_role;
grant execute on function public.actor_role(uuid) to service_role;
