-- TER-238: Profiles table + approval gate RLS
-- profiles holds sign-up info; approved=false until an admin flips it.
-- Existing accounts land at approved=false; Chris flips admin emails before merge.

-- ------------------------------------------------------------------ --
--  profiles — one row per auth user; written by SECURITY DEFINER     --
--  trigger on insert; read-only by owner via RLS.                    --
-- ------------------------------------------------------------------ --
create table if not exists public.profiles (
  id           uuid        primary key references auth.users(id) on delete cascade,
  email        text,
  name         text,
  nearest_aldi text,
  reason       text,
  approved     bool        not null default false,
  requested_at timestamptz not null default now(),
  approved_at  timestamptz,
  approved_by  text
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- No client insert/update/delete policy — mutations go through service-role endpoints.

-- ------------------------------------------------------------------ --
--  handle_new_user() trigger — runs as SECURITY DEFINER so it can    --
--  write to profiles regardless of caller's RLS context.             --
-- ------------------------------------------------------------------ --
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, nearest_aldi, reason)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'nearest_aldi',
    new.raw_user_meta_data->>'reason'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------------ --
--  is_approved() — SECURITY DEFINER so RLS policies can call it      --
--  without needing the caller to have direct profiles read access.   --
-- ------------------------------------------------------------------ --
create or replace function public.is_approved()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce(
    (select approved from public.profiles where id = auth.uid()),
    false
  );
end;
$$;

-- ------------------------------------------------------------------ --
--  Apply restrictive approval gate to every existing table except    --
--  profiles. A restrictive policy ANDs with permissive policies,     --
--  ensuring unapproved users cannot bypass existing owner checks.    --
-- ------------------------------------------------------------------ --
do $$
declare
  t text;
begin
  for t in (
    select tablename from pg_tables
    where schemaname = 'public' and tablename != 'profiles'
  ) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "approved users only" on public.%I', t);
    execute format(
      'create policy "approved users only" on public.%I as restrictive for all to authenticated using (public.is_approved())',
      t
    );
  end loop;
end;
$$;

-- ------------------------------------------------------------------ --
--  Backfill: existing auth users get a profiles row (approved=false) --
--  Chris will flip approved=true for admin emails in the dashboard   --
--  before this migration lands in production.                        --
-- ------------------------------------------------------------------ --
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;
