-- Checks for owner review (supabase/migrations/20261020000002_owner_review.sql). Run against
-- a database with the migrations and demo data loaded. Everything runs in one transaction
-- and is rolled back at the end, so it leaves no trace. Any failed check stops with an error.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/owner-review.sql

begin;

create temporary table t_ids (k text primary key, v uuid);
insert into t_ids values
  ('admin', (select id from public.app_users where role = 'admin' order by id limit 1)),
  ('owner', (select id from public.app_users where role = 'owner' order by id limit 1)),
  -- A review_required request with every detail (BK-1043 in the demo data).
  ('review', (select id from public.requests where status = 'review_required' and public.request_missing_count(id) = 0 order by created_at limit 1)),
  -- A needs_clarification request with a missing detail (BK-1044 in the demo data).
  ('missing', (select id from public.requests where status = 'needs_clarification' and public.request_missing_count(id) > 0 order by created_at limit 1)),
  ('closed', (select id from public.requests where status = 'closed' order by created_at limit 1));

create or replace function pg_temp.k(p text) returns uuid language sql as $$ select v from t_ids where k = p $$;

-- Runs a statement and returns the error prefix, or 'ok'.
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return split_part(sqlerrm, ':', 1);
end $$;

do $$
begin
  if pg_temp.k('review') is null or pg_temp.k('missing') is null or pg_temp.k('closed') is null then
    raise exception 'SETUP: demo data needs a complete review_required, a needs_clarification with missing details and a closed request';
  end if;
end $$;

-- 1. An admin can never make an owner decision.
do $$
begin
  if pg_temp.try(format('select public.transition_request(%L, %L, ''approve'', ''x'')', pg_temp.k('review'), pg_temp.k('admin'))) <> 'forbidden' then raise exception 'FAIL 1: admin approved'; end if;
  if pg_temp.try(format('select public.transition_request(%L, %L, ''decline'', ''x'')', pg_temp.k('review'), pg_temp.k('admin'))) <> 'forbidden' then raise exception 'FAIL 1: admin declined'; end if;
  if pg_temp.try(format('select public.start_owner_review(%L, %L)', pg_temp.k('review'), pg_temp.k('admin'))) <> 'forbidden' then raise exception 'FAIL 1: admin started a review'; end if;
  if pg_temp.try(format('select public.add_owner_handling_note(%L, %L, ''x'')', pg_temp.k('review'), pg_temp.k('admin'))) <> 'forbidden' then raise exception 'FAIL 1: admin added a handling note'; end if;
  raise notice 'PASS 1: admin cannot do owner-only actions';
end $$;

-- 2. The owner can't send a request to themselves.
do $$
begin
  if pg_temp.try(format('select public.transition_request(%L, %L, ''send_to_owner'', ''x'')', pg_temp.k('review'), pg_temp.k('owner'))) <> 'forbidden' then raise exception 'FAIL 2'; end if;
  raise notice 'PASS 2: owner cannot send to owner';
end $$;

-- 3. Nothing goes to the owner, and nothing is decided, while details are missing.
do $$
declare v_before text := (select status from public.requests where id = pg_temp.k('missing'));
begin
  if pg_temp.try(format('select public.transition_request(%L, %L, ''send_to_owner'', ''x'')', pg_temp.k('missing'), pg_temp.k('admin'))) <> 'missing_details' then raise exception 'FAIL 3: sent with missing details'; end if;
  if pg_temp.try(format('select public.transition_request(%L, %L, ''approve'', ''x'')', pg_temp.k('missing'), pg_temp.k('owner'))) <> 'missing_details' then raise exception 'FAIL 3: approved with missing details'; end if;
  if pg_temp.try(format('select public.transition_request(%L, %L, ''decline'', ''x'')', pg_temp.k('missing'), pg_temp.k('owner'))) <> 'missing_details' then raise exception 'FAIL 3: decided with missing details'; end if;
  if pg_temp.try(format('select public.start_owner_review(%L, %L)', pg_temp.k('missing'), pg_temp.k('owner'))) <> 'missing_details' then raise exception 'FAIL 3: review started with missing details'; end if;
  if (select status from public.requests where id = pg_temp.k('missing')) <> v_before then raise exception 'FAIL 3: status changed'; end if;
  raise notice 'PASS 3: missing details block sending and deciding';
end $$;

-- 4. Start Review records who and when once, and changes no status.
do $$
declare
  v_status text := (select status from public.requests where id = pg_temp.k('review'));
  v_updated timestamptz := (select updated_at from public.requests where id = pg_temp.k('review'));
  v_first jsonb; v_second jsonb;
begin
  v_first := public.start_owner_review(pg_temp.k('review'), pg_temp.k('owner'));
  v_second := public.start_owner_review(pg_temp.k('review'), pg_temp.k('owner'));
  if (v_first->>'already')::boolean or not (v_second->>'already')::boolean then raise exception 'FAIL 4: not idempotent'; end if;
  if (select count(*) from public.request_events where request_id = pg_temp.k('review') and event_type = 'owner_review_started') <> 1 then raise exception 'FAIL 4: duplicate events'; end if;
  if (select status from public.requests where id = pg_temp.k('review')) <> v_status then raise exception 'FAIL 4: status changed'; end if;
  if (select updated_at from public.requests where id = pg_temp.k('review')) <> v_updated then raise exception 'FAIL 4: updated_at changed'; end if;
  if (select owner_review_started_by from public.requests where id = pg_temp.k('review')) <> pg_temp.k('owner') then raise exception 'FAIL 4: reviewer not recorded'; end if;
  raise notice 'PASS 4: start review is idempotent and changes no status';
end $$;

-- 5. A handling note is an event with no status change, and the rule result stays.
do $$
declare v_before record;
begin
  select status, decision, matched_rule_id, decision_reason into v_before from public.requests where id = pg_temp.k('review');
  perform public.add_owner_handling_note(pg_temp.k('review'), pg_temp.k('owner'), 'Called the parent. Following up on Friday.');
  if (select count(*) from public.request_events where request_id = pg_temp.k('review') and event_type = 'owner_handling_note') <> 1 then raise exception 'FAIL 5: no event'; end if;
  if (select (status, decision, matched_rule_id, decision_reason) from public.requests where id = pg_temp.k('review')) is distinct from (v_before.status, v_before.decision, v_before.matched_rule_id, v_before.decision_reason) then
    raise exception 'FAIL 5: request changed';
  end if;
  raise notice 'PASS 5: handling note recorded without a status change';
end $$;

-- 6. The owner approves a review_required request without the admin sending it, once.
do $$
begin
  perform public.transition_request(pg_temp.k('review'), pg_temp.k('owner'), 'approve', 'Approved after a call with the family.');
  if (select status from public.requests where id = pg_temp.k('review')) <> 'approved' then raise exception 'FAIL 6: not approved'; end if;
  if pg_temp.try(format('select public.transition_request(%L, %L, ''approve'', ''again'')', pg_temp.k('review'), pg_temp.k('owner'))) <> 'invalid_transition' then raise exception 'FAIL 6: approved twice'; end if;
  if (select count(*) from public.request_events where request_id = pg_temp.k('review') and event_type = 'owner_approved') <> 1 then raise exception 'FAIL 6: duplicate decision'; end if;
  raise notice 'PASS 6: owner decides directly, and only once';
end $$;

-- 7. Closed requests can't be reviewed or noted.
do $$
begin
  if pg_temp.try(format('select public.start_owner_review(%L, %L)', pg_temp.k('closed'), pg_temp.k('owner'))) <> 'invalid_transition' then raise exception 'FAIL 7: reviewed a closed request'; end if;
  if pg_temp.try(format('select public.add_owner_handling_note(%L, %L, ''x'')', pg_temp.k('closed'), pg_temp.k('owner'))) <> 'invalid_transition' then raise exception 'FAIL 7: noted a closed request'; end if;
  raise notice 'PASS 7: closed requests stay closed';
end $$;

rollback;
