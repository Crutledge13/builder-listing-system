-- A builder's default title company (owners' request, 28 Oct 2026).
--
-- Most builders close through one title company. It's set once for the
-- builder (at onboarding, or on Company branding > Default title company) and
-- fills NTREIS's "Title Company Preferred / Location / Phone" for every home.
-- A community can use a different one in its community setup, and our team's
-- own entry on the MLS sheet still wins.
--
-- Who changes it: the builder_settings rules (owners, managers, marketing and
-- our admins).

alter table public.builder_settings
  add column title_company_name text check (length(title_company_name) <= 120),
  add column title_company_location text check (length(title_company_location) <= 200),
  add column title_company_phone text check (length(title_company_phone) <= 30),
  add column title_company_contact text check (length(title_company_contact) <= 80),   -- escrow officer
  add column title_company_email text check (length(title_company_email) <= 200);

-- The setup checklist's new optional step can be skipped ("We don't use one").
alter table public.builder_onboarding drop constraint if exists builder_onboarding_skipped_check;
alter table public.builder_onboarding
  add constraint builder_onboarding_skipped_check
  check (skipped <@ array['team', 'brand_guide', 'website', 'title_company']::text[]);

create or replace function public.set_setup_skip(p_builder uuid, p_step text, p_skip boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_run_setup(p_builder) then
    raise exception 'Only the owner, a manager or marketing can change the setup checklist' using errcode = '42501';
  end if;
  if p_step not in ('team', 'brand_guide', 'website', 'title_company') then
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

-- A changed default goes on the MLS update task of every live home that uses
-- it (its community has no title company of its own and our team hasn't
-- entered one).
create or replace function public.builder_settings_title_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  f record;
  h record;
begin
  for f in
    select * from (values
      ('TitleCompanyPreferred', 'Title Company Preferred', to_jsonb(old.title_company_name), to_jsonb(new.title_company_name)),
      ('TitleCompanyLocation', 'Title Company Location', to_jsonb(old.title_company_location), to_jsonb(new.title_company_location)),
      ('TitleCompanyPhone', 'Title Company Phone', to_jsonb(old.title_company_phone), to_jsonb(new.title_company_phone))
    ) v(k, label, before, after)
    where before is distinct from after
  loop
    for h in
      select hm.id from public.homes hm
      join public.communities c on c.id = hm.community_id
      left join public.mls_details cd on cd.community_id = c.id
      left join public.mls_details hd on hd.home_id = hm.id
      where hm.builder_id = new.builder_id and hm.workflow_status = 'live_on_mls' and hm.deleted_at is null
        and not (c.mls_fields ? f.k)
        and not coalesce(cd.data ? f.k, false)
        and not coalesce(hd.data ? f.k, false)
    loop
      perform private.note_mls_change(h.id, 'community.' || f.k, f.label, f.before, f.after);
    end loop;
  end loop;
  return new;
end $$;
revoke execute on function public.builder_settings_title_changes() from public, anon, authenticated;
create trigger builder_settings_title_changes
  after update of title_company_name, title_company_location, title_company_phone on public.builder_settings
  for each row execute function public.builder_settings_title_changes();

-- Community answers for the title company also go on live listings' MLS
-- updates; add their labels to the community change trigger.
create or replace function public.communities_mls_fields_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  h record;
  staff_data jsonb;
  labels jsonb := '{"SeniorCommunityYN":"Adult Community YN","SubdivisionName":"Subdivision","HighSchoolDistrict":"School District",
    "ElementarySchool":"Elementary School Name","MiddleOrJuniorSchool":"Junior High School Name","HighSchool":"Senior High School Name",
    "AssociationAmenities":"Community Features","Utilities":"Street/Utilities","SpecialTaxingAuthorityYN":"Special Taxing Authority YN",
    "SpecialDistrict":"MUD or PID","AssociationYN":"Has an HOA","AssociationType":"HOA Type","AssociationFeeFrequency":"HOA Billing Frequency",
    "AssociationFee":"HOA Dues","AssociationName":"HOA Management Company","AssociationPhone":"HOA Management Company Phone",
    "AssociationFeeIncludes":"HOA Includes","ConsentToRecord":"Consent for Visitors to Record","ShowingAttendedYN":"Showing Attended YN",
    "LockBoxType":"Lockbox Type","AccessCode":"Access/Gate Code","ShowingRequirements":"Showing Requirements",
    "ShowingContactType":"Showing Contact Type","ShowingContactName":"Showing contact name","ShowingContactPhone":"Showing Contact Phone",
    "ShowingInstructions":"Showing Instructions","Directions":"Public Driving Directions","MLSAreaMajor":"MLS area","Heating":"Heating",
    "Cooling":"Cooling","WaterSource":"Water","Sewer":"Sewer","TaxRate":"Total tax rate (%)",
    "TitleCompanyPreferred":"Title Company Preferred","TitleCompanyLocation":"Title Company Location","TitleCompanyPhone":"Title Company Phone"}';
  defaults jsonb;
begin
  select data into staff_data from public.mls_details where community_id = new.id;
  -- What a blank community answer falls back to: the builder's default title company.
  select jsonb_strip_nulls(jsonb_build_object('TitleCompanyPreferred', s.title_company_name,
           'TitleCompanyLocation', s.title_company_location, 'TitleCompanyPhone', s.title_company_phone))
    into defaults from public.builder_settings s where s.builder_id = new.builder_id;
  defaults := coalesce(defaults, '{}');
  for k in
    select key from jsonb_object_keys(new.mls_fields) as key
    union
    select key from jsonb_object_keys(old.mls_fields) as key
  loop
    continue when coalesce(new.mls_fields -> k, defaults -> k) is not distinct from coalesce(old.mls_fields -> k, defaults -> k);
    continue when coalesce(staff_data, '{}'::jsonb) ? k;
    for h in
      select id from public.homes
       where community_id = new.id and workflow_status = 'live_on_mls' and deleted_at is null
    loop
      perform private.note_mls_change(h.id, 'community.' || k, coalesce(labels ->> k, k),
        coalesce(old.mls_fields -> k, defaults -> k), coalesce(new.mls_fields -> k, defaults -> k));
    end loop;
  end loop;
  return new;
end $$;
revoke execute on function public.communities_mls_fields_changes() from public, anon, authenticated;
