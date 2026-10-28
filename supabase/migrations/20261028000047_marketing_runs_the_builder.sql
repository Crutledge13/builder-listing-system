-- Marketing becomes the builder's main operator (owners' decision, 28 Oct 2026).
--
-- Marketing can now do everything a manager can: edit communities and their
-- setup answers, edit any home detail (address, specs, price, room sizes,
-- NTREIS answers) after it's added, approve listings for the MLS, change
-- listing status (under contract, sold, paused, off the market), move homes to
-- the trash, run open houses, answer "still available?", extend expiring
-- listings, pick a home's MLS, turn the website feed on and off, run the setup
-- checklist, see reports, AI usage and access history, and manage people the
-- way managers do (add and change sales and marketing users, put salespeople
-- on communities). Managers keep everything they had.

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create or replace function private.can_manage_person(target_role public.user_role, target_builder uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_builder is not null
     and target_builder = private.my_builder_id()
     and ((private.my_role() = 'builder_owner' and target_role in ('builder_owner', 'manager', 'sales', 'marketing'))
       or (private.my_role() in ('manager', 'marketing') and target_role in ('sales', 'marketing')))
$$;

alter policy "see own, or builder's if owner/manager, or all if staff" on public.community_assignments
  using ((profile_id = auth.uid()) or private.is_staff() or exists (
    select 1 from public.communities c
    where c.id = community_assignments.community_id and c.builder_id = private.my_builder_id()
      and private.my_role() in ('builder_owner', 'manager', 'marketing')));
alter policy "owners, managers and admin assign" on public.community_assignments
  with check ((private.my_role() = 'platform_admin') or exists (
    select 1 from public.communities c
    where c.id = community_assignments.community_id and c.builder_id = private.my_builder_id()
      and private.my_role() in ('builder_owner', 'manager', 'marketing')));
alter policy "owners, managers and admin unassign" on public.community_assignments
  using ((private.my_role() = 'platform_admin') or exists (
    select 1 from public.communities c
    where c.id = community_assignments.community_id and c.builder_id = private.my_builder_id()
      and private.my_role() in ('builder_owner', 'manager', 'marketing')));

-- Access history (who gave whom access).
alter policy "see activity for visible homes" on public.activity_log
  using (private.can_see_builder(builder_id)
    and (home_id is null or exists (select 1 from public.homes h where h.id = activity_log.home_id))
    and ((not ((action like 'person\_%') or (action like 'sales\_community\_%')))
      or private.is_staff() or private.my_role() in ('builder_owner', 'manager', 'marketing')));

-- ---------------------------------------------------------------------------
-- Communities, builder settings, setup checklist
-- ---------------------------------------------------------------------------
alter policy "owners and managers edit communities" on public.communities
  using ((private.my_role() = 'platform_admin')
    or (private.my_role() in ('builder_owner', 'manager', 'marketing') and builder_id = private.my_builder_id()))
  with check ((private.my_role() = 'platform_admin')
    or (private.my_role() in ('builder_owner', 'manager', 'marketing') and builder_id = private.my_builder_id()));

-- Website feed on/off (MLS entry and feature switches stay admin-only,
-- enforced by builder_settings_mls_entry_guard).
alter policy "owners, managers and admins change builder settings" on public.builder_settings
  using ((private.my_role() = 'platform_admin')
    or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')))
  with check ((private.my_role() = 'platform_admin')
    or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')));

create or replace function private.can_run_setup(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff()
      or (b = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing'));
$$;
revoke execute on function private.can_run_setup(uuid) from public, anon;

alter policy "see AI usage" on public.ai_usage
  using (private.is_staff()
    or (private.my_role() in ('builder_owner', 'manager', 'marketing') and builder_id = private.my_builder_id()));

alter policy "update comp requests" on public.comp_requests
  using (private.is_staff() or requested_by = auth.uid()
    or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')));

-- ---------------------------------------------------------------------------
-- Open houses
-- ---------------------------------------------------------------------------
alter policy "sales, managers, owners and admin schedule" on public.open_houses
  with check (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'marketing', 'sales')
    and exists (select 1 from public.homes h where h.id = open_houses.home_id));
alter policy "sales, managers, owners and admin change" on public.open_houses
  using (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'marketing', 'sales')
    and exists (select 1 from public.homes h where h.id = open_houses.home_id))
  with check (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'marketing', 'sales'));
alter policy "schedule series" on public.open_house_series
  with check (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'marketing', 'sales')
    and exists (select 1 from public.homes h where h.id = open_house_series.home_id));
alter policy "end series" on public.open_house_series
  using (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'marketing', 'sales')
    and exists (select 1 from public.homes h where h.id = open_house_series.home_id))
  with check (private.my_role() in ('platform_admin', 'builder_owner', 'manager', 'marketing', 'sales'));

-- ---------------------------------------------------------------------------
-- Homes: marketing edits like owners and managers, and approves for the MLS
-- ---------------------------------------------------------------------------
create or replace function public.enforce_home_edit_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.user_role := private.my_role();
  changed text[];
  allowed text[];
  bad text[];
  sale text[] := array['purchase_contract_date', 'close_date', 'close_price',
    'buyer_agent_full_name', 'buyer_agent_mls_id', 'buyer_agent_state_license', 'buyer_office_name',
    'co_buyer_agent_full_name', 'co_buyer_office_name', 'buyer_unrepresented'];
begin
  if auth.uid() is null or current_setting('app.system_update', true) = 'on' then
    if new.workflow_status = 'live_on_mls' and old.workflow_status <> 'live_on_mls' and new.market_status is null then
      new.market_status := 'active';
    end if;
    return new;
  end if;

  select coalesce(array_agg(n.key), '{}') into changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'updated_by', 'field_sources');

  if r = 'platform_admin' then
    allowed := changed;
  elsif r = 'listing_coordinator' then
    allowed := array['mls_number', 'workflow_status', 'market_status', 'mls_board'] || sale;
  elsif r in ('builder_owner', 'manager', 'marketing') then
    allowed := array['community_id', 'unparsed_address', 'city', 'postal_code',
      'lot_number', 'plan_name', 'list_price', 'bedrooms_total', 'bathrooms_full',
      'bathrooms_half', 'living_area', 'lot_size_acres', 'stories', 'garage_spaces',
      'year_built', 'public_remarks', 'build_stage', 'estimated_completion',
      'workflow_status', 'deleted_at', 'market_status', 'show_representative_disclaimer', 'mls_board', 'mls_fields',
      'website_page_url'] || sale;
  elsif r = 'sales' then
    allowed := array['list_price', 'build_stage', 'estimated_completion', 'workflow_status', 'market_status'] || sale;
  else
    allowed := '{}';
  end if;

  if r in ('builder_owner', 'manager', 'marketing') and private.builder_enters_mls(new.builder_id) then
    allowed := allowed || array['mls_number', 'workflow_status'];
  end if;
  select coalesce(array_agg(c), '{}') into bad from unnest(changed) c where c <> all (allowed);
  if array_length(bad, 1) > 0 then
    raise exception 'Your role (%) cannot change: %', r, array_to_string(bad, ', ') using errcode = '42501';
  end if;

  if new.workflow_status is distinct from old.workflow_status then
    if not (
      r = 'platform_admin'
      or (r in ('builder_owner', 'manager', 'sales', 'marketing')
          and new.workflow_status in ('draft', 'in_review') and old.workflow_status in ('draft', 'in_review'))
      or (r in ('builder_owner', 'manager', 'marketing') and old.workflow_status = 'in_review' and new.workflow_status = 'approved_for_mls')
      or (r in ('builder_owner', 'manager', 'marketing') and old.workflow_status = 'approved_for_mls' and new.workflow_status in ('draft', 'in_review'))
      or (r = 'listing_coordinator' and old.workflow_status = 'approved_for_mls' and new.workflow_status = 'live_on_mls')
      or (r in ('builder_owner', 'manager', 'marketing') and private.builder_enters_mls(new.builder_id)
          and old.workflow_status = 'approved_for_mls' and new.workflow_status = 'live_on_mls')
    ) then
      raise exception 'Your role (%) cannot move a listing from % to %', r, old.workflow_status, new.workflow_status using errcode = '42501';
    end if;
  end if;

  if new.workflow_status = 'live_on_mls' and coalesce(new.mls_number, '') = '' then
    raise exception 'An MLS number is required before marking a listing live' using errcode = '23514';
  end if;
  if new.workflow_status = 'live_on_mls' and old.workflow_status <> 'live_on_mls' and new.market_status is null then
    new.market_status := 'active';
  end if;
  if new.market_status is distinct from old.market_status then
    if r = 'sales' and new.market_status not in ('active', 'under_contract', 'sold') then
      raise exception 'Ask a manager, marketing or the owner to pause or withdraw a listing' using errcode = '42501';
    end if;
  end if;

  if new.market_status = 'under_contract' and old.market_status is distinct from 'under_contract'
     and not new.buyer_unrepresented
     and (coalesce(btrim(new.buyer_agent_full_name), '') = '' or coalesce(btrim(new.buyer_office_name), '') = '') then
    raise exception 'Enter the buyer''s agent and their brokerage (or tick "The buyer has no agent")' using errcode = '23514';
  end if;
  if old.market_status = 'under_contract' and new.market_status = 'active' then
    new.buyer_agent_full_name := null;
    new.buyer_agent_mls_id := null;
    new.buyer_agent_state_license := null;
    new.buyer_office_name := null;
    new.co_buyer_agent_full_name := null;
    new.co_buyer_office_name := null;
    new.buyer_unrepresented := false;
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  select coalesce(new.field_sources, '{}'::jsonb)
         || coalesce(jsonb_object_agg(c, 'staff'), '{}'::jsonb)
    into new.field_sources
  from unnest(changed) c
  where c not in ('workflow_status', 'deleted_at', 'mls_number', 'market_status', 'show_representative_disclaimer')
    and (new.field_sources ->> c) is not distinct from (old.field_sources ->> c);

  return new;
end;
$$;
revoke execute on function public.enforce_home_edit_rules() from public, anon, authenticated;

-- "Still available / under contract / sold"
create or replace function public.confirm_availability(p_home uuid, p_answer text, p_date date default null, p_price numeric default null, p_buyer jsonb default null)
returns text language plpgsql security definer set search_path = '' as $$
declare h record; r public.user_role := private.my_role();
begin
  select id, builder_id, community_id, workflow_status into h from public.homes where id = p_home;
  if h.id is null or not (private.is_staff() or (private.can_see_home(h.builder_id, h.community_id)
     and r in ('builder_owner', 'manager', 'marketing', 'sales'))) then
    raise exception 'You can''t update this home' using errcode = '42501';
  end if;
  if h.workflow_status <> 'live_on_mls' then raise exception 'This home isn''t live on the MLS' using errcode = '23514'; end if;
  if p_answer = 'available' then
    perform private.system_update_on();
    update public.homes set availability_confirmed_at = now() where id = p_home;
    perform private.system_update_off();
    update public.website_listings
      set status_confirmed_text = status_text, status_confirmed_at = now(), status_confirmed_by = auth.uid()
      where home_id = p_home and status_text ~* '(sold|under contract|pending|contract)';
    perform private.resolve_alerts(p_home, 'availability_check', 'Still available');
    perform private.resolve_alerts(p_home, 'sold_signal_website', 'Builder confirmed it is still available (website is out of date)');
    return 'available';
  elsif p_answer = 'under_contract' then
    update public.homes set
      market_status = 'under_contract',
      purchase_contract_date = coalesce(p_date, current_date),
      buyer_unrepresented = coalesce((p_buyer ->> 'unrepresented')::boolean, false),
      buyer_agent_full_name = nullif(btrim(p_buyer ->> 'agent_name'), ''),
      buyer_office_name = nullif(btrim(p_buyer ->> 'office_name'), ''),
      buyer_agent_mls_id = nullif(btrim(p_buyer ->> 'agent_mls_id'), ''),
      buyer_agent_state_license = nullif(btrim(p_buyer ->> 'agent_license'), ''),
      co_buyer_agent_full_name = nullif(btrim(p_buyer ->> 'co_agent_name'), ''),
      co_buyer_office_name = nullif(btrim(p_buyer ->> 'co_office_name'), '')
    where id = p_home;
    return 'under_contract';
  elsif p_answer = 'sold' then
    if p_price is null then raise exception 'Enter the close price' using errcode = '23514'; end if;
    update public.homes set market_status = 'sold', close_date = coalesce(p_date, current_date), close_price = p_price where id = p_home;
    return 'sold';
  end if;
  raise exception 'Unknown answer';
end $$;

create or replace function public.extend_listing(p_home uuid, p_until date)
returns void language plpgsql security definer set search_path = '' as $$
declare h record; old_exp date;
begin
  select id, builder_id, workflow_status into h from public.homes where id = p_home and deleted_at is null;
  if h.id is null then raise exception 'Home not found'; end if;
  if not (private.is_staff() or (h.builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing'))) then
    raise exception 'Only an owner, manager or marketing can extend a listing' using errcode = '42501';
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

-- Builder alerts now email marketing too (they're the ones who act on them).
create or replace function private.raise_alert(p_home uuid, p_kind text, p_severity text, p_audience text, p_message text, p_due timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h record; aid uuid; existing record;
begin
  select id, builder_id, community_id, unparsed_address into h from public.homes where id = p_home;
  if p_audience = 'team' and private.builder_enters_mls(h.builder_id) then p_audience := 'both'; end if;
  select id, severity, message into existing from public.home_alerts where home_id = p_home and kind = p_kind and resolved_at is null;
  if existing.id is not null then
    if existing.severity <> p_severity or existing.message <> p_message then
      update public.home_alerts set severity = p_severity, message = p_message, due_at = coalesce(p_due, due_at) where id = existing.id;
    end if;
    return existing.id;
  end if;
  insert into public.home_alerts (home_id, builder_id, community_id, kind, severity, audience, message, due_at)
  values (p_home, h.builder_id, h.community_id, p_kind, p_severity, p_audience, p_message, p_due)
  returning id into aid;
  if p_audience in ('builder', 'both') then
    insert into public.email_outbox (to_email, subject, body, related_table, related_id)
    select p.email, 'Builder Listings: ' || h.unparsed_address, p_message || E'\n\nOpen Builder Listings to update it.', 'home_alerts', aid
    from public.profiles p
    where p.builder_id = h.builder_id and p.is_active
      and (p.role in ('builder_owner', 'manager', 'marketing')
        or (p.role = 'sales' and exists (select 1 from public.community_assignments a where a.profile_id = p.id and a.community_id = h.community_id)));
  end if;
  if p_audience in ('team', 'both') and p_severity = 'urgent' and not private.builder_enters_mls(h.builder_id) then
    perform private.queue_team_email('URGENT: ' || h.unparsed_address, p_message, 'home_alerts', aid);
  end if;
  return aid;
end $$;
