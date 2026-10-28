-- Builder onboarding.
--
-- 1. builders.legal_name: the exact legal company name, used for the MLS
--    "Owner Name" (falls back to the builder's display name).
-- 2. builder_onboarding: what our team collects before inviting a builder
--    (agreement, billing contact, pricing, website platform) plus the two
--    things the builder decides on its setup checklist (skipped steps, "we're
--    all set"). Staff read it; only platform admins change it directly.
--    Builder owners and managers use the functions at the bottom.
-- 3. communities.mls_fields: the builder's answers for a whole community
--    (schools, HOA, utilities, showing setup, directions), set once and shared
--    by every home in the community. Our team's own entry for the community
--    (mls_details) still wins on the MLS sheet. Changes on live listings go on
--    the MLS update task, like a home's own answers.

-- ---------------------------------------------------------------------------
-- 1. Legal name
-- ---------------------------------------------------------------------------
alter table public.builders
  add column legal_name text check (length(legal_name) <= 200);

-- ---------------------------------------------------------------------------
-- 2. Onboarding record
-- ---------------------------------------------------------------------------
create table public.builder_onboarding (
  builder_id uuid primary key references public.builders (id) on delete cascade,
  billing_contact_name text check (length(billing_contact_name) <= 80),
  billing_contact_email text check (length(billing_contact_email) <= 200),
  billing_contact_phone text check (length(billing_contact_phone) <= 30),
  pricing text check (length(pricing) <= 300),             -- what we agreed to charge
  agreement_signed_on date,                                -- service agreement
  listing_authorization_on date,                           -- authorization to list (per our attorney)
  website_platform text check (length(website_platform) <= 100), -- what runs their website
  sends_listing_feed text not null default 'unknown'       -- already sends a feed to Zillow or similar
    check (sends_listing_feed in ('yes', 'no', 'unknown')),
  notes text check (length(notes) <= 2000),
  skipped text[] not null default '{}'                     -- optional checklist steps the builder skipped
    check (skipped <@ array['team', 'brand_guide', 'website']::text[]),
  finished_at timestamptz,                                 -- the builder (or we) marked setup done
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.builder_onboarding enable row level security;
revoke all on public.builder_onboarding from anon;

-- Billing and agreement details are for our team only (managers have no
-- billing access); builders see their own skipped steps and finish date
-- through public.builder_setup_state().
create policy "our team sees onboarding" on public.builder_onboarding
  for select to authenticated using (private.is_staff());
create policy "admins add onboarding" on public.builder_onboarding
  for insert to authenticated with check (private.my_role() = 'platform_admin');
create policy "admins change onboarding" on public.builder_onboarding
  for update to authenticated
  using (private.my_role() = 'platform_admin') with check (private.my_role() = 'platform_admin');

create or replace function public.builder_onboarding_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke execute on function public.builder_onboarding_touch() from public, anon, authenticated;
create trigger builder_onboarding_touch before update on public.builder_onboarding
  for each row execute function public.builder_onboarding_touch();

-- Every builder gets an onboarding row.
insert into public.builder_onboarding (builder_id)
  select id from public.builders on conflict do nothing;

create or replace function private.builders_add_onboarding() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.builder_onboarding (builder_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke execute on function private.builders_add_onboarding() from public, anon, authenticated;
create trigger builders_add_onboarding after insert on public.builders
  for each row execute function private.builders_add_onboarding();

-- Who may run a builder's setup checklist: our staff, and that builder's
-- owners and managers.
create or replace function private.can_run_setup(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff()
      or (b = private.my_builder_id() and private.my_role() in ('builder_owner', 'manager'));
$$;
revoke execute on function private.can_run_setup(uuid) from public, anon;

-- The parts of the onboarding record the builder's checklist needs.
create or replace function public.builder_setup_state(p_builder uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.builder_onboarding;
begin
  if not private.can_run_setup(p_builder) then
    raise exception 'You can only see your own company''s setup' using errcode = '42501';
  end if;
  select * into r from public.builder_onboarding where builder_id = p_builder;
  return jsonb_build_object(
    'skipped', to_jsonb(coalesce(r.skipped, '{}')),
    'finished_at', r.finished_at,
    'agreement_signed', r.agreement_signed_on is not null
  );
end $$;
revoke execute on function public.builder_setup_state(uuid) from public, anon;
grant execute on function public.builder_setup_state(uuid) to authenticated;

-- Skip an optional step, or bring it back.
create or replace function public.set_setup_skip(p_builder uuid, p_step text, p_skip boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_run_setup(p_builder) then
    raise exception 'Only the owner or a manager can change the setup checklist' using errcode = '42501';
  end if;
  if p_step not in ('team', 'brand_guide', 'website') then
    raise exception 'That step can''t be skipped' using errcode = '22023';
  end if;
  insert into public.builder_onboarding (builder_id) values (p_builder) on conflict do nothing;
  update public.builder_onboarding
     set skipped = case when p_skip then array(select distinct unnest(skipped || p_step))
                        else array_remove(skipped, p_step) end
   where builder_id = p_builder;
end $$;
revoke execute on function public.set_setup_skip(uuid, text, boolean) from public, anon;
grant execute on function public.set_setup_skip(uuid, text, boolean) to authenticated;

-- "We're all set" (hides the checklist banner), or reopen it.
create or replace function public.finish_setup(p_builder uuid, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_run_setup(p_builder) then
    raise exception 'Only the owner or a manager can change the setup checklist' using errcode = '42501';
  end if;
  insert into public.builder_onboarding (builder_id) values (p_builder) on conflict do nothing;
  update public.builder_onboarding
     set finished_at = case when p_done then coalesce(finished_at, now()) else null end
   where builder_id = p_builder;
end $$;
revoke execute on function public.finish_setup(uuid, boolean) from public, anon;
grant execute on function public.finish_setup(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Community setup answers
-- ---------------------------------------------------------------------------
-- Who can change them: the existing community rules (owners, managers and our
-- admins edit; marketing can fill them in only when adding a community).
alter table public.communities
  add column mls_fields jsonb not null default '{}'
    check (jsonb_typeof(mls_fields) = 'object' and pg_column_size(mls_fields) < 65536),
  add column field_sources jsonb not null default '{}'
    check (jsonb_typeof(field_sources) = 'object');

-- Record where each changed answer came from (people typing it = staff).
create or replace function public.communities_mls_fields_sources() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  changed text[];
  before_fields jsonb := '{}';
begin
  if tg_op = 'UPDATE' then before_fields := old.mls_fields; end if;
  select coalesce(array_agg(k), '{}') into changed
  from (
    select key as k from jsonb_object_keys(new.mls_fields) as key
    union
    select key from jsonb_object_keys(before_fields) as key
  ) keys
  where (new.mls_fields -> k) is distinct from (before_fields -> k);
  if array_length(changed, 1) > 0 then
    new.field_sources := coalesce(new.field_sources, '{}')
      || (select jsonb_object_agg('mls_fields.' || c, 'staff') from unnest(changed) c);
  end if;
  return new;
end $$;
revoke execute on function public.communities_mls_fields_sources() from public, anon, authenticated;
create trigger communities_mls_fields_sources before insert or update of mls_fields on public.communities
  for each row execute function public.communities_mls_fields_sources();

-- A community answer changed: every live listing in it needs the MLS updated,
-- unless our team has its own entry for that field (which is what the MLS has).
create or replace function public.communities_mls_fields_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  h record;
  staff_data jsonb;
  -- Labels as the MLS sheets show them (src/lib/ntreis-fields.ts, src/lib/mls-fields.ts).
  labels jsonb := '{"SeniorCommunityYN":"Adult Community YN","SubdivisionName":"Subdivision","HighSchoolDistrict":"School District",
    "ElementarySchool":"Elementary School Name","MiddleOrJuniorSchool":"Junior High School Name","HighSchool":"Senior High School Name",
    "AssociationAmenities":"Community Features","Utilities":"Street/Utilities","SpecialTaxingAuthorityYN":"Special Taxing Authority YN",
    "SpecialDistrict":"MUD or PID","AssociationYN":"Has an HOA","AssociationType":"HOA Type","AssociationFeeFrequency":"HOA Billing Frequency",
    "AssociationFee":"HOA Dues","AssociationName":"HOA Management Company","AssociationPhone":"HOA Management Company Phone",
    "AssociationFeeIncludes":"HOA Includes","ConsentToRecord":"Consent for Visitors to Record","ShowingAttendedYN":"Showing Attended YN",
    "LockBoxType":"Lockbox Type","AccessCode":"Access/Gate Code","ShowingRequirements":"Showing Requirements",
    "ShowingContactType":"Showing Contact Type","ShowingContactName":"Showing contact name","ShowingContactPhone":"Showing Contact Phone",
    "ShowingInstructions":"Showing Instructions","Directions":"Public Driving Directions","MLSAreaMajor":"MLS area","Heating":"Heating",
    "Cooling":"Cooling","WaterSource":"Water","Sewer":"Sewer","TaxRate":"Total tax rate (%)"}';
begin
  select data into staff_data from public.mls_details where community_id = new.id;
  for k in
    select key from jsonb_object_keys(new.mls_fields) as key
    union
    select key from jsonb_object_keys(old.mls_fields) as key
  loop
    continue when (new.mls_fields -> k) is not distinct from (old.mls_fields -> k);
    continue when coalesce(staff_data, '{}'::jsonb) ? k;
    for h in
      select id from public.homes
       where community_id = new.id and workflow_status = 'live_on_mls' and deleted_at is null
    loop
      perform private.note_mls_change(h.id, 'community.' || k, coalesce(labels ->> k, k), old.mls_fields -> k, new.mls_fields -> k);
    end loop;
  end loop;
  return new;
end $$;
revoke execute on function public.communities_mls_fields_changes() from public, anon, authenticated;
create trigger communities_mls_fields_changes after update of mls_fields on public.communities
  for each row execute function public.communities_mls_fields_changes();
