-- Which MLS each home goes to, that MLS's rules, and the readiness check
-- that runs before a listing can be approved for the MLS.

-- ===========================================================================
-- MLS boards (reference data, editable by our admins)
--   rules: status_change_hours, new_listing_hours, min_photos,
--          min_photo_long_edge (pixels), remarks_max_chars, verified, source
--   field_rules: { RESOKey: { "required": bool, "hidden": bool, "label": text } }
--   extra_fields: fields this MLS asks for beyond the shared list
-- ===========================================================================
create table public.mls_boards (
  code text primary key,
  name text not null,
  short_name text not null,
  region text not null,
  counties text[] not null default '{}',
  rules jsonb not null default '{}',
  field_rules jsonb not null default '{}',
  extra_fields jsonb not null default '[]',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.mls_boards enable row level security;
revoke all on public.mls_boards from anon;
create policy "everyone signed in reads MLS boards" on public.mls_boards for select to authenticated using (true);
create policy "admins change MLS boards" on public.mls_boards for all to authenticated
  using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');

insert into public.mls_boards (code, name, short_name, region, counties, rules, field_rules, extra_fields) values
('NTREIS', 'North Texas Real Estate Information Systems', 'NTREIS', 'Dallas-Fort Worth and North Texas',
  array['Collin','Dallas','Denton','Tarrant','Rockwall','Kaufman','Ellis','Johnson','Parker','Hunt','Grayson','Wise','Hood','Fannin','Cooke','Navarro','Van Zandt','Somervell','Erath','Palo Pinto','Jack','Montague','Hill','Henderson'],
  '{"status_change_hours":72,"new_listing_hours":72,"min_photos":1,"min_photo_long_edge":1024,"remarks_max_chars":1000,"verified":true,
    "source":"NTREIS Rules (MetroTex): status changes and listing input within 72 hours; no contact info in public remarks (Rule 7.30); no buyer-agent compensation in any field (10.01); photos without branding, people, QR codes (7.29); sold price required (8.08). Photo minimum and size are our own standard."}',
  '{"MLSAreaMajor":{"required":true}}',
  '[]'),
('HAR', 'Houston Association of REALTORS MLS', 'HAR', 'Houston and the Gulf Coast',
  array['Harris','Fort Bend','Montgomery','Brazoria','Galveston','Waller','Liberty','Chambers','Austin','Walker','Grimes','San Jacinto','Matagorda','Wharton','Colorado','Polk'],
  '{"status_change_hours":48,"new_listing_hours":48,"min_photos":1,"min_photo_long_edge":1024,"remarks_max_chars":1000,"verified":false,
    "source":"Starting values, not yet confirmed against HAR rules. Confirm with HAR and update."}',
  '{"MLSAreaMajor":{"required":true,"label":"Market area"}}',
  '[{"key":"KeyMap","label":"Key Map page","section":"Location","source":"community","type":"text","required":true}]'),
('UNLOCK', 'Unlock MLS (Austin Board of REALTORS and partners)', 'Unlock MLS', 'Austin and Central Texas',
  array['Travis','Williamson','Hays','Bastrop','Caldwell','Burnet','Blanco','Lee','Llano','Milam','Fayette','Bell'],
  '{"status_change_hours":48,"new_listing_hours":48,"min_photos":1,"min_photo_long_edge":1024,"remarks_max_chars":1000,"verified":false,
    "source":"Starting values, not yet confirmed against Unlock MLS rules. Confirm with Unlock MLS and update."}',
  '{"MLSAreaMajor":{"required":true}}',
  '[]'),
('SABOR', 'San Antonio Board of REALTORS MLS', 'SABOR', 'San Antonio and the Hill Country',
  array['Bexar','Comal','Guadalupe','Medina','Kendall','Wilson','Atascosa','Bandera','Kerr','Frio','Gillespie','Karnes'],
  '{"status_change_hours":48,"new_listing_hours":48,"min_photos":1,"min_photo_long_edge":1024,"remarks_max_chars":1000,"verified":false,
    "source":"Starting values, not yet confirmed against SABOR rules. Confirm with SABOR and update."}',
  '{"MLSAreaMajor":{"required":true}}',
  '[]');

-- Which MLS(s) a builder works with. One board + locked: every home uses it
-- (an owner/manager or our team can still override per home). Several boards:
-- each community/home gets a suggestion from its county.
alter table public.builder_settings
  add column mls_boards text[] not null default '{}',
  add column mls_locked boolean not null default true;
alter table public.communities add column mls_board text references public.mls_boards (code);
alter table public.homes add column mls_board text references public.mls_boards (code);

create or replace function private.suggest_mls_board(p_builder uuid, p_county text)
returns text language sql stable security definer set search_path = '' as $$
  with mine as (select coalesce((select mls_boards from public.builder_settings where builder_id = p_builder), '{}') as boards)
  select coalesce(
    -- One of the builder's boards that covers this county
    (select b.code from public.mls_boards b, mine where b.active and b.code = any (mine.boards) and p_county = any (b.counties) order by b.code limit 1),
    -- The builder's only board
    (select mine.boards[1] from mine where array_length(mine.boards, 1) = 1),
    -- Any board that covers the county
    (select b.code from public.mls_boards b where b.active and p_county = any (b.counties) order by b.code limit 1))
$$;
revoke execute on function private.suggest_mls_board(uuid, text) from public, anon;
grant execute on function private.suggest_mls_board(uuid, text) to authenticated;

create or replace function public.communities_mls_default()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.mls_board is null then new.mls_board := private.suggest_mls_board(new.builder_id, new.county); end if;
  return new;
end $$;
revoke execute on function public.communities_mls_default() from public, anon, authenticated;
create trigger communities_mls_default before insert or update of county, builder_id on public.communities
  for each row execute function public.communities_mls_default();

create or replace function public.homes_mls_default()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.mls_board is null then
    new.mls_board := coalesce(
      (select mls_board from public.communities where id = new.community_id),
      private.suggest_mls_board(new.builder_id, (select county from public.communities where id = new.community_id)));
  end if;
  if tg_op = 'UPDATE' and old.mls_board is not null and new.mls_board is distinct from old.mls_board and old.workflow_status = 'live_on_mls' then
    raise exception 'This listing is already live on %. Take it off that MLS before moving it to another.', old.mls_board using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.homes_mls_default() from public, anon, authenticated;
create trigger homes_mls_default before insert or update of mls_board on public.homes
  for each row execute function public.homes_mls_default();

-- ===========================================================================
-- Readiness: everything that would get a listing bounced back or fined.
-- Returns a list of { level, code, message }:
--   block  the builder must fix it before approving
--   warn   worth a look, doesn't stop approval
--   team   our team fills it on the MLS sheet (doesn't stop approval)
-- ===========================================================================
create or replace function public.mls_readiness(p_home uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  h public.homes;
  b public.mls_boards;
  out jsonb := '[]';
  -- RESO name -> homes column for the builder's fields
  cols jsonb := '{"ListPrice":"list_price","UnparsedAddress":"unparsed_address","City":"city","PostalCode":"postal_code",
    "BedroomsTotal":"bedrooms_total","BathroomsFull":"bathrooms_full","BathroomsHalf":"bathrooms_half","LivingArea":"living_area",
    "LotSizeAcres":"lot_size_acres","StoriesTotal":"stories","GarageSpaces":"garage_spaces","YearBuilt":"year_built",
    "PublicRemarks":"public_remarks","EstimatedCompletion":"estimated_completion","BuilderModel":"plan_name","LotBlock":"lot_number"}';
  labels jsonb := '{"ListPrice":"List price","UnparsedAddress":"Street address","City":"City","PostalCode":"ZIP","BedroomsTotal":"Bedrooms",
    "BathroomsFull":"Full baths","BathroomsHalf":"Half baths","LivingArea":"Living area","LotSizeAcres":"Lot size","StoriesTotal":"Stories",
    "GarageSpaces":"Garage spaces","YearBuilt":"Year built","PublicRemarks":"Description","EstimatedCompletion":"Estimated completion",
    "BuilderModel":"Plan","LotBlock":"Lot and block"}';
  required text[] := array['ListPrice','UnparsedAddress','City','PostalCode','BedroomsTotal','BathroomsFull','BathroomsHalf',
    'LivingArea','LotSizeAcres','StoriesTotal','GarageSpaces','YearBuilt','PublicRemarks'];
  k text;
  v jsonb;
  missing text[] := '{}';
  remarks text;
  min_photos int;
  min_edge int;
  good_photos int;
  small_photos int;
  plan_photos int := 0;
  flagged int;
  max_chars int;
  team_missing int;
begin
  select * into h from public.homes where id = p_home;
  if h.id is null or not (private.is_staff() or private.can_see_home(h.builder_id, h.community_id)) then
    return jsonb_build_array(jsonb_build_object('level', 'block', 'code', 'not_found', 'message', 'Home not found.'));
  end if;
  select * into b from public.mls_boards where code = h.mls_board;
  if b.code is null then
    return jsonb_build_array(jsonb_build_object('level', 'block', 'code', 'no_mls', 'message', 'Pick which MLS this home goes to.'));
  end if;

  -- 1. Required fields for this MLS (the builder's part)
  if h.build_stage <> 'move_in_ready' then required := array_append(required, 'EstimatedCompletion'); end if;
  for k, v in select * from jsonb_each(b.field_rules) loop
    if (v ->> 'required')::boolean is true and cols ? k then required := array_append(required, k); end if;
    if (v ->> 'required')::boolean is false or (v ->> 'hidden')::boolean is true then required := array_remove(required, k); end if;
  end loop;
  foreach k in array required loop
    if coalesce(to_jsonb(h) ->> (cols ->> k), '') = '' then missing := array_append(missing, labels ->> k); end if;
  end loop;
  if array_length(missing, 1) > 0 then
    out := out || jsonb_build_object('level', 'block', 'code', 'missing_fields',
      'message', b.short_name || ' requires: ' || array_to_string(missing, ', ') || '.');
  end if;

  -- 2. Photos: enough, big enough, AI warnings cleared
  min_photos := coalesce((b.rules ->> 'min_photos')::int, 1);
  min_edge := coalesce((b.rules ->> 'min_photo_long_edge')::int, 1024);
  select count(*) filter (where source = 'demo' or greatest(coalesce(width, 0), coalesce(height, 0)) >= min_edge),
         count(*) filter (where source <> 'demo' and greatest(coalesce(width, 0), coalesce(height, 0)) between 1 and min_edge - 1)
    into good_photos, small_photos
  from public.media where home_id = p_home and kind = 'photo' and deleted_at is null and mls_ready;
  if h.show_representative_disclaimer and h.plan_name is not null then
    select count(*) into plan_photos from public.media
    where builder_id = h.builder_id and plan_name = h.plan_name and home_id is null and community_id is null
      and kind = 'photo' and deleted_at is null and mls_ready;
  end if;
  if good_photos + plan_photos < min_photos then
    out := out || jsonb_build_object('level', 'block', 'code', 'photos',
      'message', format('%s needs at least %s photo%s, %s pixels or larger on the long side. This home has %s ready.',
        b.short_name, min_photos, case when min_photos = 1 then '' else 's' end, min_edge, good_photos + plan_photos));
  elsif good_photos < min_photos and plan_photos > 0 then
    out := out || jsonb_build_object('level', 'warn', 'code', 'plan_photos', 'message', 'Listing with plan or model photos; the representative disclaimer is on.');
  end if;
  if small_photos > 0 then
    out := out || jsonb_build_object('level', 'warn', 'code', 'small_photos',
      'message', format('%s photo%s smaller than %s pixels won''t be used.', small_photos, case when small_photos = 1 then ' is' else 's are' end, min_edge));
  end if;
  select count(*) into flagged from public.media
  where home_id = p_home and kind = 'photo' and deleted_at is null and not mls_ready
    and jsonb_array_length(coalesce(ai_suggestion -> 'flags', '[]')) > 0;
  if flagged > 0 then
    out := out || jsonb_build_object('level', 'block', 'code', 'ai_flags',
      'message', format('%s photo%s AI warnings (people, signs, text, blur or dark). Remove %s or mark %s OK for the MLS.',
        flagged, case when flagged = 1 then ' has' else 's have' end, case when flagged = 1 then 'it' else 'them' end,
        case when flagged = 1 then 'it' else 'them' end));
  end if;

  -- 3. Description rules (fines for contact info and compensation)
  remarks := coalesce(h.public_remarks, '');
  if remarks ~ '\(?\m\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\M' then
    out := out || jsonb_build_object('level', 'block', 'code', 'remarks_phone', 'message', 'The description has a phone number. The MLS fines contact info in public remarks.');
  end if;
  if remarks ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    out := out || jsonb_build_object('level', 'block', 'code', 'remarks_email', 'message', 'The description has an email address. The MLS fines contact info in public remarks.');
  end if;
  if remarks ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|homes|info|us|io|co)\M)' then
    out := out || jsonb_build_object('level', 'block', 'code', 'remarks_web', 'message', 'The description has a website address. The MLS fines web addresses in public remarks.');
  end if;
  if remarks ~* '(commission|compensation|co-?broke|bonus to (the )?(buyer|selling)|buyer''?s? agent bonus|\m\d+(\.\d+)?\s*% (to|for) (buyer|selling))' then
    out := out || jsonb_build_object('level', 'block', 'code', 'remarks_comp', 'message', 'The description mentions agent compensation, which can''t appear in any MLS field.');
  end if;
  if remarks ~* '(\mcall\M|\mtext\M|\mcontact\M|\mlisting agent\M|\mshowing agent\M|\mask for\M|\mschedule (a|your) (showing|tour) with\M)' then
    out := out || jsonb_build_object('level', 'warn', 'code', 'remarks_agent',
      'message', 'The description may point buyers to a person ("call", "contact", "ask for"). Agent and showing info belong in showing instructions.');
  end if;
  max_chars := coalesce((b.rules ->> 'remarks_max_chars')::int, 1000);
  if length(remarks) > max_chars then
    out := out || jsonb_build_object('level', 'block', 'code', 'remarks_long',
      'message', format('The description is %s characters; %s allows %s.', length(remarks), b.short_name, max_chars));
  end if;
  if length(remarks) > 40 and remarks = upper(remarks) then
    out := out || jsonb_build_object('level', 'warn', 'code', 'remarks_caps', 'message', 'The description is all capital letters.');
  end if;

  -- 4. Our team's part (MLS sheet): informational for the builder
  select count(*) into team_missing from (
    select unnest(array['LegalDescription','PropertySubType','ConstructionMaterials','Roof','FoundationDetails']) as f
  ) req
  where not exists (select 1 from public.mls_details d where d.home_id = p_home and coalesce(d.data ->> req.f, '') not in ('', '[]'))
    and not exists (select 1 from public.mls_details d where d.community_id = h.community_id and coalesce(d.data ->> req.f, '') not in ('', '[]'));
  if team_missing > 0 then
    out := out || jsonb_build_object('level', 'team', 'code', 'team_fields',
      'message', format('%s MLS-only detail%s (like the legal description) will be filled in by our team.', team_missing, case when team_missing = 1 then '' else 's' end));
  end if;
  return out;
end $$;
revoke execute on function public.mls_readiness(uuid) from public, anon;
grant execute on function public.mls_readiness(uuid) to authenticated;

-- Approving for the MLS requires a clean readiness check.
create or replace function public.homes_mls_ready_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare issues jsonb; msg text;
begin
  if new.workflow_status = 'approved_for_mls' and old.workflow_status is distinct from 'approved_for_mls' then
    issues := public.mls_readiness(new.id);
    select string_agg(i ->> 'message', ' ') into msg from jsonb_array_elements(issues) i where i ->> 'level' = 'block';
    if msg is not null then
      raise exception 'Not ready for the MLS yet: %', msg using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.homes_mls_ready_guard() from public, anon, authenticated;
create trigger homes_mls_ready_guard before update of workflow_status on public.homes
  for each row execute function public.homes_mls_ready_guard();

-- Owners, managers and our team may change which MLS a home goes to.
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
    allowed := array['mls_number', 'workflow_status', 'market_status', 'mls_board'] || sale;
  elsif r in ('builder_owner', 'manager') then
    allowed := array['community_id', 'unparsed_address', 'city', 'postal_code',
      'lot_number', 'plan_name', 'list_price', 'bedrooms_total', 'bathrooms_full',
      'bathrooms_half', 'living_area', 'lot_size_acres', 'stories', 'garage_spaces',
      'year_built', 'public_remarks', 'build_stage', 'estimated_completion',
      'workflow_status', 'deleted_at', 'market_status', 'show_representative_disclaimer', 'mls_board'] || sale;
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

-- Demo setup: Mesquite Creek works only in North Texas (locked to NTREIS);
-- Prairie Lantern works in two markets, so homes get a suggestion by county.
update public.builder_settings set mls_boards = array['NTREIS'], mls_locked = true
  where builder_id = (select id from public.builders where name = 'Mesquite Creek Homes (demo)');
update public.builder_settings set mls_boards = array['NTREIS', 'UNLOCK'], mls_locked = false
  where builder_id = (select id from public.builders where name = 'Prairie Lantern Builders (demo)');
update public.communities set mls_board = private.suggest_mls_board(builder_id, county) where mls_board is null;
update public.homes h set mls_board = c.mls_board from public.communities c where c.id = h.community_id and h.mls_board is null;
