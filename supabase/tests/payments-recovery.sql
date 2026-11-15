-- Checks for the Payments module (supabase/migrations/20261105000001_payments_recovery.sql).
-- Runs in one transaction and rolls back, so it leaves no trace. Any failed check stops
-- with an error.
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/payments-recovery.sql

begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'pay-owner@test.example'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'pay-admin@test.example')
on conflict do nothing;
insert into public.app_users (id, display_name, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Owner', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Test Admin', 'admin')
on conflict (id) do update set role = excluded.role;

do $$
declare
  v_run uuid;
  v_batch uuid;
  r jsonb;
  ok boolean;
  owner_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  admin_id uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
begin
  perform public.reset_payments_demo();
  assert (select count(*) from public.billing_students where enrolled and data_label = 'fictional_demo') = 9, 'nine enrolled demo students';
  assert (select count(*) from public.billing_invoices where data_label = 'fictional_demo') = 11, 'eleven demo invoices';
  assert public.billing_contact_protected('BC-05') and public.billing_contact_protected('BC-06'), 'extension and dispute protect';
  assert not public.billing_contact_protected('BC-01'), 'Mehta family not protected';

  -- A batch: Priya by email, Sarah (protected) by email, Daniel by SMS, one left out.
  insert into public.recovery_runs (mode) values ('demo') returning id into v_run;
  insert into public.recovery_batches (run_id, mode, contact_ids) values (v_run, 'demo', array['BC-01','BC-05','BC-02']) returning id into v_batch;
  insert into public.recovery_messages (batch_id, contact_id, recipient_kind, recipient_name, channel, address, body, invoice_ids, amount_cents) values
    (v_batch, 'BC-01', 'parent', 'Priya Mehta', 'email', 'priya.mehta@example.com', 'Hi Priya', array['INV-2041','INV-2042'], 50000),
    (v_batch, 'BC-05', 'parent', 'Sarah Chen', 'email', 'sarah.chen@example.com', 'Hi Sarah', array['INV-2046'], 18000),
    (v_batch, 'BC-02', 'parent', 'Daniel O''Brien', 'sms', '+61412555102', 'Hi Daniel', array['INV-2043'], 24000);
  insert into public.recovery_messages (batch_id, contact_id, recipient_kind, recipient_name, channel, address, body, invoice_ids, included) values
    (v_batch, 'BC-02', 'parent', 'Daniel O''Brien', 'email', 'daniel.obrien@example.com', 'Hi Daniel', array['INV-2043'], false);

  -- The same address and channel can't be added twice to one batch.
  begin
    insert into public.recovery_messages (batch_id, contact_id, student_id, recipient_kind, recipient_name, channel, address, body)
    values (v_batch, 'BC-02', 'ST-03', 'student', 'Liam O''Brien', 'sms', '+61412555102', 'Hi Liam');
    raise exception 'duplicate address was accepted';
  exception when unique_violation then null;
  end;

  -- Only the owner approves.
  begin
    perform public.approve_recovery_batch(v_batch, admin_id, 1, true);
    raise exception 'admin approved a batch';
  exception when raise_exception then
    assert sqlerrm like 'forbidden:%', 'admin gets forbidden, got ' || sqlerrm;
  end;
  -- A stale screen is refused.
  begin
    perform public.approve_recovery_batch(v_batch, owner_id, 99, true);
    raise exception 'stale version accepted';
  exception when raise_exception then
    assert sqlerrm like 'stale_update:%', 'stale version refused, got ' || sqlerrm;
  end;
  -- A demo batch can't be sent live.
  begin
    perform public.approve_recovery_batch(v_batch, owner_id, 1, false);
    raise exception 'demo batch sent live';
  exception when raise_exception then
    assert sqlerrm like 'invalid_input:%', 'demo batch only simulated, got ' || sqlerrm;
  end;

  r := public.approve_recovery_batch(v_batch, owner_id, 1, true);
  assert jsonb_array_length(r->'go') = 2, 'Priya and Daniel go: ' || r::text;
  assert jsonb_array_length(r->'held') = 2, 'Sarah held and the left-out email: ' || r::text;
  assert (select status from public.recovery_messages where batch_id = v_batch and contact_id = 'BC-05') = 'blocked', 'protected family blocked at send time';
  assert (select status from public.recovery_messages where batch_id = v_batch and contact_id = 'BC-02' and channel = 'email') = 'excluded', 'left-out message stays out';
  assert (select count(*) from public.recovery_messages where batch_id = v_batch and status = 'simulated') = 2, 'two simulated';
  begin
    perform public.approve_recovery_batch(v_batch, owner_id, 2, true);
    raise exception 'batch approved twice';
  exception when raise_exception then
    assert sqlerrm like 'invalid_transition:%', 'second approval refused, got ' || sqlerrm;
  end;

  -- Payments: full, part, duplicate, overpayment, and one with no reminder first.
  r := public.record_recovered_payment('INV-2041', 26000, 'DEMO-A', 'demo_simulated', now() + interval '1 minute', owner_id);
  assert (r->>'counted')::boolean and (r->>'fullyPaid')::boolean, 'INV-2041 counted and paid';
  r := public.record_recovered_payment('INV-2041', 26000, 'DEMO-A', 'demo_simulated', now(), owner_id);
  assert (r->>'duplicate')::boolean, 'same payment not counted twice';
  r := public.record_recovered_payment('INV-2042', 10000, 'DEMO-B', 'demo_simulated', now() + interval '1 minute', owner_id);
  assert (r->>'counted')::boolean and not (r->>'fullyPaid')::boolean, 'part payment counted, invoice still open';
  begin
    perform public.record_recovered_payment('INV-2042', 20000, 'DEMO-C', 'demo_simulated', now(), owner_id);
    raise exception 'overpayment accepted';
  exception when raise_exception then
    assert sqlerrm like 'invalid_input:%', 'overpayment refused, got ' || sqlerrm;
  end;
  r := public.record_recovered_payment('INV-2042', 14000, 'DEMO-D', 'demo_simulated', now() + interval '1 minute', owner_id);
  assert (r->>'fullyPaid')::boolean, 'second part payment completes the invoice';
  r := public.record_recovered_payment('INV-2048', 12000, 'DEMO-E', 'demo_simulated', now(), owner_id);
  assert not (r->>'counted')::boolean, 'payment with no reminder is not credited to recovery';
  assert (select sum(amount_cents) from public.recovered_payments where attributed and data_label = 'fictional_demo') = 50000, 'Payments Recovered is $500';
  assert (select status from public.billing_invoices where id = 'INV-2041') = 'paid', 'invoice marked paid';

  -- Simulated payments never touch real (live) invoices.
  insert into public.billing_contacts (id, name, data_label) values ('BC-LIVE-1', 'Real Parent', 'live_connected');
  insert into public.billing_invoices (id, contact_id, amount_cents, issued_on, due_date, data_label) values ('INV-LIVE-1', 'BC-LIVE-1', 10000, current_date - 20, current_date - 10, 'live_connected');
  begin
    perform public.record_recovered_payment('INV-LIVE-1', 10000, 'DEMO-F', 'demo_simulated', now(), owner_id);
    raise exception 'simulated payment hit a live invoice';
  exception when raise_exception then
    assert sqlerrm like 'forbidden:%', 'live invoice protected, got ' || sqlerrm;
  end;

  -- The reset puts the demo back and leaves live records alone.
  perform public.reset_payments_demo();
  assert (select count(*) from public.recovered_payments where data_label = 'fictional_demo') = 0, 'demo payments cleared';
  assert (select count(*) from public.recovery_runs where data_label = 'fictional_demo') = 0, 'demo runs cleared';
  assert (select amount_paid_cents from public.billing_invoices where id = 'INV-2041') = 0, 'INV-2041 unpaid again';
  assert exists (select 1 from public.billing_invoices where id = 'INV-LIVE-1'), 'live invoice kept';
  raise notice 'payments-recovery: all checks passed';
end $$;

rollback;
