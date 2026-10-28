-- Demo builder Tasks boards (TEST project only): one example of each kind of
-- task for each demo builder. Everything is made the real way (requests,
-- incentives, an MLS Expire Date), so each task adds itself like it would in use.
do $$
declare
  b record; h1 uuid; h2 uuid; h3 uuid; live uuid; sales1 uuid; sales2 uuid; mkt uuid; boss uuid; cid uuid; c1 uuid; addr text;
begin
  for b in select id, name from public.builders where name like '%(demo)%' order by name loop
    select id, community_id into h1, c1 from public.homes where builder_id = b.id and deleted_at is null order by unparsed_address limit 1;
    select id, community_id, unparsed_address into h2, cid, addr from public.homes where builder_id = b.id and deleted_at is null order by unparsed_address offset 1 limit 1;
    select id into h3 from public.homes where builder_id = b.id and deleted_at is null order by unparsed_address offset 2 limit 1;
    select id into live from public.homes where builder_id = b.id and deleted_at is null and workflow_status = 'live_on_mls' and coalesce(market_status, 'active') = 'active' order by unparsed_address limit 1;
    -- A salesperson who can see the home (assigned to its community), so each
    -- request comes from someone who could really have made it.
    select p.id into sales1 from public.profiles p join public.community_assignments a on a.profile_id = p.id
      where p.builder_id = b.id and p.role = 'sales' and p.is_active and a.community_id = c1 order by p.full_name limit 1;
    select p.id into sales2 from public.profiles p join public.community_assignments a on a.profile_id = p.id
      where p.builder_id = b.id and p.role = 'sales' and p.is_active and a.community_id = cid order by p.full_name limit 1;
    select id into mkt from public.profiles where builder_id = b.id and role = 'marketing' and is_active order by full_name limit 1;
    select id into boss from public.profiles where builder_id = b.id and role in ('builder_owner', 'manager') and is_active order by role desc, full_name limit 1;

    -- Change request from a salesperson.
    if not exists (select 1 from public.change_requests where home_id = h1 and status = 'open') then
      insert into public.change_requests (home_id, builder_id, requested_by, message)
      values (h1, b.id, coalesce(sales1, boss), 'Buyer asked about the backyard: the listing says covered patio, but this lot has the extended patio. Please update the description.');
    end if;

    -- Photos to review (the photographer just delivered).
    perform private.add_builder_task(b.id, 'photo_review', 'Review the photos for ' || addr,
      E'The photographer delivered. Check the photos, then mark the request complete or send it back.\n\nFrom the photographer: Twilight shots are at the end.',
      h2, cid, 'demo_photo_review', h2, now() + interval '5 hours');

    -- Incentive ending in 4 days.
    if not exists (select 1 from public.incentives where builder_id = b.id and title = 'Free upgraded appliance package') then
      insert into public.incentives (builder_id, community_id, title, details, ends_on)
      values (b.id, cid, 'Free upgraded appliance package', 'On contracts written by the end date.', private.today_central() + 4);
    end if;

    -- A live listing whose MLS Expire Date is 10 days out.
    if live is not null then
      insert into public.mls_details (home_id, builder_id, data) values (live, b.id, jsonb_build_object('ExpirationDate', (private.today_central() + 10)::text))
      on conflict (home_id) do update set data = public.mls_details.data || excluded.data;
    end if;

    -- Things the team is waiting on: media ordered, a reverse prospecting list, comps.
    insert into public.media_requests (builder_id, home_id, needs, notes, requested_by, due_date)
    values (b.id, h3, array['photos', 'twilight'], 'Model is staged; lockbox code is in the shoot notes.', coalesce(mkt, boss), private.today_central() + 6);
    insert into public.reverse_prospect_requests (home_id, builder_id, requested_by, notes)
    values (h2, b.id, coalesce(sales2, boss), 'Buyers in the $400s looking for 4 bedrooms.');
    insert into public.comp_requests (builder_id, community_id, home_id, requested_by, location, price_point, notes)
    values (b.id, c1, h1, coalesce(sales1, boss), 'Comps near the community entrance', 425000, 'Sold in the last 6 months, 2,200 to 2,600 sq ft.');
  end loop;
  perform private.run_incentive_checks();
  perform private.run_listing_expiry_checks();
end $$;
