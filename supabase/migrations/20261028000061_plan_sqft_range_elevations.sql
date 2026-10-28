-- Tester notes (28 Oct 2026).
--
-- 1. Floor plans can give a square-foot range ("3,228 to 3,410"), because the
--    same plan comes out a little different with each elevation. living_area
--    stays the starting size (what a new home on the plan starts from); the
--    new living_area_max is the top of the range. Each home still has one
--    exact number, which is what the MLS takes.
alter table public.floor_plans
  add column living_area_max int check (living_area_max > 0);
alter table public.floor_plans
  add constraint floor_plans_living_area_range check (living_area_max is null or living_area is null or living_area_max >= living_area);

comment on column public.floor_plans.living_area is 'Starting (smallest) heated square feet of the plan.';
comment on column public.floor_plans.living_area_max is 'Largest heated square feet across the plan''s elevations; null when it is one size.';

-- 2. A floor plan's page has separate slots for floor plan drawings, elevation
--    renderings and model home photos. Elevation renderings are tagged with
--    this shared tag so they show in their own slot.
insert into public.media_tags (label, category, aliases, sort) values
  ('Elevation rendering', 'shot', '{elevation,rendering,elevation drawing,exterior rendering}', 55)
  on conflict do nothing;

-- 3. The MLS readiness checklist names missing builder answers with
--    mls_boards.rules.builder_labels. Use the same plain questions builders
--    now see on their forms (`question` in src/lib/ntreis-fields.ts) instead
--    of NTREIS's "... YN" names. Our team's MLS sheet keeps NTREIS's labels.
update public.mls_boards
set rules = jsonb_set(
  rules,
  '{builder_labels}',
  coalesce(rules -> 'builder_labels', '{}'::jsonb) || $j${
    "PropertyAttachedYN": "Does it share a wall with another home?",
    "AccessoryUnitYN": "Separate living unit on the lot (casita, garage apartment)?",
    "AccessoryUnitType": "What kind of separate unit?",
    "AccessoryUnitSqFt": "Separate unit size (sq ft)",
    "AdditionalParcelsYN": "Is it on more than one tax parcel?",
    "AdditionalParcelsDescription": "Other parcel IDs",
    "Levels": "Stories",
    "SmartHomeFeaturesYN": "Smart home features?",
    "PoolPrivateYN": "Private pool on this lot?",
    "BasementYN": "Basement?",
    "AttachedGarageYN": "Is the garage attached to the house?",
    "WaterfrontYN": "Does the lot touch water (lake, river, creek, pond)?",
    "SurveillanceDevices": "Cameras or recording devices at the home?",
    "ShowingAllowedYN": "Can agents show the home now?"
  }$j$::jsonb
)
where code = 'NTREIS';
