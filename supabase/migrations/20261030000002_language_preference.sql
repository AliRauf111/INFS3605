-- Each person's chosen language for the Tutor Compass interface. Null means "not chosen",
-- so the site falls back to this device's choice, then English. Only the site's own text is
-- translated; names, notes and other records are never changed.
-- Only the server writes this table (it has row level security and no public policies), and
-- the server only ever updates the signed-in person's own row.
-- Demo resets don't touch app_users, so the choice survives a reset.
-- Safe to run more than once.
alter table public.app_users add column if not exists preferred_language text;

-- The check is dropped and added again so that running this file after a new language
-- is added updates the list.
alter table public.app_users drop constraint if exists app_users_preferred_language_check;
alter table public.app_users add constraint app_users_preferred_language_check
  check (preferred_language is null or preferred_language in (
    'en', 'zh-Hans', 'ar', 'vi', 'yue-Hant', 'pa', 'el', 'it', 'hi', 'es', 'ta', 'te', 'mr', 'bn'));
