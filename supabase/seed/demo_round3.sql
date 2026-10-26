-- Demo data for round 3 features (TEST project only, all made up).
-- Run after demo_data.sql, demo_media.sql and demo_photo_requests.sql.
-- Safe to re-run: everything is looked up by builder name and address.

do $$
declare
  b_mc uuid := (select id from public.builders where name = 'Mesquite Creek Homes (demo)');
  b_pl uuid := (select id from public.builders where name = 'Prairie Lantern Builders (demo)');
  plan record;
  r record;
  rooms text[][] := array[
    array['model home exterior', 'exterior', 'home:exterior:day', 'photo'],
    array['kitchen', 'kitchen', 'room:kitchen', 'photo'],
    array['family room', 'living', 'room:living', 'photo'],
    array['dining room', 'dining', 'room:dining', 'photo'],
    array['primary bedroom', 'primary_bedroom', 'room:primary_bedroom', 'photo'],
    array['primary bath', 'primary_bath', 'room:primary_bath', 'photo'],
    array['covered patio', 'backyard', 'room:backyard', 'photo'],
    array['floor plan', 'floor_plan', 'floor_plan', 'floor_plan'],
    array['model home tour', null, 'video:home2', 'video']];
  i int;
  hid uuid;
  owner_mc uuid := (select id from public.profiles where email = 'owner.mesquite@demo.test');
  sales_mc uuid := (select id from public.profiles where email = 'sales.mesquite@demo.test');
begin
  -- Plan library: model-home photos for each floor plan (no home, no community).
  for plan in
    select distinct on (h.builder_id, h.plan_name) h.builder_id, h.plan_name, h.bedrooms_total,
           h.bathrooms_full + 0.5 * coalesce(h.bathrooms_half, 0) as baths, h.living_area
    from public.homes h where h.plan_name is not null and h.deleted_at is null
    order by h.builder_id, h.plan_name, h.created_at
  loop
    if exists (select 1 from public.media where builder_id = plan.builder_id and plan_name = plan.plan_name and home_id is null) then continue; end if;
    for i in 1 .. array_length(rooms, 1) loop
      insert into public.media (builder_id, plan_name, title, kind, room, source, demo_key, sort_order, mls_ready, duration_seconds, caption)
      values (plan.builder_id, plan.plan_name, 'The ' || plan.plan_name || ' plan: ' || rooms[i][1], rooms[i][4]::text, rooms[i][2], 'demo', rooms[i][3],
              i - 1, rooms[i][4] <> 'video', case when rooms[i][4] = 'video' then 15 end,
              case when rooms[i][4] = 'floor_plan' then plan.bedrooms_total || ' bed, ' || to_char(plan.baths, 'FM9.0') || ' bath, ' || to_char(plan.living_area, 'FM9,999') || ' sq ft' end);
    end loop;
  end loop;

  -- Homes not built yet: own photos go to the trash and the disclaimer is on,
  -- so their listings show plan photos.
  update public.media m set deleted_at = coalesce(m.deleted_at, now())
  from public.homes h where h.id = m.home_id and h.build_stage = 'to_be_built' and m.kind = 'photo';
  update public.homes set show_representative_disclaimer = true where build_stage = 'to_be_built';

  -- Website feed: on for Mesquite Creek, off for Prairie Lantern.
  insert into public.builder_settings (builder_id, website_url, website_feed_enabled, website_feed_source, website_feed_last_synced_at)
  values (b_mc, 'https://www.mesquitecreekhomes.example', true, 'listing_feed', now() - interval '2 hours'),
         (b_pl, 'https://www.prairielanternbuilders.example', false, null, null)
  on conflict (builder_id) do nothing;

  -- Mesquite Creek's website listings: same as ours, with a few deliberate
  -- differences (prices, a description) and two homes we don't have yet.
  for r in
    select h.id, h.unparsed_address, h.city, h.postal_code, c.name as community, h.plan_name, h.list_price, h.bedrooms_total,
           h.bathrooms_full, h.bathrooms_half, h.living_area, h.public_remarks, h.build_stage, row_number() over (order by h.unparsed_address) as n
    from public.homes h join public.communities c on c.id = h.community_id
    where h.builder_id = b_mc and h.deleted_at is null
  loop
    insert into public.website_listings (builder_id, external_id, unparsed_address, city, postal_code, community_name, plan_name, list_price,
      bedrooms_total, bathrooms_full, bathrooms_half, living_area, public_remarks, status_text, url, home_id)
    values (b_mc, 'MC-' || (1000 + r.n), r.unparsed_address, r.city, r.postal_code, r.community, r.plan_name,
      case r.unparsed_address when '1212 Pecan Ridge Dr' then r.list_price - 10000 when '1242 Sycamore Trl' then r.list_price - 10000
                              when '1266 Bur Oak Ct' then r.list_price + 5000 else r.list_price end,
      r.bedrooms_total, r.bathrooms_full, r.bathrooms_half, r.living_area,
      case when r.unparsed_address = '1218 Sycamore Trl' then 'Now with an upgraded outdoor kitchen! ' || r.public_remarks else r.public_remarks end,
      case r.build_stage when 'move_in_ready' then 'Move-in ready' when 'to_be_built' then 'To be built' else 'Under construction' end,
      'https://www.mesquitecreekhomes.example/homes/' || lower(replace(r.unparsed_address, ' ', '-')), r.id)
    on conflict (builder_id, external_id) do nothing;
  end loop;
  insert into public.website_listings (builder_id, external_id, unparsed_address, city, postal_code, community_name, plan_name, list_price,
    bedrooms_total, bathrooms_full, bathrooms_half, living_area, public_remarks, status_text, url)
  values
    (b_mc, 'MC-2001', '1290 Pecan Ridge Dr', 'Celina', '75009', 'Oak Creek', 'Brazos', 394990, 4, 3, 0, 2145,
     'The Brazos plan on a cul-de-sac lot: 4 bedrooms, open kitchen with a large island, and a covered patio.', 'Under construction',
     'https://www.mesquitecreekhomes.example/homes/1290-pecan-ridge-dr'),
    (b_mc, 'MC-2002', '1302 Willow Bend Ln', 'Forney', '75126', 'Willow Bend Ranch', 'Driftwood', 489990, 5, 4, 0, 2890,
     'Our largest plan, the Driftwood: 5 bedrooms, game room and a 3-car garage backing to the greenbelt.', 'To be built',
     'https://www.mesquitecreekhomes.example/homes/1302-willow-bend-ln')
  on conflict (builder_id, external_id) do nothing;

  -- What the MLS feed reports for live listings (two deliberate differences).
  for r in select h.* , row_number() over (order by h.unparsed_address) n from public.homes h where h.workflow_status = 'live_on_mls' and h.deleted_at is null loop
    insert into public.mls_listings (listing_id, home_id, builder_id, unparsed_address, list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, public_remarks, standard_status, modification_timestamp)
    values (coalesce(r.mls_number, 'DEMO-' || r.n), r.id, r.builder_id, r.unparsed_address,
      case when r.unparsed_address = '1236 Pecan Ridge Dr' then r.list_price + 10000 else r.list_price end,
      r.bedrooms_total,
      case when r.unparsed_address = '1278 Bur Oak Ct' then r.bathrooms_full - 1 else r.bathrooms_full end,
      r.bathrooms_half, r.living_area, r.public_remarks, 'Active', now() - interval '1 day')
    on conflict (listing_id) do nothing;
  end loop;

  -- A repeating Saturday open house (until under contract) on a live home.
  hid := (select id from public.homes where unparsed_address = '1230 Sycamore Trl');
  if hid is not null and not exists (select 1 from public.open_house_series where home_id = hid) then
    insert into public.open_house_series (home_id, builder_id, created_by, weekday, start_time, end_time, remarks, until_under_contract)
    values (hid, b_mc, sales_mc, 6, '13:00', '16:00', 'Model-quality staging, refreshments', true);
  end if;

  -- A reverse prospecting request waiting on our team.
  hid := (select id from public.homes where unparsed_address = '1236 Pecan Ridge Dr');
  if hid is not null and not exists (select 1 from public.reverse_prospect_requests where home_id = hid) then
    insert into public.reverse_prospect_requests (home_id, builder_id, requested_by, notes)
    values (hid, b_mc, owner_mc, 'Buyers searching Celina under $450k with 4+ beds.');
  end if;

  -- Tasks for approved homes waiting to be entered into the MLS.
  insert into public.tasks (kind, title, details, home_id, community_id, builder_id, source_table, source_id, due_at)
  select 'mls_entry', 'Enter ' || h.unparsed_address || ' into the MLS', 'Approved by the builder. Add the MLS number on the home once it’s live.',
         h.id, h.community_id, h.builder_id, 'homes', h.id, now() + interval '1 day'
  from public.homes h
  where h.workflow_status = 'approved_for_mls' and h.deleted_at is null
    and not exists (select 1 from public.tasks t where t.source_table = 'homes' and t.source_id = h.id and t.kind = 'mls_entry');

  -- Tasks for photo requests that still need a photographer.
  insert into public.tasks (kind, title, details, home_id, community_id, builder_id, source_table, source_id, due_at)
  select 'photo_request', 'Assign a photographer: ' || mr.address, 'Needs: ' || array_to_string(mr.needs, ', '),
         mr.home_id, mr.community_id, mr.builder_id, 'media_requests', mr.id, coalesce(mr.due_date::timestamptz, now() + interval '2 days')
  from public.media_requests mr
  where mr.status = 'requested'
    and not exists (select 1 from public.tasks t where t.source_table = 'media_requests' and t.source_id = mr.id);

  -- One finished shoot so photographer pay has an example (status set directly
  -- because the demo user approving it isn't signed in here).
  update public.media_requests set status = 'completed', completed_at = now() - interval '1 day'
  where address like '404 Indiangrass Ct%' and status = 'delivered';
  update public.photographer_payments set status = 'approved', approved_at = now() where address like '404 Indiangrass Ct%' and status = 'pending';
end $$;
