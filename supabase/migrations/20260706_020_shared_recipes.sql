-- TER-526: shared_recipes table for public recipe share-link feature.
-- Apply manually in the Supabase SQL editor — does not run automatically.

create table public.shared_recipes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id),
  token      text        not null unique,
  snapshot   jsonb       not null,
  revoked    bool        not null default false,
  created_at timestamptz not null default now()
);

create index shared_recipes_token_idx on public.shared_recipes (token);

alter table public.shared_recipes enable row level security;
-- No anon policy: all access is endpoint-mediated via the service role.
