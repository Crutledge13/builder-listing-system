-- Our team's MLS work: the extra fields the MLS needs, and tasks that say
-- exactly what to add or change.

-- ===========================================================================
-- MLS-only details. Builders give us the basics on the home; our team fills
-- in the rest of the MLS input here. A community row holds defaults shared by
-- every home in it (schools, HOA, utilities, taxes); a home row holds that
-- home's own values. Keys are RESO standard field names.
-- ===========================================================================
create table public.mls_details (
  id uuid primary key default gen_random_uuid(),
  home_id uuid unique references public.homes (id),
  community_id uuid unique references public.communities (id),
  builder_id uuid not null references public.builders (id),
  data jsonb not null default '{}',
  sources jsonb not null default '{}',     -- key -> 'staff' | 'website' | 'mls'
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint mls_details_one_owner check ((home_id is null) <> (community_id is null))
);
alter table public.mls_details enable row level security;
revoke all on public.mls_details from anon;
create policy "staff and the builder see MLS details" on public.mls_details for select to authenticated
  using (private.is_staff() or (builder_id = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager', 'marketing')));
create policy "staff add MLS details" on public.mls_details for insert to authenticated with check (private.is_staff());
create policy "staff edit MLS details" on public.mls_details for update to authenticated using (private.is_staff()) with check (private.is_staff());

create or replace function public.mls_details_fill()
returns trigger language plpgsql security definer set search_path = '' as $$
declare changed text[];
begin
  if new.home_id is not null then new.builder_id := (select builder_id from public.homes where id = new.home_id);
  else new.builder_id := (select builder_id from public.communities where id = new.community_id); end if;
  -- Every key changed here is marked as entered by our staff.
  select coalesce(array_agg(n.key), '{}') into changed
  from jsonb_each(new.data) n
  where tg_op = 'INSERT' or n.value is distinct from (old.data -> n.key);
  new.sources := coalesce(new.sources, '{}') || coalesce((select jsonb_object_agg(c, 'staff') from unnest(changed) c), '{}');
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  if new.home_id is not null and array_length(changed, 1) > 0 then
    perform private.log_activity(new.home_id, 'mls_details_edited', jsonb_build_object('fields', to_jsonb(changed)));
  end if;
  return new;
end $$;
revoke execute on function public.mls_details_fill() from public, anon, authenticated;
create trigger mls_details_fill before insert or update on public.mls_details
  for each row execute function public.mls_details_fill();

-- ===========================================================================
-- Tasks: what exactly changed, and which lines are done.
-- changes = { key: { "label": "Price", "from": 399990, "to": 389990 } }
-- photos  = { "photos": { "label": "Photos", "added": [...], "removed": [...] } }
-- checked = keys our team has ticked off as entered in the MLS
-- ===========================================================================
alter table public.tasks
  add column changes jsonb not null default '{}',
  add column checked text[] not null default '{}';

-- Sale details the MLS asks for when a listing goes under contract or closes.
alter table public.homes
  add column purchase_contract_date date,
  add column close_date date,
  add column close_price numeric(12, 2);

-- Add (or update) one change on the home's open "Update the MLS" task.
create or replace function private.note_mls_change(p_home uuid, p_key text, p_label text, p_from jsonb, p_to jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare tid uuid; tchanges jsonb; addr text; first_from jsonb;
begin
  select id, changes into tid, tchanges from public.tasks
  where source_table = 'homes' and source_id = p_home and kind = 'mls_update' and status in ('todo', 'in_progress')
  order by created_at desc limit 1;
  if tid is null then
    select unparsed_address into addr from public.homes where id = p_home;
    tid := private.add_task('mls_update', 'Update the MLS for ' || addr, 'Changed in Builder Listings. The work sheet lists each change.',
      p_home, null, null, 'homes', p_home, now() + interval '1 day', 'normal');
    tchanges := '{}';
  end if;
  -- Keep what the MLS showed before the first change; drop it if it's back to that.
  first_from := coalesce(tchanges -> p_key -> 'from', p_from);
  if (tchanges ? p_key) and first_from is not distinct from p_to then
    update public.tasks set changes = changes - p_key, checked = array_remove(checked, p_key), updated_at = now() where id = tid;
  elsif first_from is distinct from p_to then
    update public.tasks set changes = changes || jsonb_build_object(p_key, jsonb_build_object('label', p_label, 'from', first_from, 'to', p_to)),
      checked = array_remove(checked, p_key), updated_at = now()
    where id = tid;
  end if;
end $$;
revoke execute on function private.note_mls_change(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.homes_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
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
  -- Approved: our coordinator enters it into the MLS.
  if new.workflow_status = 'approved_for_mls' and old.workflow_status <> 'approved_for_mls' then
    perform private.add_task('mls_entry', 'Enter ' || new.unparsed_address || ' into the MLS',
      'Approved by the builder. Open the work sheet for every field to enter.', new.id, null, null, 'homes', new.id,
      now() + interval '1 day', 'high');
  end if;
  if old.workflow_status = 'approved_for_mls' and new.workflow_status <> 'approved_for_mls' then
    perform private.close_tasks('homes', new.id, 'mls_entry', case when new.workflow_status = 'live_on_mls' then 'done' else 'cancelled' end);
  end if;

  -- Live listing details changed: record each change for the MLS update.
  if new.workflow_status = 'live_on_mls' and old.workflow_status = 'live_on_mls' then
    for k in
      select n.key, n.value as nv, o.value as ov from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
      where n.value is distinct from o.value and labels ? n.key
    loop
      perform private.note_mls_change(new.id, k.key, labels ->> k.key, k.ov, k.nv);
    end loop;
  end if;

  -- Market status: change the MLS status, with any sale details the MLS needs.
  if new.market_status is distinct from old.market_status and old.workflow_status = 'live_on_mls' then
    status_changes := jsonb_build_object('standard_status', jsonb_build_object('label', 'Status',
      'from', coalesce(mls_names ->> coalesce(old.market_status, 'active'), old.market_status),
      'to', coalesce(mls_names ->> new.market_status, new.market_status)));
    if new.market_status = 'under_contract' then
      status_changes := status_changes || jsonb_build_object('purchase_contract_date',
        jsonb_build_object('label', 'Contract date', 'from', null, 'to', new.purchase_contract_date));
    elsif new.market_status = 'sold' then
      status_changes := status_changes
        || jsonb_build_object('close_date', jsonb_build_object('label', 'Close date', 'from', null, 'to', new.close_date))
        || jsonb_build_object('close_price', jsonb_build_object('label', 'Close price', 'from', null, 'to', new.close_price));
    end if;
    task_id := private.add_task('listing_status',
      'Change ' || new.unparsed_address || ' to ' || coalesce(mls_names ->> new.market_status, new.market_status) || ' on the MLS',
      'Changed in Builder Listings by ' || coalesce((select full_name from public.profiles where id = auth.uid()), 'the builder') || '.',
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
end $$;

-- Photos added to or removed from a live listing also need updating on the MLS.
create or replace function public.media_mls_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare live boolean; tid uuid; tchanges jsonb; added jsonb; removed jsonb; addr text;
begin
  if new.home_id is null or new.kind not in ('photo', 'floor_plan') then return new; end if;
  select workflow_status = 'live_on_mls', unparsed_address into live, addr from public.homes where id = new.home_id;
  if not coalesce(live, false) then return new; end if;
  if not (tg_op = 'INSERT' and new.deleted_at is null)
     and not (tg_op = 'UPDATE' and (new.deleted_at is null) <> (old.deleted_at is null)) then
    return new;
  end if;
  select id, changes into tid, tchanges from public.tasks
  where source_table = 'homes' and source_id = new.home_id and kind = 'mls_update' and status in ('todo', 'in_progress')
  order by created_at desc limit 1;
  if tid is null then
    tid := private.add_task('mls_update', 'Update the MLS for ' || addr, 'Changed in Builder Listings. The work sheet lists each change.',
      new.home_id, null, null, 'homes', new.home_id, now() + interval '1 day', 'normal');
    tchanges := '{}';
  end if;
  added := coalesce(tchanges -> 'photos' -> 'added', '[]');
  removed := coalesce(tchanges -> 'photos' -> 'removed', '[]');
  if new.deleted_at is null then
    if removed @> jsonb_build_array(new.id::text) then
      removed := (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(removed) x where x <> to_jsonb(new.id::text));
    else added := added || jsonb_build_array(new.id::text); end if;
  else
    if added @> jsonb_build_array(new.id::text) then
      added := (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(added) x where x <> to_jsonb(new.id::text));
    else removed := removed || jsonb_build_array(new.id::text); end if;
  end if;
  update public.tasks set
    changes = case when jsonb_array_length(added) + jsonb_array_length(removed) = 0 then changes - 'photos'
      else changes || jsonb_build_object('photos', jsonb_build_object('label', 'Photos', 'added', added, 'removed', removed)) end,
    checked = array_remove(checked, 'photos'), updated_at = now()
  where id = tid;
  return new;
end $$;
revoke execute on function public.media_mls_changes() from public, anon, authenticated;
create trigger media_mls_changes after insert or update of deleted_at on public.media
  for each row execute function public.media_mls_changes();

-- Who may change the sale details: the same people who may change the status.
create or replace function public.enforce_home_edit_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r public.user_role := private.my_role();
  changed text[];
  allowed text[];
  bad text[];
  sale text[] := array['purchase_contract_date', 'close_date', 'close_price'];
begin
  if auth.uid() is null then
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
    allowed := array['mls_number', 'workflow_status', 'market_status'] || sale;
  elsif r in ('builder_owner', 'manager') then
    allowed := array['community_id', 'unparsed_address', 'city', 'postal_code',
      'lot_number', 'plan_name', 'list_price', 'bedrooms_total', 'bathrooms_full',
      'bathrooms_half', 'living_area', 'lot_size_acres', 'stories', 'garage_spaces',
      'year_built', 'public_remarks', 'build_stage', 'estimated_completion',
      'workflow_status', 'deleted_at', 'market_status', 'show_representative_disclaimer'] || sale;
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
    if new.workflow_status <> 'live_on_mls' then
      raise exception 'Only a listing that''s live on the MLS has a market status' using errcode = '23514';
    end if;
    if r = 'sales' and new.market_status not in ('active', 'under_contract', 'sold') then
      raise exception 'Ask a manager or owner to pause or withdraw a listing' using errcode = '42501';
    end if;
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
