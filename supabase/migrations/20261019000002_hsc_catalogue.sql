-- NSW HSC subject catalogue (Years 11 and 12).
-- The catalogue rows come from src/lib/catalogue/hsc.ts through supabase/catalogue.sql.
-- Category codes such as MTH1011 are Tutor Compass's own codes, not NESA course numbers.
-- Every table here is safe to create again: nothing is dropped and no rows are removed.

create table if not exists public.hsc_subject_areas (
  id text primary key,
  name text not null,
  year11_code text not null unique check (year11_code ~ '^[A-Z]{3}1011$'),
  year12_code text not null unique check (year12_code ~ '^[A-Z]{3}1012$'),
  sort_order integer not null
);

create table if not exists public.hsc_courses (
  id text primary key check (id ~ '^[a-z0-9_]+$'),
  area_id text not null references public.hsc_subject_areas (id),
  name text not null,
  kind text not null check (kind in ('course', 'language', 'vet')),
  note text not null default '',
  sort_order integer not null
);

-- Which year each course actually runs in. A course and year pair must be here before
-- anyone can record it.
create table if not exists public.hsc_course_years (
  course_id text not null references public.hsc_courses (id),
  year_level smallint not null check (year_level in (11, 12)),
  primary key (course_id, year_level)
);

-- What this business actually offers, out of the full catalogue. The owner switches
-- these on and off on the Subjects page.
create table if not exists public.course_offerings (
  course_id text not null,
  year_level smallint not null,
  offered boolean not null default false,
  updated_by uuid references public.app_users (id),
  updated_at timestamptz not null default now(),
  primary key (course_id, year_level),
  foreign key (course_id, year_level) references public.hsc_course_years (course_id, year_level)
);

-- The exact courses and years each tutor teaches.
create table if not exists public.tutor_courses (
  id uuid primary key default gen_random_uuid(),
  tutor_id text not null references public.tutors (id) on delete cascade,
  course_id text not null,
  year_level smallint not null,
  area_id text,
  category_code text,
  course_level text not null default '',
  qualification text not null default '' check (char_length(qualification) <= 120),
  created_at timestamptz not null default now(),
  unique (tutor_id, course_id, year_level, course_level),
  foreign key (course_id, year_level) references public.hsc_course_years (course_id, year_level)
);

-- The courses each student is studying.
create table if not exists public.student_courses (
  id uuid primary key default gen_random_uuid(),
  family_id text not null references public.families (id) on delete cascade,
  student_name text not null check (char_length(student_name) between 1 and 80),
  course_id text not null,
  year_level smallint not null,
  area_id text,
  category_code text,
  course_level text not null default '',
  qualification text not null default '' check (char_length(qualification) <= 120),
  created_at timestamptz not null default now(),
  unique (family_id, student_name, course_id, year_level, course_level),
  foreign key (course_id, year_level) references public.hsc_course_years (course_id, year_level)
);

-- Bookings keep their old free-text subject and can also point at an exact course.
alter table public.bookings
  add column if not exists course_id text,
  add column if not exists year_level smallint,
  add column if not exists area_id text,
  add column if not exists category_code text,
  add column if not exists course_level text not null default '',
  add column if not exists qualification text not null default '';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_course_year_fk') then
    alter table public.bookings add constraint bookings_course_year_fk
      foreign key (course_id, year_level) references public.hsc_course_years (course_id, year_level);
  end if;
end $$;

-- Fills in the subject area and category code from the catalogue, so they can never
-- disagree with the course and year, and rejects levels that don't fit.
create or replace function public.hsc_fill_course() returns trigger
language plpgsql as $$
declare
  v_kind text;
  v_area text;
  v_code text;
begin
  if new.course_id is null then
    new.year_level := null; new.area_id := null; new.category_code := null;
    new.course_level := ''; new.qualification := '';
    return new;
  end if;
  select c.kind, c.area_id, case when new.year_level = 11 then a.year11_code else a.year12_code end
    into v_kind, v_area, v_code
    from public.hsc_courses c
    join public.hsc_subject_areas a on a.id = c.area_id
    join public.hsc_course_years y on y.course_id = c.id and y.year_level = new.year_level
   where c.id = new.course_id;
  if v_area is null then
    raise exception 'invalid_input: % is not a Year % course', new.course_id, new.year_level;
  end if;
  if v_kind = 'language' then
    if new.course_level not in ('beginners', 'continuers', 'extension') then
      raise exception 'invalid_input: choose Beginners, Continuers or Extension for a language';
    end if;
    if new.course_level = 'extension' and new.year_level <> 12 then
      raise exception 'invalid_input: language Extension is a Year 12 course';
    end if;
  elsif new.course_level <> '' then
    raise exception 'invalid_input: only languages have a level';
  end if;
  if v_kind <> 'vet' then new.qualification := ''; end if;
  new.area_id := v_area;
  new.category_code := v_code;
  return new;
end $$;

drop trigger if exists tutor_courses_fill on public.tutor_courses;
create trigger tutor_courses_fill before insert or update on public.tutor_courses
  for each row execute function public.hsc_fill_course();
drop trigger if exists student_courses_fill on public.student_courses;
create trigger student_courses_fill before insert or update on public.student_courses
  for each row execute function public.hsc_fill_course();
drop trigger if exists bookings_course_fill on public.bookings;
create trigger bookings_course_fill before insert or update of course_id, year_level, course_level, qualification on public.bookings
  for each row execute function public.hsc_fill_course();

alter table public.hsc_subject_areas enable row level security;
alter table public.hsc_courses enable row level security;
alter table public.hsc_course_years enable row level security;
alter table public.course_offerings enable row level security;
alter table public.tutor_courses enable row level security;
alter table public.student_courses enable row level security;
