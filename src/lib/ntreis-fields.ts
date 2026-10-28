// NTREIS (North Texas) Residential input form, in Matrix's own tab and field
// order, with Matrix's exact labels and pick-list spellings. Read from a blank
// Matrix form on 26 Oct 2026; the full list is docs/ntreis-residential-fields.md.
//
// One list drives two screens:
//   - "Add a home" and the home page ask the builder every field marked `ask`.
//   - Our team's MLS sheet shows every field here, in this order.
//
// Keys are RESO names (or our own names for NTREIS-only fields) so the MLS
// feed lines up. Where a value lives:
//   home       a column on homes
//   builder    homes.mls_fields (the builder's answers)
//   detail     mls_details for this home (our team)
//   community  mls_details for the community (shared defaults)
//   derived    worked out from other values (shown, not stored)

import type { DeriveContext, MlsSection } from "@/lib/mls-fields";

const YN = ["Yes", "No"];

// Matrix's street types (Street Type pick-list) and the abbreviations builders type.
const STREET_TYPES = ["Alley", "Avenue", "Bend", "Bluff", "Boulevard", "Branch", "ByPass", "Circle", "Cliff", "Annex", "Corner", "Court", "Cove", "Creek", "Crest", "Crossing", "Drive", "Expressway", "Extension", "Freeway", "Canyon", "Gardens", "Glen", "Green", "Grove", "Heights", "Highway", "Hill", "Hollow", "Junction", "Knoll", "Falls", "Landing", "Lane", "Loop", "Manor", "Meadows", "Mews", "Park", "Parkway", "Pass", "Forest", "Path", "Pathway", "Pike", "Place", "Plaza", "Point", "Pointe", "Ridge", "Road", "Row", "Harbor", "Run", "Shore", "Springs", "Spur", "Square", "Street", "Terrace", "Trace", "Trail", "Turn", "Lake", "Valley", "Viaduct", "View", "Village", "Ville", "Vista", "Walk", "Way", "Lakes", "Meadow", "Station"];
const STREET_ABBR: Record<string, string> = {
  aly: "Alley", ave: "Avenue", av: "Avenue", bnd: "Bend", blf: "Bluff", blvd: "Boulevard", br: "Branch", cir: "Circle", clf: "Cliff",
  cor: "Corner", ct: "Court", cv: "Cove", crk: "Creek", crst: "Crest", xing: "Crossing", dr: "Drive", expy: "Expressway", ext: "Extension",
  fwy: "Freeway", cyn: "Canyon", gdns: "Gardens", gln: "Glen", grn: "Green", grv: "Grove", hts: "Heights", hwy: "Highway", hl: "Hill",
  holw: "Hollow", jct: "Junction", knl: "Knoll", fls: "Falls", lndg: "Landing", ln: "Lane", lp: "Loop", mnr: "Manor", mdws: "Meadows",
  pkwy: "Parkway", pky: "Parkway", frst: "Forest", pl: "Place", plz: "Plaza", pt: "Point", rdg: "Ridge", rd: "Road", hbr: "Harbor",
  shr: "Shore", spgs: "Springs", sq: "Square", st: "Street", ter: "Terrace", trce: "Trace", trl: "Trail", vly: "Valley", via: "Viaduct",
  vw: "View", vlg: "Village", vl: "Ville", vis: "Vista", wy: "Way", lks: "Lakes", mdw: "Meadow", sta: "Station",
};
const DIRS: Record<string, string> = { n: "N", s: "S", e: "E", w: "W", ne: "NE", nw: "NW", se: "SE", sw: "SW", north: "N", south: "S", east: "E", west: "W" };

// Split "1214 N Pecan Ridge Dr" into Matrix's boxes: number 1214, direction N,
// name "Pecan Ridge", type Drive. The last word counts as the street type only
// when it's on Matrix's list (or a common abbreviation of one).
export function parseStreet(address: unknown) {
  const words = String(address ?? "").trim().replace(/[.,]/g, "").split(/\s+/).filter(Boolean);
  const out: { number?: string; dir?: string; name?: string; type?: string; dirSuffix?: string } = {};
  if (words.length < 2 || !/^\d+[A-Za-z]?$/.test(words[0])) return out;
  out.number = words.shift();
  if (words.length > 1 && DIRS[words[0].toLowerCase()]) out.dir = DIRS[words.shift()!.toLowerCase()];
  if (words.length > 1 && DIRS[words[words.length - 1].toLowerCase()]) out.dirSuffix = DIRS[words.pop()!.toLowerCase()];
  if (words.length > 1) {
    const last = words[words.length - 1].toLowerCase();
    const type = STREET_ABBR[last] ?? STREET_TYPES.find((t) => t.toLowerCase() === last);
    if (type) {
      out.type = type;
      words.pop();
    }
  }
  out.name = words.join(" ");
  return out;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

function lotRange(acres: number | null) {
  if (acres === null || Number.isNaN(acres)) return null;
  if (acres === 0) return "Zero Lot";
  if (acres < 0.5) return "< .5 Acre (not Zero)";
  if (acres < 1) return ".5 to < 1 Acre";
  if (acres < 3) return "1 to < 3 Acres";
  if (acres < 5) return "3 to < 5 Acres";
  if (acres < 10) return "5 to < 10 Acres";
  if (acres < 50) return "10 to < 50 Acres";
  if (acres <= 100) return "50 to =< 100 Acres";
  return "Over 100 Acres";
}

const STAGE_TO_NTREIS: Record<string, string> = {
  to_be_built: "Proposed",
  under_construction: "New Construction - Incomplete",
  move_in_ready: "New Construction - Complete",
};

const LEVELS_FROM_STORIES: Record<number, string> = { 1: "One", 2: "Two" };
// Levels -> our stories column (when the builder only answered Levels).
export const STORIES_FROM_LEVELS: Record<string, number> = { One: 1, "One and One Half": 1, Two: 2, "Three Or More": 3, "Multi/Split": 2 };

const yesIfAny = (c: DeriveContext, key: string) => {
  const v = c.get(key);
  return Array.isArray(v) ? (v.length ? "Yes" : "No") : null;
};

export const NTREIS_SECTIONS: MlsSection[] = [
  {
    title: "Property info",
    fields: [
      { key: "PropertySubType", label: "Property Sub Type", source: "builder", ask: true, type: "select", required: true, preset: "Single Family Residence",
        options: ["Single Family Residence", "Condominium", "Townhouse", "Mobile Home", "Manufactured Home", "Farm/Ranch"],
        help: "A detached new home is Single Family Residence. Townhouse: shares a wall and the buyer owns the land under it. Condominium: the buyer owns the unit but not the land." },
      { key: "PropertyAttachedYN", label: "Property Attached YN", source: "builder", ask: true, type: "yesno", options: YN, required: true, preset: "No",
        help: "Yes only if the home shares a wall with another home (townhomes, duplexes). Detached homes: No." },
      { key: "ListingAgreement", label: "Listing Agreement Type", source: "detail", type: "select", required: true,
        options: ["Exclusive Right To Sell", "Exclusive Right With Exception", "Exclusive Agency", "Exclusive Agency with Reservation", "Exclusive Right To Lease"] },
      { key: "TransactionType", label: "Transaction Type", source: "derived", type: "select", required: true, options: ["For Sale", "For Sale/Lease"], derive: () => "For Sale" },
      { key: "SeniorCommunityYN", label: "Adult Community YN", source: "community", type: "yesno", options: YN },
      { key: "WillSubdivide", label: "Will Subdivide YN", source: "derived", type: "select", required: true, options: ["Yes", "No", "Subdivided"], derive: () => "No" },
      { key: "AccessoryUnitYN", label: "Accessory Unit YN", source: "builder", ask: true, type: "yesno", options: YN,
        help: "A second, separate living space on the lot, like a casita or garage apartment. A guest bedroom inside the house doesn't count." },
      { key: "AccessoryUnitType", label: "Accessory Unit Type", source: "builder", ask: true, type: "select", options: ["Accessory Dwelling Unit (AdU)", "Guest Quarters", "Pool House", "Other"],
        help: "Only if you answered Yes above." },
      { key: "AccessoryUnitSqFt", label: "Accessory Unit SqFt", source: "builder", ask: true, type: "number", help: "Only if you answered Yes above." },
      { key: "StructureType", label: "Housing Type", source: "builder", ask: true, type: "multi", required: true, preset: ["Single Detached"],
        options: ["Apartment", "Attached or 1/2 Duplex", "Condo/Townhome", "Designated Historical Home", "Farm/Ranch House", "Garden/Zero Lot Line", "Hi Rise", "Historical/Conservation Dist.", "Interval Ownership", "Lake House", "Log Cabin", "Manufactured (certificate exch)", "Mobile Doublewide w/Land", "Mobile Singlewide w/Land", "Resort Property", "Single Detached", "Underground", "Vacation Home"],
        help: "For a typical detached new home, pick only Single Detached. Garden/Zero Lot Line means the house is built right on one side property line." },
      { key: "ConstructionMaterials", label: "Construction Material", source: "builder", ask: true, type: "multi",
        options: ["Aluminum Siding", "Block", "Board & Batten Siding", "Brick", "Cedar", "Concrete", "Fiber Cement", "Fiberglass Siding", "Frame", "Log", "Metal Siding", "Plaster", "Radiant Barrier", "Rock/Stone", "Siding", "Steel Siding", "Stone Veneer", "Stucco", "Tilt Wall", "Unknown", "Vinyl Siding", "Wood", "See Remarks", "Other"],
        help: "What the outside walls are made of; pick all that apply. HardiePlank is Fiber Cement. Thin stone accents are Stone Veneer; full stone is Rock/Stone." },
      { key: "ArchitecturalStyle", label: "Architectural Style", source: "builder", ask: true, type: "multi",
        options: ["A-Frame", "Barndominium", "Colonial", "Contemporary/Modern", "Craftsman", "Early American", "English", "French", "Geo/Dome", "Loft", "Mediterranean", "Mid-Century Modern", "Modern Farmhouse", "Oriental", "Prairie", "Ranch", "Southwestern", "Spanish", "Split Level", "Studio", "Traditional", "Tudor", "Victorian", "Other"],
        help: "Optional. Most production homes here are Traditional; Modern Farmhouse and Craftsman are also common." },
      { key: "PropertyCondition", label: "Year Built Details/Construc. Status", source: "derived", type: "select",
        options: ["Preowned", "New Construction - Complete", "New Construction - Incomplete", "Proposed", "Unknown"],
        derive: (c) => STAGE_TO_NTREIS[String(c.home.build_stage)] ?? null, hint: "From the home's build stage." },
      { key: "EstimatedCompletion", label: "Estimated Completion Date", source: "home", column: "estimated_completion", ask: true, type: "date",
        help: "When the home will be finished. Leave blank if it's already move-in ready." },
      { key: "ListPrice", label: "List Price", source: "home", column: "list_price", ask: true, type: "money", required: true,
        help: "Whole dollars, no cents. Matrix enters prices in thousands; our team converts it." },
      { key: "ListingContractDate", label: "List Date", source: "detail", type: "date", required: true },
      { key: "ExpirationDate", label: "Expire Date", source: "detail", type: "date", required: true },
      { key: "YearBuilt", label: "Year Built", source: "home", column: "year_built", ask: true, type: "number", required: true,
        help: "For a home still being built, the year it will be finished." },
      { key: "YearBuiltSource", label: "Year Built Source", source: "derived", type: "select",
        options: ["Appraiser", "Assessor", "Builder", "Estimated", "Owner", "Public Records", "See Remarks", "Other"], derive: () => "Builder" },
      { key: "LivingArea", label: "SqFt/Living Area", source: "home", column: "living_area", ask: true, type: "number", required: true,
        help: "Heated and cooled square feet only. Don't count the garage or covered patios." },
      { key: "LivingAreaSource", label: "SqFt Source", source: "builder", ask: true, type: "select", preset: "Builder",
        options: ["Appraiser", "Assessor", "Builder", "Other", "Owner", "Plans", "Public Records", "See Remarks"],
        help: "Where the square footage comes from. For a new home, Builder (or Plans, if it's straight from the floor plan)." },
      { key: "ParcelNumber", label: "Parcel ID", source: "builder", ask: true, type: "text", required: true,
        help: "The county appraisal district's property ID for this lot (search the address or lot on the CAD website). If the lot doesn't have one yet, leave it blank and our team will look it up." },
      { key: "AdditionalParcelsYN", label: "Multi Parcel ID YN", source: "builder", ask: true, type: "yesno", options: YN, required: true, preset: "No",
        help: "Yes only if the home sits on more than one tax parcel. Almost always No." },
      { key: "AdditionalParcelsDescription", label: "Additional Parcel ID", source: "builder", ask: true, type: "text", help: "Only if you answered Yes above." },
    ],
  },
  {
    title: "Location and schools",
    fields: [
      { key: "StreetNumber", label: "Street/Box Number", source: "derived", type: "text", required: true, derive: (c) => parseStreet(c.home.unparsed_address).number, hint: "From the street address." },
      { key: "StreetDirPrefix", label: "Street Dir", source: "derived", type: "text", derive: (c) => parseStreet(c.home.unparsed_address).dir },
      { key: "StreetName", label: "Street Name", source: "derived", type: "text", required: true, derive: (c) => parseStreet(c.home.unparsed_address).name },
      { key: "StreetSuffix", label: "Street Type", source: "derived", type: "text", derive: (c) => parseStreet(c.home.unparsed_address).type },
      { key: "StreetDirSuffix", label: "Street Dir/Suffix", source: "derived", type: "text", derive: (c) => parseStreet(c.home.unparsed_address).dirSuffix },
      { key: "StateOrProvince", label: "State", source: "derived", type: "text", required: true, derive: () => "Texas" },
      { key: "CountyOrParish", label: "County/Parish", source: "derived", type: "text", required: true, derive: (c) => c.home.communities?.county ?? null },
      { key: "City", label: "City", source: "home", column: "city", type: "text", required: true },
      { key: "PostalCode", label: "Zip", source: "home", column: "postal_code", type: "text", required: true },
      { key: "Lot", label: "Lot", source: "builder", ask: true, type: "text", help: "The lot number on the plat (the recorded subdivision map), e.g. 12." },
      { key: "TaxBlock", label: "Tax Block", source: "builder", ask: true, type: "text", help: "The block letter or number on the plat, e.g. B." },
      { key: "SubdivisionName", label: "Subdivision", source: "community", type: "text", required: true, hint: "The legal plat name on the deed, which can differ from the marketing name.",
        derive: (c) => c.home.communities?.name ?? null },
      { key: "LegalDescription", label: "Additn'l Legal Desc.", source: "builder", ask: true, type: "text",
        help: "Only extra legal wording beyond lot, block and subdivision, such as a phase or section. Usually blank." },
      { key: "HighSchoolDistrict", label: "School District", source: "community", type: "text", required: true },
      { key: "ElementarySchool", label: "Elementary School Name", source: "community", type: "text" },
      { key: "MiddleOrJuniorSchool", label: "Junior High School Name", source: "community", type: "text", hint: "Some districts use Middle School Name instead; enter the school in whichever box Matrix shows." },
      { key: "HighSchool", label: "Senior High School Name", source: "community", type: "text" },
    ],
  },
  {
    title: "Rooms",
    fields: [
      { key: "BedroomsTotal", label: "# Bedrooms", source: "home", column: "bedrooms_total", ask: true, type: "number", required: true },
      { key: "BathroomsFull", label: "# Full Baths", source: "home", column: "bathrooms_full", ask: true, type: "number", required: true,
        help: "A full bath has a shower or tub." },
      { key: "BathroomsHalf", label: "# Half Baths", source: "home", column: "bathrooms_half", ask: true, type: "number", required: true,
        help: "A half bath has a toilet and sink but no shower or tub. Enter 0 if none." },
      { key: "Levels", label: "Levels", source: "builder", ask: true, type: "select", required: true,
        options: ["One", "One and One Half", "Two", "Three Or More", "Multi/Split"],
        help: "Number of stories. One and One Half: mostly one story with a small upstairs, like a single game room or bonus room.",
        derive: (c) => LEVELS_FROM_STORIES[Number(c.home.stories)] ?? (Number(c.home.stories) >= 3 ? "Three Or More" : null) },
      { key: "LivingAreasTotal", label: "# Living Areas", source: "builder", ask: true, type: "number", required: true,
        help: "Count each separate living space: family room, game room, media room, an open loft. A two-story with a family room and game room has 2." },
      { key: "DiningAreasTotal", label: "# Dining Areas", source: "builder", ask: true, type: "number", required: true,
        help: "Count the formal dining room and the breakfast or kitchen eating area separately. One open dining area is 1." },
    ],
  },
  {
    title: "Features",
    fields: [
      { key: "AccessibilityFeaturesYN", label: "Accessibility Features YN", source: "derived", type: "yesno", options: YN, required: true,
        derive: (c) => yesIfAny(c, "AccessibilityFeatures") ?? "No", hint: "Yes when any accessibility feature is picked." },
      { key: "AccessibilityFeatures", label: "Accessibility Features", source: "builder", ask: true, type: "multi",
        options: ["Approach with Ramp", "Accessible Bath - Full", "Accessible Bath - Half+Hall", "Accessible Bedroom", "Accessible Doors", "Elec. & Env. Controls", "Accessible Elevator Installed", "Accessible Entrance", "Hearing-Impairment", "Accessible Grip", "Accessible Hallway(s)", "Accessible Kitchen", "Customized Wheelchair Acc", "Meets ADA Requirements", "Smart Technology", "Stair Lift"],
        help: "Only features built specifically for accessibility. Leave it all unchecked if there are none; the MLS then shows No." },
      { key: "InteriorFeatures", label: "Interior Features", source: "builder", ask: true, type: "multi", required: true,
        options: ["Built-in Features", "Built-in Wine Cooler", "Cable TV Available", "Cathedral Ceiling(s)", "Cedar Closet(s)", "Central Vacuum", "Chandelier", "Decorative Lighting", "Double Vanity", "Dry Bar", "Dumbwaiter", "Eat-in Kitchen", "Elevator", "Flat Screen Wiring", "Granite Counters", "High Speed Internet Available", "In-Law Suite Floorplan", "Kitchen Island", "Loft", "Multiple Staircases", "Natural Woodwork", "Open Floorplan", "Other", "Paneling", "Pantry", "Smart Home System", "Sound System Wiring", "Tile Counters", "Vaulted Ceiling(s)", "Wainscoting", "Walk-In Closet(s)", "Wet Bar", "Wired for Data", "Second Primary Bedroom"],
        help: "Pick at least one. NTREIS has no Quartz option: for quartz counters, pick the features that fit (like Kitchen Island) and mention quartz in the description." },
      { key: "SecurityFeatures", label: "Security Features", source: "builder", ask: true, type: "multi",
        options: ["Burglar", "Carbon Monoxide Detector(s)", "Fire Alarm", "Fire Sprinkler System", "Firewall(s)", "Gated Community", "Key Card Entry", "Prewired", "Security Gate", "Security Guard", "Security Lights", "Security Service", "Security System", "Security System Leased", "Security System Owned", "Smoke Detector(s)", "Unknown", "Wireless", "Other"],
        help: "Most new homes have Smoke Detector(s) and Carbon Monoxide Detector(s). Prewired means wired for an alarm that isn't installed." },
      { key: "LaundryFeatures", label: "Laundry Features", source: "builder", ask: true, type: "multi",
        options: ["Dryer - Electric Hookup", "Dryer - Gas Hookup", "In Garage", "In Hall", "In Kitchen", "In Utility Room", "Laundry Chute", "W/D - Full Size W/D Area", "W/D - Stacked W/D Area", "Dryer Hookup", "Washer Hookup", "Other", "On Site", "None"],
        help: "Where the laundry is and which hookups it has. A separate laundry room is In Utility Room." },
      { key: "SmartHomeFeaturesYN", label: "Smart Home Features YN", source: "builder", ask: true, type: "yesno", options: YN, required: true,
        help: "Yes if smart-home tech comes with the home, like a smart thermostat, smart locks, video doorbell or a home hub." },
      { key: "PoolPrivateYN", label: "Pool on Property YN", source: "builder", ask: true, type: "yesno", options: YN, required: true, preset: "No",
        help: "A pool on this lot only. A community pool doesn't count; that's listed for the community." },
      { key: "PoolFeatures", label: "Pool Features", source: "builder", ask: true, type: "multi",
        options: ["Above Ground", "Cabana", "Diving Board", "Fenced", "Fiberglass", "Gunite", "Heated", "In Ground", "Indoor", "Infinity", "Lap", "Outdoor Pool", "Pool Cover", "Pool Sweep", "Pool/Spa Combo", "Private", "Pump", "Salt Water", "Sep. Spa/Hot Tub", "Solar Cover", "Solar Heat", "Sport", "Vinyl", "Water Feature", "Waterfall", "Other"],
        help: "Only if the home has its own pool." },
      { key: "BasementYN", label: "Basement YN", source: "builder", ask: true, type: "yesno", options: YN, required: true, preset: "No",
        help: "Rare in North Texas. No unless the home has a level below ground." },
      { key: "FoundationDetails", label: "Foundation", source: "builder", ask: true, type: "multi", preset: ["Slab"],
        options: ["Block", "Bois DArc Post", "Brick/Mortar", "Combination", "Concrete Perimeter", "Pillar/Post/Pier", "Slab", "Stone", "Other", "None"],
        help: "Nearly every new home here is Slab (a poured concrete foundation)." },
      { key: "Roof", label: "Roof", source: "builder", ask: true, type: "multi",
        options: ["Asphalt", "Built-Up", "Composition", "Concrete", "Fiber Cement", "Fiberglass", "Flat", "Metal", "Mixed", "Shake", "Shingle", "Slate", "Spanish Tile", "Synthetic", "Tar/Gravel", "Tile", "Wood", "Other"],
        help: "Standard asphalt shingles are usually entered as Composition. Add Metal if part of the roof is metal (like a porch accent)." },
      { key: "Flooring", label: "Flooring", source: "builder", ask: true, type: "multi",
        options: ["Adobe", "Bamboo", "Brick", "Brick/Adobe", "Carpet", "Ceramic Tile", "Clay", "Combination", "Concrete", "Cork", "Dirt", "Engineered Wood", "Granite", "Hardwood", "Laminate", "Linoleum", "Luxury Vinyl Plank", "Marble", "None", "Other", "Painted/Stained", "Parquet", "Pavers", "Reclaimed Wood", "See Remarks", "Simulated Wood", "Slate", "Softwood", "Stamped", "Stone", "Sustainable", "Terrazzo", "Tile", "Travertine Stone", "Varies", "Vinyl", "Wood", "Wood Under Carpet"],
        help: "Every floor type in the home. LVP is Luxury Vinyl Plank. Bathroom and laundry tile is Ceramic Tile (porcelain counts)." },
      { key: "AssociationAmenities", label: "Community Features", source: "community", type: "multi",
        options: ["Airport/Runway", "Boat Ramp", "Campground", "Club House", "Common Elevator", "Community Dock", "Community Pool", "Community Sprinkler", "Concierge", "Curbs", "Electric Car Charging Station", "Fishing", "Fitness Center", "Gated", "Golf", "Greenbelt", "Guarded Entrance", "Hangar", "Horse Facilities", "Jogging Path/Bike Path", "Lake", "Laundry", "Marina", "Park", "Perimeter Fencing", "Pickle Ball Court", "Playground", "Pool", "Racquet Ball", "Restaurant", "RV Parking", "Sauna", "Sidewalks", "Spa", "Stable(s)", "Tennis Court(s)", "Other"] },
      { key: "FireplacesTotal", label: "# Fireplaces", source: "builder", ask: true, type: "number", required: true, preset: "0",
        help: "Enter 0 if the home has no fireplace. An outdoor fireplace counts." },
      { key: "FireplaceFeatures", label: "Fireplace Features", source: "builder", ask: true, type: "multi",
        options: ["Bath", "Bedroom", "Blower Fan", "Brick", "Circulating", "Decorative", "Den", "Dining Room", "Double Sided", "Electric", "EPA Certified Wood Stove", "EPA Qualified Fireplace", "Family Room", "Fire Pit", "Freestanding", "Gas", "Gas Logs", "Gas Starter", "Glass Doors", "Great Room", "Heatilator", "Insert", "Kitchen", "Library", "Living Room", "Masonry", "Primary Bedroom", "Metal", "Outside", "Pellet Stove", "Propane", "Raised Hearth", "Recreation Room", "Sealed Combustion", "See Remarks", "See Through Fireplace", "Stone", "Ventless", "Wood Burning", "Wood Burning Stove", "Zero Clearance", "Other", "None"],
        help: "Which room it's in and what kind it is, e.g. Family Room + Gas Logs. Pick None if there's no fireplace." },
      { key: "Appliances", label: "Appliances", source: "builder", ask: true, type: "multi", required: true,
        options: ["Built-in Coffee Maker", "Built-in Gas Range", "Built-in Refrigerator", "Commercial Grade Range", "Commercial Grade Vent", "Dishwasher", "Disposal", "Dryer", "Electric Cooktop", "Electric Oven", "Electric Range", "Electric Water Heater", "Gas Cooktop", "Gas Oven", "Gas Range", "Gas Water Heater", "Ice Maker", "Indoor Grill", "Microwave", "Oven-Convection", "Oven-Double", "Plumbed For Gas in Kitchen", "Refrigerator", "Tankless Water Heater", "Trash Compactor", "Vented Exhaust Fan", "Warming Drawer", "Washer", "Water Filter", "Water Purifier", "Other", "Water Softener", "None"],
        help: "Only what's included with the home. Don't pick Refrigerator, Washer or Dryer unless they convey. Include the water heater type." },
      { key: "WindowFeatures", label: "Window Features", source: "builder", ask: true, type: "multi",
        options: ["Bay Window(s)", "Electric Shades", "Shutters", "Skylights(s)", "Window Coverings"],
        help: "Window Coverings means blinds come with the home." },
      { key: "PatioAndPorchFeatures", label: "Patio & Porch Features", source: "builder", ask: true, type: "multi",
        options: ["Awning(s)", "Covered", "Deck", "Enclosed", "Front Porch", "Glass Enclosed", "Patio", "Rear Porch", "Roof Top Deck/Patio", "Screened", "Side Porch", "Terrace", "Wrap Around", "See Remarks", "Other", "None"],
        help: "A covered back patio is Covered + Patio. Add Front Porch if there's a porch at the entry." },
      { key: "CarportSpaces", label: "# Carport Spaces", source: "builder", ask: true, type: "number", required: true, preset: "0", help: "Enter 0 if there's no carport." },
      { key: "GarageSpaces", label: "# Garage Spaces", source: "home", column: "garage_spaces", ask: true, type: "number",
        help: "How many cars the garage holds. A 2-car garage plus a 1-car tandem bay is 3." },
      { key: "CoveredSpaces", label: "# Covered Spaces (Total)", source: "derived", type: "number", required: true,
        derive: (c) => { const g = num(c.home.garage_spaces); const cp = num(c.get("CarportSpaces")); return g === null && cp === null ? null : (g ?? 0) + (cp ?? 0); },
        hint: "Garage plus carport spaces." },
      { key: "GarageYN", label: "Garage YN", source: "derived", type: "yesno", options: YN, required: true,
        derive: (c) => { const g = num(c.home.garage_spaces); return g === null ? null : g > 0 ? "Yes" : "No"; } },
      { key: "AttachedGarageYN", label: "Attached Garage YN", source: "builder", ask: true, type: "yesno", options: YN,
        help: "Yes if the garage is part of the house. No for a detached garage." },
      { key: "ParkingFeatures", label: "Parking Features", source: "builder", ask: true, type: "multi", required: true,
        options: ["Additional Parking", "Aggregate", "Alley Access", "Asphalt", "Assigned", "Attached Carport", "Basement", "Boat", "Carport", "Circular Driveway", "Porte-Cochere", "Common", "Community Structure", "Concrete", "Converted Garage", "Covered", "Deck", "Deeded", "Detached Carport", "Direct Access", "Drive Through", "Driveway", "Electric Gate", "Elec Vehicle Charging Station(s)", "Enclosed", "Epoxy Flooring", "Garage", "Garage Door Opener", "Garage Double Door", "Garage Faces Front", "Garage Faces Rear", "Garage Faces Side", "Garage Single Door", "Gated", "Golf Cart Garage", "Gravel", "Guest", "Heated Garage", "Inside Entrance", "Kitchen Level", "Leased", "Lighted", "No Garage", "None", "Off Site", "Off Street", "On Site", "On Street", "Open", "Other", "Outside", "Oversized", "Parking Lot", "Parking Pad", "Paved", "Paver Block", "Permit Required", "Private", "RV Access/Parking", "RV Carport", "RV Garage", "RV Gated", "Secured", "See Remarks", "Shared Driveway", "Side By Side", "Storage", "Tandem", "Unassigned", "Underground", "Unpaved", "Valet", "Varies by Unit", "Workshop in Garage"],
        help: "A typical new home: Garage, Garage Door Opener, Garage Faces Front (or Rear for alley-load, Side for a side-entry garage), Driveway and Concrete. Add Alley Access for rear-entry homes." },
      { key: "SpecialNotes", label: "Special Notes", source: "detail", type: "multi",
        options: ["Aerial Photo", "Affordable Housing", "Age-Restricted", "Agent Related to Owner", "Build to Suit", "Deed Restrictions", "Deep Hole Test", "Environ. Study Complete", "Feasibility Study Available", "Flood Plain", "Flowage Easement", "Highline", "Historical", "HUD", "Inland/Wetland Restrictions", "Meets ADA Guidelines", "Owner/ Agent", "Perc Test", "Phase I Complete", "Phase II Complete", "Pipeline", "Res. Service Contract", "Right of First Refusal", "Section 8 Qualified", "Special Assessments", "Special Contracts/Provisions", "Survey Available", "Utility Easement", "Verify Flood Insurance", "Verify Rollback Tax", "Verify Tax Exemptions", "Other"] },
    ],
  },
  {
    title: "Lot info",
    fields: [
      { key: "LotSizeArea", label: "Lot Size Area", source: "home", column: "lot_size_acres", ask: true, type: "number", required: true,
        help: "In acres, from the plat. 1 acre is 43,560 sq ft, so a 7,000 sq ft lot is 0.161." },
      { key: "LotSizeUnits", label: "Lot Size Unit", source: "derived", type: "select", required: true, options: ["Acres", "Square Feet"],
        derive: (c) => (num(c.home.lot_size_acres) === null ? null : "Acres"), hint: "We always enter lot size in acres." },
      { key: "LotSizeDimensions", label: "Lot Dimensions", source: "builder", ask: true, type: "text", help: "Width x depth in feet from the plat, e.g. 50 x 120." },
      { key: "LotSizeSource", label: "Lot Size Source", source: "builder", ask: true, type: "select", preset: "Plans",
        options: ["Appraiser", "Assessor", "Builder", "Estimated", "Owner", "Plans", "Public Records", "See Remarks", "Other"],
        help: "Where the lot size comes from. Plans if it's from the plat or site plan." },
      { key: "LotSizeRange", label: "Lot Size (Acreage)", source: "derived", type: "select", required: true,
        options: ["< .5 Acre (not Zero)", ".5 to < 1 Acre", "1 to < 3 Acres", "3 to < 5 Acres", "5 to < 10 Acres", "10 to < 50 Acres", "50 to =< 100 Acres", "Over 100 Acres", "Condo/Townhome Lot", "Zero Lot"],
        derive: (c) => lotRange(num(c.home.lot_size_acres)), hint: "Picked from the lot size." },
      { key: "LotFeatures", label: "Lot Features", source: "builder", ask: true, type: "multi",
        options: ["Acreage", "Adjacent to Greenbelt", "Agricultural", "Airstrip", "Bayou", "Bottom", "Brush", "Cleared", "Corner Lot", "Cul-De-Sac", "Few Trees", "Flag Lot", "Greenbelt", "Gullies", "Hilly", "Interior Lot", "Irregular Lot", "Landscaped", "Leasehold", "Level", "Lrg. Backyard Grass", "Many Trees", "Cedar", "Mesquite", "Oak", "Pine", "Shinnery", "Need Fill", "No Backyard Grass", "On Golf Course", "Other", "Park View", "Pasture", "Rock Outcropping", "Rolling Slope", "Rugged", "Sloped", "Sprinkler System", "Steep Slope", "Subdivision", "Swamp", "Tank/ Pond", "Taxi-way", "Undivided", "Varied", "Water/Lake View", "Waterfront", "Zero Lot Line"],
        help: "Common picks: Interior Lot or Corner Lot, Subdivision, Landscaped, Sprinkler System. Cul-De-Sac if it's on one." },
      { key: "ExteriorFeatures", label: "Exterior Features", source: "builder", ask: true, type: "multi",
        options: ["Attached Grill", "Awning(s)", "Balcony", "Barbecue", "Basketball Court", "Boat Slip", "Built-in Barbecue", "Courtyard", "Covered Courtyard", "Covered Deck", "Covered Patio/Porch", "Dock", "Dog Run", "Electric Grill", "Fire Pit", "Garden(s)", "Gas Grill", "Gray Water System", "Rain Gutters", "Kennel", "Lighting", "Misting System", "Mosquito Mist System", "Outdoor Grill", "Outdoor Kitchen", "Outdoor Living Center", "Outdoor Shower", "Permeable Paving", "Playground", "Private Entrance", "Private Landing Strip", "Private Yard", "Putting Green", "Rain Barrel/Cistern(s)", "RV Hookup", "RV/Boat Parking", "Sport Court", "Stable/Barn", "Storage", "Storm Cellar", "Tennis Court(s)", "Uncovered Courtyard", "Other"],
        help: "Things outside the house, e.g. Covered Patio/Porch, Rain Gutters, Private Yard. Gas line for a grill is Gas Grill only if the grill is included." },
      { key: "Fencing", label: "Type of Fence", source: "builder", ask: true, type: "multi",
        options: ["Back Yard", "Barbed Wire", "Block", "Brick", "Chain Link", "Cross Fenced", "Electric", "Fenced", "Front Yard", "Full", "Gate", "High Fence", "Invisible", "Masonry", "Metal", "Net", "Partial", "Partial Cross", "Perimeter", "Pipe", "Privacy", "Rock/Stone", "Security", "Split Rail", "Vinyl", "Wire", "Wood", "Wrought Iron", "Other", "None"],
        help: "Pick where it is and what it's made of. A standard 6-foot wood back fence is Back Yard + Privacy + Wood. Pick None if it isn't fenced." },
      { key: "WaterfrontYN", label: "Waterfront YN", source: "builder", ask: true, type: "yesno", options: YN, required: true, preset: "No",
        help: "Yes only if the lot itself touches a lake, river, creek or pond. A view of water isn't waterfront." },
    ],
  },
  {
    title: "Utilities",
    fields: [
      { key: "Utilities", label: "Street/Utilities", source: "community", type: "multi", required: true,
        options: ["Aerobic Septic", "All Weather Road", "Alley", "Asphalt", "Cable Available", "City Sewer", "City Water", "Co-op Electric", "Co-op Membership Included", "Co-op Water", "Community Mailbox", "Concrete", "Curbs", "Dirt", "Electricity Available", "Electricity Connected", "Electricity Not Available", "Gravel/Rock", "Individual Gas Meter", "Individual Water Meter", "Master Gas Meter", "Master Water Meter", "MUD Sewer", "MUD Water", "Natural Gas Available", "Outside City Limits", "Overhead Utilities", "Phone Available", "Private Road", "Private Sewer", "Private Water", "Propane", "Rural Water District", "Septic", "Sewer Available", "Sewer Not Available", "Sewer Tap Fee Paid", "Sidewalk", "Underground Utilities", "Unincorporated", "Water Tap Fee Paid", "Well", "See Remarks", "No City Services", "No Sewer", "No Water", "Other", "None"],
        hint: "NTREIS puts water, sewer, street and utilities in this one list. Include City Water/City Sewer or MUD Water/MUD Sewer here." },
      { key: "Heating", label: "Heating", source: "builder", ask: true, type: "multi",
        options: ["Active Solar", "Central", "Electric", "ENERGY STAR Equipment", "ENERGY STAR Installation", "Fireplace Insert", "Fireplace(s)", "Floor Furnance", "Gas Jets", "Geothermal", "Heat Pump", "Humidity Control", "Natural Gas", "Oil", "Passive Solar", "Pellet Stove", "Propane", "Solar", "Space Heater", "Wall Furnace", "Wood Stove", "Zoned", "Other", "None", "Radiant Heat Floors"],
        help: "Usually Central plus the fuel: Natural Gas, or Electric (add Heat Pump if it has one). Zoned if upstairs and downstairs have separate thermostats." },
      { key: "Cooling", label: "Cooling", source: "builder", ask: true, type: "multi",
        options: ["Attic Fan", "Ceiling Fan(s)", "Central Air", "Electric", "ENERGY STAR Qualified Equipment", "Evaporative Cooling", "Gas", "Geothermal", "Heat Pump", "Humidity Control", "Multi Units", "Roof Turbine(s)", "Wall Unit(s)", "Wall/Window Unit(s)", "Window Unit(s)", "Zoned", "Other", "None"],
        help: "Usually Central Air + Electric. Add Ceiling Fan(s) if fans are installed, and Zoned for separate upstairs and downstairs systems." },
      { key: "MudDistrictYN", label: "MUD District YN", source: "derived", type: "yesno", options: YN, required: true,
        derive: (c) => { const d = c.get("SpecialDistrict"); return d ? (String(d).includes("MUD") ? "Yes" : "No") : null; }, hint: "From the community's MUD or PID answer." },
      { key: "SpecialTaxingAuthorityYN", label: "Special Taxing Authority YN", source: "community", type: "yesno", options: YN },
      { key: "PublicImprovementDistrictYN", label: "Public Improvement District YN", source: "derived", type: "yesno", options: YN, required: true,
        derive: (c) => { const d = c.get("SpecialDistrict"); return d ? (String(d).includes("PID") ? "Yes" : "No") : null; }, hint: "From the community's MUD or PID answer." },
      { key: "SpecialDistrict", label: "MUD or PID", source: "community", type: "select", options: ["None", "MUD", "PID", "MUD and PID"], required: true,
        hint: "Texas special taxing districts must be disclosed. Fills the two Yes/No fields above." },
    ],
  },
  {
    title: "Green features",
    fields: [
      { key: "GreenEnergyEfficient", label: "Green Energy Features", source: "builder", ask: true, type: "multi",
        options: ["12 inch+ Attic Insulation", "Appliances", "Construction", "Doors", "Drought Tolerant Plants", "Energy Recovery Ventilator", "Enhanced Air Filtration", "ET Irrigation Control", "Exposure/Shade", "Geo-thermal HVAC", "Other", "HVAC", "Incentives", "Insulation", "Lighting", "Low Flow Commode", "Mechanical Fresh Air", "Rain / Freeze Sensors", "Rain Water Catchment", "Roof", "Solar Electric System", "Solar Electric System - Leased", "Solar Electric System - Owned", "Solar Hot Water", "Thermostat", "Waterheater", "Windows"],
        help: "Optional. Energy-saving parts of the home, e.g. HVAC, Insulation, Windows, Thermostat. Spray foam counts as Insulation." },
      { key: "GreenBuildingVerificationType", label: "Building Verification", source: "builder", ask: true, type: "select",
        options: ["Certified Passive House", "ENERGY STAR Certified Homes", "EnerPHit", "Green Built N. TX", "HERS Index Score", "Home Energy Score", "Home Energy Upgrade Cert of Energy Efficiency Improvements", "Home Energy Upgrade Cert of Energy Efficiency Performance", "Home Performance with ENERGY STAR", "Indoor airPLUS", "LEED For Homes", "Living Building Challenge", "NGBP-National Green", "NGBS New Construction", "NGBS Small Projects Remodel", "NGBS Whole-Home Remodel", "PHIUS+", "WaterSense", "Zero Energy Ready Home", "Pearl Certification"],
        help: "Only if the home has a third-party energy rating or certificate. Most builders with a HERS rating pick HERS Index Score." },
      { key: "GreenVerificationRating", label: "Rating", source: "builder", ask: true, type: "text",
        help: "The score from the certificate, e.g. a HERS score of 52. Lower HERS scores are better." },
      { key: "GreenVerificationStatus", label: "Status", source: "builder", ask: true, type: "select", options: ["Complete", "In Process"],
        help: "In Process if the rating is projected and the final test isn't done yet." },
    ],
  },
  {
    title: "Financial",
    fields: [
      { key: "ListingTerms", label: "Listing Terms (Proposed Financing)", source: "builder", ask: true, type: "multi",
        options: ["1031 Exchange", "All Incl Trust Deed", "Assumable", "Cash", "Contact Agent", "Contract", "Conventional", "Convl Assumable", "Escalating", "Existing Bonds", "Federal Land Bank", "FHA", "FHA Assumable", "FHA-203K", "Fixed", "FMHA", "Land Use Fee", "Lease Back", "Lease Option", "Lease Purchase", "Lien Release", "Not Assumable", "Owner Carry 2nd", "Owner Will Carry", "Priv Financing Avail", "Relo Property", "Seller Equity Share", "Special Funding", "Submit", "Texas Vet", "Trade", "Trust Conveyance", "Trust Deed", "TX VET Assumable", "USDA Loan", "VA Assumable", "VA Loan", "VA Reinstmt Reqd", "Other"],
        help: "Ways a buyer can pay that you accept. Typical: Cash, Conventional, FHA, VA Loan. Don't list incentives or rates here." },
      { key: "Possession", label: "Possession", source: "builder", ask: true, type: "multi", required: true,
        options: ["30-60 Days", "60-90 Days", "Closing/Funding", "Lease Outstanding", "Negotiable", "Specific Date", "Subject to Lease", "Upon Completion", "Other"],
        help: "When the buyer gets the keys. Finished home: Closing/Funding. Still being built: Upon Completion." },
      { key: "ExistingLoanType", label: "Loan Type", source: "derived", type: "select", required: true, options: ["Assumable Non Qualifying", "Assumable Qualifying", "Treat As Clear"], derive: () => "Treat As Clear" },
      { key: "SecondMortgageYN", label: "Second Mortgage YN", source: "derived", type: "yesno", options: YN, required: true, derive: () => "No" },
    ],
  },
  {
    title: "HOA",
    fields: [
      { key: "AssociationYN", label: "Has an HOA", source: "community", type: "yesno", options: YN, hint: "Ours, not an NTREIS box: fills HOA Type below." },
      { key: "AssociationType", label: "HOA Type", source: "community", type: "select", options: ["Mandatory", "Voluntary", "None"], required: true,
        derive: (c) => { const yn = c.get("AssociationYN"); return yn === "Yes" ? "Mandatory" : yn === "No" ? "None" : null; }, hint: "Mandatory when the community has an HOA, unless set otherwise." },
      { key: "AssociationFeeFrequency", label: "HOA Billing Frequency", source: "community", type: "select",
        options: ["Annually", "Bi-Monthly", "Bi-Weekly", "Daily", "Monthly", "One Time", "Quarterly", "Seasonal", "Semi-Annual", "Semi-Monthly", "Weekly", "Other"] },
      { key: "AssociationFee", label: "HOA Dues", source: "community", type: "money" },
      { key: "AssociationName", label: "HOA Management Company", source: "community", type: "text" },
      { key: "AssociationPhone", label: "HOA Management Company Phone", source: "community", type: "text" },
      { key: "AssociationFeeIncludes", label: "HOA Includes", source: "community", type: "multi",
        options: ["Back Yard Maintenance", "Concierge", "Electricity", "Front Yard Maintenance", "Full Use of Facilities", "Gas", "Insurance", "Internet", "Maintenance Grounds", "Maintenance Structure", "Management Fees", "Pest Control", "Security", "Sewer", "Trash", "Utilities", "Water"] },
    ],
  },
  {
    title: "Showing",
    fields: [
      { key: "SpecialListingConditions", label: "Special Listing Conditions", source: "derived", type: "multi", required: true,
        options: ["Standard/Individual", "Builder", "Real Estate (Bank) Owned", "Auction", "Bankruptcy Property", "HUD Owned", "In Foreclosure", "Notice Of Default", "Probate Listing", "Short Sale", "Third Party Approval"],
        derive: () => ["Builder"] },
      { key: "ConsentToRecord", label: "Consent for Visitors to Record", source: "community", type: "multi", options: ["Audio", "Video", "None"] },
      { key: "SurveillanceDevices", label: "Notice Surveillance Devices Present", source: "builder", ask: true, type: "multi", options: ["Audio", "Video", "None"],
        help: "Cameras or recording devices in or on the home during showings (for example a video doorbell or construction camera). None if there aren't any." },
      { key: "ShowingAllowedYN", label: "Showing Allowed", source: "builder", ask: true, type: "yesno", options: YN, required: true, preset: "Yes",
        help: "No only if agents can't tour the home yet, for example while it's still being framed." },
      { key: "ShowingAttendedYN", label: "Showing Attended YN", source: "community", type: "yesno", options: YN },
      { key: "OwnerName", label: "Owner Name", source: "derived", type: "text", required: true, derive: (c) => c.home.builders?.legal_name || c.home.builders?.name?.replace(" (demo)", "") || null,
        hint: "The builder's legal company name (Admin > Onboarding), or its display name if none is set." },
      { key: "LockBoxType", label: "Lockbox Type", source: "community", type: "select", required: true,
        options: ["Blue BT LE", "Blue iBox", "Call Listing Office", "Call Seller Direct", "Combo", "SentriLock", "Supra", "See Remarks", "Other", "None"] },
      { key: "LockBoxSerialNumber", label: "Key Box Number", source: "builder", ask: true, type: "text", required: true,
        help: "The serial number on this home's lockbox. If agents pick up keys at the model home instead, type None." },
      { key: "LockBoxLocation", label: "Lock Box Location", source: "builder", ask: true, type: "text", help: "Where agents find it, e.g. Front door or Garage keypad side." },
      { key: "AccessCode", label: "Access/Gate Code", source: "community", type: "text" },
      { key: "OccupantType", label: "Occupant Type", source: "derived", type: "select", options: ["Owner", "Tenant", "Vacant"], derive: () => "Vacant" },
      { key: "ShowingRequirements", label: "Showing Requirements", source: "community", type: "multi", required: true,
        options: ["24 Hour Notice", "Appointment Only", "Call-Key Box", "Combination Lock Box", "Courtesy Call (Appt Svc Only)", "Day Sleeper", "Email Listing Agent", "Go (Appt Svc Only)", "Go - Key Box", "Go Show-No Appt. Needed", "Key In Office", "Occupied", "Pet(s) on Premises", "Restricted Hours", "Security System", "Showing Service", "Special", "To Be Built", "Under Construction", "Virtual Showing - Call Agent", "See Remarks", "No Lock Box", "No Sign"] },
      { key: "ShowingService", label: "Showing Service(s)", source: "detail", type: "multi", required: true, options: ["BrokerBay", "ShowingTime", "None"] },
      { key: "ShowingContactType", label: "Showing Contact Type", source: "community", type: "multi",
        options: ["Showing Service", "Agent", "Builder", "Occupant", "Office", "Other", "Owner", "Property Manager"] },
      { key: "ShowingContactName", label: "Showing contact name", source: "community", type: "text", hint: "Ours, for the showing instructions; NTREIS has no name box." },
      { key: "ShowingContactPhone", label: "Showing Contact Phone", source: "community", type: "text" },
      { key: "ShowingInstructions", label: "Showing Instructions", source: "community", type: "longtext" },
    ],
  },
  {
    title: "Remarks",
    fields: [
      { key: "SyndicateTo", label: "Listing will be distributed to", source: "detail", type: "multi",
        options: ["Members IDX Websites", "Realtor.com", "Syndicate Listing", "Homes.com", "NTREIS Translator", "Realtors Property Resource"] },
      { key: "InternetAddressDisplayYN", label: "Allow Address Display", source: "derived", type: "yesno", options: YN, required: true, derive: () => "Yes" },
      { key: "InternetConsumerCommentYN", label: "Allow Comments/Reviews", source: "detail", type: "yesno", options: YN, required: true },
      { key: "InternetAutomatedValuationDisplayYN", label: "Allow AVM", source: "detail", type: "yesno", options: YN, required: true },
      { key: "InternetEntireListingDisplayYN", label: "Allow Internet Display", source: "derived", type: "yesno", options: YN, required: true, derive: () => "Yes" },
      { key: "Directions", label: "Public Driving Directions", source: "community", type: "longtext", required: true },
      { key: "PublicRemarks", label: "Property Description", source: "home", column: "public_remarks", ask: true, type: "longtext",
        hint: "No agent contact info, compensation or showing details here.",
        help: "What buyers read. Don't include phone numbers, emails, websites, showing instructions or agent pay: NTREIS fines all of these. Up to 1,000 characters." },
      { key: "Exclusions", label: "Excludes", source: "builder", ask: true, type: "longtext",
        help: "Anything in the home that doesn't come with it, like model-home furniture, decor or a TV mount. Leave blank if nothing." },
      { key: "PrivateRemarks", label: "Private Remarks", source: "detail", type: "longtext" },
    ],
  },
  {
    title: "Status",
    fields: [{ key: "StandardStatus", label: "Status", source: "detail", type: "select", required: true, options: ["Incomplete", "Active", "Coming Soon"] }],
  },
];

export const NTREIS_FIELDS = NTREIS_SECTIONS.flatMap((s) => s.fields);

// What the builder answers on "Add a home" and the home page (stored in homes.mls_fields).
export const NTREIS_BUILDER_FIELDS = NTREIS_FIELDS.filter((f) => f.source === "builder");

// Kept in step with mls_boards.rules.builder_required for NTREIS (migration 025).
export const NTREIS_BUILDER_REQUIRED = NTREIS_BUILDER_FIELDS.filter((f) => f.required).map((f) => f.key);
