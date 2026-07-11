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
