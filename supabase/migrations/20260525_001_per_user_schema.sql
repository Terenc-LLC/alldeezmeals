-- TER-173: per-user schema + RLS
-- Run once in Supabase SQL Editor (service role).
-- All five tables are created here; only user_state is wired into the app this issue.
-- orders, catalog, item_usage are schema+RLS only — population deferred to TER-181/186/190.
-- allowed_emails was introduced in TER-187; IF NOT EXISTS guards against re-run errors.

-- ------------------------------------------------------------------ --
--  user_state — one row per user; full CRUD by that user only         --
-- ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS public.user_state (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state       jsonb       NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.user_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_state: owner full access" ON public.user_state;
CREATE POLICY "user_state: owner full access" ON public.user_state
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS user_state_user_id_idx ON public.user_state (user_id);

-- ------------------------------------------------------------------ --
--  orders — per-user archived plan snapshots (TER-181 writes here)    --
-- ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS public.orders (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ordered_at  timestamptz NOT NULL DEFAULT now(),
  plan        jsonb       NOT NULL DEFAULT '{}'
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders: owner full access" ON public.orders;
CREATE POLICY "orders: owner full access" ON public.orders
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS orders_user_id_idx ON public.orders (user_id);

-- ------------------------------------------------------------------ --
--  catalog — shared/global ALDI product catalog                       --
--  SELECT: any authenticated user.                                    --
--  INSERT/UPDATE/DELETE: service role only (bypasses RLS).            --
--  No client INSERT/UPDATE/DELETE policy = blocked for JWT clients.  --
-- ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS public.catalog (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name        text        NOT NULL,
  package_size     text,
  last_price_cents integer,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_name, package_size)
);

ALTER TABLE public.catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog: authenticated users can read" ON public.catalog;
CREATE POLICY "catalog: authenticated users can read" ON public.catalog
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- No INSERT/UPDATE/DELETE policy => blocked for all JWT-authenticated clients.
-- The service role (used by /api ingestion functions) bypasses RLS and can write freely.

-- ------------------------------------------------------------------ --
--  item_usage — per-user purchase history (TER-190 affinity writes)  --
-- ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS public.item_usage (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  catalog_id          uuid        REFERENCES public.catalog(id) ON DELETE SET NULL,
  item_name           text        NOT NULL,
  purchase_count      integer     NOT NULL DEFAULT 1,
  last_purchased_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_name)
);

ALTER TABLE public.item_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_usage: owner full access" ON public.item_usage;
CREATE POLICY "item_usage: owner full access" ON public.item_usage
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS item_usage_user_id_idx ON public.item_usage (user_id);

-- ------------------------------------------------------------------ --
--  allowed_emails — invite allowlist (TER-187)                        --
--  No client policies: only service role can read/write.              --
-- ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS public.allowed_emails (
  email       text        PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

-- No client SELECT/INSERT/UPDATE/DELETE policy.
-- The Supabase auth hook (or admin functions) check this server-side via service role.
