-- Demo MLS details (TEST project only, all made up). Run after demo_round3.sql.
-- Community rows hold what every home there shares; home rows hold the rest.
-- A few required fields are left empty on purpose so the "missing" warnings show.

insert into public.mls_details (community_id, data)
select c.id, d.data
from public.communities c
join (values
  ('Oak Creek', jsonb_build_object(
    'SubdivisionName', 'Oak Creek Ph 2',
    'Directions', 'From Dallas North Tollway, go east on FM 455, left on Oak Creek Pkwy. Model home on the right.',
    'Heating', jsonb_build_array('Central', 'Natural Gas'), 'Cooling', jsonb_build_array('Central Air', 'Electric'),
    'WaterSource', jsonb_build_array('City'), 'Sewer', jsonb_build_array('City'),
    'Utilities', jsonb_build_array('Electricity Connected', 'Natural Gas Available', 'Underground Utilities', 'Fiber Optic'),
    'HighSchoolDistrict', 'Celina ISD', 'ElementarySchool', 'Oak Creek Elementary (demo)', 'MiddleOrJuniorSchool', 'Sycamore Middle (demo)', 'HighSchool', 'Celina High (demo)',
    'AssociationYN', 'Yes', 'AssociationName', 'Oak Creek HOA (demo)', 'AssociationFee', 900, 'AssociationFeeFrequency', 'Annually',
    'AssociationAmenities', jsonb_build_array('Pool', 'Playground', 'Jogging Path/Bike Path'),
    'SpecialDistrict', 'PID', 'TaxRate', 2.41,
    'ShowingInstructions', 'Please check in at the Oak Creek model home (1200 Sycamore Trl) before showing. Model open daily 10 to 6.',
    'ShowingContactName', 'Taylor Brooks (demo)', 'ShowingContactPhone', '(214) 555-0142')),
  ('Willow Bend Ranch', jsonb_build_object(
    'SubdivisionName', 'Willow Bend Ranch Ph 1',
    'Directions', 'From I-20, exit FM 548 north, right on Willow Bend Ln. Model at the entrance.',
    'Heating', jsonb_build_array('Central', 'Electric', 'Heat Pump'), 'Cooling', jsonb_build_array('Central Air', 'Electric'),
    'WaterSource', jsonb_build_array('MUD'), 'Sewer', jsonb_build_array('MUD'),
    'Utilities', jsonb_build_array('Electricity Connected', 'Underground Utilities'),
    'HighSchoolDistrict', 'Forney ISD', 'ElementarySchool', 'Willow Bend Elementary (demo)', 'MiddleOrJuniorSchool', 'Bur Oak Middle (demo)', 'HighSchool', 'Forney North High (demo)',
    'AssociationYN', 'Yes', 'AssociationName', 'Willow Bend Ranch HOA (demo)', 'AssociationFee', 75, 'AssociationFeeFrequency', 'Monthly',
    'AssociationAmenities', jsonb_build_array('Park', 'Pond', 'Playground'),
    'SpecialDistrict', 'MUD', 'TaxRate', 2.78,
    'ShowingInstructions', 'Call the onsite agent to schedule. Homes are locked with a builder lockbox.',
    'ShowingContactName', 'Jamie Ortiz (demo)', 'ShowingContactPhone', '(972) 555-0188')),
  ('Bluestem Meadows', jsonb_build_object(
    'SubdivisionName', 'Bluestem Meadows',
    'Heating', jsonb_build_array('Central', 'Natural Gas'), 'Cooling', jsonb_build_array('Central Air'),
    'WaterSource', jsonb_build_array('City'), 'Sewer', jsonb_build_array('City'),
    'HighSchoolDistrict', 'Princeton ISD', 'ElementarySchool', 'Bluestem Elementary (demo)', 'MiddleOrJuniorSchool', 'Lantern Middle (demo)', 'HighSchool', 'Princeton High (demo)',
    'AssociationYN', 'Yes', 'AssociationName', 'Bluestem Meadows HOA (demo)', 'AssociationFee', 650, 'AssociationFeeFrequency', 'Annually',
    'SpecialDistrict', 'None', 'TaxRate', 2.19,
    'ShowingInstructions', 'Showings by appointment through the Bluestem sales office.',
    'ShowingContactName', 'Prairie Lantern sales (demo)', 'ShowingContactPhone', '(469) 555-0117'))
) as d(name, data) on d.name = c.name
on conflict (community_id) do nothing;

-- Home-level details for homes that are approved or live.
insert into public.mls_details (home_id, data)
select h.id,
  jsonb_build_object(
    'PropertySubType', 'Single Family Residence',
    'SpecialListingConditions', 'Builder Owned',
    'LivingAreaSource', 'Builder',
    'AttachedGarageYN', 'Yes',
    'FireplacesTotal', case when h.living_area > 2300 then 1 else 0 end,
    'PoolPrivateYN', 'No',
    'ConstructionMaterials', jsonb_build_array('Brick', 'Stone', 'Fiber Cement'),
    'Roof', jsonb_build_array('Composition'),
    'FoundationDetails', jsonb_build_array('Slab'),
    'Flooring', jsonb_build_array('Carpet', 'Ceramic Tile', 'Luxury Vinyl Plank'),
    'InteriorFeatures', jsonb_build_array('Kitchen Island', 'Open Floorplan', 'Walk-In Closet(s)', 'Quartz Counters'),
    'PatioAndPorchFeatures', jsonb_build_array('Covered', 'Front Porch'),
    'Fencing', jsonb_build_array('Wood'),
    'GreenEnergyEfficient', jsonb_build_array('Energy Star Appliances', 'Low-E Windows', 'Tankless Water Heater'),
    'TaxAnnualAmount', round(h.list_price * coalesce((select (cd.data ->> 'TaxRate')::numeric from public.mls_details cd where cd.community_id = h.community_id), 2.4) / 100),
    'PrivateRemarks', 'Builder warranty: 1 year workmanship, 2 year systems, 10 year structural. Use builder contract.'
  )
  -- The legal description only for some, so one approved home shows it missing.
  || case when h.unparsed_address in ('1266 Bur Oak Ct', '424 Bluestem Way') then '{}'::jsonb
     else jsonb_build_object('LegalDescription',
       (select c.name from public.communities c where c.id = h.community_id) || ', Block ' || split_part(h.lot_number, '-', 1) || ', Lot ' || ltrim(split_part(h.lot_number, '-L', 2), '0'))
     end
from public.homes h
where h.workflow_status in ('approved_for_mls', 'live_on_mls') and h.deleted_at is null
on conflict (home_id) do nothing;

-- A sample "Update the MLS" task: the builder dropped a live price and added a photo.
update public.homes set list_price = list_price - 5000, public_remarks = public_remarks || ' Now with an upgraded kitchen island.'
where unparsed_address = '1236 Pecan Ridge Dr' and public_remarks not like '%upgraded kitchen island%';
insert into public.media (builder_id, home_id, title, kind, room, source, demo_key, sort_order, mls_ready)
select h.builder_id, h.id, '1236 Pecan Ridge Dr: upgraded kitchen island', 'photo', 'kitchen', 'demo', 'room:kitchen', 20, true
from public.homes h
where h.unparsed_address = '1236 Pecan Ridge Dr'
  and not exists (select 1 from public.media m where m.home_id = h.id and m.title like '%upgraded kitchen island%');
