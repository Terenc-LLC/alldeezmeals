-- TER-335: Recipe validation failures log.
-- Service-role only — no client policy (mirrors recipe_library pattern).
-- MANUAL APPLY in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.recipe_validation_failures (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  recipe_json  jsonb       NOT NULL,
  hard_failures jsonb      NOT NULL DEFAULT '[]',
  soft_failures jsonb      NOT NULL DEFAULT '[]',
  source       text        -- 'insert' (TER-335) | 'backfill' (TER-336)
);

ALTER TABLE public.recipe_validation_failures ENABLE ROW LEVEL SECURITY;
-- No client policy — service-role writes bypass RLS.
