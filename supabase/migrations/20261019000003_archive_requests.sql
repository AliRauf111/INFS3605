-- Lets admins and the owner archive a request. An archived request keeps its details,
-- decisions and history. It leaves the normal lists and shows under "Archived requests",
-- where it can be restored. Archiving never changes the decision or the status.
alter table public.requests
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.app_users (id);

alter table public.request_events drop constraint if exists request_events_event_type_check;
alter table public.request_events add constraint request_events_event_type_check check (event_type in (
  'created', 'reevaluated', 'sent_to_owner', 'owner_approved', 'owner_declined',
  'owner_requested_info', 'admin_replied', 'admin_recorded', 'closed',
  'removed_from_list', 'restored_to_list', 'archived', 'unarchived'
));
