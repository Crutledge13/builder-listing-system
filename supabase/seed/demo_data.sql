-- Demo data for the TEST project only. Every name, address and company here
-- is made up. Never run this against the live project.
--
-- Replace __DEMO_PASSWORD__ with the demo password before running. The real
-- value is kept out of the repository.

-- ---------------------------------------------------------------------------
-- Demo logins (one per role, plus a second builder to prove separation)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.demo_user(p_email text, p_name text)
returns uuid language plpgsql as $$
declare uid uuid;
begin
  select id into uid from auth.users where email = p_email;
  if uid is not null then return uid; end if;
  uid := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    p_email, extensions.crypt('__DEMO_PASSWORD__', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name),
    now(), now(), '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid,
    jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true),
    'email', now(), now(), now());
  return uid;
end $$;

do $$
declare
  b_mc uuid; b_pl uuid;
  c_oak uuid; c_willow uuid; c_blue uuid;
  i int;
  plan record;
  stat public.workflow_status;
  stage public.build_stage;
  addr_no int;
begin
  insert into public.builders (name, slug) values ('Mesquite Creek Homes (demo)', 'mesquite-creek') returning id into b_mc;
  insert into public.builders (name, slug) values ('Prairie Lantern Builders (demo)', 'prairie-lantern') returning id into b_pl;

  insert into public.communities (builder_id, name, city, county) values (b_mc, 'Oak Creek', 'Celina', 'Collin') returning id into c_oak;
  insert into public.communities (builder_id, name, city, county) values (b_mc, 'Willow Bend Ranch', 'Forney', 'Kaufman') returning id into c_willow;
  insert into public.communities (builder_id, name, city, county) values (b_pl, 'Bluestem Meadows', 'Princeton', 'Collin') returning id into c_blue;

  insert into public.profiles (id, email, full_name, role, builder_id) values
    (pg_temp.demo_user('admin@demo.test', 'Conner Rutledge'), 'admin@demo.test', 'Conner Rutledge', 'platform_admin', null),
    (pg_temp.demo_user('coordinator@demo.test', 'Casey Coordinator'), 'coordinator@demo.test', 'Casey Coordinator', 'listing_coordinator', null),
    (pg_temp.demo_user('owner.mesquite@demo.test', 'Morgan Reyes'), 'owner.mesquite@demo.test', 'Morgan Reyes', 'builder_owner', b_mc),
    (pg_temp.demo_user('manager.mesquite@demo.test', 'Jordan Ellis'), 'manager.mesquite@demo.test', 'Jordan Ellis', 'manager', b_mc),
    (pg_temp.demo_user('sales.mesquite@demo.test', 'Taylor Brooks'), 'sales.mesquite@demo.test', 'Taylor Brooks', 'sales', b_mc),
    (pg_temp.demo_user('sales2.mesquite@demo.test', 'Jamie Ortiz'), 'sales2.mesquite@demo.test', 'Jamie Ortiz', 'sales', b_mc),
    (pg_temp.demo_user('marketing.mesquite@demo.test', 'Riley Chen'), 'marketing.mesquite@demo.test', 'Riley Chen', 'marketing', b_mc),
    (pg_temp.demo_user('owner.prairie@demo.test', 'Avery Patel'), 'owner.prairie@demo.test', 'Avery Patel', 'builder_owner', b_pl),
    (pg_temp.demo_user('marketing.prairie@demo.test', 'Quinn Harper'), 'marketing.prairie@demo.test', 'Quinn Harper', 'marketing', b_pl);

  -- Mesquite Creek: Oak Creek (8 homes) and Willow Bend Ranch (6 homes)
  for i in 1..14 loop
    select * into plan from (values
      ('Aspen', 1850, 3, 2, 0, 1, 349990),
      ('Brazos', 2145, 4, 3, 0, 1, 389990),
      ('Cypress', 2480, 4, 3, 1, 2, 429990),
      ('Driftwood', 2890, 5, 4, 0, 2, 479990)
    ) p(name, sqft, beds, fullb, halfb, stories, price) offset ((i - 1) % 4) limit 1;

    stat := (array['draft','draft','in_review','in_review','approved_for_mls','live_on_mls','live_on_mls'])[1 + (i % 7)]::public.workflow_status;
    stage := (array['to_be_built','under_construction','under_construction','move_in_ready'])[1 + (i % 4)]::public.build_stage;
    addr_no := 1200 + i * 6;

    insert into public.homes (
      builder_id, community_id, unparsed_address, city, postal_code, lot_number, plan_name,
      list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, lot_size_acres,
      stories, garage_spaces, year_built, public_remarks, build_stage, estimated_completion,
      workflow_status, mls_number, field_sources
    ) values (
      b_mc,
      case when i <= 8 then c_oak else c_willow end,
      addr_no || case when i <= 8
        then (array[' Pecan Ridge Dr',' Sycamore Trl'])[1 + (i % 2)]
        else (array[' Willow Bend Ln',' Bur Oak Ct'])[1 + (i % 2)] end,
      case when i <= 8 then 'Celina' else 'Forney' end,
      case when i <= 8 then '75009' else '75126' end,
      'B' || (2 + i / 5) || '-L' || lpad(i::text, 2, '0'),
      plan.name,
      plan.price + (i % 3) * 5000,
      plan.beds, plan.fullb, plan.halfb, plan.sqft,
      round((0.14 + (i % 5) * 0.02)::numeric, 3),
      plan.stories, 2 + (plan.sqft > 2400)::int, 2026,
      'The ' || plan.name || ' plan by Mesquite Creek Homes offers ' || plan.beds || ' bedrooms and '
        || plan.sqft || ' square feet of open living, with a chef''s kitchen, covered patio and energy-efficient features throughout.',
      stage,
      case when stage = 'move_in_ready' then null else date '2026-12-15' + (i * 9) end,
      stat,
      case when stat = 'live_on_mls' then 'DEMO-' || (20400 + i) end,
      jsonb_build_object('list_price', case when i % 3 = 0 then 'staff' else 'website' end,
                         'public_remarks', 'website', 'living_area', 'website',
                         'lot_size_acres', 'staff')
    );
  end loop;

  -- Prairie Lantern: Bluestem Meadows (7 homes)
  for i in 1..7 loop
    select * into plan from (values
      ('Lantern', 1720, 3, 2, 0, 1, 329990),
      ('Meadowlark', 2210, 4, 2, 1, 2, 374990),
      ('Prairie', 2650, 4, 3, 0, 1, 414990)
    ) p(name, sqft, beds, fullb, halfb, stories, price) offset ((i - 1) % 3) limit 1;

    stat := (array['draft','in_review','approved_for_mls','live_on_mls'])[1 + (i % 4)]::public.workflow_status;
    stage := (array['under_construction','move_in_ready','to_be_built'])[1 + (i % 3)]::public.build_stage;

    insert into public.homes (
      builder_id, community_id, unparsed_address, city, postal_code, lot_number, plan_name,
      list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, lot_size_acres,
      stories, garage_spaces, year_built, public_remarks, build_stage, estimated_completion,
      workflow_status, mls_number, field_sources
    ) values (
      b_pl, c_blue,
      (400 + i * 4) || (array[' Bluestem Way',' Indiangrass Ct'])[1 + (i % 2)],
      'Princeton', '75407',
      'A1-L' || lpad(i::text, 2, '0'),
      plan.name,
      plan.price + (i % 2) * 7500,
      plan.beds, plan.fullb, plan.halfb, plan.sqft,
      round((0.15 + (i % 3) * 0.03)::numeric, 3),
      plan.stories, 2, 2026,
      'Welcome to the ' || plan.name || ' at Bluestem Meadows: ' || plan.beds || ' bedrooms, '
        || plan.sqft || ' square feet, and a bright open layout backing to green space.',
      stage,
      case when stage = 'move_in_ready' then null else date '2027-01-20' + (i * 12) end,
      stat,
      case when stat = 'live_on_mls' then 'DEMO-' || (31700 + i) end,
      jsonb_build_object('list_price', 'staff', 'public_remarks', 'staff')
    );
  end loop;
end $$;

-- Salespeople see only their assigned communities (migration 0004).
insert into public.community_assignments (profile_id, community_id)
select p.id, c.id from public.profiles p join public.communities c on
  (p.email = 'sales.mesquite@demo.test' and c.name = 'Oak Creek') or
  (p.email = 'sales2.mesquite@demo.test' and c.name = 'Willow Bend Ranch')
on conflict do nothing;
