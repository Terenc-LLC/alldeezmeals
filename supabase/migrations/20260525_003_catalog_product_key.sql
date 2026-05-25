-- TER-202: Change catalog dedup key from normalized_name → normalized_product.
-- normalized_product = lower(trim(regexp_replace(product_name, '\s+', ' ', 'g')))
-- normalized_name kept as a non-unique indexed column (future generic→product lookup).
--
-- After applying this migration, run in the SQL editor:
--   TRUNCATE public.item_usage;
--   TRUNCATE public.catalog CASCADE;
-- Then re-ingest receipts to rebuild with the correct key.

-- 1. Add normalized_product column (nullable initially for backfill)
ALTER TABLE public.catalog ADD COLUMN IF NOT EXISTS normalized_product text;

-- 2. Backfill from product_name; fall back to normalized_name for rows without one
UPDATE public.catalog
SET normalized_product = lower(trim(regexp_replace(
  coalesce(nullif(trim(product_name), ''), normalized_name, ''),
  '\s+', ' ', 'g'
)))
WHERE normalized_product IS NULL;

-- 3. Enforce NOT NULL now that all rows have a value
ALTER TABLE public.catalog ALTER COLUMN normalized_product SET NOT NULL;

-- 4. Drop the old unique constraint on normalized_name
ALTER TABLE public.catalog DROP CONSTRAINT IF EXISTS catalog_normalized_name_key;

-- 5. Add unique constraint on normalized_product (new dedup key)
ALTER TABLE public.catalog ADD CONSTRAINT catalog_normalized_product_key UNIQUE (normalized_product);

-- 6. Index normalized_name for the future generic→product lookup (non-unique)
CREATE INDEX IF NOT EXISTS catalog_normalized_name_idx ON public.catalog (normalized_name);
