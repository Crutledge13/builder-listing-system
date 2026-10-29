-- Sales "MLS entry" switch (owners, 29 Oct 2026).
--
-- Not a new role: a switch on a salesperson. When it's on, for their assigned
-- communities only, they can add homes, fill in every listing detail (specs,
-- description, NTREIS answers, room sizes), change the community's setup
-- answers (schools, HOA, utilities, showing, directions) and reorder the
-- listing photos / pick the cover.
--
-- A second switch, "Needs marketing approval" (on by default):
--   on  -> they submit for review; marketing (or the owner/manager) approves.
--          Once a home is Ready for MLS or live, its listing details and photo
--          order are locked to them again; they use change requests.
--   off -> they can mark homes Ready for MLS themselves (straight to our
--          listing coordinator) and keep editing live listings, which goes
--          on the MLS update task like any other edit.
-- Community setup answers change directly either way; every live home in the
-- community gets the change on its MLS update task (communities_mls_fields_changes).
--
-- Who flips the switches: whoever can manage the salesperson (owner, manager,
-- marketing at that builder, our platform admins), through the existing
-- profiles rules. Nobody can change their own.

alter table public.profiles
  add column sales_mls_entry boolean not null default false,
  add column sales_needs_approval boolean not null default true;

comment on column public.profiles.sales_mls_entry is 'Sales only: may add homes and enter listing details, community setup and photo order for their communities.';
comment on column public.profiles.sales_needs_approval is 'Sales with MLS entry: true = marketing approves before our team enters it in the MLS.';

-- ---------------------------------------------------------------------------
-- Helpers (always true or false, never null)
-- ---------------------------------------------------------------------------
create or replace function private.sales_mls_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'sales' and p.sales_mls_entry
                   from public.profiles p where p.id = (select auth.uid()) and p.is_active), false)
$$;

create or replace function private.sales_skips_approval() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'sales' and p.sales_mls_entry and not p.sales_needs_approval
                   from public.profiles p where p.id = (select auth.uid()) and p.is_active), false)
$$;

-- May this salesperson change the listing details of a home in this state?
create or replace function private.sales_may_edit_listing(ws public.workflow_status) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.sales_mls_on()
    and (ws in ('draft', 'in_review') or private.sales_skips_approval()), false)
$$;

-- ---------------------------------------------------------------------------
-- Switches only mean something for sales; log every change on access history
-- ---------------------------------------------------------------------------
create or replace function public.profiles_sales_switches() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role <> 'sales' then
    new.sales_mls_entry := false;
    new.sales_needs_approval := true;
  end if;
  return new;
end $$;
revoke execute on function public.profiles_sales_switches() from public, anon, authenticated;

create trigger profiles_sales_switches before insert or update on public.profiles
  for each row execute function public.profiles_sales_switches();

create or replace function public.profiles_log_access()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare who jsonb := jsonb_build_object('person_id', new.id, 'name', new.full_name, 'email', new.email);
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (new.builder_id, auth.uid(), 'person_added', who || jsonb_build_object('role', new.role));
    return new;
  end if;
  if new.role is distinct from old.role then
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (new.builder_id, auth.uid(), 'person_role_changed', who || jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  if new.builder_id is distinct from old.builder_id then
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (coalesce(new.builder_id, old.builder_id), auth.uid(), 'person_company_changed',
            who || jsonb_build_object('from', old.builder_id, 'to', new.builder_id));
  end if;
  if new.is_active is distinct from old.is_active then
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (new.builder_id, auth.uid(), case when new.is_active then 'person_turned_on' else 'person_turned_off' end, who);
  end if;
  if new.role = 'sales' and old.role = 'sales' and new.sales_mls_entry is distinct from old.sales_mls_entry then
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (new.builder_id, auth.uid(), case when new.sales_mls_entry then 'person_mls_entry_on' else 'person_mls_entry_off' end, who);
  end if;
  if new.role = 'sales' and old.role = 'sales' and new.sales_mls_entry
     and new.sales_needs_approval is distinct from old.sales_needs_approval then
    insert into public.activity_log (builder_id, actor_id, action, changes)
    values (new.builder_id, auth.uid(), case when new.sales_needs_approval then 'person_approval_on' else 'person_approval_off' end, who);
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- Homes: add, edit and approve
-- ---------------------------------------------------------------------------
drop policy "builder editors add homes" on public.homes;
create policy "builder editors add homes" on public.homes for insert to authenticated
  with check (
    private.my_role() = 'platform_admin'
    or ((private.my_role() in ('builder_owner', 'manager', 'marketing') or private.sales_mls_on())
        and private.can_see_home(builder_id, community_id)
        and workflow_status = 'draft' and mls_number is null and deleted_at is null)
  );

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
  sales_skip boolean := false;
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
    -- MLS entry switch: the listing details too (not trash, MLS choice, disclaimer or website page).
    if private.sales_may_edit_listing(old.workflow_status) then
      allowed := allowed || array['community_id', 'unparsed_address', 'city', 'postal_code',
        'lot_number', 'plan_name', 'bedrooms_total', 'bathrooms_full', 'bathrooms_half',
        'living_area', 'lot_size_acres', 'stories', 'garage_spaces', 'year_built',
        'public_remarks', 'mls_fields'];
    end if;
    sales_skip := private.sales_skips_approval();
  else
    allowed := '{}';
  end if;

  if r in ('builder_owner', 'manager', 'marketing') and private.builder_enters_mls(new.builder_id) then
    allowed := allowed || array['mls_number', 'workflow_status'];
  end if;
  select coalesce(array_agg(c), '{}') into bad from unnest(changed) c where c <> all (allowed);
  if array_length(bad, 1) > 0 then
    if r = 'sales' and private.sales_mls_on() then
      raise exception 'This listing is waiting on or past marketing''s approval, so its details are locked. Send a change request instead (can''t change: %)',
        array_to_string(bad, ', ') using errcode = '42501';
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
      -- Salespeople who don't need marketing's approval send it straight to our team.
      or (r = 'sales' and sales_skip and old.workflow_status in ('draft', 'in_review') and new.workflow_status = 'approved_for_mls')
      or (r = 'sales' and sales_skip and old.workflow_status = 'approved_for_mls' and new.workflow_status in ('draft', 'in_review'))
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

-- When a salesperson submits a home for review, tell marketing it's waiting.
create or replace function public.homes_sales_review_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.workflow_status = 'in_review' and old.workflow_status is distinct from 'in_review'
     and private.my_role() = 'sales' then
    perform private.notify_builder(new.builder_id, array['marketing'], null, 'listing',
      new.unparsed_address || ' is waiting for your approval',
      coalesce((select full_name from public.profiles where id = auth.uid()), 'A salesperson')
        || ' entered it for the MLS. Check it and approve it for our team.',
      '/homes/' || new.id);
  end if;
  return new;
end $$;
revoke execute on function public.homes_sales_review_notice() from public, anon, authenticated;

create trigger homes_sales_review_notice after update of workflow_status on public.homes
  for each row execute function public.homes_sales_review_notice();

-- ---------------------------------------------------------------------------
-- Communities: setup answers only, for their assigned communities
-- ---------------------------------------------------------------------------
drop policy "owners and managers edit communities" on public.communities;
create policy "owners and managers edit communities" on public.communities for update to authenticated
  using (
    private.my_role() = 'platform_admin'
    or (private.my_role() in ('builder_owner', 'manager', 'marketing') and builder_id = private.my_builder_id())
    or (private.sales_mls_on() and builder_id = private.my_builder_id() and id in (select private.my_community_ids()))
  )
  with check (
    private.my_role() = 'platform_admin'
    or (private.my_role() in ('builder_owner', 'manager', 'marketing') and builder_id = private.my_builder_id())
    or (private.sales_mls_on() and builder_id = private.my_builder_id() and id in (select private.my_community_ids()))
  );

create or replace function public.communities_sales_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare bad text[];
begin
  if auth.uid() is null or private.my_role() is distinct from 'sales' then return new; end if;
  select coalesce(array_agg(n.key), '{}') into bad
  from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value and n.key not in ('mls_fields', 'field_sources');
  if array_length(bad, 1) > 0 then
    raise exception 'Salespeople can change a community''s setup answers only (not: %)', array_to_string(bad, ', ')
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.communities_sales_guard() from public, anon, authenticated;

create trigger communities_00_sales_guard before update on public.communities
  for each row execute function public.communities_sales_guard();

-- ---------------------------------------------------------------------------
-- Listing photos: reorder and pick the cover (no adding, removing or uploading)
-- ---------------------------------------------------------------------------
create policy "sales with MLS entry reorder listings" on public.listing_media for update to authenticated
  using (exists (select 1 from public.homes h where h.id = listing_media.home_id
                 and private.sales_may_edit_listing(h.workflow_status)))
  with check (exists (select 1 from public.homes h where h.id = listing_media.home_id
                 and private.sales_may_edit_listing(h.workflow_status)));

create policy "sales with MLS entry pick the cover" on public.media for update to authenticated
  using (home_id is not null and exists (select 1 from public.homes h where h.id = media.home_id
         and private.sales_may_edit_listing(h.workflow_status)))
  with check (home_id is not null and exists (select 1 from public.homes h where h.id = media.home_id
         and private.sales_may_edit_listing(h.workflow_status)));

create or replace function public.listing_media_sales_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and private.my_role() = 'sales'
     and (new.home_id is distinct from old.home_id or new.media_id is distinct from old.media_id
          or new.tour_id is distinct from old.tour_id) then
    raise exception 'Salespeople can only change the photo order' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.listing_media_sales_guard() from public, anon, authenticated;
create trigger listing_media_00_sales_guard before update on public.listing_media
  for each row execute function public.listing_media_sales_guard();

create or replace function public.media_sales_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare bad text[];
begin
  if auth.uid() is null or private.my_role() is distinct from 'sales' then return new; end if;
  select coalesce(array_agg(n.key), '{}') into bad
  from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value and n.key not in ('is_cover', 'updated_at');
  if array_length(bad, 1) > 0 then
    raise exception 'Salespeople can only pick the cover photo' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.media_sales_guard() from public, anon, authenticated;
-- Named to run before media_prepare, which tidies tags and search text.
create trigger media_00_sales_guard before update on public.media
  for each row execute function public.media_sales_guard();
