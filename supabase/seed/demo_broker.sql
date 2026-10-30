-- Demo broker mode (TEST project only, everything made up). Run after
-- demo_more_builders.sql. Safe to run again.
--
-- Prairie Lantern Builders lists through its own outside broker: Blake Sutton
-- of Lone Star Listing Group (broker@demo.test). Prairie Lantern's MLS work
-- (new listings, updates, status changes, open houses) goes to Blake's bare
-- broker screens instead of our team's board, and Prairie Lantern gets told
-- when Blake finishes each one.
--
-- The login reuses the existing demo password (copied from admin@demo.test).
-- Its app_metadata carries role "broker" so the sign-in router keeps it inside
-- /broker before any page loads.

do $$
declare uid uuid; pw text; b_pl uuid;
begin
  select id into b_pl from public.builders where name = 'Prairie Lantern Builders (demo)';
  if b_pl is null then return; end if;

  select id into uid from auth.users where email = 'broker@demo.test';
  if uid is null then
    select encrypted_password into pw from auth.users where email = 'admin@demo.test';
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      'broker@demo.test', coalesce(pw, extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))), now(),
      '{"provider":"email","providers":["email"],"role":"broker"}', jsonb_build_object('full_name', 'Blake Sutton'),
      now(), now(), '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', 'broker@demo.test', 'email_verified', true), 'email', now(), now(), now());
  else
    update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"role":"broker"}' where id = uid;
  end if;

  if not exists (select 1 from public.profiles where id = uid) then
    insert into public.profiles (id, email, full_name, role, builder_id, phone, job_title)
    values (uid, 'broker@demo.test', 'Blake Sutton', 'broker', null, '(817) 555-0164', 'Broker, Lone Star Listing Group');
  end if;

  insert into public.broker_builders (broker_id, builder_id)
  values (uid, b_pl) on conflict (broker_id, builder_id) do nothing;

  update public.builder_settings set mls_entry = 'broker' where builder_id = b_pl;
end $$;
