-- TER-264: update handle_new_user() trigger to capture signup_source from auth metadata.
-- Column was added in migration 018 (nullable); this wires it up on insert.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles
    (id, email, name, first_name, last_name, nearest_aldi, reason, referred_by, referral_code, signup_source)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'nearest_aldi',
    new.raw_user_meta_data->>'reason',
    new.raw_user_meta_data->>'referred_by',
    upper(substr(md5(new.id::text || now()::text), 1, 12)),
    new.raw_user_meta_data->>'signup_source'
  )
  on conflict (id) do nothing;
  return new;
end; $$;
