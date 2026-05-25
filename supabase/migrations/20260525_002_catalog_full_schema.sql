-- TER-186: Redefine catalog to the full target schema.
-- catalog is empty/dormant (schema-only from TER-173), safe to drop and recreate.
-- item_usage.catalog_id FK is dropped around the table recreate, then re-added.
-- TER-195 (nutrition) and TER-198 (seed) must populate existing columns, not add new migrations.

-- 1. Drop FK from item_usage so we can drop catalog
ALTER TABLE public.item_usage DROP CONSTRAINT IF EXISTS item_usage_catalog_id_fkey;

-- 2. Drop old catalog shell
DROP TABLE IF EXISTS public.catalog;

-- 3. Recreate catalog with full target shape
CREATE TABLE public.catalog (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name         text        NOT NULL,        -- join key, e.g. "brown sugar"
  product_name            text,                        -- e.g. "Baker's Corner Brown Sugar"
  brand                   text,                        -- e.g. "Baker's Corner"
  category                text,
  package_size            text,                        -- e.g. "32 oz"
  upc                     text,                        -- GTIN; feeds TER-195 nutrition lookup
  last_price_cents        integer,
  last_seen_at            timestamptz,
  -- nutrition columns (TER-195 populates these; TER-186 never writes them):
  kcal_per_100g           numeric,
  serving_g               numeric,
  macros                  jsonb,
  fdc_id                  text,
  nutrition_source        text,                        -- usda|off|manual|seed
  nutrition_retrieved_at  timestamptz,
  nutrition_stale         boolean     DEFAULT false,
  -- provenance:
  source                  text,                        -- receipt|seed|manual
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  UNIQUE (normalized_name)
);

-- 4. Re-apply RLS
--    SELECT: any authenticated user.
--    INSERT/UPDATE/DELETE: service role only (bypasses RLS).
--    No client write policy = blocked for all JWT clients.
ALTER TABLE public.catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog: authenticated users can read" ON public.catalog;
CREATE POLICY "catalog: authenticated users can read" ON public.catalog
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 5. Re-add FK from item_usage → catalog (same semantics as TER-173)
ALTER TABLE public.item_usage
  ADD CONSTRAINT item_usage_catalog_id_fkey
  FOREIGN KEY (catalog_id) REFERENCES public.catalog(id) ON DELETE SET NULL;
