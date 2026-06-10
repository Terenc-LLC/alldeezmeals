-- TER-368: add signup_source column to profiles for future TER-264 tracking
-- Column is nullable; populated by TER-264 once that feature is live.

alter table public.profiles
  add column if not exists signup_source text;
