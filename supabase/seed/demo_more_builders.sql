-- More demo builders, and every demo builder fully onboarded (TEST project
-- only, everything made up). Run after demo_billing.sql. Safe to run again.
--
-- One demo builder per billing plan, each with its own sign-ins:
--   Mesquite Creek Homes     Listing Service+ + Photos   (from demo_data.sql)
--   Prairie Lantern Builders Software + Photos           (from demo_data.sql)
--   Cedar Hollow Homes       Software only; enters its own MLS listings
--   Redbud Ridge Homes       Listing Service+ only; uses its own photographer
--
-- Then every demo builder gets its company details filled in as if setup were
-- finished: legal name, agreement dates, billing and main contacts, website,
-- drawn demo logo and colors, title company, photographer contact, community
-- setup answers, and "We're all set".
--
-- New logins reuse the existing demo password (copied from admin@demo.test),
-- so this file never needs the password itself.

create or replace function pg_temp.demo_user2(p_email text, p_name text)
returns uuid language plpgsql as $$
declare uid uuid; pw text;
begin
  select id into uid from auth.users where email = p_email;
  if uid is not null then return uid; end if;
  select encrypted_password into pw from auth.users where email = 'admin@demo.test';
  uid := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    p_email, coalesce(pw, extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name),
    now(), now(), '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
  return uid;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Two more builders, their people, communities, homes and plans
-- ---------------------------------------------------------------------------
do $$
declare
  b_ch uuid; b_rr uuid; c_saddle uuid; c_hickory uuid; c_redbud uuid;
  i int; plan record; stat public.workflow_status; stage public.build_stage;
begin
  if exists (select 1 from public.builders where name = 'Cedar Hollow Homes (demo)') then return; end if;
  if not exists (select 1 from public.builders where name like '%(demo)%') then return; end if;

  insert into public.builders (name, slug, legal_name) values ('Cedar Hollow Homes (demo)', 'cedar-hollow', 'Cedar Hollow Homes, LLC') returning id into b_ch;
  insert into public.builders (name, slug, legal_name) values ('Redbud Ridge Homes (demo)', 'redbud-ridge', 'Redbud Ridge Homebuilders, Inc.') returning id into b_rr;
  -- Markets first, so communities and homes pick up NTREIS.
  insert into public.builder_settings (builder_id, website_url, mls_boards) values
    (b_ch, 'https://www.cedarhollowhomes.example', array['NTREIS']),
    (b_rr, 'https://www.redbudridgehomes.example', array['NTREIS'])
  on conflict (builder_id) do nothing;

  insert into public.communities (builder_id, name, city, county) values (b_ch, 'Saddle Creek', 'Anna', 'Collin') returning id into c_saddle;
  insert into public.communities (builder_id, name, city, county) values (b_ch, 'Hickory Bend', 'Melissa', 'Collin') returning id into c_hickory;
  insert into public.communities (builder_id, name, city, county) values (b_rr, 'Redbud Ridge', 'Midlothian', 'Ellis') returning id into c_redbud;

  insert into public.profiles (id, email, full_name, role, builder_id) values
    (pg_temp.demo_user2('owner.cedar@demo.test', 'Drew Coleman'), 'owner.cedar@demo.test', 'Drew Coleman', 'builder_owner', b_ch),
    (pg_temp.demo_user2('marketing.cedar@demo.test', 'Parker Lane'), 'marketing.cedar@demo.test', 'Parker Lane', 'marketing', b_ch),
    (pg_temp.demo_user2('sales.cedar@demo.test', 'Sam Whitfield'), 'sales.cedar@demo.test', 'Sam Whitfield', 'sales', b_ch),
    (pg_temp.demo_user2('owner.redbud@demo.test', 'Elena Marsh'), 'owner.redbud@demo.test', 'Elena Marsh', 'builder_owner', b_rr),
    (pg_temp.demo_user2('marketing.redbud@demo.test', 'Chris Vega'), 'marketing.redbud@demo.test', 'Chris Vega', 'marketing', b_rr),
    (pg_temp.demo_user2('sales.redbud@demo.test', 'Dana Fields'), 'sales.redbud@demo.test', 'Dana Fields', 'sales', b_rr)
  on conflict (id) do nothing;

  insert into public.community_assignments (profile_id, community_id)
  select p.id, c from public.profiles p, unnest(array[c_saddle, c_hickory]) c where p.email = 'sales.cedar@demo.test'
  union all
  select p.id, c_redbud from public.profiles p where p.email = 'sales.redbud@demo.test'
  on conflict do nothing;

  -- Cedar Hollow: Saddle Creek (4 homes) and Hickory Bend (3 homes).
  for i in 1..7 loop
    select * into plan from (values
      ('Juniper', 1980, 3, 2, 1, 1, 359990),
      ('Mesa', 2360, 4, 3, 0, 1, 399990),
      ('Ridgeline', 2780, 4, 3, 1, 2, 449990)
    ) p(name, sqft, beds, fullb, halfb, stories, price) offset ((i - 1) % 3) limit 1;
    stat := (array['live_on_mls','draft','in_review','approved_for_mls','live_on_mls','live_on_mls','draft'])[i]::public.workflow_status;
    stage := (array['move_in_ready','to_be_built','under_construction','under_construction','move_in_ready','under_construction','to_be_built'])[i]::public.build_stage;
    insert into public.homes (
      builder_id, community_id, unparsed_address, city, postal_code, lot_number, plan_name,
      list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, lot_size_acres,
      stories, garage_spaces, year_built, public_remarks, build_stage, estimated_completion,
      workflow_status, mls_number, field_sources
    ) values (
      b_ch, case when i <= 4 then c_saddle else c_hickory end,
      (800 + i * 8) || case when i <= 4 then (array[' Saddle Creek Dr',' Spur Ln'])[1 + (i % 2)] else (array[' Hickory Bend Way',' Pecan Hollow Ct'])[1 + (i % 2)] end,
      case when i <= 4 then 'Anna' else 'Melissa' end,
      case when i <= 4 then '75409' else '75454' end,
      'C' || (1 + i / 4) || '-L' || lpad(i::text, 2, '0'), plan.name,
      plan.price + (i % 3) * 6000, plan.beds, plan.fullb, plan.halfb, plan.sqft,
      round((0.16 + (i % 4) * 0.02)::numeric, 3), plan.stories, 2 + (plan.sqft > 2500)::int, 2026,
      'The ' || plan.name || ' by Cedar Hollow Homes: ' || plan.beds || ' bedrooms, ' || plan.sqft
        || ' square feet, quartz counters, a covered patio and a spray-foam insulated attic.',
      stage, case when stage = 'move_in_ready' then null else date '2027-01-10' + (i * 10) end,
      stat, case when stat = 'live_on_mls' then 'DEMO-' || (41200 + i) end,
      jsonb_build_object('list_price', 'staff', 'public_remarks', 'staff')
    );
  end loop;

  -- Redbud Ridge: one community (5 homes).
  for i in 1..5 loop
    select * into plan from (values
      ('Redbud', 2050, 3, 2, 1, 1, 339990),
      ('Live Oak', 2440, 4, 3, 0, 1, 384990)
    ) p(name, sqft, beds, fullb, halfb, stories, price) offset ((i - 1) % 2) limit 1;
    stat := (array['live_on_mls','approved_for_mls','in_review','live_on_mls','draft'])[i]::public.workflow_status;
    stage := (array['move_in_ready','under_construction','under_construction','move_in_ready','to_be_built'])[i]::public.build_stage;
    insert into public.homes (
      builder_id, community_id, unparsed_address, city, postal_code, lot_number, plan_name,
      list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, lot_size_acres,
      stories, garage_spaces, year_built, public_remarks, build_stage, estimated_completion,
      workflow_status, mls_number, field_sources
    ) values (
      b_rr, c_redbud,
      (3100 + i * 6) || (array[' Redbud Ridge Dr',' Ironwood Trl'])[1 + (i % 2)],
      'Midlothian', '76065', 'R1-L' || lpad(i::text, 2, '0'), plan.name,
      plan.price + (i % 2) * 8000, plan.beds, plan.fullb, plan.halfb, plan.sqft,
      round((0.18 + (i % 3) * 0.03)::numeric, 3), plan.stories, 2, 2026,
      'Welcome home to the ' || plan.name || ' at Redbud Ridge: ' || plan.beds || ' bedrooms on a '
        || 'tree-lined street, with an oversized island, study and three-car tandem garage.',
      stage, case when stage = 'move_in_ready' then null else date '2027-02-01' + (i * 14) end,
      stat, case when stat = 'live_on_mls' then 'DEMO-' || (52300 + i) end,
      jsonb_build_object('list_price', 'staff', 'public_remarks', 'staff')
    );
  end loop;

  insert into public.floor_plans (builder_id, name, bedrooms_total, bathrooms_full, bathrooms_half, living_area, stories, garage_spaces, levels, living_areas_total, dining_areas_total, rooms, notes)
  select b, p.name, p.beds, p.bf, p.bh, p.sqft, p.st, p.gar, p.levels, p.living, p.dining, p.rooms::jsonb, 'Demo plan (made up).'
  from (values
    (b_ch, 'Juniper', 3, 2, 1, 1980, 1, 2, 'One', 1, 1, '[{"RoomType":"Family Room","RoomLevel":"1","RoomLength":19,"RoomWidth":16},{"RoomType":"Kitchen","RoomLevel":"1","RoomLength":15,"RoomWidth":12},{"RoomType":"Dining Room","RoomLevel":"1","RoomLength":12,"RoomWidth":11},{"RoomType":"Bedroom-Primary","RoomLevel":"1","RoomLength":16,"RoomWidth":14},{"RoomType":"Bath-Primary","RoomLevel":"1","RoomLength":11,"RoomWidth":9},{"RoomType":"Bedroom","RoomLevel":"1","RoomLength":12,"RoomWidth":11},{"RoomType":"Bedroom","RoomLevel":"1","RoomLength":11,"RoomWidth":10}]'),
    (b_ch, 'Mesa', 4, 3, 0, 2360, 1, 2, 'One', 1, 1, '[{"RoomType":"Great Room","RoomLevel":"1","RoomLength":21,"RoomWidth":17},{"RoomType":"Kitchen","RoomLevel":"1","RoomLength":16,"RoomWidth":13},{"RoomType":"Breakfast Rm","RoomLevel":"1","RoomLength":12,"RoomWidth":10},{"RoomType":"Bedroom-Primary","RoomLevel":"1","RoomLength":17,"RoomWidth":14},{"RoomType":"Bath-Primary","RoomLevel":"1","RoomLength":12,"RoomWidth":10},{"RoomType":"Office","RoomLevel":"1","RoomLength":11,"RoomWidth":10},{"RoomType":"Bedroom","RoomLevel":"1","RoomLength":12,"RoomWidth":11},{"RoomType":"Bedroom","RoomLevel":"1","RoomLength":12,"RoomWidth":10},{"RoomType":"Bedroom","RoomLevel":"1","RoomLength":11,"RoomWidth":10}]'),
    (b_ch, 'Ridgeline', 4, 3, 1, 2780, 2, 3, 'Two', 2, 2, '[{"RoomType":"Family Room","RoomLevel":"1","RoomLength":20,"RoomWidth":17},{"RoomType":"Kitchen","RoomLevel":"1","RoomLength":16,"RoomWidth":13},{"RoomType":"Dining Room","RoomLevel":"1","RoomLength":13,"RoomWidth":12},{"RoomType":"Bedroom-Primary","RoomLevel":"1","RoomLength":17,"RoomWidth":15},{"RoomType":"Bath-Primary","RoomLevel":"1","RoomLength":13,"RoomWidth":11},{"RoomType":"Game Room","RoomLevel":"2","RoomLength":18,"RoomWidth":15},{"RoomType":"Bedroom","RoomLevel":"2","RoomLength":12,"RoomWidth":12},{"RoomType":"Bedroom","RoomLevel":"2","RoomLength":12,"RoomWidth":11},{"RoomType":"Bedroom","RoomLevel":"2","RoomLength":11,"RoomWidth":11}]'),
    (b_rr, 'Redbud', 3, 2, 1, 2050, 1, 2, 'One', 1, 1, '[{"RoomType":"Living Room","RoomLevel":"1","RoomLength":19,"RoomWidth":16},{"RoomType":"Kitchen","RoomLevel":"1","RoomLength":15,"RoomWidth":13},{"RoomType":"Dining Room","RoomLevel":"1","RoomLength":12,"RoomWidth":11},{"RoomType":"Bedroom-Primary","RoomLevel":"1","RoomLength":16,"RoomWidth":14},{"RoomType":"Bath-Primary","RoomLevel":"1","RoomLength":11,"RoomWidth":10},{"RoomType":"Office","RoomLevel":"1","RoomLength":11,"RoomWidth":10},{"RoomType":"Bedroom","RoomLevel":"1","RoomLength":12,"RoomWidth":11},{"RoomType":"Bedroom","RoomLevel":"1","RoomLength":11,"RoomWidth":11}]'),
    (b_rr, 'Live Oak', 4, 3, 0, 2440, 1, 3, 'One', 1, 1, '[{"RoomType":"Family Room","RoomLevel":"1","RoomLength":21,"RoomWidth":18},{"RoomType":"Kitchen","RoomLevel":"1","RoomLength":17,"RoomWidth":13},{"RoomType":"Breakfast Rm","RoomLevel":"1","RoomLength":12,"RoomWidth":11},{"RoomType":"Bedroom-Primary","RoomLevel":"1","RoomLength":17,"RoomWidth":15},{"RoomType":"Bath-Primary","RoomLevel":"1","RoomLength":13,"RoomWidth":10},{"RoomType":"Bedroom","RoomLevel":"1","RoomLength":12,"RoomWidth":12},{"RoomType":"Bedroom","RoomLevel":"1","RoomLength":12,"RoomWidth":11},{"RoomType":"Bedroom","RoomLevel":"1","RoomLength":11,"RoomWidth":11}]')
  ) as p(b, name, beds, bf, bh, sqft, st, gar, levels, living, dining, rooms);

  -- One incentive each.
  insert into public.incentives (builder_id, title, details, ends_on) values
    (b_ch, '$7,500 flex cash', 'Use toward closing costs, upgrades or a rate buydown on contracts by the end date.', private.today_central() + 40),
    (b_rr, 'Free 3-car garage upgrade', 'On Live Oak plans that go under contract by the end date.', private.today_central() + 25);
end $$;

-- Demo pictures and videos for the new builders' homes and communities (same
-- drawn media as demo_media.sql; skips anything that already has media).
insert into public.media (builder_id, home_id, kind, room, title, tags, source, demo_key, mime_type, width, height, is_cover, mls_ready, sort_order)
select h.builder_id, h.id, x.kind, x.room, x.title, x.tags, 'demo', x.demo_key,
       'image/svg+xml', 1440, 960, x.sort_order = 0, x.kind <> 'floor_plan', x.sort_order
from public.homes h
join public.builders b on b.id = h.builder_id and b.name in ('Cedar Hollow Homes (demo)', 'Redbud Ridge Homes (demo)')
cross join (values
  (0, 'photo', 'exterior', 'Front exterior', array['curb appeal'], 'home:exterior:day'),
  (1, 'photo', 'exterior', 'Front exterior at twilight', array['twilight'], 'home:exterior:twilight'),
  (2, 'photo', 'kitchen', 'Kitchen', array['island', 'pendant lights'], 'room:kitchen'),
  (3, 'photo', 'living', 'Family room', array['open concept'], 'room:living'),
  (4, 'photo', 'dining', 'Dining room', array[]::text[], 'room:dining'),
  (5, 'photo', 'primary_bedroom', 'Primary bedroom', array[]::text[], 'room:primary_bedroom'),
  (6, 'photo', 'primary_bath', 'Primary bath', array['double vanity', 'soaking tub'], 'room:primary_bath'),
  (7, 'photo', 'bedroom', 'Secondary bedroom', array[]::text[], 'room:bedroom'),
  (8, 'photo', 'backyard', 'Backyard and covered patio', array['covered patio'], 'room:backyard'),
  (9, 'floor_plan', 'floor_plan', 'Floor plan', array[]::text[], 'floor_plan')
) as x(sort_order, kind, room, title, tags, demo_key)
where not exists (select 1 from public.media m where m.home_id = h.id and m.source = 'demo');

insert into public.media (builder_id, community_id, kind, room, title, tags, source, demo_key, mime_type, width, height, duration_seconds, mls_ready, sort_order)
select c.builder_id, c.id, x.kind, x.room, c.name || ' ' || x.title, x.tags, 'demo', x.demo_key,
       case when x.kind = 'video' then 'video/mp4' else 'image/svg+xml' end,
       case when x.kind = 'video' then 960 else 1440 end, case when x.kind = 'video' then 640 else 960 end,
       case when x.kind = 'video' then 12.6 end, x.kind = 'photo', x.sort_order
from public.communities c
join public.builders b on b.id = c.builder_id and b.name in ('Cedar Hollow Homes (demo)', 'Redbud Ridge Homes (demo)')
cross join (values
  (0, 'photo', 'entrance', 'entrance', array['monument sign'], 'community:entrance'),
  (1, 'photo', 'amenity', 'pool', array['pool', 'amenities'], 'community:amenity'),
  (2, 'photo', 'aerial', 'aerial view', array['drone'], 'community:aerial'),
  (3, 'photo', 'site_map', 'site plan', array['lot map'], 'community:site_map'),
  (4, 'photo', 'model_home', 'model home', array['model home'], 'community:model_home'),
  (5, 'video', null, 'community tour', array['video tour', 'drone'], 'video:community')
) as x(sort_order, kind, room, title, tags, demo_key)
where not exists (select 1 from public.media m where m.community_id = c.id and m.home_id is null and m.source = 'demo');

-- ---------------------------------------------------------------------------
-- 2. Every demo builder fully onboarded
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  last_m date := (date_trunc('month', (now() at time zone 'America/Chicago')) - interval '1 month')::date;
begin
  for r in select * from (values
    -- name, legal name, color 1, color 2, website, tagline, title company, title location, title phone, escrow officer,
    -- main contact (name, title, email, phone), billing contact (name, email, phone), photo contact (name, phone, email, notes),
    -- mls entry, website platform, pricing note
    ('Mesquite Creek Homes (demo)', 'Mesquite Creek Homes, LLC', '#7a4a2a', '#d9a441', 'https://www.mesquitecreekhomes.example',
     'Built for North Texas living', 'Lone Star Title (demo)', '5800 Legacy Dr, Plano, TX 75024', '(972) 555-0130', 'Karen Holt',
     'Morgan Reyes', 'Owner', 'owner.mesquite@demo.test', '(214) 555-0101',
     'Lisa Moreno, Accounts Payable', 'ap@mesquitecreekhomes.example', '(214) 555-0109',
     'Riley Chen', '(214) 555-0142', 'marketing.mesquite@demo.test', 'Lockbox on the front door; code is in the shoot email. Park on the street, not the driveway.',
     'our_team', 'WordPress with a listings plugin', 'Listing Service+ with our photographer, $350 per listing for year one.'),
    ('Prairie Lantern Builders (demo)', 'Prairie Lantern Builders, Inc.', '#2f5d50', '#e3b448', 'https://www.prairielanternbuilders.example',
     'Homes with room to breathe', 'Bluebonnet Title (demo)', '2201 W University Dr, McKinney, TX 75071', '(469) 555-0175', 'Marcus Lee',
     'Avery Patel', 'Owner', 'owner.prairie@demo.test', '(469) 555-0111',
     'Avery Patel', 'billing@prairielanternbuilders.example', '(469) 555-0111',
     'Quinn Harper', '(972) 555-0187', 'marketing.prairie@demo.test', 'Check in at the model home sales office before shooting.',
     'our_team', 'Squarespace', 'Software plus our photographer; $2,500 onboarding.'),
    ('Cedar Hollow Homes (demo)', 'Cedar Hollow Homes, LLC', '#3c5a3a', '#b5651d', 'https://www.cedarhollowhomes.example',
     'Craftsman-built in Collin County', 'Trinity Title (demo)', '101 E White St, Anna, TX 75409', '(972) 555-0155', 'Jenna Ruiz',
     'Drew Coleman', 'President', 'owner.cedar@demo.test', '(972) 555-0120',
     'Pat Owens, Controller', 'accounting@cedarhollowhomes.example', '(972) 555-0124',
     'Parker Lane', '(972) 555-0126', 'marketing.cedar@demo.test', 'Homes are on a combo lockbox at the front door.',
     'builder', 'Custom site (agency built)', 'Software only at $3,500 a month (annual agreement). They enter their own MLS listings.'),
    ('Redbud Ridge Homes (demo)', 'Redbud Ridge Homebuilders, Inc.', '#9c2c5a', '#4a6b8a', 'https://www.redbudridgehomes.example',
     'Rooted in Ellis County', 'Ellis County Abstract & Title (demo)', '310 S Rogers St, Waxahachie, TX 75165', '(972) 555-0168', 'Tom Baker',
     'Elena Marsh', 'Owner', 'owner.redbud@demo.test', '(469) 555-0140',
     'Elena Marsh', 'elena@redbudridgehomes.example', '(469) 555-0140',
     'Chris Vega', '(469) 555-0145', 'marketing.redbud@demo.test', 'They use their own photographer; no shoots booked through us.',
     'our_team', 'Wix', 'Listing Service+ at standard $400 per listing, $1,500 onboarding. Their own photographer.')
  ) as t(name, legal, c1, c2, web, tagline, tc_name, tc_loc, tc_phone, tc_contact,
         mc_name, mc_title, mc_email, mc_phone, bill_name, bill_email, bill_phone,
         ph_name, ph_phone, ph_email, ph_notes, mls_entry, platform, pricing)
  loop
    update public.builders set legal_name = r.legal where name = r.name;

    update public.builder_branding br set
      -- A drawn demo logo (src/lib/demo-logo.ts), not a stored file: <builder>/demo-logo/<color>/<Name>.svg
      logo_path = br.builder_id || '/demo-logo/' || substr(r.c1, 2) || '/' || replace(replace(r.name, ' (demo)', ''), ' ', '-') || '.svg',
      logo_updated_at = now(),
      colors = jsonb_build_array(jsonb_build_object('name', 'Main', 'hex', r.c1), jsonb_build_object('name', 'Accent', 'hex', r.c2),
                                 jsonb_build_object('name', 'Ink', 'hex', '#1e2125')),
      fonts = array['Figtree', 'Georgia'],
      website_url = r.web, tagline = r.tagline,
      brand_notes = 'Warm and plain-spoken. Lead with the lot and the light; never use "luxury". Spell out numbers under ten. (Demo notes.)'
    from public.builders b where b.id = br.builder_id and b.name = r.name;

    insert into public.builder_settings (builder_id, website_url, mls_boards)
      select id, r.web, array['NTREIS'] from public.builders where name = r.name
      on conflict (builder_id) do nothing;
    update public.builder_settings s set
      website_url = coalesce(s.website_url, r.web),
      mls_entry = r.mls_entry,
      title_company_name = r.tc_name, title_company_location = r.tc_loc, title_company_phone = r.tc_phone,
      title_company_contact = r.tc_contact,
      title_company_email = lower(replace(r.tc_contact, ' ', '.')) || '@title.example',
      main_contact_name = r.mc_name, main_contact_title = r.mc_title, main_contact_email = r.mc_email, main_contact_phone = r.mc_phone
    from public.builders b where b.id = s.builder_id and b.name = r.name;

    update public.builder_photo_info p set contact_name = r.ph_name, contact_phone = r.ph_phone, contact_email = r.ph_email, access_notes = r.ph_notes
    from public.builders b where b.id = p.builder_id and b.name = r.name;

    update public.builder_onboarding o set
      agreement_signed_on = last_m - 10, listing_authorization_on = last_m - 10,
      billing_contact_name = r.bill_name, billing_contact_email = r.bill_email, billing_contact_phone = r.bill_phone,
      pricing = r.pricing, website_platform = r.platform, sends_listing_feed = case when r.name like 'Mesquite%' then 'yes' else 'no' end,
      notes = 'Demo builder: every detail here is made up.',
      skipped = array['brand_guide'], finished_at = coalesce(o.finished_at, last_m + 3)
    from public.builders b where b.id = o.builder_id and b.name = r.name;
  end loop;

  -- Community setup answers (the builder's side), so every community is ready for the MLS.
  update public.communities c set mls_fields = c.mls_fields || jsonb_build_object(
      'SubdivisionName', coalesce(c.mls_fields ->> 'SubdivisionName', c.name || ' Ph 1'),
      'HighSchoolDistrict', coalesce(c.mls_fields ->> 'HighSchoolDistrict', c.city || ' ISD'),
      'ElementarySchool', c.name || ' Elementary (demo)',
      'HighSchool', c.city || ' High (demo)',
      'Utilities', jsonb_build_array('City Sewer', 'City Water', 'Concrete', 'Curbs', 'Electricity Connected', 'Natural Gas Available', 'Sidewalk', 'Underground Utilities'),
      'SpecialDistrict', case when c.county = 'Ellis' then 'MUD' else 'PID' end,
      'AssociationType', 'Mandatory',
      'AssociationFee', 750, 'AssociationFeeFrequency', 'Annually',
      'AssociationName', c.name || ' HOA (demo)',
      'LockBoxType', 'SentriLock',
      'ShowingRequirements', jsonb_build_array('Appointment Only', 'Showing Service'),
      'ShowingInstructions', 'Book through the showing service. Model home open daily 10 to 6.',
      'Directions', coalesce(c.mls_fields ->> 'Directions', 'From the highway, take the ' || c.city || ' exit east 2 miles; ' || c.name || ' entrance is on the left past the school.'))
  from public.builders b where b.id = c.builder_id and b.name like '%(demo)%';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Billing for the new builders (Mesquite and Prairie are in demo_billing.sql)
-- ---------------------------------------------------------------------------
do $$
declare
  ch uuid := (select id from public.builders where name = 'Cedar Hollow Homes (demo)');
  rr uuid := (select id from public.builders where name = 'Redbud Ridge Homes (demo)');
  this_m date := date_trunc('month', (now() at time zone 'America/Chicago'))::date;
  last_m date := (date_trunc('month', (now() at time zone 'America/Chicago')) - interval '1 month')::date;
  next_m date := (date_trunc('month', (now() at time zone 'America/Chicago')) + interval '1 month')::date;
  h record; i int := 0; inv uuid; n int;
begin
  if ch is null or rr is null or exists (select 1 from public.invoices where builder_id in (ch, rr)) then return; end if;
  perform set_config('app.billing_system', 'on', true);

  update public.builder_billing set plan = 'software', includes_photos = false, starts_on = last_m, software_fee_cents = 350000,
    deal_notes = 'Annual agreement: $3,500/month (standard $4,000). No onboarding fee. They enter their own MLS listings.'
  where builder_id = ch;
  update public.builder_billing set plan = 'listing_service', includes_photos = false, starts_on = last_m, onboarding_fee_cents = 150000,
    deal_notes = 'Standard Listing Service+ pricing. $1,500 onboarding on the first invoice. They use their own photographer.'
  where builder_id = rr;

  -- Cedar Hollow: last month's software (paid), this month's (sent, not yet due... issued the 1st).
  insert into public.billing_charges (builder_id, kind, description, amount_cents, occurred_on, invoice_month) values
    (ch, 'software', 'Software, ' || to_char(last_m, 'FMMonth YYYY'), 350000, last_m, last_m),
    (ch, 'software', 'Software, ' || to_char(this_m, 'FMMonth YYYY'), 350000, this_m, this_m);

  -- Redbud Ridge: onboarding and last month's listings on this month's invoice.
  insert into public.billing_charges (builder_id, kind, description, amount_cents, occurred_on, invoice_month)
  values (rr, 'onboarding', 'Onboarding and setup', 150000, last_m, last_m);
  for h in select id, unparsed_address, workflow_status from public.homes where builder_id = rr and workflow_status in ('approved_for_mls', 'live_on_mls') order by unparsed_address loop
    i := i + 1;
    insert into public.billing_charges (builder_id, kind, home_id, description, amount_cents, occurred_on, invoice_month)
    values (rr, 'listing', h.id, 'Listing: ' || h.unparsed_address, 40000,
            case when i = 1 then this_m + 6 else last_m + 4 + i * 5 end,
            case when i = 1 then next_m else this_m end);
  end loop;

  select coalesce(max(substring(number from '\d+$')::int), 0) into n from public.invoices;

  insert into public.invoices (builder_id, period_month) values (ch, last_m) returning id into inv;
  update public.billing_charges set invoice_id = inv where builder_id = ch and invoice_month = last_m;
  perform private.invoice_recalc(inv);
  n := n + 1;
  update public.invoices set status = 'paid', number = 'INV-' || to_char(last_m, 'YYYYMM') || '-' || lpad(n::text, 4, '0'),
    issued_on = last_m, due_on = last_m + 15, sent_at = last_m + time '09:00', paid_at = last_m + 12 + time '10:00', paid_note = 'ACH received' where id = inv;

  insert into public.invoices (builder_id, period_month) values (ch, this_m) returning id into inv;
  update public.billing_charges set invoice_id = inv where builder_id = ch and invoice_month = this_m;
  perform private.invoice_recalc(inv);
  n := n + 1;
  update public.invoices set status = 'paid', number = 'INV-' || to_char(this_m, 'YYYYMM') || '-' || lpad(n::text, 4, '0'),
    issued_on = this_m, due_on = this_m + 15, sent_at = this_m + time '09:00', paid_at = this_m + 9 + time '10:00', paid_note = 'ACH received' where id = inv;

  -- Redbud's first invoice: just the onboarding from last month and listings (onboarding month is last month,
  -- so it lands on this month's invoice with the listings).
  update public.billing_charges set invoice_month = this_m where builder_id = rr and kind = 'onboarding';
  insert into public.invoices (builder_id, period_month) values (rr, this_m) returning id into inv;
  update public.billing_charges set invoice_id = inv where builder_id = rr and invoice_month = this_m;
  perform private.invoice_recalc(inv);
  n := n + 1;
  update public.invoices set status = 'sent', number = 'INV-' || to_char(this_m, 'YYYYMM') || '-' || lpad(n::text, 4, '0'),
    issued_on = this_m + 2, due_on = this_m + 32, sent_at = this_m + 2 + time '09:00',
    notes = 'Net 30 on the first invoice, as agreed.' where id = inv;
  perform setval('public.invoice_number_seq', greatest(n, (select last_value from public.invoice_number_seq)));
end $$;
