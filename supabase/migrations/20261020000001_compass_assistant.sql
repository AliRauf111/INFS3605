-- Compass owner assistant: conversation state kept on the server, and one approval
-- process for every business change Compass prepares.
--
-- Compass may read records and prepare unsaved drafts on its own. Anything that saves
-- (a draft, a new request, a workflow step or an owner decision) becomes a proposal
-- first. The person sees the exact preview and confirms it, and only then does
-- execute_agent_proposal make the change, in one transaction with its audit record.

-- Conversation state ---------------------------------------------------------------
-- One row per Compass conversation. The browser only holds the session key; the task
-- Compass is working on and the request in focus live here, tied to the signed-in user.
create table if not exists public.agent_sessions (
  session_key uuid primary key,
  user_id uuid not null references public.app_users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists agent_sessions_user_idx on public.agent_sessions (user_id, updated_at desc);

-- Proposals ------------------------------------------------------------------------
create table if not exists public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.app_users (id),
  created_role text not null check (created_role in ('admin', 'owner')),
  session_key uuid,
  action_type text not null check (action_type in (
    'request.create', 'request.send_to_owner', 'request.approve', 'request.decline',
    'request.request_info', 'request.record_outcome', 'draft.save'
  )),
  -- 'request' targets an existing request; 'new_request' is a request not yet saved.
  target_type text not null check (target_type in ('request', 'new_request')),
  target_id uuid,
  inputs jsonb not null,
  input_hash text not null check (char_length(input_hash) = 64),
  -- The record and policy versions the preview was built from.
  preconditions jsonb not null,
  -- Exactly what the person was shown: current and proposed values, warnings, policy references.
  preview jsonb not null,
  -- 'staff' means an admin or the owner may confirm. 'owner' means only the owner.
  required_role text not null check (required_role in ('staff', 'owner')),
  status text not null default 'pending' check (status in (
    'pending', 'succeeded', 'failed', 'expired', 'cancelled', 'superseded', 'stale'
  )),
  replaces uuid references public.agent_proposals (id),
  expires_at timestamptz not null,
  confirmed_by uuid references public.app_users (id),
  confirmed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((target_type = 'request') = (target_id is not null))
);
create index if not exists agent_proposals_creator_idx on public.agent_proposals (created_by, created_at desc);
create index if not exists agent_proposals_target_idx on public.agent_proposals (target_id);

-- A proposal's action, target, inputs and preview can never be changed. Editing makes
-- a new proposal and marks the old one superseded.
create or replace function public.protect_agent_proposals() returns trigger
language plpgsql as $$
begin
  if new.action_type is distinct from old.action_type
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.inputs is distinct from old.inputs
     or new.input_hash is distinct from old.input_hash
     or new.preconditions is distinct from old.preconditions
     or new.preview is distinct from old.preview
     or new.required_role is distinct from old.required_role
     or new.created_by is distinct from old.created_by then
    raise exception 'invalid_input: a proposal cannot be changed after it is prepared';
  end if;
  if old.status <> 'pending' and new.status is distinct from old.status then
    raise exception 'invalid_transition: this proposal is already %', old.status;
  end if;
  return new;
end $$;

drop trigger if exists agent_proposals_protect on public.agent_proposals;
create trigger agent_proposals_protect before update on public.agent_proposals
  for each row execute function public.protect_agent_proposals();

-- Run a confirmed proposal. Called only by the server, after it has re-run the business
-- rules. This function checks again, under a row lock:
--   * the person confirming prepared it, and still has the required role
--   * it is still pending and has not expired
--   * the request has not changed since the preview (status, decision, last update,
--     archived or removed, and the draft being replaced)
-- Then it makes the change through the existing workflow functions and writes the audit
-- record, all in this one transaction. A second call returns the first result.
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
  elsif v_p.action_type = 'request.create' then
    -- The server re-ran the engine just now. Its inputs and outcome must match the preview.
    if p_payload->'request'->'confirmed_facts' is distinct from v_p.inputs->'facts' then
      raise exception 'invalid_input: the facts do not match the confirmed preview';
    end if;
    if p_payload->'request'->>'decision' is distinct from v_pre->'decision'->>'colour'
       or p_payload->'request'->>'matched_rule_id' is distinct from v_pre->'decision'->>'matchedRuleId' then
      v_changed := array_append(v_changed, 'decision');
    end if;
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
          jsonb_build_object('target', coalesce(v_p.target_id::text, v_result->>'id'), 'input_hash', v_p.input_hash,
                             'prepared_by_role', v_p.created_role, 'result', v_result));

  update public.agent_proposals
     set status = 'succeeded', confirmed_by = p_actor, confirmed_at = now(), result = v_result, updated_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'result', v_result);
end $$;

-- New activity kinds for Compass's reads and proposals.
alter table public.ai_activity drop constraint if exists ai_activity_event_type_check;
alter table public.ai_activity add constraint ai_activity_event_type_check check (event_type in (
  'details_extracted', 'clarification_needed', 'booking_retrieved', 'payment_found',
  'availability_checked', 'policy_retrieved', 'missing_information', 'confirmation_required',
  'decision_completed', 'draft_prepared', 'owner_review_created', 'rule_proposed',
  'suggestion_prepared', 'ai_unavailable',
  'records_retrieved', 'briefing_prepared', 'proposal_prepared', 'proposal_confirmed',
  'proposal_cancelled', 'sensitive_case_routed'
));

alter table public.agent_sessions enable row level security;
alter table public.agent_proposals enable row level security;

revoke all on function public.execute_agent_proposal(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.execute_agent_proposal(uuid, uuid, jsonb) to service_role;
