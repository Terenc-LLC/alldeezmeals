-- TER-317: Recipe library P2a — lossless full-payload column.
-- Manual apply in the Supabase SQL editor.

ALTER TABLE recipe_library ADD COLUMN IF NOT EXISTS recipe_json jsonb;
