-- TER-294: In-app feedback form — feedback table + RLS
-- Direct client insert (anon key + user JWT). No service-role key needed.
-- Reads happen in the Supabase dashboard; no SELECT policy for regular users.

create table if not exists public.feedback (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        default auth.uid() references auth.users(id) on delete set null,
  email       text,
  category    text,
  message     text        not null,
  app_context text,
  created_at  timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- Insert-for-self: authenticated users can insert rows where user_id = their own uid.
drop policy if exists "feedback insert own" on public.feedback;
create policy "feedback insert own"
  on public.feedback for insert
  to authenticated
  with check (user_id = auth.uid());

-- Approval gate: mirrors the restrictive policy applied to all other tables in
-- 20260527_006_profiles_approval_gate.sql. New tables must add it explicitly.
drop policy if exists "approved users only" on public.feedback;
create policy "approved users only"
  on public.feedback as restrictive for all
  to authenticated
  using (public.is_approved());
