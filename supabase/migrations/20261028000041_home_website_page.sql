-- Tie each home to its own page on the builder's website (owners, 28 Oct 2026),
-- for the "More info on the builder's website" button on realtor share pages.
--
-- Builders with their website connected: a home is tied to its website listing
-- when it's added from it, or when someone confirms a suggested match (same
-- address, same builder) with "Link them". Never automatically.
-- Builders without it: an optional "Website page" link on each home
-- (homes.website_page_url), asked when adding a home and editable after.
--
-- The share page uses, in order: the linked website listing's page, the home's
-- own website page link, the builder's main website.

alter table public.homes
  add column website_page_url text
  check (website_page_url is null or (website_page_url ~* '^https?://[^\s]+$' and length(website_page_url) <= 500));

-- Owners, managers and marketing may set it after the home is added (marketing
-- too: it's a marketing link, not pricing). Same rule as before otherwise.
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
      'workflow_status', 'deleted_at', 'market_status', 'show_representative_disclaimer', 'mls_board', 'mls_fields',
      'website_page_url'] || sale;
  elsif r = 'sales' then
    allowed := array['list_price', 'build_stage', 'estimated_completion', 'workflow_status', 'market_status'] || sale;
  elsif r = 'marketing' then
    allowed := array['public_remarks', 'workflow_status', 'show_representative_disclaimer', 'website_page_url'];
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
      or (r in ('builder_owner', 'manager') and old.workflow_status = 'in_review' and new.workflow_status = 'approved_for_mls')
      or (r in ('builder_owner', 'manager') and old.workflow_status = 'approved_for_mls' and new.workflow_status in ('draft', 'in_review'))
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
      raise exception 'Ask a manager or owner to pause or withdraw a listing' using errcode = '42501';
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
$function$;

-- An address boiled down for matching: lower case, no punctuation, common
-- street words shortened ("123 Pecan Ridge Drive" = "123 pecan ridge dr").
create or replace function private.address_key(a text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      ' ' || regexp_replace(lower(coalesce(a, '')), '[^a-z0-9]+', ' ', 'g') || ' ',
      ' street ', ' st ', 'g'), ' drive ', ' dr ', 'g'), ' avenue ', ' ave ', 'g'), ' lane ', ' ln ', 'g'),
      ' road ', ' rd ', 'g'), ' court ', ' ct ', 'g'), ' boulevard ', ' blvd ', 'g'), ' circle ', ' cir ', 'g'),
      ' trail ', ' trl ', 'g'), ' place ', ' pl ', 'g'), ' parkway ', ' pkwy ', 'g'), ' cove ', ' cv ', 'g'),
    '\s+', ' ', 'g')), '')
$$;

-- Suggested matches: a website listing and a home at the same builder with the
-- same address (and ZIP, when both have one), neither linked yet. Shown for a
-- person to confirm; nothing is linked here. Runs with the caller's own access,
-- so people only see their own builder's.
create or replace function public.website_link_suggestions(p_home uuid default null)
returns table (website_listing_id uuid, home_id uuid, address text, website_url text, community_name text)
language sql stable security invoker set search_path = '' as $$
  select w.id, h.id, h.unparsed_address, w.url, c.name
  from public.website_listings w
  join public.homes h on h.builder_id = w.builder_id
    and private.address_key(h.unparsed_address) = private.address_key(w.unparsed_address)
    and (w.postal_code is null or h.postal_code is null or btrim(w.postal_code) = btrim(h.postal_code))
  left join public.communities c on c.id = h.community_id
  where w.home_id is null and w.dismissed_at is null and h.deleted_at is null
    and not exists (select 1 from public.website_listings w2 where w2.home_id = h.id)
    and (p_home is null or h.id = p_home)
  order by h.unparsed_address
$$;
revoke all on function public.website_link_suggestions(uuid) from public, anon;
grant execute on function public.website_link_suggestions(uuid) to authenticated;

-- Where "More info on the builder's website" goes for a valid link:
-- the linked website listing's page, then the home's own link, then the main site.
create or replace function public.share_website(p_token text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select w.url from public.website_listings w
      where w.home_id = s.home_id and w.url ~* '^https?://' order by w.last_seen_at desc limit 1),
    (select h.website_page_url from public.homes h where h.id = s.home_id),
    (select bb.website_url from public.builder_branding bb where bb.builder_id = s.builder_id and bb.website_url ~* '^https?://'))
  from private.live_share(p_token) s
  where s.id is not null
$$;
revoke all on function public.share_website(text) from public;
grant execute on function public.share_website(text) to anon, authenticated;
