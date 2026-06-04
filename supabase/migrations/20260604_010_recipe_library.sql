-- TER-304: Recipe library (P1 — save generated originals, full schema for P2/P3).
-- Manual apply in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS recipe_library (
  id                bigserial PRIMARY KEY,
  content_hash      text UNIQUE,
  normalized_recipe text,
  name              text,
  cuisine           text,
  dietary_tags      jsonb DEFAULT '[]',
  ingredients       jsonb,
  steps             jsonb,
  nutrition         jsonb,
  difficulty        int,
  servings          int,
  base_recipe_id    bigint REFERENCES recipe_library(id) ON DELETE CASCADE,
  times_reused      int DEFAULT 0,
  active            boolean DEFAULT true,
  source            text DEFAULT 'generated',
  model             text,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipe_library_normalized_recipe_idx
  ON recipe_library (normalized_recipe);

-- One cached variant per (base recipe, serving count). Only applies to Phase 2 rescaled rows.
CREATE UNIQUE INDEX IF NOT EXISTS recipe_library_variant_idx
  ON recipe_library (base_recipe_id, servings)
  WHERE base_recipe_id IS NOT NULL;

ALTER TABLE recipe_library ENABLE ROW LEVEL SECURITY;
-- No anon policy — service-role writes bypass RLS.
-- No user_id column — global, unattributed pool.
