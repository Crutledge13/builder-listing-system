-- Buyer's agent details, asked for when a home goes under contract.
--
-- Only what the MLS needs to show who brought the buyer: the agent's name and
-- brokerage (office), the agent's MLS ID or TREC license number if the builder
-- has it (either one lets our team find the agent in the MLS), an optional
-- second (co-buyer) agent, and a box for buyers with no agent. Column names
-- follow RESO (BuyerAgentFullName, BuyerAgentMlsId, BuyerAgentStateLicense,
-- BuyerOfficeName, CoBuyerAgentFullName, CoBuyerOfficeName).
--
-- A person can't mark a home under contract without either the agent's name
-- and brokerage or "the buyer has no agent". If the contract falls through
-- (back to active), the details are cleared so the next contract asks again.

alter table public.homes
  add column buyer_agent_full_name text,
  add column buyer_agent_mls_id text,
  add column buyer_agent_state_license text,
  add column buyer_office_name text,
  add column co_buyer_agent_full_name text,
  add column co_buyer_office_name text,
  add column buyer_unrepresented boolean not null default false;

comment on column public.homes.buyer_agent_full_name is 'RESO BuyerAgentFullName. Asked when the home goes under contract.';
comment on column public.homes.buyer_agent_mls_id is 'RESO BuyerAgentMlsId, if the builder has it.';
comment on column public.homes.buyer_agent_state_license is 'RESO BuyerAgentStateLicense (TREC license number), if the builder has it.';
comment on column public.homes.buyer_office_name is 'RESO BuyerOfficeName: the buyer agent''s brokerage.';
comment on column public.homes.co_buyer_agent_full_name is 'RESO CoBuyerAgentFullName (optional second buyer agent).';
comment on column public.homes.co_buyer_office_name is 'RESO CoBuyerOfficeName.';
comment on column public.homes.buyer_unrepresented is 'The buyer has no agent. Stands in for the buyer agent details.';

-- Same rules as before, with the buyer agent details added to the sale details
-- (the people who can mark a home under contract can fill them in), the check
-- that they're there, and clearing them when a contract falls through.
create or replace function public.enforce_home_edit_rules()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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
  elsif r in ('builder_owner', 'manager') then
    allowed := array['community_id', 'unparsed_address', 'city', 'postal_code',
      'lot_number', 'plan_name', 'list_price', 'bedrooms_total', 'bathrooms_full',
      'bathrooms_half', 'living_area', 'lot_size_acres', 'stories', 'garage_spaces',
      'year_built', 'public_remarks', 'build_stage', 'estimated_completion',
      'workflow_status', 'deleted_at', 'market_status', 'show_representative_disclaimer', 'mls_board', 'mls_fields'] || sale;
  elsif r = 'sales' then
    allowed := array['list_price', 'build_stage', 'estimated_completion', 'workflow_status', 'market_status'] || sale;
  elsif r = 'marketing' then
    allowed := array['public_remarks', 'workflow_status', 'show_representative_disclaimer'];
  else
    allowed := '{}';
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
      or (r in ('builder_owner', 'manager') and old.workflow_status = 'in_review' and new.workflow_status = 'approved_for_mls')
      or (r in ('builder_owner', 'manager') and old.workflow_status = 'approved_for_mls' and new.workflow_status in ('draft', 'in_review'))
      or (r = 'listing_coordinator' and old.workflow_status = 'approved_for_mls' and new.workflow_status = 'live_on_mls')
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
      raise exception 'Ask a manager or owner to pause or withdraw a listing' using errcode = '42501';
    end if;
  end if;

  -- Under contract needs the buyer's agent (or "no agent") for the MLS.
  if new.market_status = 'under_contract' and old.market_status is distinct from 'under_contract'
     and not new.buyer_unrepresented
     and (coalesce(btrim(new.buyer_agent_full_name), '') = '' or coalesce(btrim(new.buyer_office_name), '') = '') then
    raise exception 'Enter the buyer''s agent and their brokerage (or tick "The buyer has no agent")' using errcode = '23514';
  end if;
  -- The contract fell through: clear the buyer side so the next contract asks again.
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
$function$;

-- Our team's "Change to Pending" task now lists the buyer's agent, line by line.
create or replace function public.homes_tasks()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  k record;
  labels jsonb := '{"list_price":"List price","bedrooms_total":"Bedrooms","bathrooms_full":"Full baths","bathrooms_half":"Half baths",
    "living_area":"Living area (sq ft)","lot_size_acres":"Lot size (acres)","public_remarks":"Public remarks","build_stage":"Property condition",
    "estimated_completion":"Estimated completion","unparsed_address":"Address","city":"City","postal_code":"ZIP","lot_number":"Lot and block",
    "plan_name":"Builder plan (model)","stories":"Stories","garage_spaces":"Garage spaces","year_built":"Year built"}';
  mls_names jsonb := '{"active":"Active","paused":"Temporarily Off Market (Hold)","under_contract":"Pending (under contract)",
    "sold":"Closed (sold)","withdrawn":"Withdrawn"}';
  status_changes jsonb;
  task_id uuid;
begin
  if new.workflow_status = 'approved_for_mls' and old.workflow_status <> 'approved_for_mls' then
    perform private.add_task('mls_entry', 'Enter ' || new.unparsed_address || ' into the MLS',
      'Approved by the builder. Open the work sheet for every field to enter.', new.id, null, null, 'homes', new.id,
      now() + interval '1 day', 'high');
  end if;
  if old.workflow_status = 'approved_for_mls' and new.workflow_status <> 'approved_for_mls' then
    perform private.close_tasks('homes', new.id, 'mls_entry', case when new.workflow_status = 'live_on_mls' then 'done' else 'cancelled' end);
  end if;

  if new.workflow_status = 'live_on_mls' and old.workflow_status = 'live_on_mls' then
    for k in
      select n.key, n.value as nv, o.value as ov from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
      where n.value is distinct from o.value and labels ? n.key
    loop
      perform private.note_mls_change(new.id, k.key, labels ->> k.key, k.ov, k.nv);
    end loop;
  end if;

  if new.market_status is distinct from old.market_status and old.workflow_status = 'live_on_mls' then
    status_changes := jsonb_build_object('standard_status', jsonb_build_object('label', 'Status',
      'from', coalesce(mls_names ->> coalesce(old.market_status, 'active'), old.market_status),
      'to', coalesce(mls_names ->> new.market_status, new.market_status)));
    if new.market_status = 'under_contract' then
      status_changes := status_changes || jsonb_build_object('purchase_contract_date',
        jsonb_build_object('label', 'Contract date', 'from', null, 'to', new.purchase_contract_date));
      if new.buyer_unrepresented then
        status_changes := status_changes || jsonb_build_object('buyer_agent_full_name',
          jsonb_build_object('label', 'Buyer agent', 'from', null, 'to', 'None: the buyer has no agent'));
      else
        status_changes := status_changes
          || jsonb_build_object('buyer_agent_full_name', jsonb_build_object('label', 'Buyer agent', 'from', null, 'to', new.buyer_agent_full_name))
          || jsonb_build_object('buyer_office_name', jsonb_build_object('label', 'Buyer office (brokerage)', 'from', null, 'to', new.buyer_office_name));
        if coalesce(new.buyer_agent_mls_id, '') <> '' then
          status_changes := status_changes || jsonb_build_object('buyer_agent_mls_id',
            jsonb_build_object('label', 'Buyer agent MLS ID', 'from', null, 'to', new.buyer_agent_mls_id));
        end if;
        if coalesce(new.buyer_agent_state_license, '') <> '' then
          status_changes := status_changes || jsonb_build_object('buyer_agent_state_license',
            jsonb_build_object('label', 'Buyer agent TREC license', 'from', null, 'to', new.buyer_agent_state_license));
        end if;
        if coalesce(new.co_buyer_agent_full_name, '') <> '' then
          status_changes := status_changes
            || jsonb_build_object('co_buyer_agent_full_name', jsonb_build_object('label', 'Co-buyer agent', 'from', null, 'to', new.co_buyer_agent_full_name))
            || jsonb_build_object('co_buyer_office_name', jsonb_build_object('label', 'Co-buyer office (brokerage)', 'from', null, 'to', new.co_buyer_office_name));
        end if;
      end if;
    elsif new.market_status = 'sold' then
      status_changes := status_changes
        || jsonb_build_object('close_date', jsonb_build_object('label', 'Close date', 'from', null, 'to', new.close_date))
        || jsonb_build_object('close_price', jsonb_build_object('label', 'Close price', 'from', null, 'to', new.close_price));
    end if;
    task_id := private.add_task('listing_status',
      'Change ' || new.unparsed_address || ' to ' || coalesce(mls_names ->> new.market_status, new.market_status) || ' on the MLS',
      'Changed in Builder Listing Services by ' || coalesce((select full_name from public.profiles where id = auth.uid()), 'the builder') || '.',
      new.id, null, null, 'homes_status', new.id, now() + interval '1 day', 'high');
    update public.tasks set changes = status_changes where id = task_id;
    if new.market_status in ('paused', 'under_contract', 'sold', 'withdrawn') then
      update public.open_house_series set ended_at = now(),
        ended_reason = 'the home is ' || case new.market_status when 'paused' then 'paused' when 'under_contract' then 'under contract'
          when 'sold' then 'sold' else 'withdrawn' end
      where home_id = new.id and ended_at is null;
      update public.open_houses set cancelled_at = now()
      where home_id = new.id and series_id is null and cancelled_at is null and starts_at > now();
    end if;
    perform private.log_activity(new.id, 'market_' || new.market_status, '{}'::jsonb);
  end if;
  return new;
end $function$;

-- The "Needs your attention" answer takes the buyer's agent too.
drop function public.confirm_availability(uuid, text, date, numeric);
create function public.confirm_availability(p_home uuid, p_answer text, p_date date default null, p_price numeric default null, p_buyer jsonb default null)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare h record; r public.user_role := private.my_role();
begin
  select id, builder_id, community_id, workflow_status into h from public.homes where id = p_home;
  if h.id is null or not (private.is_staff() or (private.can_see_home(h.builder_id, h.community_id)
     and r in ('builder_owner', 'manager', 'sales'))) then
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
    -- Runs as the signed-in person, so the edit rules (including the buyer
    -- agent check) apply exactly as they do on the home page.
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
end $function$;

revoke execute on function public.confirm_availability(uuid, text, date, numeric, jsonb) from public, anon;
grant execute on function public.confirm_availability(uuid, text, date, numeric, jsonb) to authenticated;
