-- Checks for Compass's approval process (execute_agent_proposal). Run against a database
-- with the migrations and demo data loaded. Everything runs in one transaction and is
-- rolled back at the end, so it leaves no trace. Any failed check stops with an error.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/agent-proposals.sql

begin;

create temporary table t_ids (k text primary key, v uuid);
insert into t_ids values
  ('admin', (select id from public.app_users where role = 'admin' order by id limit 1)),
  ('owner', (select id from public.app_users where role = 'owner' order by id limit 1)),
  ('awaiting', (select id from public.requests where status = 'awaiting_owner' order by created_at limit 1)),
  ('review', (select id from public.requests where status = 'review_required' order by created_at limit 1));

create or replace function pg_temp.k(p text) returns uuid language sql as $$ select v from t_ids where k = p $$;

-- A pending proposal whose preconditions match the request as it is now.
create or replace function pg_temp.propose(p_by uuid, p_action text, p_target uuid, p_required text, p_note text default 'Test note')
returns uuid language plpgsql as $$
declare v_id uuid; r public.requests;
begin
  select * into r from public.requests where id = p_target;
  insert into public.agent_proposals (created_by, created_role, action_type, target_type, target_id, inputs, input_hash, preconditions, preview, required_role, expires_at)
  values (p_by, public.actor_role(p_by), p_action, 'request', p_target, jsonb_build_object('note', p_note), repeat('a', 64),
          jsonb_build_object('status', r.status, 'currentDecisionId', r.current_decision_id, 'updatedAt', r.updated_at, 'archivedAt', null, 'hiddenAt', null),
          '{}'::jsonb, p_required, now() + interval '15 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- 1. An admin can't execute an owner decision, even with a proposal in hand.
do $$
declare v_id uuid; v_before text; v_failed boolean := false;
begin
  select status into v_before from public.requests where id = pg_temp.k('awaiting');
  v_id := pg_temp.propose(pg_temp.k('admin'), 'request.approve', pg_temp.k('awaiting'), 'owner');
  begin
    perform public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  exception when others then
    v_failed := sqlerrm like 'forbidden:%';
  end;
  if not v_failed then raise exception 'FAIL 1: admin executed an owner-only proposal'; end if;
  if (select status from public.requests where id = pg_temp.k('awaiting')) <> v_before then raise exception 'FAIL 1: request changed'; end if;
  raise notice 'PASS 1: admin cannot execute an owner decision';
end $$;

-- 2. Someone else can't confirm a proposal they didn't prepare.
do $$
declare v_id uuid; v_failed boolean := false;
begin
  v_id := pg_temp.propose(pg_temp.k('admin'), 'request.send_to_owner', pg_temp.k('review'), 'staff');
  begin
    perform public.execute_agent_proposal(v_id, pg_temp.k('owner'), '{}'::jsonb);
  exception when others then v_failed := sqlerrm like 'forbidden:%';
  end;
  if not v_failed then raise exception 'FAIL 2: another user confirmed the proposal'; end if;
  raise notice 'PASS 2: only the preparer can confirm';
end $$;

-- 3. A change to the request after the preview makes the proposal stale, and nothing runs.
do $$
declare v_id uuid; v_res jsonb;
begin
  v_id := pg_temp.propose(pg_temp.k('owner'), 'request.decline', pg_temp.k('awaiting'), 'owner');
  update public.requests set updated_at = now() + interval '1 second' where id = pg_temp.k('awaiting');
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('owner'), '{}'::jsonb);
  if v_res->>'code' <> 'stale' then raise exception 'FAIL 3: expected stale, got %', v_res; end if;
  if (select status from public.agent_proposals where id = v_id) <> 'stale' then raise exception 'FAIL 3: proposal not marked stale'; end if;
  if (select status from public.requests where id = pg_temp.k('awaiting')) <> 'awaiting_owner' then raise exception 'FAIL 3: request changed'; end if;
  raise notice 'PASS 3: changed records invalidate an earlier preview (%)', v_res->'changed';
end $$;

-- 4. The owner's decision runs once. A repeated confirm returns the first result.
do $$
declare v_id uuid; v_first jsonb; v_second jsonb; v_events int; v_audit int;
begin
  v_id := pg_temp.propose(pg_temp.k('owner'), 'request.approve', pg_temp.k('awaiting'), 'owner', 'Approved in test');
  select count(*) into v_events from public.request_events where request_id = pg_temp.k('awaiting');
  v_first := public.execute_agent_proposal(v_id, pg_temp.k('owner'), '{}'::jsonb);
  if (v_first->>'ok')::boolean is not true then raise exception 'FAIL 4: first confirm failed: %', v_first; end if;
  v_second := public.execute_agent_proposal(v_id, pg_temp.k('owner'), '{}'::jsonb);
  if (v_second->>'duplicate')::boolean is not true then raise exception 'FAIL 4: second confirm was not a duplicate: %', v_second; end if;
  if (select status from public.requests where id = pg_temp.k('awaiting')) <> 'approved' then raise exception 'FAIL 4: request not approved'; end if;
  if (select count(*) from public.request_events where request_id = pg_temp.k('awaiting')) <> v_events + 1 then raise exception 'FAIL 4: expected exactly one new event'; end if;
  select count(*) into v_audit from public.audit_events where entity_type = 'agent_proposal' and entity_id = v_id::text;
  if v_audit <> 1 then raise exception 'FAIL 4: expected one audit row, found %', v_audit; end if;
  if (select confirmed_by from public.agent_proposals where id = v_id) <> pg_temp.k('owner') then raise exception 'FAIL 4: approver not recorded'; end if;
  raise notice 'PASS 4: one execution, one event, one audit row, approver recorded';
end $$;

-- 5. An expired preview can't run.
do $$
declare v_id uuid; v_res jsonb;
begin
  v_id := pg_temp.propose(pg_temp.k('admin'), 'request.send_to_owner', pg_temp.k('review'), 'staff');
  update public.agent_proposals set expires_at = now() - interval '1 minute' where id = v_id;
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if v_res->>'code' <> 'expired' then raise exception 'FAIL 5: expected expired, got %', v_res; end if;
  if (select status from public.requests where id = pg_temp.k('review')) <> 'review_required' then raise exception 'FAIL 5: request changed'; end if;
  raise notice 'PASS 5: expired previews are refused';
end $$;

-- 6. A business change the database refuses leaves no partial change or audit row.
do $$
declare v_id uuid; v_res jsonb; v_audit int;
begin
  -- Recording an outcome isn't allowed from Owner Review Required, so transition_request refuses.
  v_id := pg_temp.propose(pg_temp.k('admin'), 'request.record_outcome', pg_temp.k('review'), 'staff', 'Done');
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if v_res->>'code' <> 'failed' then raise exception 'FAIL 6: expected failed, got %', v_res; end if;
  if (select status from public.requests where id = pg_temp.k('review')) <> 'review_required' then raise exception 'FAIL 6: request changed'; end if;
  select count(*) into v_audit from public.audit_events where entity_id = v_id::text;
  if v_audit <> 0 then raise exception 'FAIL 6: audit written for a failed change'; end if;
  raise notice 'PASS 6: refused changes roll back and the proposal is marked failed (%)', v_res->>'error';
end $$;

-- 7. A stored preview can't be altered, and a finished proposal can't be reopened.
do $$
declare v_id uuid; v_failed boolean := false;
begin
  v_id := pg_temp.propose(pg_temp.k('admin'), 'request.send_to_owner', pg_temp.k('review'), 'staff');
  begin
    update public.agent_proposals set inputs = '{"note":"changed"}' where id = v_id;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 7: inputs were editable'; end if;
  update public.agent_proposals set status = 'cancelled' where id = v_id;
  v_failed := false;
  begin
    update public.agent_proposals set status = 'pending' where id = v_id;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 7: a cancelled proposal was reopened'; end if;
  raise notice 'PASS 7: previews are immutable and finished proposals stay finished';
end $$;

-- 8. An admin can save a draft through a proposal. It is stored, not sent.
do $$
declare v_id uuid; v_res jsonb; r public.requests;
begin
  select * into r from public.requests where id = pg_temp.k('review');
  insert into public.agent_proposals (created_by, created_role, action_type, target_type, target_id, inputs, input_hash, preconditions, preview, required_role, expires_at)
  values (pg_temp.k('admin'), 'admin', 'draft.save', 'request', r.id,
          '{"kind":"parent_response","body":"Hello, could you send your receipt?","generatedBy":"template"}', repeat('b', 64),
          jsonb_build_object('status', r.status, 'currentDecisionId', r.current_decision_id, 'updatedAt', r.updated_at, 'archivedAt', null, 'hiddenAt', null,
                             'draftUpdatedAt', (select updated_at from public.drafts where request_id = r.id and kind = 'parent_response')),
          '{}', 'staff', now() + interval '15 minutes')
  returning id into v_id;
  v_res := public.execute_agent_proposal(v_id, pg_temp.k('admin'), '{}'::jsonb);
  if (v_res->>'ok')::boolean is not true then raise exception 'FAIL 8: %', v_res; end if;
  if not exists (select 1 from public.drafts where request_id = r.id and kind = 'parent_response' and body like 'Hello, could you send%') then raise exception 'FAIL 8: draft not saved'; end if;
  raise notice 'PASS 8: draft saved through a confirmed proposal';
end $$;

rollback;
