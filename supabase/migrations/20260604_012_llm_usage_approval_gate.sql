-- TER-323: Add restrictive approval-gate policy to llm_usage (mirrors migration 006/007 pattern).
-- Manual apply in the Supabase SQL editor.

alter table public.llm_usage enable row level security;
drop policy if exists "approved users only" on public.llm_usage;
create policy "approved users only" on public.llm_usage
  as restrictive for all to authenticated
  using (public.is_approved());
