-- TER-194: nutrition_cache table.
-- RLS: SELECT + INSERT + UPDATE for authenticated users (user JWT, no service-role needed).
-- The /api/nutrition endpoint creates its Supabase client with the caller's access token
-- so auth.uid() resolves; any invited user may write cache rows (acceptable for invite-only app).

CREATE TABLE IF NOT EXISTS public.nutrition_cache (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key     text        NOT NULL,
  result        jsonb       NOT NULL,
  fdc_id        text,
  gtin          text,
  source        text        NOT NULL DEFAULT 'usda',
  retrieved_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cache_key)
);

ALTER TABLE public.nutrition_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nutrition_cache: authenticated read" ON public.nutrition_cache;
CREATE POLICY "nutrition_cache: authenticated read" ON public.nutrition_cache
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "nutrition_cache: authenticated insert" ON public.nutrition_cache;
CREATE POLICY "nutrition_cache: authenticated insert" ON public.nutrition_cache
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "nutrition_cache: authenticated update" ON public.nutrition_cache;
CREATE POLICY "nutrition_cache: authenticated update" ON public.nutrition_cache
  FOR UPDATE
  USING  (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS nutrition_cache_key_idx ON public.nutrition_cache (cache_key);
