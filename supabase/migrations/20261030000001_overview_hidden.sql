-- Requests the owner has asked to keep off the Overview's "Over to you" cards. They still
-- show on the Requests page and still count in the traffic-light totals.
-- Safe to run more than once.
alter table public.requests add column if not exists overview_hidden boolean not null default false;
