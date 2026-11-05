-- Payments and the Autonomous Payment Recovery Agent.
--
-- Billing contacts (the parent or guardian who pays), the students they pay for, their
-- invoices (as held in Xero), payment arrangements and disputes found in Gmail, and the
-- recovery agent's own records: each scan, each batch of reminder messages the owner
-- approves, every message, follow-up task, verified payment and audit event.
--
-- The rules that matter are checked here, under a lock, as well as in the app:
--   * approve_recovery_batch: only the owner approves. Every message is checked again just
--     before it goes: the invoices still have a balance, the family has no extension,
--     dispute or plan, the channel is permitted and the address isn't a duplicate.
--   * record_recovered_payment: a payment counts towards Payments Recovered only once
--     (one row per payment reference), never more than the invoice's balance, and only
--     when a reminder for that invoice was sent or simulated before the payment arrived.
--
-- Demo data is labelled 'fictional_demo' and is put back by public.reset_payments_demo(),
-- which the website calls with the main demo reset. Nothing labelled 'live_connected' or
-- 'imported' is ever removed. Safe to run more than once.

create extension if not exists pgcrypto;

-- Records ------------------------------------------------------------------------------
create table if not exists public.billing_contacts (
  id text primary key check (id ~ '^BC-[0-9A-Za-z-]{2,40}$'),
  name text not null check (char_length(name) between 1 and 120),
  email text,
  phone text,
  email_permitted boolean not null default true,
  sms_permitted boolean not null default false,
  xero_contact_id text,
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_students (
  id text primary key check (id ~ '^ST-[0-9A-Za-z-]{2,40}$'),
  name text not null check (char_length(name) between 1 and 120),
  year_level integer check (year_level between 1 and 12),
  billing_contact_id text not null references public.billing_contacts (id),
  enrolled boolean not null default true,
  -- A student is only ever messaged when this is true and the family confirmed it on the date below.
  student_contact_permitted boolean not null default false,
  student_contact_verified_on date,
  student_email text,
  student_phone text,
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create index if not exists billing_students_contact_idx on public.billing_students (billing_contact_id);

create table if not exists public.billing_invoices (
  id text primary key check (id ~ '^INV-[0-9A-Za-z-]{2,40}$'),
  student_id text references public.billing_students (id),
  contact_id text not null references public.billing_contacts (id),
  xero_invoice_id text,
  description text not null default '',
  amount_cents integer not null check (amount_cents > 0),
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  issued_on date not null,
  due_date date not null,
  status text not null default 'authorised' check (status in ('authorised', 'paid', 'voided')),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  updated_at timestamptz not null default now(),
  check (amount_paid_cents <= amount_cents)
);
create index if not exists billing_invoices_contact_idx on public.billing_invoices (contact_id);

-- Extensions, disputes and payment plans. Found in Gmail by the scan, or recorded by the owner.
create table if not exists public.billing_exceptions (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null references public.billing_contacts (id),
  kind text not null check (kind in ('extension', 'dispute', 'payment_plan', 'hardship')),
  source text not null default 'gmail' check (source in ('gmail', 'owner', 'sms')),
  summary text not null check (char_length(summary) <= 500),
  found_on date not null default current_date,
  active_until date,
  active boolean not null default true,
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create index if not exists billing_exceptions_contact_idx on public.billing_exceptions (contact_id) where active;

-- The owner's recovery rules. One row.
create table if not exists public.recovery_settings (
  id integer primary key default 1 check (id = 1),
  min_days_overdue integer not null default 7 check (min_days_overdue between 0 and 120),
  min_balance_cents integer not null default 5000 check (min_balance_cents >= 0),
  escalate_after_days integer not null default 28 check (escalate_after_days between 1 and 365),
  max_reminders integer not null default 2 check (max_reminders between 1 and 6),
  manual_minutes_per_family integer not null default 12 check (manual_minutes_per_family between 0 and 120),
  manual_minutes_per_invoice integer not null default 3 check (manual_minutes_per_invoice between 0 and 60),
  admin_hourly_rate_cents integer not null default 3800 check (admin_hourly_rate_cents >= 0),
  updated_at timestamptz not null default now()
);
insert into public.recovery_settings (id) values (1) on conflict (id) do nothing;

-- Agent records ------------------------------------------------------------------------
create table if not exists public.recovery_runs (
  id uuid primary key default gen_random_uuid(),
  started_by uuid references public.app_users (id),
  mode text not null check (mode in ('demo', 'live')),
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  steps jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  assessments jsonb not null default '[]'::jsonb,
  log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);

create table if not exists public.recovery_batches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.recovery_runs (id) on delete cascade,
  mode text not null check (mode in ('demo', 'live')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'cancelled')),
  contact_ids text[] not null,
  excluded jsonb not null default '[]'::jsonb,
  created_by uuid references public.app_users (id),
  approved_by uuid references public.app_users (id),
  approved_at timestamptz,
  version integer not null default 1,
  expires_at timestamptz not null default now() + interval '1 day',
  created_at timestamptz not null default now(),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);

create table if not exists public.recovery_messages (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.recovery_batches (id) on delete cascade,
  contact_id text not null references public.billing_contacts (id),
  student_id text references public.billing_students (id),
  recipient_kind text not null check (recipient_kind in ('parent', 'student')),
  recipient_name text not null,
  channel text not null check (channel in ('email', 'sms')),
  address text not null,
  subject text,
  body text not null check (char_length(body) between 1 and 4000),
  invoice_ids text[] not null default '{}',
  amount_cents integer not null default 0,
  included boolean not null default true,
  edited boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'excluded', 'simulated', 'queued', 'sent', 'delivered', 'failed', 'blocked')),
  status_reason text,
  provider_ref text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  -- One message per address and channel in a batch, so nobody gets the same reminder twice.
  unique (batch_id, channel, address)
);
create index if not exists recovery_messages_contact_idx on public.recovery_messages (contact_id, sent_at);

create table if not exists public.recovery_tasks (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null references public.billing_contacts (id),
  kind text not null check (kind in ('reply_follow_up', 'promise_to_pay', 'escalation', 'delivery_failed')),
  summary text not null check (char_length(summary) <= 500),
  status text not null default 'open' check (status in ('open', 'done')),
  needs_owner boolean not null default false,
  source_ref text,
  created_at timestamptz not null default now(),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  unique (contact_id, kind, source_ref)
);

create table if not exists public.recovered_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id text not null references public.billing_invoices (id),
  contact_id text not null references public.billing_contacts (id),
  payment_ref text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  paid_at timestamptz not null default now(),
  verified_at timestamptz not null default now(),
  source text not null check (source in ('xero', 'demo_simulated')),
  -- The batch whose reminder came before this payment, or null when the payment can't be credited to the agent.
  batch_id uuid references public.recovery_batches (id) on delete set null,
  attributed boolean not null default false,
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);

create table if not exists public.recovery_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  detail text not null check (char_length(detail) <= 1000),
  mode text not null check (mode in ('demo', 'live', 'system')),
  run_id uuid references public.recovery_runs (id) on delete cascade,
  batch_id uuid references public.recovery_batches (id) on delete cascade,
  contact_id text references public.billing_contacts (id),
  invoice_id text references public.billing_invoices (id),
  actor_id uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create index if not exists recovery_events_time_idx on public.recovery_events (created_at desc);

-- Only the server (secret key) reads or writes any of this.
alter table public.billing_contacts enable row level security;
alter table public.billing_students enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_exceptions enable row level security;
alter table public.recovery_settings enable row level security;
alter table public.recovery_runs enable row level security;
alter table public.recovery_batches enable row level security;
alter table public.recovery_messages enable row level security;
alter table public.recovery_tasks enable row level security;
alter table public.recovered_payments enable row level security;
alter table public.recovery_events enable row level security;

-- Is this family protected from reminders today? (extension, dispute, plan or hardship)
create or replace function public.billing_contact_protected(p_contact text) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.billing_exceptions e
    where e.contact_id = p_contact and e.active
      and (e.active_until is null or e.active_until >= (now() at time zone 'Australia/Sydney')::date)
  )
$$;

-- Owner approval -------------------------------------------------------------------------
-- Approves a draft batch and marks each included message as it should go. p_simulated
-- means demo mode: messages become 'simulated' and nothing leaves the app. Live messages
-- become 'queued' and the server sends them and records delivery afterwards.
-- Returns the messages that will go and the ones held back, with the reason for each.
create or replace function public.approve_recovery_batch(p_batch uuid, p_actor uuid, p_version integer, p_simulated boolean)
returns jsonb
language plpgsql as $$
declare
  v_role text;
  v_batch public.recovery_batches%rowtype;
  v_msg record;
  v_reason text;
  v_balance integer;
  v_seen text[] := '{}';
  v_key text;
  v_go jsonb := '[]'::jsonb;
  v_held jsonb := '[]'::jsonb;
  v_mode text;
begin
  select role into v_role from public.app_users where id = p_actor;
  if v_role is distinct from 'owner' then
    raise exception 'forbidden: only the owner can approve and send payment reminders';
  end if;

  select * into v_batch from public.recovery_batches where id = p_batch for update;
  if not found then raise exception 'not_found: that batch no longer exists'; end if;
  if v_batch.status <> 'draft' then raise exception 'invalid_transition: this batch has already been %', v_batch.status; end if;
  if v_batch.version <> p_version then raise exception 'stale_update: the messages changed since you opened this screen. Review them again.'; end if;
  if v_batch.expires_at < now() then raise exception 'stale_update: this batch is more than a day old. Run the scan again.'; end if;
  if p_simulated and v_batch.mode <> 'demo' then raise exception 'invalid_input: a live batch cannot be simulated'; end if;
  if not p_simulated and v_batch.mode <> 'live' then raise exception 'invalid_input: demo messages can only be simulated'; end if;
  v_mode := case when p_simulated then 'demo' else 'live' end;

  -- Lock the invoices and contacts involved so nothing changes while we check.
  perform 1 from public.billing_invoices where contact_id = any (v_batch.contact_ids) for update;
  perform 1 from public.billing_contacts where id = any (v_batch.contact_ids) for update;

  for v_msg in
    select m.*, c.email_permitted, c.sms_permitted, s.student_contact_permitted, s.student_contact_verified_on
    from public.recovery_messages m
    join public.billing_contacts c on c.id = m.contact_id
    left join public.billing_students s on s.id = m.student_id
    where m.batch_id = p_batch
    order by m.recipient_kind, m.contact_id, m.channel
  loop
    v_reason := null;
    if not v_msg.included then
      v_reason := 'Left out by the owner';
    elsif public.billing_contact_protected(v_msg.contact_id) then
      v_reason := 'Family now has an extension, dispute or payment plan';
    else
      select coalesce(sum(amount_cents - amount_paid_cents), 0) into v_balance
      from public.billing_invoices
      where id = any (v_msg.invoice_ids) and status = 'authorised';
      if v_balance <= 0 then
        v_reason := 'Invoices already paid';
      elsif v_msg.recipient_kind = 'parent' and v_msg.channel = 'email' and not v_msg.email_permitted then
        v_reason := 'Email not permitted for this contact';
      elsif v_msg.recipient_kind = 'parent' and v_msg.channel = 'sms' and not v_msg.sms_permitted then
        v_reason := 'SMS not permitted for this contact';
      elsif v_msg.recipient_kind = 'student' and not (coalesce(v_msg.student_contact_permitted, false) and v_msg.student_contact_verified_on is not null) then
        v_reason := 'Student contact not verified';
      end if;
    end if;
    v_key := v_msg.channel || ':' || lower(regexp_replace(v_msg.address, '\s', '', 'g'));
    if v_reason is null and v_key = any (v_seen) then
      v_reason := 'Same address already receives a message';
    end if;

    if v_reason is null then
      v_seen := v_seen || v_key;
      update public.recovery_messages
        set status = case when p_simulated then 'simulated' else 'queued' end,
            status_reason = case when p_simulated then 'Demo mode: simulated, not sent' else null end,
            sent_at = case when p_simulated then now() else null end,
            updated_at = now()
        where id = v_msg.id;
      v_go := v_go || jsonb_build_object('id', v_msg.id, 'channel', v_msg.channel, 'contact', v_msg.contact_id);
    else
      update public.recovery_messages
        set status = case when v_msg.included then 'blocked' else 'excluded' end, status_reason = v_reason, updated_at = now()
        where id = v_msg.id;
      v_held := v_held || jsonb_build_object('id', v_msg.id, 'contact', v_msg.contact_id, 'reason', v_reason);
    end if;
  end loop;

  update public.recovery_batches
    set status = 'sent', approved_by = p_actor, approved_at = now(), version = version + 1
    where id = p_batch;

  insert into public.recovery_events (kind, detail, mode, run_id, batch_id, actor_id, data_label)
  values ('batch_approved',
          format('Owner approved %s message(s)%s; %s held back after the final check.',
                 jsonb_array_length(v_go), case when p_simulated then ' (simulated in demo mode, nothing sent)' else '' end, jsonb_array_length(v_held)),
          v_mode, v_batch.run_id, p_batch, p_actor, v_batch.data_label);

  return jsonb_build_object('go', v_go, 'held', v_held, 'mode', v_mode);
end $$;

-- Verified payments -------------------------------------------------------------------------
-- Records a payment confirmed in Xero (or, in demo mode, a simulated confirmation). It is
-- credited to the recovery agent only when a reminder covering the invoice went out (or was
-- simulated) before the payment. The same payment reference is never counted twice, and a
-- payment can't be more than what is still owed.
create or replace function public.record_recovered_payment(
  p_invoice text, p_amount_cents integer, p_payment_ref text, p_source text, p_paid_at timestamptz, p_actor uuid
) returns jsonb
language plpgsql as $$
declare
  v_inv public.billing_invoices%rowtype;
  v_balance integer;
  v_batch uuid;
  v_paid boolean;
  v_label text;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'invalid_input: enter an amount above $0'; end if;
  if p_source not in ('xero', 'demo_simulated') then raise exception 'invalid_input: unknown payment source'; end if;
  if p_payment_ref is null or char_length(p_payment_ref) not between 3 and 120 then raise exception 'invalid_input: a payment reference is needed'; end if;

  select * into v_inv from public.billing_invoices where id = p_invoice for update;
  if not found then raise exception 'not_found: that invoice no longer exists'; end if;
  if p_source = 'demo_simulated' and v_inv.data_label <> 'fictional_demo' then
    raise exception 'forbidden: simulated payments can only be recorded against demo invoices';
  end if;

  if exists (select 1 from public.recovered_payments where payment_ref = p_payment_ref) then
    return jsonb_build_object('duplicate', true, 'counted', false);
  end if;

  v_balance := v_inv.amount_cents - v_inv.amount_paid_cents;
  if v_inv.status <> 'authorised' or v_balance <= 0 then raise exception 'invalid_input: this invoice has nothing left to pay'; end if;
  if p_amount_cents > v_balance then raise exception 'invalid_input: the payment is more than the % still owed', to_char(v_balance / 100.0, 'FM$999,990.00'); end if;

  select m.batch_id into v_batch
  from public.recovery_messages m
  join public.recovery_batches b on b.id = m.batch_id
  where p_invoice = any (m.invoice_ids)
    and m.status in ('simulated', 'sent', 'delivered')
    and coalesce(m.sent_at, b.approved_at) <= coalesce(p_paid_at, now())
  order by m.sent_at desc nulls last
  limit 1;

  v_paid := v_inv.amount_paid_cents + p_amount_cents >= v_inv.amount_cents;
  update public.billing_invoices
    set amount_paid_cents = amount_paid_cents + p_amount_cents,
        status = case when v_paid then 'paid' else status end,
        updated_at = now()
    where id = p_invoice;

  v_label := v_inv.data_label;
  insert into public.recovered_payments (invoice_id, contact_id, payment_ref, amount_cents, paid_at, source, batch_id, attributed, data_label)
  values (p_invoice, v_inv.contact_id, p_payment_ref, p_amount_cents, coalesce(p_paid_at, now()), p_source, v_batch, v_batch is not null, v_label);

  -- Stop reminders: once a family owes nothing, close their open follow-ups.
  if not exists (select 1 from public.billing_invoices where contact_id = v_inv.contact_id and status = 'authorised' and amount_paid_cents < amount_cents) then
    update public.recovery_tasks set status = 'done' where contact_id = v_inv.contact_id and status = 'open';
  end if;

  insert into public.recovery_events (kind, detail, mode, batch_id, contact_id, invoice_id, actor_id, data_label)
  values ('payment_verified',
          format('%s payment of %s verified on %s%s.%s',
                 case when v_paid then 'Full' else 'Part' end,
                 to_char(p_amount_cents / 100.0, 'FM$999,990.00'), p_invoice,
                 case when p_source = 'demo_simulated' then ' (simulated in demo mode, Xero not changed)' else ' in Xero' end,
                 case when v_batch is null then ' Not counted as recovered: no reminder had been sent first.' when v_paid then ' Reminders stopped for this invoice.' else '' end),
          case when p_source = 'demo_simulated' then 'demo' else 'live' end, v_batch, v_inv.contact_id, p_invoice, p_actor, v_label);

  return jsonb_build_object('duplicate', false, 'counted', v_batch is not null, 'fullyPaid', v_paid, 'balanceCents', v_balance - p_amount_cents);
end $$;

-- Demo data ---------------------------------------------------------------------------------
-- Nine enrolled students in seven families, one former student, and the Gmail findings
-- that protect two families. Dates are counted back from today in Sydney.
create or replace function public.payments_demo_seed() returns void
language plpgsql as $$
declare
  d date := (now() at time zone 'Australia/Sydney')::date;
begin
  insert into public.billing_contacts (id, name, email, phone, email_permitted, sms_permitted, xero_contact_id) values
    ('BC-01', 'Priya Mehta', 'priya.mehta@example.com', '+61 412 555 101', true, true, 'XC-DEMO-01'),
    ('BC-02', 'Daniel O''Brien', 'daniel.obrien@example.com', '+61 412 555 102', true, true, 'XC-DEMO-02'),
    ('BC-03', 'Mei Lin Wong', 'meilin.wong@example.com', '+61 412 555 103', true, true, 'XC-DEMO-03'),
    ('BC-04', 'Fatima Hassan', 'fatima.hassan@example.com', '+61 412 555 10', true, true, 'XC-DEMO-04'),
    ('BC-05', 'Sarah Chen', 'sarah.chen@example.com', '+61 412 555 105', true, true, 'XC-DEMO-05'),
    ('BC-06', 'Tom Nguyen', 'tom.nguyen@example.com', '+61 412 555 106', true, false, 'XC-DEMO-06'),
    ('BC-07', 'Rachel Brown', 'rachel.brown@example.com', '+61 412 555 107', true, true, 'XC-DEMO-07'),
    ('BC-08', 'Karen Smith', 'karen.smith@example.com', '+61 412 555 108', true, false, 'XC-DEMO-08')
  on conflict (id) do nothing;

  insert into public.billing_students (id, name, year_level, billing_contact_id, enrolled, student_contact_permitted, student_contact_verified_on, student_email, student_phone) values
    ('ST-01', 'Aarav Mehta', 9, 'BC-01', true, false, null, null, null),
    ('ST-02', 'Anika Mehta', 7, 'BC-01', true, false, null, null, null),
    -- Liam is 17 and his father agreed to lesson reminders by text. His phone is the family phone.
    ('ST-03', 'Liam O''Brien', 12, 'BC-02', true, true, d - 60, 'liam.obrien@example.com', '+61 412 555 102'),
    ('ST-04', 'Chloe Wong', 11, 'BC-03', true, true, d - 45, 'chloe.wong@example.com', null),
    ('ST-05', 'Omar Hassan', 10, 'BC-04', true, false, null, null, null),
    ('ST-06', 'Oliver Chen', 8, 'BC-05', true, false, null, null, null),
    ('ST-07', 'Jack Nguyen', 11, 'BC-06', true, false, null, null, null),
    ('ST-08', 'Ethan Brown', 6, 'BC-07', true, false, null, null, null),
    ('ST-09', 'Mia Brown', 9, 'BC-07', true, false, null, null, null),
    ('ST-10', 'Noah Smith', 10, 'BC-08', false, false, null, null, null)
  on conflict (id) do nothing;

  insert into public.billing_invoices (id, student_id, contact_id, xero_invoice_id, description, amount_cents, amount_paid_cents, issued_on, due_date, status) values
    ('INV-2041', 'ST-01', 'BC-01', 'XI-DEMO-2041', 'Year 9 Mathematics, Term 4 (4 lessons)', 26000, 0, d - 35, d - 21, 'authorised'),
    ('INV-2042', 'ST-02', 'BC-01', 'XI-DEMO-2042', 'Year 7 English, Term 4 (4 lessons)', 24000, 0, d - 35, d - 21, 'authorised'),
    ('INV-2043', 'ST-03', 'BC-02', 'XI-DEMO-2043', 'Year 12 Physics, Term 4 (4 lessons)', 24000, 0, d - 26, d - 12, 'authorised'),
    ('INV-2044', 'ST-04', 'BC-03', 'XI-DEMO-2044', 'Year 11 Chemistry, Term 4 (6 lessons)', 36000, 0, d - 23, d - 9, 'authorised'),
    ('INV-2045', 'ST-05', 'BC-04', 'XI-DEMO-2045', 'Year 10 Mathematics, Term 4 (3 lessons)', 18000, 0, d - 44, d - 30, 'authorised'),
    ('INV-2046', 'ST-06', 'BC-05', 'XI-DEMO-2046', 'Year 8 Mathematics, Term 4 (3 lessons)', 18000, 0, d - 19, d - 5, 'authorised'),
    ('INV-2047', 'ST-07', 'BC-06', 'XI-DEMO-2047', 'Year 11 English, Term 4 (5 lessons)', 30000, 0, d - 29, d - 15, 'authorised'),
    ('INV-2048', 'ST-08', 'BC-07', 'XI-DEMO-2048', 'Year 6 Reading, Term 4 (2 lessons)', 12000, 0, d - 17, d - 3, 'authorised'),
    ('INV-2049', 'ST-09', 'BC-07', 'XI-DEMO-2049', 'Year 9 Science, Term 4 (4 lessons)', 24000, 24000, d - 30, d - 16, 'paid'),
    ('INV-2050', 'ST-04', 'BC-03', 'XI-DEMO-2050', 'Year 11 Chemistry, Term 4 (2 more lessons)', 12000, 0, d - 2, d + 12, 'authorised'),
    ('INV-2039', 'ST-10', 'BC-08', 'XI-DEMO-2039', 'Year 10 Mathematics, Term 3 (4 lessons)', 24000, 0, d - 70, d - 56, 'authorised')
  on conflict (id) do nothing;

  insert into public.billing_exceptions (contact_id, kind, source, summary, found_on, active_until) values
    ('BC-05', 'extension', 'gmail', 'Owner agreed by email to a 14-day extension while Sarah''s pay cycle changes.', d - 4, d + 10),
    ('BC-06', 'dispute', 'gmail', 'Tom says one lesson on this invoice was cancelled by the tutor and should not be charged.', d - 6, null);

  insert into public.recovery_settings (id) values (1) on conflict (id) do nothing;
end $$;

-- Puts the demo payments back as they started. Called by the website with the main demo reset.
create or replace function public.reset_payments_demo() returns jsonb
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('tutor_compass_payments_reset'));
  delete from public.recovery_events where data_label = 'fictional_demo';
  delete from public.recovered_payments where data_label = 'fictional_demo';
  delete from public.recovery_tasks where data_label = 'fictional_demo';
  delete from public.recovery_messages where data_label = 'fictional_demo';
  delete from public.recovery_batches where data_label = 'fictional_demo';
  delete from public.recovery_runs where data_label = 'fictional_demo';
  delete from public.billing_exceptions where data_label = 'fictional_demo';
  delete from public.billing_invoices where data_label = 'fictional_demo';
  delete from public.billing_students where data_label = 'fictional_demo';
  delete from public.billing_contacts where data_label = 'fictional_demo';
  perform public.payments_demo_seed();
  return jsonb_build_object('resetAt', now(), 'invoices', (select count(*) from public.billing_invoices where data_label = 'fictional_demo'));
end $$;

revoke all on function public.billing_contact_protected(text) from public, anon, authenticated;
revoke all on function public.approve_recovery_batch(uuid, uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.record_recovered_payment(text, integer, text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.payments_demo_seed() from public, anon, authenticated;
revoke all on function public.reset_payments_demo() from public, anon, authenticated;

-- First load: add the demo payments if there are none yet.
do $$
begin
  if not exists (select 1 from public.billing_contacts) then
    perform public.payments_demo_seed();
  end if;
end $$;
