-- TER-357: Recipe review gate — pending/approved/rejected status + rejection metadata.
-- Apply in Supabase SQL editor.

ALTER TABLE recipe_library
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rejection_category text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid;

ALTER TABLE recipe_library
  ADD CONSTRAINT recipe_library_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE recipe_library
  ADD CONSTRAINT recipe_library_rejection_category_check
  CHECK (
    rejection_category IS NULL OR
    rejection_category IN (
      'not_original', 'bad_instructions', 'implausible_ingredients',
      'duplicate', 'unappetizing', 'format_error', 'other'
    )
  );

-- Backfill: existing rows are already live/seeded-clean → treat as approved.
-- active remains true; review_status moves from default 'pending' → 'approved'.
UPDATE recipe_library SET review_status = 'approved' WHERE review_status = 'pending';
