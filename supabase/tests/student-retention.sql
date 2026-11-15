-- Checks for the Student Retention Agent (supabase/migrations/20261105000002_student_retention.sql
-- and supabase/retention-demo.sql). Runs in one transaction and rolls back, so it leaves
-- no trace. Any failed check stops with an error.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/student-retention.sql

begin;

insert into auth.users (id, email) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'ret-owner@test.example'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ret-admin@test.example')
on conflict do nothing;
insert into public.app_users (id, display_name, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Test Owner', 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Test Admin', 'admin')
on conflict (id) do update set role = excluded.role;

do $$
declare
  owner_id uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  admin_id uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_msg uuid;
  v_jack uuid;
  v_live uuid;
  v_ver integer;
  r jsonb;
  ok boolean;
begin
  perform public.reset_payments_demo();
  perform public.reset_retention_demo();
  assert (select count(*) from public.retention_lessons where data_label = 'fictional_demo') > 150, 'demo lessons added';
  assert (select count(*) from public.retention_concerns where confidential) = 1, 'one confidential note';
  assert (select count(*) from public.retention_messages where status = 'sent') = 2, 'two earlier check-ins';

  -- A draft for Aarav's mother.
  insert into public.retention_messages (student_id, contact_id, channel, recipient_name, address, subject, body, mode)
  values ('ST-01', 'BC-01', 'email', 'Priya Mehta', 'priya.mehta@example.com', 'Checking in', 'Hi Priya, how are lessons going?', 'demo')
  returning id into v_msg;

  -- Only one draft in progress per student.
  ok := false;
  begin
    insert into public.retention_messages (student_id, contact_id, channel, recipient_name, address, body, mode) values ('ST-01', 'BC-01', 'sms', 'Priya Mehta', '+61 412 555 101', 'Hi', 'demo');
  exception when unique_violation then ok := true; end;
  assert ok, 'second open draft refused';

  -- An admin can't approve or send.
  ok := false;
  begin perform public.approve_retention_message(v_msg, admin_id, 1); exception when others then ok := sqlerrm like 'forbidden:%'; end;
  assert ok, 'admin approval refused';

  -- Sending before approval is refused.
  ok := false;
  begin perform public.send_retention_message(v_msg, owner_id, 'email', true); exception when others then ok := sqlerrm like 'invalid_transition:%'; end;
  assert ok, 'send before approval refused';

  -- A stale version is refused.
  ok := false;
  begin perform public.approve_retention_message(v_msg, owner_id, 7); exception when others then ok := sqlerrm like 'stale_update:%'; end;
  assert ok, 'stale approval refused';

  r := public.approve_retention_message(v_msg, owner_id, 1);
  assert (r->>'version')::int = 2, 'version moves on';
  assert (select status = 'approved' and approved_by = owner_id and approved_at is not null and approved_hash is not null from public.retention_messages where id = v_msg), 'approval recorded with who and when';

  -- Approved twice is refused.
  ok := false;
  begin perform public.approve_retention_message(v_msg, owner_id, 2); exception when others then ok := sqlerrm like 'invalid_transition:%'; end;
  assert ok, 'second approval refused';

  -- A change after approval that skipped the app's reset is still caught by the fingerprint.
  update public.retention_messages set body = 'Hi Priya, Aarav is at risk.' where id = v_msg;
  ok := false;
  begin perform public.send_retention_message(v_msg, owner_id, 'email', true); exception when others then ok := sqlerrm like 'stale_update:%'; end;
  assert ok, 'changed after approval refused';
  update public.retention_messages set body = 'Hi Priya, how are lessons going?' where id = v_msg;

  -- The owner must send by the channel that was approved.
  ok := false;
  begin perform public.send_retention_message(v_msg, owner_id, 'sms', true); exception when others then ok := sqlerrm like 'invalid_input:%'; end;
  assert ok, 'different channel needs a fresh approval';

  -- Demo messages can only be simulated.
  ok := false;
  begin perform public.send_retention_message(v_msg, owner_id, 'email', false); exception when others then ok := sqlerrm like 'invalid_input:%'; end;
  assert ok, 'demo message cannot go live';

  r := public.send_retention_message(v_msg, owner_id, 'email', true);
  assert r->>'status' = 'sent', 'simulated send';
  assert (select delivery_status = 'simulated' and sent_by = owner_id and follow_up = 'scheduled' from public.retention_messages where id = v_msg), 'recorded as simulated, never delivered';

  -- No second send.
  ok := false;
  begin perform public.send_retention_message(v_msg, owner_id, 'email', true); exception when others then ok := sqlerrm like 'invalid_transition:%already been sent%'; end;
  assert ok, 'repeat send refused';

  -- Cooldown: another check-in for Aarav straight away is held back.
  insert into public.retention_messages (student_id, contact_id, channel, recipient_name, address, subject, body, mode)
  values ('ST-01', 'BC-01', 'email', 'Priya Mehta', 'priya.mehta@example.com', 'Again', 'Hi again', 'demo') returning id, version into v_msg, v_ver;
  perform public.approve_retention_message(v_msg, owner_id, v_ver);
  ok := false;
  begin perform public.send_retention_message(v_msg, owner_id, 'email', true); exception when others then ok := sqlerrm like 'invalid_transition:%held back%'; end;
  assert ok, 'cooldown holds back a repeat check-in';

  -- Jack's father hasn't agreed to SMS.
  insert into public.retention_messages (student_id, contact_id, channel, recipient_name, address, body, mode)
  values ('ST-07', 'BC-06', 'sms', 'Tom Nguyen', '+61 412 555 106', 'Hi Tom', 'demo') returning id, version into v_jack, v_ver;
  perform public.approve_retention_message(v_jack, owner_id, v_ver);
  ok := false;
  begin perform public.send_retention_message(v_jack, owner_id, 'sms', true); exception when others then ok := sqlerrm like 'forbidden:%SMS%'; end;
  assert ok, 'SMS without permission refused';

  -- An email draft needs a subject before approval.
  delete from public.retention_messages where id = v_jack;
  insert into public.retention_messages (student_id, contact_id, channel, recipient_name, address, body, mode)
  values ('ST-07', 'BC-06', 'email', 'Tom Nguyen', 'tom.nguyen@example.com', 'Hi Tom', 'demo') returning id, version into v_jack, v_ver;
  ok := false;
  begin perform public.approve_retention_message(v_jack, owner_id, v_ver); exception when others then ok := sqlerrm like 'invalid_input:%subject%'; end;
  assert ok, 'email without subject refused';

  -- Reset restores demo rows only. A live record survives.
  insert into public.billing_contacts (id, name, email, data_label) values ('BC-LIVE-1', 'Real Parent', 'real@example.com', 'live_connected');
  insert into public.billing_students (id, name, billing_contact_id, enrolled, data_label) values ('ST-LIVE-1', 'Real Student', 'BC-LIVE-1', true, 'live_connected');
  insert into public.retention_lessons (student_id, lesson_date, subject, outcome, data_label) values ('ST-LIVE-1', current_date - 3, 'Maths', 'attended', 'live_connected');
  insert into public.retention_messages (student_id, contact_id, channel, recipient_name, address, subject, body, mode, data_label)
  values ('ST-LIVE-1', 'BC-LIVE-1', 'email', 'Real Parent', 'real@example.com', 'Hello', 'Hello', 'live', 'live_connected') returning id into v_live;
  perform public.reset_retention_demo();
  assert exists (select 1 from public.retention_lessons where student_id = 'ST-LIVE-1'), 'live lesson kept';
  assert exists (select 1 from public.retention_messages where id = v_live), 'live message kept';
  assert (select count(*) from public.retention_messages where data_label = 'fictional_demo') = 2, 'demo messages back to the two earlier check-ins';
  assert not exists (select 1 from public.retention_messages where student_id = 'ST-07'), 'demo drafts cleared';

  -- Live messages can't be simulated.
  ok := false;
  begin perform public.send_retention_message(v_live, owner_id, 'email', true); exception when others then ok := sqlerrm like 'invalid_transition:%' or sqlerrm like 'invalid_input:%'; end;
  assert ok, 'live message not simulated';

  raise notice 'Student Retention checks passed';
end $$;

rollback;
