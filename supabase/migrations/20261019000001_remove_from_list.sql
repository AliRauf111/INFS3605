-- Lets admins and the owner take a request off the lists without deleting it.
-- The request, its decisions and its history all stay; it just stops showing on the
-- dashboard, Requests and Approval Alley. It can be put back from its own page.
alter table public.requests
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references public.app_users (id);

alter table public.request_events drop constraint if exists request_events_event_type_check;
alter table public.request_events add constraint request_events_event_type_check check (event_type in (
  'created', 'reevaluated', 'sent_to_owner', 'owner_approved', 'owner_declined',
  'owner_requested_info', 'admin_replied', 'admin_recorded', 'closed',
  'removed_from_list', 'restored_to_list'
));
