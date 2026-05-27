-- TER-237: Receipt submissions queue. User submissions land here as `pending`;
-- admin approval writes to `catalog` via api/admin/approve-submission.ts.
-- Catalog writes are admin-only (no RLS write policy here — admin path uses service-role + isAdmin check).

create table if not exists receipt_submissions (
  id uuid primary key default gen_random_uuid(),
  submitter_user_id uuid not null references auth.users(id) on delete set null,
  submitter_email text,
  order_date date,
  rows jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_email text,
  approved_count int,
  rejected_reason text
);

create index if not exists receipt_submissions_status_created_at_idx
  on receipt_submissions (status, created_at desc);

alter table receipt_submissions enable row level security;

create policy "users insert own submissions"
  on receipt_submissions for insert to authenticated
  with check (submitter_user_id = auth.uid());

create policy "users select own submissions"
  on receipt_submissions for select to authenticated
  using (submitter_user_id = auth.uid());

-- No UPDATE/DELETE policy: admin endpoints use service-role + isAdmin check.
