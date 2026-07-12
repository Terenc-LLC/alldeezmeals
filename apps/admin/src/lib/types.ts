// TER-368/499: shape returned by GET /api/users (apps/admin/api/users.ts).
export type AdminUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  approved: boolean;
  signup_source: string | null;
  created_at: string;
  last_active: string | null;
  recipes_generated: number;
  dinners_accepted: number;
  feedback_count: number;
  qualified: boolean;
  qualification_slot: number | null;
};

// TER-492: shape returned by GET /api/list-feedback.
export type FeedbackItem = {
  id: string;
  user_id: string | null;
  email: string | null;
  message: string;
  category: string | null;
  app_context: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
};

// TER-357: shape returned by GET /api/list-pending-recipes.
export type PendingRecipe = {
  id: number;
  name: string;
  cuisine: string | null;
  difficulty: number | null;
  servings: number | null;
  ingredients: Array<{ name: string; source?: string; recipeAmount?: { qty?: number; unit?: string } }>;
  steps: string[];
  source: string;
  model: string | null;
  created_at: string;
};

export const REJECT_CATEGORIES: { value: string; label: string }[] = [
  { value: "not_original", label: "Not original" },
  { value: "bad_instructions", label: "Bad instructions" },
  { value: "implausible_ingredients", label: "Implausible ingredients" },
  { value: "duplicate", label: "Duplicate" },
  { value: "unappetizing", label: "Unappetizing" },
  { value: "format_error", label: "Format error" },
  { value: "other", label: "Other" },
];

// TER-186/195b: shape returned by a direct `catalog` table read (RLS allows any
// authenticated user to SELECT; writes go through the admin-gated endpoints —
// apps/admin/api/catalog-nutrition.ts and apps/admin/api/nutrition.ts). Mirrors
// the CatalogItem shape from the old CatalogView.tsx (deleted in TER-510).
export type CatalogItem = {
  id: string;
  product_name: string | null;
  normalized_product: string;
  package_size: string | null;
  category: string | null;
  upc: string | null;
  kcal_per_100g: number | null;
  serving_g: number | null;
  macros: { protein_g: number; fat_g: number; carbs_g: number } | null;
  fdc_id: string | null;
  nutrition_source: string | null;
  nutrition_retrieved_at: string | null;
  nutrition_stale: boolean | null;
  updated_at: string;
};

// TER-237: shape returned by GET /api/list-submissions.
export type PendingSubmission = {
  id: string;
  submitter_email: string | null;
  order_date: string | null;
  rows: Array<{
    productName?: string;
    normalizedProduct?: string;
    brand?: string;
    category?: string;
    packageSize?: string;
    unitPriceCents?: number;
  }>;
  status: string;
  created_at: string;
};
