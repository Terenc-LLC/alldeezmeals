-- TER-351: record post-merge hardening applied manually to prod after TER-266.
-- MANUAL APPLY in Supabase SQL editor (already applied in prod; this records it for fresh environments).

-- 1) qualification_counter had RLS disabled (Supabase warning).
alter table public.qualification_counter enable row level security;
-- intentionally NO policies: all access is via the SECURITY DEFINER fn + service role, both of which bypass RLS.

-- 2) claim_qualification (SECURITY DEFINER) had a mutable search_path.
alter function public.claim_qualification(uuid) set search_path = '';
