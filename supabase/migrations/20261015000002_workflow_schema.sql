-- Stages 2 to 4: users and roles, the knowledge hub, versioned policies, decision
-- history, owner approvals, evidence snapshots, AI activity, drafts, audit events and
-- rule suggestions. All tables use row level security with no policies, so only the
-- Next.js server (secret key) can read or write them.

-- Users and roles ---------------------------------------------------------------
-- Sign-in is handled by Supabase Auth (auth.users). The role lives here, in a table
-- only the server can write, never in user-editable metadata.
create table public.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null check (role in ('admin', 'owner')),
  created_at timestamptz not null default now()
);

alter table public.requests
  add column created_by uuid references public.app_users (id),
  add column policy_version_id uuid,
  add column current_decision_id uuid,
  add column booking_id text,
  add column decision_count integer not null default 1 check (decision_count >= 1);

-- Knowledge hub (all fictional demonstration data) -------------------------------
create table public.families (
  id text primary key check (id ~ '^FAM-[0-9]{2,6}$'),
  parent_name text not null,
  student_name text not null,
  data_label text not null default 'fictional_demo'
    check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);

create table public.tutors (
  id text primary key check (id ~ '^T-[0-9]{2,6}$'),
  name text not null,
  subjects text[] not null default '{}',
  data_label text not null default 'fictional_demo'
    check (data_label in ('live_connected', 'imported', 'fictional_demo'))
);

create table public.bookings (
  id text primary key check (id ~ '^BK-[0-9]{3,8}$'),
  family_id text not null references public.families (id),
  tutor_id text not null references public.tutors (id),
  subject text not null,
  lessons_purchased integer not null check (lessons_purchased > 0),
  lessons_used integer not null check (lessons_used >= 0),
  price_cents integer not null check (price_cents >= 0),
  status text not null check (status in ('active', 'completed', 'cancelled')),
  data_label text not null default 'fictional_demo'
    check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  source_system text not null default 'Fictional booking spreadsheet',
  last_synced_at timestamptz not null default now(),
  check (lessons_used <= lessons_purchased)
);
create index bookings_family_idx on public.bookings (family_id);

create table public.payments (
  id text primary key check (id ~ '^PAY-[0-9]{3,8}$'),
  booking_id text not null references public.bookings (id),
  invoice_ref text not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null check (status in ('paid', 'pending', 'overdue', 'refunded', 'disputed')),
  paid_at timestamptz,
  due_date date,
  method text,
  data_label text not null default 'fictional_demo'
    check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  source_system text not null default 'Fictional payments export',
  last_synced_at timestamptz not null default now()
);
create index payments_booking_idx on public.payments (booking_id);

create table public.tutor_availability (
  id text primary key check (id ~ '^SLOT-[0-9]{3,8}$'),
  tutor_id text not null references public.tutors (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('free', 'booked')),
  data_label text not null default 'fictional_demo'
    check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  source_system text not null default 'Fictional tutor calendar',
  last_synced_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index availability_tutor_idx on public.tutor_availability (tutor_id, starts_at);

-- Written procedures the owner has approved, such as the welfare escalation steps.
create table public.knowledge_articles (
  id text primary key check (id ~ '^KB-[0-9]{2,6}$'),
  title text not null,
  category text not null,
  body text not null,
  owner_approved boolean not null default false,
  version integer not null default 1 check (version >= 1),
  data_label text not null default 'fictional_demo'
    check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  updated_at timestamptz not null default now()
);

-- Policies and rule versions ----------------------------------------------------
-- One row per version. Activating a new version archives the old one, but old rows
-- are never edited, so past decisions can always show the exact rules they used.
create table public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('refund', 'lesson_change', 'payment_extension')),
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  definition jsonb not null,
  change_note text not null default '' check (char_length(change_note) <= 1000),
  source text not null default 'owner' check (source in ('owner', 'ai_proposal', 'suggestion', 'seed')),
  created_by uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  activated_by uuid references public.app_users (id),
  activated_at timestamptz,
  archived_at timestamptz,
  unique (category, version)
);
-- At most one active version per category.
create unique index policy_one_active_idx on public.policy_versions (category) where status = 'active';

-- Every time the engine evaluates a request we keep a full copy of what it used.
create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  sequence integer not null check (sequence >= 1),
  colour text not null check (colour in ('green', 'amber', 'red')),
  matched_rule_id text not null,
  policy_version text not null,
  policy_version_id uuid references public.policy_versions (id),
  policy_snapshot jsonb,
  facts jsonb not null,
  result jsonb not null,
  input_hash text not null check (char_length(input_hash) = 64),
  engine_version text not null,
  reason text not null default 'initial' check (reason in ('initial', 'clarification', 'seed')),
  created_by uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  unique (request_id, sequence)
);

create table public.evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references public.decisions (id) on delete cascade,
  request_id uuid not null references public.requests (id) on delete cascade,
  records jsonb not null,
  retrieved_at timestamptz not null
);

alter table public.requests
  add constraint requests_current_decision_fk foreign key (current_decision_id) references public.decisions (id),
  add constraint requests_policy_version_fk foreign key (policy_version_id) references public.policy_versions (id);

-- Workflow and approval events (what people did, in order) ----------------------
create table public.request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'reevaluated', 'sent_to_owner', 'owner_approved', 'owner_declined',
    'owner_requested_info', 'admin_replied', 'admin_recorded', 'closed'
  )),
  actor_id uuid references public.app_users (id),
  actor_role text check (actor_role in ('admin', 'owner', 'system')),
  from_status text,
  to_status text,
  note text not null default '' check (char_length(note) <= 4000),
  created_at timestamptz not null default now()
);
create index request_events_request_idx on public.request_events (request_id, created_at);

-- AI and agent activity (only events that really happened) ----------------------
create table public.ai_activity (
  id uuid primary key default gen_random_uuid(),
  session_key uuid not null,
  request_id uuid references public.requests (id) on delete cascade,
  event_type text not null check (event_type in (
    'details_extracted', 'clarification_needed', 'booking_retrieved', 'payment_found',
    'availability_checked', 'policy_retrieved', 'missing_information', 'confirmation_required',
    'decision_completed', 'draft_prepared', 'owner_review_created', 'rule_proposed',
    'suggestion_prepared', 'ai_unavailable'
  )),
  state text not null check (state in ('pending', 'completed', 'blocked', 'failed')),
  mode text not null check (mode in ('live_ai', 'simulated', 'system')),
  summary text not null check (char_length(summary) <= 500),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.app_users (id),
  created_at timestamptz not null default now()
);
create index ai_activity_session_idx on public.ai_activity (session_key, created_at);
create index ai_activity_request_idx on public.ai_activity (request_id, created_at);

-- Editable drafts. Nothing here is ever sent anywhere by the app.
create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  kind text not null check (kind in (
    'parent_response', 'tutor_message', 'escalation_summary', 'reschedule_proposal', 'admin_checklist'
  )),
  body text not null check (char_length(body) <= 6000),
  generated_by text not null check (generated_by in ('template', 'live_ai', 'simulated', 'edited')),
  updated_by uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, kind)
);

-- Audit log of protected operations ---------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.app_users (id),
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

-- Rule suggestions from repeated exceptions (inactive until the owner acts) -------
create table public.rule_suggestions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('refund', 'lesson_change', 'payment_extension')),
  pattern_key text not null,
  summary text not null,
  proposal jsonb not null,
  based_on_request_ids uuid[] not null,
  generated_by text not null check (generated_by in ('live_ai', 'simulated', 'system')),
  status text not null default 'open' check (status in ('open', 'dismissed', 'drafted')),
  draft_policy_version_id uuid references public.policy_versions (id),
  created_at timestamptz not null default now(),
  unique (pattern_key)
);

alter table public.app_users enable row level security;
alter table public.families enable row level security;
alter table public.tutors enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.tutor_availability enable row level security;
alter table public.knowledge_articles enable row level security;
alter table public.policy_versions enable row level security;
alter table public.decisions enable row level security;
alter table public.evidence_snapshots enable row level security;
alter table public.request_events enable row level security;
alter table public.ai_activity enable row level security;
alter table public.drafts enable row level security;
alter table public.audit_events enable row level security;
alter table public.rule_suggestions enable row level security;
