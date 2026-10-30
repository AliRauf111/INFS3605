-- Each person's chosen language for the Tutor Compass interface. Null means "not chosen",
-- so the site falls back to this device's choice, then English. Only the site's own text is
-- translated; names, notes and other records are never changed.
-- Only the server writes this table (it has row level security and no public policies), and
-- the server only ever updates the signed-in person's own row.
-- Demo resets don't touch app_users, so the choice survives a reset.
-- Safe to run more than once.
alter table public.app_users add column if not exists preferred_language text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_users_preferred_language_check') then
    alter table public.app_users add constraint app_users_preferred_language_check
      check (preferred_language is null or preferred_language in ('en', 'zh-Hans', 'ar', 'vi', 'yue-Hant', 'pa', 'el', 'it', 'hi', 'es'));
  end if;
end $$;
