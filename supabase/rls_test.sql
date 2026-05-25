-- RLS Verification Tests: TER-173
-- Run each block in the Supabase SQL Editor.
-- Replace USER_A_ID / USER_B_ID with real UUIDs from auth.users.
-- These tests confirm two invariants:
--   1. User A cannot see User B's user_state / orders / item_usage rows.
--   2. A normal authenticated client cannot write to catalog.

-- ------------------------------------------------------------------ --
-- SETUP: seed one user_state row for User B (run as service role)
-- ------------------------------------------------------------------ --
-- INSERT INTO public.user_state (user_id, state)
-- VALUES ('<USER_B_ID>', '{"location":{"name":"Test City"}}'::jsonb)
-- ON CONFLICT (user_id) DO NOTHING;

-- ------------------------------------------------------------------ --
-- TEST 1: User A cannot read User B's user_state
-- ------------------------------------------------------------------ --
-- In Supabase SQL Editor → enable "Set role" → pick authenticated user = User A.
-- (Or use the RLS simulator: Authentication → Policies → Simulate)

-- Query run as User A:
SELECT count(*) AS should_be_zero
FROM public.user_state
WHERE user_id = '<USER_B_ID>';
-- Expected result: 0 rows (RLS filters them out)

-- ------------------------------------------------------------------ --
-- TEST 2: User A cannot read User B's orders
-- ------------------------------------------------------------------ --
SELECT count(*) AS should_be_zero
FROM public.orders
WHERE user_id = '<USER_B_ID>';
-- Expected result: 0

-- ------------------------------------------------------------------ --
-- TEST 3: User A cannot read User B's item_usage
-- ------------------------------------------------------------------ --
SELECT count(*) AS should_be_zero
FROM public.item_usage
WHERE user_id = '<USER_B_ID>';
-- Expected result: 0

-- ------------------------------------------------------------------ --
-- TEST 4: User A can read catalog (shared)
-- ------------------------------------------------------------------ --
SELECT count(*) AS visible_rows
FROM public.catalog;
-- Expected result: however many catalog rows exist (shared read is allowed)

-- ------------------------------------------------------------------ --
-- TEST 5: An authenticated client cannot write to catalog
-- ------------------------------------------------------------------ --
-- Run as any authenticated user (not service role):
INSERT INTO public.catalog (item_name, package_size)
VALUES ('test item', '1 unit');
-- Expected result: ERROR: new row violates row-level security policy for table "catalog"
-- (No INSERT policy exists for authenticated role → blocked)

-- ------------------------------------------------------------------ --
-- TEST 6: User A can write their own user_state
-- ------------------------------------------------------------------ --
-- Run as User A:
INSERT INTO public.user_state (user_id, state)
VALUES (auth.uid(), '{"location":{"name":"Bloomfield, IA"}}'::jsonb)
ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now();
-- Expected result: 1 row upserted (no error)

-- ------------------------------------------------------------------ --
-- TEST 7: User A cannot insert a user_state row for User B
-- ------------------------------------------------------------------ --
-- Run as User A:
INSERT INTO public.user_state (user_id, state)
VALUES ('<USER_B_ID>', '{}'::jsonb);
-- Expected result: ERROR: new row violates row-level security policy for table "user_state"
