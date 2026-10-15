-- Stage 1: the requests table.
-- Every request Sarah creates, with the confirmed facts and the decision the rule
-- engine made at the time. Money is stored in whole cents.

create extension if not exists pgcrypto;

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null
    check (request_type in ('refund', 'lesson_change', 'payment_extension', 'other')),
  money_involved text check (money_involved in ('yes', 'no', 'unsure')),
  amount_cents integer check (amount_cents between 0 and 10000000),
  -- null means "not answered". It is never treated as "no".
  complaint_status text check (complaint_status in ('yes', 'no', 'unsure')),
  welfare_status text check (welfare_status in ('yes', 'no', 'unsure')),
  reference_id text check (char_length(reference_id) between 2 and 40),
  context text not null default '' check (char_length(context) <= 2000),
  confirmed_facts jsonb not null default '{}'::jsonb,
  decision text not null check (decision in ('green', 'amber', 'red')),
  decision_reason text not null check (char_length(decision_reason) <= 2000),
  matched_rule_id text not null,
  policy_version text not null,
  next_step text not null default '',
  status text not null default 'ready' check (status in (
    'ready', 'needs_clarification', 'review_required', 'awaiting_owner',
    'more_info_requested', 'approved', 'declined', 'closed'
  )),
  intake_method text not null default 'wizard' check (intake_method in ('wizard', 'ai_intake', 'seed')),
  -- A random key the browser sends with each submission, so pressing Submit twice
  -- cannot create two requests.
  idempotency_key uuid unique,
  data_label text not null default 'fictional_demo'
    check (data_label in ('live_connected', 'imported', 'fictional_demo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index requests_created_at_idx on public.requests (created_at desc);
create index requests_status_idx on public.requests (status);

-- Row level security with no policies: the anon and authenticated keys can read and
-- write nothing. Only the server, using the secret key, can reach this table.
alter table public.requests enable row level security;
