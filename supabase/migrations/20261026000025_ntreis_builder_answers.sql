-- NTREIS questions for builders.
--
-- homes.mls_fields holds the builder's answers to the NTREIS questions on
-- "Add a home" and the home page, keyed by RESO name (or our own name for
-- NTREIS-only fields). The list of questions, with NTREIS's exact labels and
-- choices, is src/lib/ntreis-fields.ts; the full NTREIS form is
-- docs/ntreis-residential-fields.md. Our team's own entries stay in mls_details
-- and win over the builder's answer on the MLS sheet.

alter table public.homes
  add column mls_fields jsonb not null default '{}'::jsonb
    constraint homes_mls_fields_object check (jsonb_typeof(mls_fields) = 'object');

comment on column public.homes.mls_fields is
  'Builder''s answers to MLS-specific questions (NTREIS today), keyed by RESO name. Sources per answer are in field_sources as "mls_fields.<key>".';

-- Owners and managers may change the answers after a home is added (the same
-- people who edit its specs). Marketing sets them only when adding a home;
-- sales and our coordinators don't change them (coordinators override on the
-- MLS sheet instead). Platform admins can change anything already.
do $do$
declare src text; pat text;
begin
  src := pg_get_functiondef('public.enforce_home_edit_rules()'::regprocedure);
  pat := $x$'show_representative_disclaimer', 'mls_board'] || sale;$x$;
  if position(pat in src) = 0 then raise exception 'enforce_home_edit_rules: owner/manager list not found'; end if;
  execute replace(src, pat, $x$'show_representative_disclaimer', 'mls_board', 'mls_fields'] || sale;$x$);
end $do$;

-- NTREIS: which builder answers it needs, and their NTREIS labels. MLS area
-- isn't on NTREIS's input form (Matrix works it out), so it's no longer required.
update public.mls_boards
  set rules = rules || $j${"builder_required": ["PropertySubType", "PropertyAttachedYN", "StructureType", "ParcelNumber", "AdditionalParcelsYN", "LivingAreasTotal", "DiningAreasTotal", "InteriorFeatures", "SmartHomeFeaturesYN", "PoolPrivateYN", "BasementYN", "FireplacesTotal", "Appliances", "CarportSpaces", "ParkingFeatures", "WaterfrontYN", "Possession", "ShowingAllowedYN", "LockBoxSerialNumber"], "builder_labels": {"PropertySubType": "Property Sub Type", "PropertyAttachedYN": "Property Attached YN", "AccessoryUnitYN": "Accessory Unit YN", "AccessoryUnitType": "Accessory Unit Type", "AccessoryUnitSqFt": "Accessory Unit SqFt", "StructureType": "Housing Type", "ConstructionMaterials": "Construction Material", "ArchitecturalStyle": "Architectural Style", "LivingAreaSource": "SqFt Source", "ParcelNumber": "Parcel ID", "AdditionalParcelsYN": "Multi Parcel ID YN", "AdditionalParcelsDescription": "Additional Parcel ID", "Lot": "Lot", "TaxBlock": "Tax Block", "LegalDescription": "Additn'l Legal Desc.", "Levels": "Levels", "LivingAreasTotal": "# Living Areas", "DiningAreasTotal": "# Dining Areas", "AccessibilityFeatures": "Accessibility Features", "InteriorFeatures": "Interior Features", "SecurityFeatures": "Security Features", "LaundryFeatures": "Laundry Features", "SmartHomeFeaturesYN": "Smart Home Features YN", "PoolPrivateYN": "Pool on Property YN", "PoolFeatures": "Pool Features", "BasementYN": "Basement YN", "FoundationDetails": "Foundation", "Roof": "Roof", "Flooring": "Flooring", "FireplacesTotal": "# Fireplaces", "FireplaceFeatures": "Fireplace Features", "Appliances": "Appliances", "WindowFeatures": "Window Features", "PatioAndPorchFeatures": "Patio & Porch Features", "CarportSpaces": "# Carport Spaces", "AttachedGarageYN": "Attached Garage YN", "ParkingFeatures": "Parking Features", "LotSizeDimensions": "Lot Dimensions", "LotSizeSource": "Lot Size Source", "LotFeatures": "Lot Features", "ExteriorFeatures": "Exterior Features", "Fencing": "Type of Fence", "WaterfrontYN": "Waterfront YN", "Heating": "Heating", "Cooling": "Cooling", "GreenEnergyEfficient": "Green Energy Features", "GreenBuildingVerificationType": "Building Verification", "GreenVerificationRating": "Rating", "GreenVerificationStatus": "Status", "ListingTerms": "Listing Terms (Proposed Financing)", "Possession": "Possession", "SurveillanceDevices": "Notice Surveillance Devices Present", "ShowingAllowedYN": "Showing Allowed", "LockBoxSerialNumber": "Key Box Number", "LockBoxLocation": "Lock Box Location", "Exclusions": "Excludes"}}$j$::jsonb,
      field_rules = field_rules - 'MLSAreaMajor'
  where code = 'NTREIS';

-- Readiness: say which NTREIS answers are still missing (a warning, so drafts
-- can still be approved while the builder finishes them), and count the
-- builder's answers when listing what our team still has to fill in.
do $do$
declare src text; pat text;
begin
  src := pg_get_functiondef('public.mls_readiness(uuid)'::regprocedure);

  pat := $x$  team_missing int;$x$;
  if position(pat in src) = 0 then raise exception 'mls_readiness: declare not found'; end if;
  src := replace(src, pat, $x$  team_missing int;
  builder_missing text[];$x$);

  -- (anchored on code, not comments: the deployed function may have none)
  pat := $x$  select count(*) into team_missing from ($x$;
  if position(pat in src) = 0 then raise exception 'mls_readiness: team check not found'; end if;
  src := replace(src, pat, $x$  -- 3b. This MLS's own questions for the builder (homes.mls_fields)
  select coalesce(array_agg(coalesce(b.rules -> 'builder_labels' ->> k.key, k.key)), '{}') into builder_missing
  from jsonb_array_elements_text(coalesce(b.rules -> 'builder_required', '[]'::jsonb)) as k(key)
  where coalesce(h.mls_fields ->> k.key, '') in ('', '[]')
    and not exists (select 1 from public.mls_details d where d.home_id = p_home and coalesce(d.data ->> k.key, '') not in ('', '[]'));
  if array_length(builder_missing, 1) > 0 then
    out := out || jsonb_build_object('level', 'warn', 'code', 'builder_answers',
      'message', format('%s also needs: %s. Answer these under %s details on the home.',
        b.short_name, array_to_string(builder_missing, ', '), b.short_name));
  end if;

  select count(*) into team_missing from ($x$);

  pat := $x$  where not exists (select 1 from public.mls_details d where d.home_id = p_home and coalesce(d.data ->> req.f, '') not in ('', '[]'))$x$;
  if position(pat in src) = 0 then raise exception 'mls_readiness: team mls_details check not found'; end if;
  src := replace(src, pat, $x$  where coalesce(h.mls_fields ->> req.f, '') in ('', '[]')
    and not exists (select 1 from public.mls_details d where d.home_id = p_home and coalesce(d.data ->> req.f, '') not in ('', '[]'))$x$);

  execute src;
end $do$;

-- A live listing's NTREIS answers changed: add each change to the MLS update task.
create or replace function public.homes_mls_fields_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  k text;
  lbl text;
begin
  if new.workflow_status = 'live_on_mls' and old.workflow_status = 'live_on_mls' then
    for k in
      select key from jsonb_object_keys(new.mls_fields) as key
      union
      select key from jsonb_object_keys(old.mls_fields) as key
    loop
      if (new.mls_fields -> k) is distinct from (old.mls_fields -> k) then
        select coalesce(b.rules -> 'builder_labels' ->> k, k) into lbl from public.mls_boards b where b.code = new.mls_board;
        perform private.note_mls_change(new.id, 'mls_fields.' || k, coalesce(lbl, k), old.mls_fields -> k, new.mls_fields -> k);
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke execute on function public.homes_mls_fields_changes() from public, anon, authenticated;
create trigger homes_mls_fields_changes after update of mls_fields on public.homes
  for each row execute function public.homes_mls_fields_changes();
