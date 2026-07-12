-- TER-514: lightweight feedback triage — mark-handled state (admin-only writes).
-- MANUAL APPLY in Supabase SQL editor (project uses manual migrations)

alter table public.feedback
  add column if not exists handled    boolean not null default false,
  add column if not exists handled_at timestamptz;

-- Writes go through the admin-gated apps/admin/api/mark-feedback-handled.ts
-- endpoint (service-role client), so no new RLS policy is needed — the
-- existing "approved users only" + "feedback insert own" policies (migration
-- 20260601_007_feedback.sql) are untouched.
