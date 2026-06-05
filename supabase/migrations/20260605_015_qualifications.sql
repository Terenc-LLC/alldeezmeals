-- TER-266: beta qualification — atomic 1-50 counter, qualifications table, profiles columns
-- MANUAL APPLY in Supabase SQL editor

-- 1. Extend profiles with qualification fields
alter table public.profiles
  add column if not exists qualified_at         timestamptz,
  add column if not exists qualification_number int;

-- 2. Single-row counter table (max count = 50)
create table if not exists public.qualification_counter (
  id    int primary key default 1,
  count int not null default 0,
  check (id = 1)
);
insert into public.qualification_counter (id, count)
values (1, 0)
on conflict (id) do nothing;

-- 3. Qualifications table
create table if not exists public.qualifications (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  qualification_number int unique not null,
  qualified_at         timestamptz not null default now()
);

-- 4. RLS: user can select their own row; no client insert/update (service role only)
alter table public.qualifications enable row level security;

create policy "users can view own qualification"
  on public.qualifications
  for select
  to authenticated
  using (auth.uid() = user_id);

-- 5. Atomic claim function (SECURITY DEFINER)
--    Returns the assigned qualification_number, or null if cap reached or already claimed.
create or replace function public.claim_qualification(uid uuid)
returns int language plpgsql security definer as $$
declare n int;
begin
  -- Idempotent: return existing number if already qualified
  select qualification_number into n from public.qualifications where user_id = uid;
  if n is not null then return n; end if;

  -- Atomic increment only if count < 50; returns the new count (the assigned slot)
  update public.qualification_counter
    set count = count + 1
    where id = 1 and count < 50
    returning count into n;

  if n is null then return null; end if;  -- cap reached

  insert into public.qualifications (user_id, qualification_number) values (uid, n);
  update public.profiles set qualified_at = now(), qualification_number = n where id = uid;
  return n;
end $$;
