-- Demo photographer (Sky Navarro, photographer@demo.test) and sample photo
-- requests for the TEST project. Replace __DEMO_PASSWORD__ before running.
do $$
declare uid uuid := gen_random_uuid();
begin
  if not exists (select 1 from auth.users where email = 'photographer@demo.test') then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      'photographer@demo.test', extensions.crypt('__DEMO_PASSWORD__', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"Sky Navarro"}',
      now(), now(), '', '', '', '', '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', 'photographer@demo.test', 'email_verified', true), 'email', now(), now(), now());
    insert into public.profiles (id, email, full_name, role, builder_id) values (uid, 'photographer@demo.test', 'Sky Navarro', 'photographer', null);
  end if;
end $$;

-- Four requests: two Oak Creek homes (one assigned and scheduled), one Willow
-- Bend home (waiting for a photographer), one Bluestem home (delivered).
-- The database fills in builder, community, address and names from the home.
insert into public.media_requests (home_id, community_id, builder_id, needs, notes, due_date, requested_by, address, community_name, builder_name)
select h.id, h.community_id, h.builder_id, x.needs, x.notes, current_date + x.due, p.id, '', '', ''
from (values
  ('Oak Creek', 0, array['photos','twilight'], 'Just finished landscaping. Please get the front with the new sod and a twilight shot.', 5, 'marketing.mesquite@demo.test'),
  ('Oak Creek', 1, array['photos','video'], 'Model-quality staging is in Saturday morning.', 9, 'sales.mesquite@demo.test'),
  ('Willow Bend Ranch', 0, array['photos','drone','floor_plan'], 'Corner lot backing to the greenbelt, drone would help.', 12, 'marketing.mesquite@demo.test'),
  ('Bluestem Meadows', 0, array['photos'], null, 3, 'owner.prairie@demo.test')
) as x(community, n, needs, notes, due, requester)
join lateral (
  select hh.* from public.homes hh join public.communities c on c.id = hh.community_id
  where c.name = x.community order by hh.unparsed_address offset x.n limit 1
) h on true
join public.profiles p on p.email = x.requester;
