-- TER-285: shared_lists table for public share-link feature.
-- Apply manually in the Supabase SQL editor — does not run automatically.

create table public.shared_lists (
  id          bigserial primary key,
  token       text        not null unique,
  user_id     uuid        not null,
  snapshot    jsonb       not null,
  check_state jsonb       not null default '{}',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked     bool        not null default false
);

create index shared_lists_token_idx on public.shared_lists (token);

alter table public.shared_lists enable row level security;
-- No anon policy: all access is endpoint-mediated via the service role.
