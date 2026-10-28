-- Demo builder Tasks boards (TEST project only): one example of each kind for
-- each demo builder, spread across the due-date groups so every part of the
-- board shows. Change requests and incentives are made for real, so their
-- tasks add themselves the same way they would in use.
do $$
declare
  b record; h1 uuid; h2 uuid; h3 uuid; sales uuid; mkt uuid; boss uuid; cid uuid;
  noon timestamptz := (private.today_central()::timestamp + interval '12 hours') at time zone 'America/Chicago';
begin
  for b in select id, name from public.builders where name like '%(demo)%' order by name loop
    select id into h1 from public.homes where builder_id = b.id and deleted_at is null order by unparsed_address limit 1;
    select id into h2 from public.homes where builder_id = b.id and deleted_at is null order by unparsed_address offset 1 limit 1;
    select id into h3 from public.homes where builder_id = b.id and deleted_at is null order by unparsed_address offset 2 limit 1;
    select community_id into cid from public.homes where id = h2;
    select id into sales from public.profiles where builder_id = b.id and role = 'sales' and is_active order by full_name limit 1;
    select id into mkt from public.profiles where builder_id = b.id and role = 'marketing' and is_active order by full_name limit 1;
    select id into boss from public.profiles where builder_id = b.id and role in ('builder_owner', 'manager') and is_active order by role desc, full_name limit 1;

    -- Change request (a salesperson asks; the task adds itself, due in 3 days).
    insert into public.change_requests (home_id, builder_id, requested_by, message)
    values (h1, b.id, coalesce(sales, boss), 'Buyer asked about the backyard: the listing says covered patio, but this lot has the extended patio. Please update the description.');

    -- Photos to review (as if the photographer just delivered), due today.
    insert into public.builder_tasks (builder_id, kind, title, details, home_id, due_at, assignee_id, created_by)
    select b.id, 'photo_review', 'Review the photos for ' || unparsed_address,
      E'The photographer delivered. Check the photos, then mark the request complete or send it back.\n\nFrom the photographer: Twilight shots are at the end; the front sprinkler was running, so one exterior has a wet driveway.',
      id, noon + interval '5 hours', mkt, null
    from public.homes where id = h2;

    -- Incentive ending in 4 days (made for real; the daily check adds the task).
    insert into public.incentives (builder_id, community_id, title, details, ends_on)
    values (b.id, cid, 'Free upgraded appliance package', 'On contracts written by the end date.', private.today_central() + 4);

    -- Everyday tasks the team adds themselves: overdue, this week, later, no date, and one finished.
    insert into public.builder_tasks (builder_id, kind, title, details, home_id, due_at, priority, assignee_id, created_by) values
      (b.id, 'other', 'Send the spring brochure to the printer', 'Final proof is in the shared drive. 500 copies.', null, noon - interval '2 days', 'high', mkt, null),
      (b.id, 'other', 'Order a new yard sign for the model', null, h3, noon + interval '3 days', 'normal', boss, null),
      (b.id, 'other', 'Plan the grand opening for the next phase', 'Food truck, balloons, realtor lunch. Pick a Saturday.', null, noon + interval '20 days', 'normal', null, null),
      (b.id, 'other', 'Update the sales office hours on the website', null, null, null, 'normal', mkt, null);
    insert into public.builder_tasks (builder_id, kind, title, details, due_at, assignee_id, status, created_by)
    values (b.id, 'other', 'Refresh the community welcome video', 'Done: new drone footage added.', noon - interval '3 days', mkt, 'done', null);
  end loop;
  perform private.run_incentive_checks();
end $$;
