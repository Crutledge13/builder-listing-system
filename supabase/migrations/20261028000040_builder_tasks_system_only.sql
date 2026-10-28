-- The builder's Tasks board holds only what happens in this system. People
-- can't type in their own tasks; every task comes from something real and
-- closes when that thing is handled:
--   photos to review (photographer delivered)     -> closes when complete / sent back
--   change request (someone asked for an edit)     -> closes when done / declined
--   incentive ending (7 days out)                  -> closes when extended / ended
--   listing expiring (MLS Expire Date, 14 days out)-> closes when extended / let expire
--   media ordered, reverse prospecting, comps      -> tracked until our team delivers
-- People can start a task and hand it to a teammate. They can't mark a task
-- done by hand, except "Let it expire" on a listing that's expiring.

-- 1. New kinds; the free-typed kind goes away.
delete from public.builder_tasks where kind = 'other';
alter table public.builder_tasks drop constraint builder_tasks_kind_check;
alter table public.builder_tasks add constraint builder_tasks_kind_check check (kind in
  ('photo_review', 'change_request', 'incentive', 'listing_expiring', 'media_order', 'reverse_prospecting', 'comps'));
drop policy "add to-dos" on public.builder_tasks;

-- 2. Only the system opens and closes tasks. The helpers raise a flag the guard trusts.
create or replace function private.add_builder_task(p_builder uuid, p_kind text, p_title text, p_details text, p_home uuid, p_community uuid,
  p_source_table text, p_source_id uuid, p_due timestamptz, p_priority text default 'normal') returns uuid
language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  select id into tid from public.builder_tasks
  where source_table = p_source_table and source_id = p_source_id and status in ('todo', 'in_progress') limit 1;
  if tid is not null then return tid; end if;
  perform set_config('app.builder_tasks_system', 'on', true);
  insert into public.builder_tasks (builder_id, kind, title, details, home_id, community_id, source_table, source_id, due_at, priority, created_by)
  values (p_builder, p_kind, left(p_title, 200), left(p_details, 4000), p_home, p_community, p_source_table, p_source_id, p_due, p_priority, null)
  returning id into tid;
  perform set_config('app.builder_tasks_system', 'off', true);
  return tid;
end $$;
revoke all on function private.add_builder_task(uuid, text, text, text, uuid, uuid, text, uuid, timestamptz, text) from public, anon, authenticated;

create or replace function private.close_builder_tasks(p_source_table text, p_source_id uuid, p_status text default 'done') returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.builder_tasks_system', 'on', true);
  update public.builder_tasks set status = p_status
  where source_table = p_source_table and source_id = p_source_id and status in ('todo', 'in_progress');
  perform set_config('app.builder_tasks_system', 'off', true);
end $$;
revoke all on function private.close_builder_tasks(text, uuid, text) from public, anon, authenticated;

create or replace function public.builder_tasks_people_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or current_setting('app.builder_tasks_system', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'Tasks come from the system (photos, change requests, incentives, listings, requests)' using errcode = '42501';
  end if;
  -- People may start a task, hand it on, or (for an expiring listing) let it expire.
  if (to_jsonb(new) - array['status', 'assignee_id', 'updated_at', 'completed_at', 'completed_by'])
     is distinct from (to_jsonb(old) - array['status', 'assignee_id', 'updated_at', 'completed_at', 'completed_by']) then
    raise exception 'You can start a task or hand it to someone; it closes on its own when the work is done' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'todo' and new.status = 'in_progress')
    or (old.status = 'in_progress' and new.status = 'todo')
    or (old.kind = 'listing_expiring' and old.status in ('todo', 'in_progress') and new.status = 'done')) then
    raise exception 'This task closes on its own when the work is done' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.builder_tasks_people_guard() from public, anon, authenticated;
create trigger builder_tasks_people_guard before insert or update on public.builder_tasks
  for each row execute function public.builder_tasks_people_guard();

-- 3. Requests the builder team is waiting on: tracked until our team delivers.
create or replace function public.media_requests_order_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status in ('requested', 'assigned', 'scheduled') then
    perform private.add_builder_task(new.builder_id, 'media_order', 'Media ordered: ' || new.address,
      'Requested by ' || coalesce(new.requester_name, 'your team') || '. Our team books the photographer; you''ll get the photos to review here.',
      new.home_id, new.community_id, 'media_requests_order', new.id, new.due_date::timestamp at time zone 'America/Chicago');
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status in ('delivered', 'completed') then
      perform private.close_builder_tasks('media_requests_order', new.id, 'done');
    elsif new.status = 'cancelled' then
      perform private.close_builder_tasks('media_requests_order', new.id, 'cancelled');
    elsif new.status = 'scheduled' and new.scheduled_for is not null then
      perform set_config('app.builder_tasks_system', 'on', true);
      update public.builder_tasks set details = 'Requested by ' || coalesce(new.requester_name, 'your team') || '. Shoot booked for '
          || to_char(new.scheduled_for at time zone 'America/Chicago', 'Dy Mon DD, FMHH12:MI AM') || coalesce(' with ' || new.photographer_name, '') || '.'
      where source_table = 'media_requests_order' and source_id = new.id and status in ('todo', 'in_progress');
      perform set_config('app.builder_tasks_system', 'off', true);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.media_requests_order_task() from public, anon, authenticated;
create trigger media_requests_order_task after insert or update of status, scheduled_for on public.media_requests
  for each row execute function public.media_requests_order_task();

create or replace function public.reverse_prospect_builder_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status in ('requested', 'in_progress') then
    perform private.add_builder_task(new.builder_id, 'reverse_prospecting', 'Reverse prospecting: ' || new.address,
      'Requested by ' || coalesce(new.requester_name, 'your team') || '. Our team is pulling the list from the MLS; it goes straight back to them.',
      new.home_id, null, 'reverse_prospect_requests', new.id, null);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('delivered', 'cancelled') then
    perform private.close_builder_tasks('reverse_prospect_requests', new.id, case when new.status = 'cancelled' then 'cancelled' else 'done' end);
  end if;
  return null;
end $$;
revoke all on function public.reverse_prospect_builder_task() from public, anon, authenticated;
create trigger reverse_prospect_builder_task after insert or update of status on public.reverse_prospect_requests
  for each row execute function public.reverse_prospect_builder_task();

create or replace function public.comp_requests_builder_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status in ('requested', 'in_progress') then
    perform private.add_builder_task(new.builder_id, 'comps', 'Comps requested: ' || new.location,
      'Requested by ' || coalesce(new.requester_name, 'your team') || '. Our team pulls the comps; they come back on the request.',
      new.home_id, new.community_id, 'comp_requests', new.id, null);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('delivered', 'cancelled') then
    perform private.close_builder_tasks('comp_requests', new.id, case when new.status = 'cancelled' then 'cancelled' else 'done' end);
  end if;
  return null;
end $$;
revoke all on function public.comp_requests_builder_task() from public, anon, authenticated;
create trigger comp_requests_builder_task after insert or update of status on public.comp_requests
  for each row execute function public.comp_requests_builder_task();

-- 4. Listings close to their MLS Expire Date (14 days out). Our team (or the
--    builder, if they enter their own MLS) sets Expire Date on the MLS sheet.
create or replace function private.listing_expires_on(p_home uuid) returns date
language sql stable security definer set search_path = '' as $$
  select case when (d.data ->> 'ExpirationDate') ~ '^\d{4}-\d{2}-\d{2}$' then (d.data ->> 'ExpirationDate')::date end
  from public.mls_details d where d.home_id = p_home
$$;
revoke all on function private.listing_expires_on(uuid) from public, anon, authenticated;

create or replace function private.run_listing_expiry_checks() returns void
language plpgsql security definer set search_path = '' as $$
declare h record; today date := private.today_central();
begin
  for h in
    select hm.id, hm.builder_id, hm.community_id, hm.unparsed_address, private.listing_expires_on(hm.id) as exp
    from public.homes hm
    where hm.deleted_at is null and hm.workflow_status = 'live_on_mls' and coalesce(hm.market_status, 'active') in ('active', 'paused')
  loop
    if h.exp is null then continue; end if;
    if h.exp <= today + 14 then
      if not exists (select 1 from public.builder_tasks where source_table = 'listing_expiry' and source_id = h.id and status in ('todo', 'in_progress')) then
        perform private.add_builder_task(h.builder_id, 'listing_expiring',
          'Listing ' || case when h.exp < today then 'expired ' else 'expires ' end || to_char(h.exp, 'Mon FMDD') || ': ' || h.unparsed_address,
          'The MLS listing agreement ends ' || to_char(h.exp, 'FMMonth FMDD, YYYY') || '. Extend it with a new date, or let it expire. Either way the MLS is updated.',
          h.id, h.community_id, 'listing_expiry', h.id, (h.exp::timestamp + interval '17 hours') at time zone 'America/Chicago',
          case when h.exp <= today + 3 then 'high' else 'normal' end);
        perform private.notify_builder(h.builder_id, array['builder_owner', 'manager', 'marketing'], h.community_id, 'listing',
          'Listing expires ' || to_char(h.exp, 'Mon FMDD') || ': ' || h.unparsed_address, 'Extend it or let it expire.', '/todo?kind=listing_expiring');
      end if;
    else
      perform private.close_builder_tasks('listing_expiry', h.id, 'done');
    end if;
  end loop;
  -- Homes that came off the market or were sold no longer need the reminder.
  perform private.close_builder_tasks('listing_expiry', t.source_id, 'cancelled')
  from public.builder_tasks t join public.homes hm on hm.id = t.source_id
  where t.source_table = 'listing_expiry' and t.status in ('todo', 'in_progress')
    and (hm.deleted_at is not null or hm.workflow_status <> 'live_on_mls' or coalesce(hm.market_status, 'active') not in ('active', 'paused'));
end $$;
revoke all on function private.run_listing_expiry_checks() from public, anon, authenticated;
select cron.schedule('listing-expiry-checks', '13 12 * * *', $$select private.run_listing_expiry_checks()$$);

-- Extend a listing: owners, managers (and our team) give the new Expire Date.
-- It's saved on the MLS sheet and goes on the MLS update task.
create or replace function public.extend_listing(p_home uuid, p_until date) returns void
language plpgsql security definer set search_path = '' as $$
declare h record; old_exp date;
begin
  select id, builder_id, workflow_status into h from public.homes where id = p_home and deleted_at is null;
  if h.id is null then raise exception 'Home not found'; end if;
  if not (private.is_staff() or (h.builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager'))) then
    raise exception 'Only an owner or manager can extend a listing' using errcode = '42501';
  end if;
  if p_until is null or p_until <= private.today_central() then raise exception 'Pick a new end date after today'; end if;
  old_exp := private.listing_expires_on(p_home);
  if exists (select 1 from public.mls_details where home_id = p_home) then
    update public.mls_details set data = data || jsonb_build_object('ExpirationDate', p_until::text), updated_at = now(), updated_by = auth.uid()
    where home_id = p_home;
  else
    insert into public.mls_details (home_id, builder_id, data, updated_by) values (p_home, h.builder_id, jsonb_build_object('ExpirationDate', p_until::text), auth.uid());
  end if;
  if h.workflow_status = 'live_on_mls' then
    perform private.note_mls_change(p_home, 'ExpirationDate', 'Expire Date', coalesce(to_jsonb(old_exp::text), 'null'::jsonb), to_jsonb(p_until::text));
  end if;
  insert into public.activity_log (builder_id, home_id, actor_id, action, changes)
  values (h.builder_id, p_home, auth.uid(), 'listing_extended', jsonb_build_object('ExpirationDate', jsonb_build_object('from', old_exp, 'to', p_until)));
  if p_until > private.today_central() + 14 then
    perform private.close_builder_tasks('listing_expiry', p_home, 'done');
  end if;
end $$;
revoke all on function public.extend_listing(uuid, date) from public, anon;
grant execute on function public.extend_listing(uuid, date) to authenticated;

-- 5. Start the board with what's already waiting.
do $$ declare r record; begin
  for r in select * from public.media_requests where status in ('requested', 'assigned', 'scheduled') loop
    perform private.add_builder_task(r.builder_id, 'media_order', 'Media ordered: ' || r.address,
      'Requested by ' || coalesce(r.requester_name, 'your team') || '. Our team books the photographer; you''ll get the photos to review here.',
      r.home_id, r.community_id, 'media_requests_order', r.id, r.due_date::timestamp at time zone 'America/Chicago');
  end loop;
  for r in select * from public.reverse_prospect_requests where status in ('requested', 'in_progress') loop
    perform private.add_builder_task(r.builder_id, 'reverse_prospecting', 'Reverse prospecting: ' || r.address,
      'Requested by ' || coalesce(r.requester_name, 'your team') || '. Our team is pulling the list from the MLS; it goes straight back to them.',
      r.home_id, null, 'reverse_prospect_requests', r.id, null);
  end loop;
  for r in select * from public.comp_requests where status in ('requested', 'in_progress') loop
    perform private.add_builder_task(r.builder_id, 'comps', 'Comps requested: ' || r.location,
      'Requested by ' || coalesce(r.requester_name, 'your team') || '. Our team pulls the comps; they come back on the request.',
      r.home_id, r.community_id, 'comp_requests', r.id, null);
  end loop;
end $$;
select private.run_listing_expiry_checks();
