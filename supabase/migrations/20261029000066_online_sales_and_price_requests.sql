-- Owners, 29 Oct 2026:
-- 1. Online sales counselors. For now they have exactly a salesperson's access,
--    so they ARE salespeople (role 'sales') with profiles.online_sales = true.
--    Every rule that protects sales (assigned communities only, no uploads, no
--    pausing listings...) covers them with nothing to keep in step. When they
--    need to differ, check private.is_online_sales().
-- 2. Salespeople can't change a home's price; they send a price change request
--    (change_requests.kind = 'price' with the price they want). Owners,
--    managers, marketing and our admins approve it (the price changes, as
--    them) or decline it, and the salesperson is told either way.
-- 3. The home edit rules also learn the new columns: GPS coordinates (builder
--    editors) and the expected close date (a sale detail, required when a home
--    goes under contract).

-- ---------------------------------------------------------------------------
-- 1. Online sales counselors
-- ---------------------------------------------------------------------------
alter table public.profiles add column online_sales boolean not null default false;
alter table public.join_links add column online_sales boolean not null default false;

-- Only salespeople can be online; changing someone's role clears it.
create or replace function public.profiles_online_sales() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.role <> 'sales' then new.online_sales := false; end if;
  return new;
end $$;
revoke execute on function public.profiles_online_sales() from public, anon, authenticated;
create trigger profiles_online_sales before insert or update of role, online_sales on public.profiles
  for each row execute function public.profiles_online_sales();

create or replace function public.join_links_online_sales() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.role <> 'sales' then new.online_sales := false; end if;
  return new;
end $$;
revoke execute on function public.join_links_online_sales() from public, anon, authenticated;
create trigger join_links_online_sales before insert or update on public.join_links
  for each row execute function public.join_links_online_sales();

create or replace function private.is_online_sales() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.online_sales from public.profiles p
                   where p.id = (select auth.uid()) and p.is_active and p.role = 'sales'), false)
$$;
revoke execute on function private.is_online_sales() from public, anon;
grant execute on function private.is_online_sales() to authenticated;

-- The join page names the role; an online sales link says so.
drop function public.join_link_info(text);
create function public.join_link_info(p_token text)
returns table(ok boolean, reason text, role public.user_role, builder_name text, online_sales boolean)
language sql stable security definer set search_path = '' as $$
  select
    l.revoked_at is null and l.expires_at > now() and (l.max_uses is null or l.use_count < l.max_uses),
    case when l.revoked_at is not null then 'off'
         when l.expires_at <= now() then 'expired'
         when l.max_uses is not null and l.use_count >= l.max_uses then 'used' end,
    l.role,
    replace(b.name, ' (demo)', ''),
    l.online_sales
  from public.join_links l
  left join public.builders b on b.id = l.builder_id
  where p_token is not null and length(p_token) >= 20 and l.token = p_token
$$;
-- Signed-out people read this on the join page.
revoke all on function public.join_link_info(text) from public;
grant execute on function public.join_link_info(text) to anon, authenticated;

create or replace function public.redeem_join_link(p_token text, p_user uuid, p_email text, p_name text, p_phone text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare l public.join_links; name text := left(btrim(coalesce(p_name, '')), 120);
begin
  select * into l from public.join_links where token = p_token for update;
  if l.id is null or l.revoked_at is not null or l.expires_at <= now()
     or (l.max_uses is not null and l.use_count >= l.max_uses) then
    raise exception 'This join link isn''t working anymore' using errcode = '42501';
  end if;
  if name = '' then raise exception 'Enter your name'; end if;
  if exists (select 1 from public.profiles where id = p_user or lower(email) = lower(p_email)) then
    raise exception 'That email already has an account' using errcode = '23505';
  end if;

  insert into public.profiles (id, email, full_name, role, builder_id, phone, online_sales)
  values (p_user, lower(btrim(p_email)), name, l.role, l.builder_id, nullif(left(btrim(coalesce(p_phone, '')), 40), ''), l.online_sales);

  if l.role = 'sales' and cardinality(l.community_ids) > 0 then
    insert into public.community_assignments (profile_id, community_id)
    select p_user, c from unnest(l.community_ids) c
    where c in (select id from public.communities where builder_id = l.builder_id);
  end if;
  if l.role = 'listing_coordinator' and cardinality(l.staff_builder_ids) > 0 then
    insert into public.staff_builders (profile_id, builder_id, created_by)
    select p_user, b, l.created_by from unnest(l.staff_builder_ids) b
    where b in (select id from public.builders);
  end if;

  update public.activity_log set actor_id = l.created_by, changes = changes || jsonb_build_object('via', 'join link', 'link', l.label)
  where action = 'person_added' and changes ->> 'person_id' = p_user::text;
  perform set_config('app.join_redeem', 'on', true);
  update public.join_links set use_count = use_count + 1 where id = l.id;
  perform set_config('app.join_redeem', 'off', true);

  if l.created_by is not null then
    perform private.notify(l.created_by, 'person_joined',
      name || ' joined with your join link',
      name || ' (' || lower(btrim(p_email)) || ') can now sign in' || coalesce(' with the link "' || l.label || '"', '') || '. Check their role and access on Admin > People.',
      '/admin/people');
  end if;
  return l.role::text;
end $$;
revoke all on function public.redeem_join_link(text, uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Price change requests
-- ---------------------------------------------------------------------------
alter table public.change_requests
  add column kind text not null default 'general' check (kind in ('general', 'price')),
  add column requested_price numeric(12,2) check (requested_price > 0),
  add column price_at_request numeric(12,2),
  add constraint change_requests_price_shape check ((kind = 'price') = (requested_price is not null));

create or replace function public.change_requests_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.builder_id := (select builder_id from public.homes where id = new.home_id);
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    new.status := 'open';
    new.resolved_by := null; new.resolved_at := null; new.resolution_note := null;
    if new.kind = 'price' then
      new.price_at_request := (select list_price from public.homes where id = new.home_id);
      if new.requested_price is not distinct from new.price_at_request then
        raise exception 'That''s already the price' using errcode = '23514';
      end if;
      new.message := 'Change the price from ' || coalesce('$' || to_char(new.price_at_request, 'FM999,999,999'), 'no price')
        || ' to $' || to_char(new.requested_price, 'FM999,999,999')
        || coalesce('. ' || nullif(btrim(new.message), ''), '');
    end if;
    perform private.log_activity(new.home_id, 'change_requested', jsonb_build_object('message', new.message));
    return new;
  end if;
  if new.home_id <> old.home_id or new.builder_id <> old.builder_id
     or new.requested_by <> old.requested_by or new.message <> old.message
     or new.created_at <> old.created_at or new.kind <> old.kind
     or new.requested_price is distinct from old.requested_price
     or new.price_at_request is distinct from old.price_at_request then
    raise exception 'Only the status of a request can be changed' using errcode = '42501';
  end if;
  -- A price request is only "done" once the price really is the one asked for
  -- (public.resolve_price_request changes it first).
  if new.kind = 'price' and new.status = 'done' and old.status <> 'done'
     and (select list_price from public.homes where id = new.home_id) is distinct from new.requested_price then
    raise exception 'Approve price requests with "Approve" on the home, so the price changes too' using errcode = '23514';
  end if;
  if new.status is distinct from old.status then
    new.resolved_by := case when new.status = 'open' then null else auth.uid() end;
    new.resolved_at := case when new.status = 'open' then null else now() end;
    perform private.log_activity(new.home_id, 'change_request_' || new.status,
      jsonb_build_object('message', new.message, 'note', new.resolution_note));
  end if;
  return new;
end $$;
revoke execute on function public.change_requests_guard() from public, anon, authenticated;

-- Price requests are the builder's call, so they skip our team's board (once
-- the price really changes, the usual MLS update task follows).
create or replace function public.change_requests_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'price' then return new; end if;
  if tg_op = 'INSERT' then
    perform private.add_task('change_request', 'Change requested on ' || (select unparsed_address from public.homes where id = new.home_id),
      new.message, new.home_id, null, null, 'change_requests', new.id, now() + interval '2 days', 'normal');
  elsif new.status <> old.status and new.status in ('done', 'declined') then
    perform private.close_tasks('change_requests', new.id, null, case when new.status = 'done' then 'done' else 'cancelled' end);
  end if;
  return new;
end $$;
revoke execute on function public.change_requests_tasks() from public, anon, authenticated;

create or replace function public.change_requests_builder_tasks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h record;
begin
  if tg_op = 'INSERT' and new.status = 'open' then
    select unparsed_address, community_id into h from public.homes where id = new.home_id;
    perform private.add_builder_task(new.builder_id, 'change_request',
      case when new.kind = 'price' then 'Price change request: ' else 'Change request: ' end || coalesce(h.unparsed_address, 'a home'),
      new.message, new.home_id, null, 'change_requests', new.id,
      now() + case when new.kind = 'price' then interval '1 day' else interval '3 days' end);
    if new.kind = 'price' then
      perform private.notify_builder(new.builder_id, array['builder_owner', 'manager', 'marketing'], null, 'change_request',
        'Price change request: ' || coalesce(h.unparsed_address, 'a home'),
        coalesce((select full_name from public.profiles where id = new.requested_by), 'A salesperson') || ' asked: ' || new.message,
        '/homes/' || new.home_id || '#price');
    end if;
  elsif tg_op = 'UPDATE' and new.status <> 'open' and old.status = 'open' then
    perform private.close_builder_tasks('change_requests', new.id, case when new.status = 'declined' then 'cancelled' else 'done' end);
    if new.kind = 'price' and new.requested_by is distinct from auth.uid() then
      select unparsed_address into h from public.homes where id = new.home_id;
      perform private.notify(new.requested_by, 'change_request',
        case when new.status = 'done' then 'Price change approved: ' else 'Price change declined: ' end || coalesce(h.unparsed_address, 'a home'),
        new.message || coalesce(E'\n' || new.resolution_note, ''),
        '/homes/' || new.home_id || '#price');
    end if;
  end if;
  return new;
end $$;
revoke all on function public.change_requests_builder_tasks() from public, anon, authenticated;

-- Approve (the price changes, as the person approving, so the home edit rules
-- and MLS update task apply as usual) or decline a price request.
create or replace function public.resolve_price_request(p_request uuid, p_approve boolean, p_note text default null)
returns text language plpgsql security invoker set search_path = '' as $$
declare c public.change_requests;
begin
  if coalesce(private.my_role() not in ('platform_admin', 'builder_owner', 'manager', 'marketing'), true) then
    raise exception 'Only owners, managers and marketing can approve price changes' using errcode = '42501';
  end if;
  select * into c from public.change_requests where id = p_request and kind = 'price' for update;
  if c.id is null then raise exception 'Unknown price request' using errcode = '42501'; end if;
  if c.status <> 'open' then raise exception 'This request was already answered'; end if;
  if p_approve then
    update public.homes set list_price = c.requested_price where id = c.home_id;
    if not found then raise exception 'You can''t change this home' using errcode = '42501'; end if;
  end if;
  update public.change_requests
    set status = case when p_approve then 'done' else 'declined' end,
        resolution_note = nullif(left(btrim(coalesce(p_note, '')), 1000), '')
    where id = c.id;
  return case when p_approve then 'done' else 'declined' end;
end $$;
revoke execute on function public.resolve_price_request(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_price_request(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Expected close date, and the home edit rules
-- ---------------------------------------------------------------------------
alter table public.homes add column expected_close_date date;

create or replace function public.enforce_home_edit_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.user_role := private.my_role();
  changed text[];
  allowed text[];
  bad text[];
  sale text[] := array['purchase_contract_date', 'close_date', 'close_price', 'expected_close_date',
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
      'website_page_url', 'latitude', 'longitude'] || sale;
  elsif r = 'sales' then
    -- No list_price: salespeople send a price change request instead (owners, 29 Oct 2026).
    allowed := array['build_stage', 'estimated_completion', 'workflow_status', 'market_status'] || sale;
  else
    allowed := '{}';
  end if;

  if r in ('builder_owner', 'manager', 'marketing') and private.builder_enters_mls(new.builder_id) then
    allowed := allowed || array['mls_number', 'workflow_status'];
  end if;
  select coalesce(array_agg(c), '{}') into bad from unnest(changed) c where c <> all (allowed);
  if array_length(bad, 1) > 0 then
    if r = 'sales' and 'list_price' = any (bad) then
      raise exception 'Salespeople can''t change the price. Send a price change request instead.' using errcode = '42501';
    end if;
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

  if new.market_status in ('under_contract', 'sold') and old.market_status is distinct from new.market_status
     and not new.buyer_unrepresented
     and (coalesce(btrim(new.buyer_agent_full_name), '') = '' or coalesce(btrim(new.buyer_office_name), '') = '') then
    raise exception 'Enter the buyer''s agent and their brokerage (or tick "The buyer has no agent")' using errcode = '23514';
  end if;
  -- Going under contract asks when it's expected to close (owners, 29 Oct 2026).
  if new.market_status = 'under_contract' and old.market_status is distinct from 'under_contract' then
    if new.expected_close_date is null then
      raise exception 'Enter the expected close date' using errcode = '23514';
    end if;
    if new.expected_close_date < coalesce(new.purchase_contract_date, current_date) then
      raise exception 'The expected close date can''t be before the contract date' using errcode = '23514';
    end if;
  end if;
  if old.market_status = 'under_contract' and new.market_status = 'active' then
    new.buyer_agent_full_name := null;
    new.buyer_agent_mls_id := null;
    new.buyer_agent_state_license := null;
    new.buyer_office_name := null;
    new.co_buyer_agent_full_name := null;
    new.co_buyer_office_name := null;
    new.buyer_unrepresented := false;
    new.expected_close_date := null;
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

-- "Under contract" from Needs your attention asks for the expected close date too.
drop function public.confirm_availability(uuid, text, date, numeric, jsonb);
create function public.confirm_availability(p_home uuid, p_answer text, p_date date default null,
  p_price numeric default null, p_buyer jsonb default null, p_expected_close date default null)
returns text language plpgsql security definer set search_path = '' as $$
declare h record; r public.user_role := private.my_role();
begin
  select id, builder_id, community_id, workflow_status into h from public.homes where id = p_home;
  if h.id is null or not (private.staff_for(h.builder_id) or (private.can_see_home(h.builder_id, h.community_id)
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
      expected_close_date = p_expected_close,
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
    update public.homes set market_status = 'sold', close_date = coalesce(p_date, current_date), close_price = p_price,
      buyer_unrepresented = case when p_buyer is null then buyer_unrepresented else coalesce((p_buyer ->> 'unrepresented')::boolean, false) end,
      buyer_agent_full_name = case when p_buyer is null then buyer_agent_full_name else nullif(btrim(p_buyer ->> 'agent_name'), '') end,
      buyer_office_name = case when p_buyer is null then buyer_office_name else nullif(btrim(p_buyer ->> 'office_name'), '') end,
      buyer_agent_mls_id = case when p_buyer is null then buyer_agent_mls_id else nullif(btrim(p_buyer ->> 'agent_mls_id'), '') end,
      buyer_agent_state_license = case when p_buyer is null then buyer_agent_state_license else nullif(btrim(p_buyer ->> 'agent_license'), '') end,
      co_buyer_agent_full_name = case when p_buyer is null then co_buyer_agent_full_name else nullif(btrim(p_buyer ->> 'co_agent_name'), '') end,
      co_buyer_office_name = case when p_buyer is null then co_buyer_office_name else nullif(btrim(p_buyer ->> 'co_office_name'), '') end
    where id = p_home;
    return 'sold';
  end if;
  raise exception 'Unknown answer';
end $$;
revoke execute on function public.confirm_availability(uuid, text, date, numeric, jsonb, date) from public, anon;
grant execute on function public.confirm_availability(uuid, text, date, numeric, jsonb, date) to authenticated;
