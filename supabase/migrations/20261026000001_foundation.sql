-- Foundation: builders (tenants), user profiles with roles, communities,
-- homes (listings), activity log, and the row-level security rules that
-- keep each builder's data walled off.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum (
  'platform_admin',
  'listing_coordinator',
  'builder_owner',
  'manager',
  'sales',
  'marketing'
);

-- Where a listing is in our own approval process.
create type public.workflow_status as enum (
  'draft',
  'in_review',
  'approved_for_mls',
  'live_on_mls'
);

-- Construction stage of the home.
create type public.build_stage as enum (
  'to_be_built',
  'under_construction',
  'move_in_ready'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.builders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.user_role not null,
  builder_id uuid references public.builders (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Our staff have no builder; builder users must have one.
  constraint profile_builder_matches_role check (
    (role in ('platform_admin', 'listing_coordinator') and builder_id is null)
    or (role not in ('platform_admin', 'listing_coordinator') and builder_id is not null)
  )
);

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders (id) on delete restrict,
  name text not null,
  city text not null,
  county text,
  created_at timestamptz not null default now()
);

-- Field names follow the RESO Data Dictionary where one exists
-- (UnparsedAddress -> unparsed_address, ListPrice -> list_price, etc.).
create table public.homes (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references public.builders (id) on delete restrict,
  community_id uuid not null references public.communities (id) on delete restrict,

  unparsed_address text not null,          -- RESO UnparsedAddress
  city text not null,                      -- RESO City
  state_or_province text not null default 'TX', -- RESO StateOrProvince
  postal_code text not null,               -- RESO PostalCode
  lot_number text,                         -- builder lot number
  plan_name text,                          -- builder floor plan name

  list_price numeric(12, 2),               -- RESO ListPrice
  bedrooms_total smallint,                 -- RESO BedroomsTotal
  bathrooms_full smallint,                 -- RESO BathroomsFull
  bathrooms_half smallint,                 -- RESO BathroomsHalf
  living_area integer,                     -- RESO LivingArea (sq ft)
  lot_size_acres numeric(6, 3),            -- RESO LotSizeAcres
  stories smallint,                        -- RESO StoriesTotal
  garage_spaces smallint,                  -- RESO GarageSpaces
  year_built smallint,                     -- RESO YearBuilt
  public_remarks text,                     -- RESO PublicRemarks (listing description)

  build_stage public.build_stage not null default 'under_construction',
  estimated_completion date,

  workflow_status public.workflow_status not null default 'draft',
  mls_number text,                         -- RESO ListingId, logged by coordinator

  -- Where each field's current value came from: "website", "staff" or "mls".
  field_sources jsonb not null default '{}'::jsonb,

  deleted_at timestamptz,                  -- 30-day trash
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create index homes_builder_idx on public.homes (builder_id);
create index homes_community_idx on public.homes (community_id);
create index homes_workflow_idx on public.homes (workflow_status);
create index communities_builder_idx on public.communities (builder_id);
create index profiles_builder_idx on public.profiles (builder_id);

create table public.activity_log (
  id bigint generated always as identity primary key,
  builder_id uuid references public.builders (id) on delete restrict,
  home_id uuid references public.homes (id) on delete set null,
  actor_id uuid references auth.users (id),
  action text not null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_home_idx on public.activity_log (home_id, created_at desc);
create index activity_log_builder_idx on public.activity_log (builder_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helper functions: who is the signed-in user?
-- Security definer so they can read profiles without tripping RLS loops.
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.my_builder_id()
returns uuid
language sql stable security definer set search_path = ''
as $$ select builder_id from public.profiles where id = auth.uid() $$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select role in ('platform_admin', 'listing_coordinator')
       from public.profiles where id = auth.uid()),
    false)
$$;

-- Can the signed-in user see this builder's data?
create or replace function public.can_see_builder(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_staff() or target = public.my_builder_id() $$;

revoke execute on function public.my_role(), public.my_builder_id(),
  public.is_staff(), public.can_see_builder(uuid) from public, anon;
grant execute on function public.my_role(), public.my_builder_id(),
  public.is_staff(), public.can_see_builder(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.builders enable row level security;
alter table public.profiles enable row level security;
alter table public.communities enable row level security;
alter table public.homes enable row level security;
alter table public.activity_log enable row level security;

-- Signed-out visitors get nothing, at the permission level too.
revoke all on public.builders, public.profiles, public.communities,
  public.homes, public.activity_log from anon;

-- Builders
create policy "see own builder or all if staff" on public.builders
  for select to authenticated using (public.can_see_builder(id));
create policy "platform admin manages builders" on public.builders
  for all to authenticated
  using (public.my_role() = 'platform_admin')
  with check (public.my_role() = 'platform_admin');

-- Profiles
create policy "see self, same company, or all if staff" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff()
         or (builder_id is not null and builder_id = public.my_builder_id()));
create policy "platform admin manages users" on public.profiles
  for all to authenticated
  using (public.my_role() = 'platform_admin')
  with check (public.my_role() = 'platform_admin');

-- Communities
create policy "see own builder communities" on public.communities
  for select to authenticated using (public.can_see_builder(builder_id));
create policy "owners and managers add communities" on public.communities
  for insert to authenticated
  with check (public.my_role() = 'platform_admin'
    or (public.my_role() in ('builder_owner', 'manager')
        and builder_id = public.my_builder_id()));
create policy "owners and managers edit communities" on public.communities
  for update to authenticated
  using (public.my_role() = 'platform_admin'
    or (public.my_role() in ('builder_owner', 'manager')
        and builder_id = public.my_builder_id()))
  with check (public.my_role() = 'platform_admin'
    or (public.my_role() in ('builder_owner', 'manager')
        and builder_id = public.my_builder_id()));

-- Homes
create policy "see own builder homes" on public.homes
  for select to authenticated using (public.can_see_builder(builder_id));
create policy "builder editors add homes" on public.homes
  for insert to authenticated
  with check (public.my_role() = 'platform_admin'
    or (public.my_role() in ('builder_owner', 'manager', 'sales')
        and builder_id = public.my_builder_id()
        and workflow_status = 'draft'
        and mls_number is null
        and deleted_at is null));
create policy "editors update homes" on public.homes
  for update to authenticated
  using (public.my_role() in ('platform_admin', 'listing_coordinator')
    or (public.my_role() in ('builder_owner', 'manager', 'sales', 'marketing')
        and builder_id = public.my_builder_id()))
  with check (public.my_role() in ('platform_admin', 'listing_coordinator')
    or (public.my_role() in ('builder_owner', 'manager', 'sales', 'marketing')
        and builder_id = public.my_builder_id()));
-- No delete policy: homes are never hard-deleted by users; they go to trash
-- by setting deleted_at.

-- Activity log: read only. Rows are written by triggers.
create policy "see own builder activity" on public.activity_log
  for select to authenticated using (public.can_see_builder(builder_id));

-- ---------------------------------------------------------------------------
-- Field-level rules for homes, enforced in the database.
-- RLS decides WHICH homes a user may edit; this trigger decides WHICH FIELDS.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_home_edit_rules()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r public.user_role := public.my_role();
  changed text[];
  allowed text[];
  bad text[];
begin
  -- Service/maintenance connections (no signed-in user) skip the rules.
  if auth.uid() is null then
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
    allowed := array['mls_number', 'workflow_status'];
  elsif r in ('builder_owner', 'manager') then
    allowed := array['community_id', 'unparsed_address', 'city', 'postal_code',
      'lot_number', 'plan_name', 'list_price', 'bedrooms_total', 'bathrooms_full',
      'bathrooms_half', 'living_area', 'lot_size_acres', 'stories', 'garage_spaces',
      'year_built', 'public_remarks', 'build_stage', 'estimated_completion',
      'workflow_status', 'deleted_at'];
  elsif r = 'sales' then
    allowed := array['list_price', 'build_stage', 'estimated_completion',
      'workflow_status'];
  elsif r = 'marketing' then
    allowed := array['public_remarks', 'workflow_status'];
  else
    allowed := '{}';
  end if;

  select coalesce(array_agg(c), '{}') into bad
  from unnest(changed) c where c <> all (allowed);

  if array_length(bad, 1) > 0 then
    raise exception 'Your role (%) cannot change: %', r, array_to_string(bad, ', ')
      using errcode = '42501';
  end if;

  -- Approval workflow: who may move a listing to which status.
  if new.workflow_status is distinct from old.workflow_status then
    if not (
      r = 'platform_admin'
      -- any builder editor can send for review or pull back to draft
      or (r in ('builder_owner', 'manager', 'sales', 'marketing')
          and new.workflow_status in ('draft', 'in_review')
          and old.workflow_status in ('draft', 'in_review'))
      -- only owners and managers approve for the MLS
      or (r in ('builder_owner', 'manager')
          and old.workflow_status = 'in_review'
          and new.workflow_status = 'approved_for_mls')
      -- owners and managers can send an approved listing back
      or (r in ('builder_owner', 'manager')
          and old.workflow_status = 'approved_for_mls'
          and new.workflow_status in ('draft', 'in_review'))
      -- only our coordinators mark a listing live on the MLS
      or (r = 'listing_coordinator'
          and old.workflow_status = 'approved_for_mls'
          and new.workflow_status = 'live_on_mls')
    ) then
      raise exception 'Your role (%) cannot move a listing from % to %',
        r, old.workflow_status, new.workflow_status using errcode = '42501';
    end if;
  end if;

  if new.workflow_status = 'live_on_mls' and coalesce(new.mls_number, '') = '' then
    raise exception 'An MLS number is required before marking a listing live'
      using errcode = '23514';
  end if;

  -- Remember who changed it, and mark changed fields as entered by staff.
  new.updated_at := now();
  new.updated_by := auth.uid();
  select coalesce(new.field_sources, '{}'::jsonb)
         || coalesce(jsonb_object_agg(c, 'staff'), '{}'::jsonb)
    into new.field_sources
  from unnest(changed) c
  where c not in ('workflow_status', 'deleted_at', 'mls_number');

  return new;
end;
$$;

create trigger homes_enforce_edit_rules
  before update on public.homes
  for each row execute function public.enforce_home_edit_rules();

-- ---------------------------------------------------------------------------
-- Activity log: record every change to a home.
-- ---------------------------------------------------------------------------
create or replace function public.log_home_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  diff jsonb;
  act text;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (builder_id, home_id, actor_id, action, changes)
    values (new.builder_id, new.id, auth.uid(), 'created', '{}'::jsonb);
    return new;
  end if;

  select coalesce(jsonb_object_agg(n.key,
           jsonb_build_object('from', o.value, 'to', n.value)), '{}'::jsonb)
    into diff
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'updated_by', 'field_sources');

  if diff = '{}'::jsonb then
    return new;
  end if;

  act := case
    when new.deleted_at is not null and old.deleted_at is null then 'moved_to_trash'
    when new.deleted_at is null and old.deleted_at is not null then 'restored'
    when new.workflow_status is distinct from old.workflow_status
      then 'status_' || new.workflow_status::text
    else 'edited'
  end;

  insert into public.activity_log (builder_id, home_id, actor_id, action, changes)
  values (new.builder_id, new.id, auth.uid(), act, diff);
  return new;
end;
$$;

create trigger homes_log_activity
  after insert or update on public.homes
  for each row execute function public.log_home_activity();

-- Trigger functions are not meant to be called directly.
revoke execute on function public.enforce_home_edit_rules(),
  public.log_home_activity() from public, anon, authenticated;
