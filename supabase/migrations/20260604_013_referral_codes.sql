-- TER-325: referral codes + referred-by tracking + split name fields
-- MANUAL APPLY in Supabase SQL editor (project uses manual migrations)

alter table public.profiles
  add column if not exists first_name    text,
  add column if not exists last_name     text,
  add column if not exists referral_code text,
  add column if not exists referred_by   text;

-- Recreate the signup trigger to capture first/last + referred_by and mint a 12-char code.
-- Code = md5(uuid || timestamp) → unique (UUID guarantees no same-second collision).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles
    (id, email, name, first_name, last_name, nearest_aldi, reason, referred_by, referral_code)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'nearest_aldi',
    new.raw_user_meta_data->>'reason',
    new.raw_user_meta_data->>'referred_by',
    upper(substr(md5(new.id::text || now()::text), 1, 12))
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- Backfill codes for existing users (incl. admin):
update public.profiles
set referral_code = upper(substr(md5(id::text || coalesce(requested_at::text, now()::text)), 1, 12))
where referral_code is null;
