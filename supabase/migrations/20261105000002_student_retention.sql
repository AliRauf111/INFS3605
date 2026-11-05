-- Student Retention Agent.
--
-- Uses the students and parent or guardian contacts the Payments module already holds
-- (billing_students and billing_contacts), so no student is recorded twice. Adds:
--   * retention_lessons: each lesson's attendance (attended, cancelled by the family,
--     cancelled by the tutor, missed, rescheduled or still to come)
--   * retention_concerns: parent concerns, open or resolved. Confidential notes are kept
--     apart: they never count towards a score, never go to the AI and never go in a message.
--   * retention_settings: the thresholds the owner can change
--   * retention_runs, retention_dismissals, retention_alert_state: each analysis, flags
--     the owner dismissed (with the reason) and what happened to the attention alert
--   * retention_messages and retention_events: every check-in draft, its approval, the
--     send, delivery, the parent's response and follow-up, plus an audit log
--
-- The rules that matter are checked here, under a lock, as well as in the app:
--   * approve_retention_message: only the owner approves. The approval is tied to the
--     exact channel, recipient, subject and message (a fingerprint), so any later change
--     needs a fresh approval.
--   * send_retention_message: only the owner sends, only an approved message whose content
--     still matches its approval, only on a channel the family allows, only once, and not
--     when the same student had a check-in within the cooldown period.
--
-- Demo data is labelled 'fictional_demo' and is put back by public.reset_retention_demo(),
-- which the website calls with the main demo reset. Nothing labelled 'live_connected' or
-- 'imported' is ever removed. Run the Payments SQL first. Safe to run more than once.

do $$
begin
  if to_regclass('public.billing_students') is null or to_regclass('public.billing_contacts') is null then
    raise exception 'Run payments-recovery.sql first: the Student Retention Agent uses its student and contact records.';
  end if;
end $$;

-- Records ------------------------------------------------------------------------------
create table if not exists public.retention_lessons (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.billing_students (id) on delete cascade,
  lesson_date date not null,
  subject text not null check (char_length(subject) between 1 and 120),
  tutor_name text,
  outcome text not null check (outcome in ('attended', 'cancelled_family', 'cancelled_tutor', 'no_show', 'rescheduled', 'scheduled')),
  note text check (note is null or char_length(note) <= 300),
  source text not null default 'Lesson register',
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create index if not exists retention_lessons_student_idx on public.retention_lessons (student_id, lesson_date);

create table if not exists public.retention_concerns (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.billing_students (id) on delete cascade,
  raised_on date not null,
  category text not null check (category in ('scheduling', 'tutor_fit', 'progress', 'cost', 'communication', 'other')),
  summary text not null check (char_length(summary) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  confidential boolean not null default false,
  resolved_on date,
  resolved_by uuid references public.app_users (id) on delete set null,
  source text not null default 'Parent conversation',
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create index if not exists retention_concerns_student_idx on public.retention_concerns (student_id);

-- The owner's thresholds. One row.
create table if not exists public.retention_settings (
  id smallint primary key default 1 check (id = 1),
  high_threshold integer not null default 60 check (high_threshold between 1 and 100),
  medium_threshold integer not null default 30 check (medium_threshold between 1 and 100),
  window_days integer not null default 30 check (window_days between 7 and 90),
  baseline_days integer not null default 60 check (baseline_days between 14 and 180),
  min_lessons integer not null default 3 check (min_lessons between 1 and 20),
  cooldown_days integer not null default 14 check (cooldown_days between 1 and 60),
  updated_by uuid references public.app_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (medium_threshold < high_threshold)
);

create table if not exists public.retention_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users (id) on delete set null,
  monitored integer not null default 0,
  high integer not null default 0,
  medium integer not null default 0,
  low integer not null default 0,
  mode text not null default 'demo' check (mode in ('demo', 'live')),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create index if not exists retention_runs_time_idx on public.retention_runs (created_at desc);

-- A flag the owner says is wrong, with the reason. It stays dismissed until the student's
-- score rises again (the app compares it with score_at).
create table if not exists public.retention_dismissals (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.billing_students (id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 300),
  score_at integer not null check (score_at between 0 and 100),
  level_at text not null check (level_at in ('high', 'medium', 'low')),
  active boolean not null default true,
  dismissed_by uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create unique index if not exists retention_dismissals_one_active on public.retention_dismissals (student_id) where active;

-- The "Student Retention Alert" in What Needs My Attention. The key names the high-risk
-- students it was about, so a new student at risk brings the alert back.
create table if not exists public.retention_alert_state (
  alert_key text primary key check (char_length(alert_key) between 1 and 400),
  state text not null check (state in ('reviewed', 'dismissed', 'snoozed')),
  until timestamptz,
  actor_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);

create table if not exists public.retention_messages (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.billing_students (id) on delete cascade,
  contact_id text not null references public.billing_contacts (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  recipient_name text not null check (char_length(recipient_name) between 1 and 120),
  address text not null default '' check (char_length(address) <= 200),
  subject text check (subject is null or char_length(subject) <= 200),
  body text not null check (char_length(body) between 1 and 4000),
  source text not null default 'template' check (source in ('template', 'ai', 'owner')),
  variant integer not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_approval', 'approved', 'rejected', 'sending', 'sent', 'failed')),
  version integer not null default 1,
  prepared_by uuid references public.app_users (id) on delete set null,
  approved_by uuid references public.app_users (id) on delete set null,
  approved_at timestamptz,
  approved_hash text,
  rejected_reason text check (rejected_reason is null or char_length(rejected_reason) <= 300),
  sent_by uuid references public.app_users (id) on delete set null,
  sent_at timestamptz,
  delivery_status text not null default 'none' check (delivery_status in ('none', 'simulated', 'accepted', 'delivered', 'failed')),
  delivery_detail text check (delivery_detail is null or char_length(delivery_detail) <= 300),
  provider_ref text,
  response_status text not null default 'none' check (response_status in ('none', 'received')),
  response_at timestamptz,
  response_note text check (response_note is null or char_length(response_note) <= 500),
  follow_up text not null default 'none' check (follow_up in ('none', 'scheduled', 'required', 'resolved')),
  follow_up_on date,
  mode text not null default 'demo' check (mode in ('demo', 'live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create index if not exists retention_messages_student_idx on public.retention_messages (student_id, created_at desc);
-- One draft in progress per student at a time.
create unique index if not exists retention_messages_one_open on public.retention_messages (student_id)
  where status in ('draft', 'awaiting_approval', 'approved', 'rejected', 'sending');

create table if not exists public.retention_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  detail text not null check (char_length(detail) <= 1000),
  student_id text,
  message_id uuid,
  actor_id uuid references public.app_users (id) on delete set null,
  mode text not null default 'demo' check (mode in ('demo', 'live', 'system')),
  created_at timestamptz not null default now(),
  data_label text not null default 'fictional_demo' check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);
create index if not exists retention_events_time_idx on public.retention_events (created_at desc);

-- Only the server (secret key) reads or writes any of this.
alter table public.retention_lessons enable row level security;
alter table public.retention_concerns enable row level security;
alter table public.retention_settings enable row level security;
alter table public.retention_runs enable row level security;
alter table public.retention_dismissals enable row level security;
alter table public.retention_alert_state enable row level security;
alter table public.retention_messages enable row level security;
alter table public.retention_events enable row level security;

-- The fingerprint an approval is tied to: channel, recipient, subject and message.
create or replace function public.retention_message_hash(p_channel text, p_address text, p_subject text, p_body text)
returns text language sql immutable as $$
  select md5(coalesce(p_channel, '') || chr(31) || coalesce(p_address, '') || chr(31) || coalesce(p_subject, '') || chr(31) || coalesce(p_body, ''))
$$;

-- Owner approval ------------------------------------------------------------------------
create or replace function public.approve_retention_message(p_id uuid, p_actor uuid, p_version integer)
returns jsonb
language plpgsql as $$
declare
  v_role text;
  v_name text;
  v_msg public.retention_messages%rowtype;
  v_hash text;
begin
  select role, display_name into v_role, v_name from public.app_users where id = p_actor;
  if v_role is distinct from 'owner' then
    raise exception 'forbidden: only the owner can approve a check-in message';
  end if;
  select * into v_msg from public.retention_messages where id = p_id for update;
  if not found then raise exception 'not_found: that draft no longer exists'; end if;
  if v_msg.status not in ('draft', 'awaiting_approval') then
    raise exception 'invalid_transition: this message is % and cannot be approved now', replace(v_msg.status, '_', ' ');
  end if;
  if v_msg.version <> p_version then
    raise exception 'stale_update: the message changed since you opened it. Read it again before approving.';
  end if;
  if char_length(trim(v_msg.address)) = 0 then raise exception 'invalid_input: there is no % for this family', case when v_msg.channel = 'sms' then 'mobile number' else 'email address' end; end if;
  if v_msg.channel = 'email' and char_length(trim(coalesce(v_msg.subject, ''))) = 0 then raise exception 'invalid_input: add a subject line before approving'; end if;
  v_hash := public.retention_message_hash(v_msg.channel, v_msg.address, v_msg.subject, v_msg.body);
  update public.retention_messages
    set status = 'approved', approved_by = p_actor, approved_at = now(), approved_hash = v_hash,
        rejected_reason = null, version = version + 1, updated_at = now()
    where id = p_id;
  insert into public.retention_events (kind, detail, student_id, message_id, actor_id, mode, data_label)
  values ('approved', format('%s approved the %s check-in to %s.', coalesce(v_name, 'The owner'), case when v_msg.channel = 'sms' then 'SMS' else 'email' end, v_msg.recipient_name),
          v_msg.student_id, p_id, p_actor, v_msg.mode, v_msg.data_label);
  return jsonb_build_object('version', v_msg.version + 1, 'approvedAt', now());
end $$;

-- Sending ------------------------------------------------------------------------------------
-- p_simulated means demo mode: the message is marked as a simulated send and nothing leaves
-- the app. Live messages become 'sending' and the server hands them to Gmail or the SMS
-- provider, then records what the provider said.
create or replace function public.send_retention_message(p_id uuid, p_actor uuid, p_channel text, p_simulated boolean)
returns jsonb
language plpgsql as $$
declare
  v_role text;
  v_name text;
  v_msg public.retention_messages%rowtype;
  v_contact public.billing_contacts%rowtype;
  v_cooldown integer;
  v_recent timestamptz;
  v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  select role, display_name into v_role, v_name from public.app_users where id = p_actor;
  if v_role is distinct from 'owner' then
    raise exception 'forbidden: only the owner can send a check-in message';
  end if;
  select * into v_msg from public.retention_messages where id = p_id for update;
  if not found then raise exception 'not_found: that message no longer exists'; end if;
  if v_msg.status in ('sending', 'sent') then
    raise exception 'invalid_transition: this message has already been sent';
  end if;
  if v_msg.status <> 'approved' or v_msg.approved_hash is null then
    raise exception 'invalid_transition: approve the message before sending it';
  end if;
  if v_msg.channel <> p_channel then
    raise exception 'invalid_input: this message was approved as % and needs a fresh approval to go by %',
      case when v_msg.channel = 'sms' then 'an SMS' else 'an email' end, case when p_channel = 'sms' then 'SMS' else 'email' end;
  end if;
  if public.retention_message_hash(v_msg.channel, v_msg.address, v_msg.subject, v_msg.body) <> v_msg.approved_hash then
    raise exception 'stale_update: the message changed after it was approved. Approve it again.';
  end if;
  if p_simulated and v_msg.mode <> 'demo' then raise exception 'invalid_input: a live message cannot be simulated'; end if;
  if not p_simulated and v_msg.mode <> 'live' then raise exception 'invalid_input: demo messages can only be simulated'; end if;

  select * into v_contact from public.billing_contacts where id = v_msg.contact_id for update;
  if not found then raise exception 'not_found: the parent or guardian record no longer exists'; end if;
  if v_msg.channel = 'email' and not v_contact.email_permitted then raise exception 'forbidden: this family has not agreed to email'; end if;
  if v_msg.channel = 'sms' and not v_contact.sms_permitted then raise exception 'forbidden: this family has not agreed to SMS'; end if;
  if lower(replace(v_msg.address, ' ', '')) <> lower(replace(coalesce(case when v_msg.channel = 'sms' then v_contact.phone else v_contact.email end, ''), ' ', '')) then
    raise exception 'stale_update: the family''s contact details changed. Prepare the message again.';
  end if;

  select coalesce(cooldown_days, 14) into v_cooldown from public.retention_settings where id = 1;
  select max(sent_at) into v_recent from public.retention_messages
    where student_id = v_msg.student_id and id <> p_id and status = 'sent' and data_label = v_msg.data_label;
  if v_recent is not null and v_recent > now() - make_interval(days => coalesce(v_cooldown, 14)) then
    raise exception 'invalid_transition: this family had a check-in on % so another one is held back for % days',
      to_char(v_recent at time zone 'Australia/Sydney', 'DD Mon'), coalesce(v_cooldown, 14);
  end if;

  update public.retention_messages
    set status = case when p_simulated then 'sent' else 'sending' end,
        delivery_status = case when p_simulated then 'simulated' else 'none' end,
        delivery_detail = case when p_simulated then 'Demo mode: simulated, nothing was sent' else null end,
        sent_by = p_actor, sent_at = now(),
        follow_up = 'scheduled', follow_up_on = v_today + 7,
        updated_at = now()
    where id = p_id;
  insert into public.retention_events (kind, detail, student_id, message_id, actor_id, mode, data_label)
  values (case when p_simulated then 'simulated' else 'sending' end,
          format('%s confirmed the %s to %s%s.', coalesce(v_name, 'The owner'), case when v_msg.channel = 'sms' then 'SMS' else 'email' end, v_msg.recipient_name,
                 case when p_simulated then ' (demo mode: simulated, nothing was sent)' else '' end),
          v_msg.student_id, p_id, p_actor, v_msg.mode, v_msg.data_label);
  return jsonb_build_object('status', case when p_simulated then 'sent' else 'sending' end, 'channel', v_msg.channel, 'address', v_msg.address, 'subject', v_msg.subject, 'body', v_msg.body);
end $$;

revoke all on function public.retention_message_hash(text, text, text, text) from public, anon, authenticated;
revoke all on function public.approve_retention_message(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.send_retention_message(uuid, uuid, text, boolean) from public, anon, authenticated;
