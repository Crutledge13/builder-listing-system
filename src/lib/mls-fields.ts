// Every field our team enters on the MLS, in input-screen order (NTREIS,
// North Texas). Keys are RESO standard names so the MLS feed lines up.
//
// Where a value comes from:
//   home       a column on homes (the builder's data; edit it on the home page)
//   detail     our team fills it on the MLS sheet (stored in mls_details)
//   community  shared by every home in the community (mls_details for the community);
//              a home can still override it
//   derived    worked out from other data (shown, not stored)

export type MlsSource = "home" | "detail" | "community" | "derived";
export type MlsType = "text" | "longtext" | "number" | "money" | "date" | "yesno" | "select" | "multi";

export type MlsField = {
  key: string;            // RESO name (or homes column when source = home)
  label: string;
  source: MlsSource;
  column?: string;        // homes column, when source = home
  type: MlsType;
  options?: string[];
  required?: boolean;     // the MLS won't accept the listing without it
  hint?: string;
};

export type MlsSection = { title: string; fields: MlsField[] };

const YES_NO = ["Yes", "No"];

export const MLS_SECTIONS: MlsSection[] = [
  {
    title: "Listing",
    fields: [
      { key: "ListPrice", label: "List price", source: "home", column: "list_price", type: "money", required: true },
      { key: "PropertyType", label: "Property type", source: "derived", type: "text", required: true },
      { key: "PropertySubType", label: "Property sub type", source: "detail", type: "select", options: ["Single Family Residence", "Townhouse", "Condominium"], required: true },
      { key: "NewConstructionYN", label: "New construction", source: "derived", type: "yesno", required: true },
      { key: "PropertyCondition", label: "Construction status", source: "derived", type: "text", required: true },
      { key: "EstimatedCompletion", label: "Estimated completion", source: "home", column: "estimated_completion", type: "date" },
      { key: "BuilderName", label: "Builder name", source: "derived", type: "text", required: true },
      { key: "BuilderModel", label: "Builder plan (model)", source: "home", column: "plan_name", type: "text" },
      { key: "YearBuilt", label: "Year built", source: "home", column: "year_built", type: "number", required: true },
      { key: "SpecialListingConditions", label: "Special listing conditions", source: "detail", type: "select", options: ["Standard", "Builder Owned"], required: true },
    ],
  },
  {
    title: "Location",
    fields: [
      { key: "UnparsedAddress", label: "Street address", source: "home", column: "unparsed_address", type: "text", required: true },
      { key: "City", label: "City", source: "home", column: "city", type: "text", required: true },
      { key: "StateOrProvince", label: "State", source: "derived", type: "text", required: true },
      { key: "PostalCode", label: "ZIP", source: "home", column: "postal_code", type: "text", required: true },
      { key: "CountyOrParish", label: "County", source: "derived", type: "text", required: true },
      { key: "SubdivisionName", label: "Subdivision", source: "community", type: "text", required: true, hint: "Usually the legal plat name, which can differ from the marketing name." },
      { key: "MLSAreaMajor", label: "MLS area", source: "community", type: "text", hint: "The MLS's own area code for this location." },
      { key: "LotBlock", label: "Lot and block", source: "home", column: "lot_number", type: "text" },
      { key: "LegalDescription", label: "Legal description", source: "detail", type: "longtext", required: true },
      { key: "ParcelNumber", label: "Tax ID (parcel)", source: "detail", type: "text", hint: "Often not assigned yet for new lots." },
      { key: "Directions", label: "Directions", source: "community", type: "longtext", required: true },
    ],
  },
  {
    title: "Size and rooms",
    fields: [
      { key: "BedroomsTotal", label: "Bedrooms", source: "home", column: "bedrooms_total", type: "number", required: true },
      { key: "BathroomsFull", label: "Full baths", source: "home", column: "bathrooms_full", type: "number", required: true },
      { key: "BathroomsHalf", label: "Half baths", source: "home", column: "bathrooms_half", type: "number", required: true },
      { key: "LivingArea", label: "Living area (sq ft)", source: "home", column: "living_area", type: "number", required: true },
      { key: "LivingAreaSource", label: "Square feet source", source: "detail", type: "select", options: ["Builder", "Plans", "Appraisal", "Tax"], required: true },
      { key: "LotSizeAcres", label: "Lot size (acres)", source: "home", column: "lot_size_acres", type: "number", required: true },
      { key: "StoriesTotal", label: "Stories", source: "home", column: "stories", type: "number", required: true },
      { key: "GarageSpaces", label: "Garage spaces", source: "home", column: "garage_spaces", type: "number", required: true },
      { key: "AttachedGarageYN", label: "Attached garage", source: "detail", type: "yesno", options: YES_NO },
      { key: "FireplacesTotal", label: "Fireplaces", source: "detail", type: "number" },
      { key: "PoolPrivateYN", label: "Private pool", source: "detail", type: "yesno", options: YES_NO, required: true },
    ],
  },
  {
    title: "Construction and features",
    fields: [
      { key: "ConstructionMaterials", label: "Construction", source: "detail", type: "multi", options: ["Brick", "Stone", "Fiber Cement", "Siding", "Stucco", "Frame"], required: true },
      { key: "Roof", label: "Roof", source: "detail", type: "multi", options: ["Composition", "Metal", "Tile"], required: true },
      { key: "FoundationDetails", label: "Foundation", source: "detail", type: "multi", options: ["Slab", "Pier and Beam"], required: true },
      { key: "Flooring", label: "Flooring", source: "detail", type: "multi", options: ["Carpet", "Ceramic Tile", "Luxury Vinyl Plank", "Wood", "Laminate"] },
      { key: "InteriorFeatures", label: "Interior features", source: "detail", type: "multi", options: ["Kitchen Island", "Open Floorplan", "Walk-In Closet(s)", "Pantry", "Granite Counters", "Quartz Counters", "Smart Home System"] },
      { key: "PatioAndPorchFeatures", label: "Patio and porch", source: "detail", type: "multi", options: ["Covered", "Front Porch", "Patio"] },
      { key: "Fencing", label: "Fencing", source: "detail", type: "multi", options: ["Wood", "Wrought Iron", "None"] },
      { key: "GreenEnergyEfficient", label: "Energy features", source: "detail", type: "multi", options: ["Energy Star Appliances", "HVAC", "Insulation", "Low-E Windows", "Tankless Water Heater"] },
    ],
  },
  {
    title: "Utilities",
    fields: [
      { key: "Heating", label: "Heating", source: "community", type: "multi", options: ["Central", "Electric", "Natural Gas", "Heat Pump"], required: true },
      { key: "Cooling", label: "Cooling", source: "community", type: "multi", options: ["Central Air", "Electric"], required: true },
      { key: "WaterSource", label: "Water", source: "community", type: "multi", options: ["City", "MUD", "Co-op", "Well"], required: true },
      { key: "Sewer", label: "Sewer", source: "community", type: "multi", options: ["City", "MUD", "Septic", "Aerobic Septic"], required: true },
      { key: "Utilities", label: "Utilities", source: "community", type: "multi", options: ["Electricity Connected", "Natural Gas Available", "Underground Utilities", "Cable Available", "Fiber Optic"] },
    ],
  },
  {
    title: "Schools",
    fields: [
      { key: "HighSchoolDistrict", label: "School district", source: "community", type: "text", required: true },
      { key: "ElementarySchool", label: "Elementary school", source: "community", type: "text", required: true },
      { key: "MiddleOrJuniorSchool", label: "Middle school", source: "community", type: "text", required: true },
      { key: "HighSchool", label: "High school", source: "community", type: "text", required: true },
    ],
  },
  {
    title: "HOA and taxes",
    fields: [
      { key: "AssociationYN", label: "HOA", source: "community", type: "yesno", options: YES_NO, required: true },
      { key: "AssociationName", label: "HOA name", source: "community", type: "text" },
      { key: "AssociationFee", label: "HOA fee", source: "community", type: "money" },
      { key: "AssociationFeeFrequency", label: "HOA fee paid", source: "community", type: "select", options: ["Monthly", "Quarterly", "Semi-Annually", "Annually"] },
      { key: "AssociationAmenities", label: "Community amenities", source: "community", type: "multi", options: ["Pool", "Playground", "Park", "Jogging Path/Bike Path", "Clubhouse", "Fitness Center", "Pond"] },
      { key: "SpecialDistrict", label: "MUD or PID", source: "community", type: "select", options: ["None", "MUD", "PID", "MUD and PID"], required: true, hint: "Texas special taxing districts must be disclosed." },
      { key: "TaxRate", label: "Total tax rate (%)", source: "community", type: "number" },
      { key: "TaxAnnualAmount", label: "Estimated annual taxes", source: "detail", type: "money" },
    ],
  },
  {
    title: "Remarks and showings",
    fields: [
      { key: "PublicRemarks", label: "Public remarks", source: "home", column: "public_remarks", type: "longtext", required: true, hint: "No agent contact info, compensation or showing details here." },
      { key: "PrivateRemarks", label: "Agent remarks (private)", source: "detail", type: "longtext" },
      { key: "ShowingInstructions", label: "Showing instructions", source: "community", type: "longtext", required: true },
      { key: "ShowingContactName", label: "Showing contact", source: "community", type: "text", required: true },
      { key: "ShowingContactPhone", label: "Showing contact phone", source: "community", type: "text", required: true },
    ],
  },
];

export const ALL_MLS_FIELDS = MLS_SECTIONS.flatMap((s) => s.fields);

// ---------------------------------------------------------------------------
// Each MLS asks for slightly different things. A board can relabel a field,
// make it required or not, hide it, or add fields of its own (mls_boards).
// ---------------------------------------------------------------------------
export type MlsBoard = {
  code: string;
  name: string;
  short_name: string;
  region: string;
  counties: string[];
  rules: { status_change_hours?: number; new_listing_hours?: number; min_photos?: number; min_photo_long_edge?: number; remarks_max_chars?: number; verified?: boolean; source?: string };
  field_rules: Record<string, { required?: boolean; hidden?: boolean; label?: string }>;
  extra_fields: (MlsField & { section?: string })[];
};

export const MLS_BOARD_SELECT = "code, name, short_name, region, counties, rules, field_rules, extra_fields";

export function sectionsForBoard(board: MlsBoard | null | undefined): MlsSection[] {
  if (!board) return MLS_SECTIONS;
  const rules = board.field_rules ?? {};
  const sections = MLS_SECTIONS.map((sec) => ({
    title: sec.title,
    fields: sec.fields
      .filter((f) => !rules[f.key]?.hidden)
      .map((f) => {
        const r = rules[f.key];
        return r ? { ...f, label: r.label ?? f.label, required: r.required ?? f.required } : f;
      }),
  }));
  for (const extra of board.extra_fields ?? []) {
    const target = sections.find((s) => s.title === extra.section) ?? sections[sections.length - 1];
    if (!target.fields.some((f) => f.key === extra.key)) target.fields.push({ ...extra, source: extra.source ?? "detail" });
  }
  return sections;
}

// Which MLS field a homes column feeds (for "what changed" on update tasks).
export const MLS_FIELD_FOR_COLUMN: Record<string, MlsField> = Object.fromEntries(
  ALL_MLS_FIELDS.filter((f) => f.column).map((f) => [f.column!, f]),
);
MLS_FIELD_FOR_COLUMN.build_stage = { key: "PropertyCondition", label: "Construction status", source: "derived", type: "text" };

export type HomeForMls = Record<string, unknown> & {
  id: string;
  build_stage: string;
  builders: { name: string } | null;
  communities: { name: string; county: string | null } | null;
};

export const CONDITION: Record<string, string> = {
  to_be_built: "New Construction - To Be Built",
  under_construction: "New Construction - Incomplete",
  move_in_ready: "New Construction - Complete",
};

export type ResolvedValue = { value: unknown; from: "home" | "this home" | "community" | "derived" | "missing" };

// Work out a field's value: the home's own value, else the community default,
// else what we can derive.
export function resolveField(
  f: MlsField,
  home: HomeForMls,
  homeDetails: Record<string, unknown>,
  communityDetails: Record<string, unknown>,
): ResolvedValue {
  const present = (v: unknown) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
  if (f.source === "home") {
    const v = home[f.column!];
    return present(v) ? { value: v, from: "home" } : { value: null, from: "missing" };
  }
  if (present(homeDetails[f.key])) return { value: homeDetails[f.key], from: "this home" };
  if (f.source === "community" && present(communityDetails[f.key])) return { value: communityDetails[f.key], from: "community" };
  switch (f.key) {
    case "PropertyType": return { value: "Residential", from: "derived" };
    case "NewConstructionYN": return { value: "Yes", from: "derived" };
    case "PropertyCondition": return { value: CONDITION[home.build_stage] ?? home.build_stage, from: "derived" };
    case "BuilderName": return { value: home.builders?.name.replace(" (demo)", "") ?? null, from: "derived" };
    case "StateOrProvince": return { value: "TX", from: "derived" };
    case "CountyOrParish": return home.communities?.county ? { value: home.communities.county, from: "derived" } : { value: null, from: "missing" };
    case "SubdivisionName": return home.communities?.name ? { value: home.communities.name, from: "derived" } : { value: null, from: "missing" };
  }
  return { value: null, from: "missing" };
}

export function formatMls(f: Pick<MlsField, "type">, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.join(", ");
  if (f.type === "money") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
  if (f.type === "date") {
    const d = new Date(String(v).slice(0, 10) + "T12:00:00");
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
  }
  if (f.type === "number") return String(Number(v));
  return String(v);
}

export function completeness(
  home: HomeForMls,
  homeDetails: Record<string, unknown>,
  communityDetails: Record<string, unknown>,
  sections: MlsSection[] = MLS_SECTIONS,
) {
  const required = sections.flatMap((s) => s.fields).filter((f) => f.required);
  const missing = required.filter((f) => resolveField(f, home, homeDetails, communityDetails).from === "missing");
  return { required: required.length, filled: required.length - missing.length, missing };
}

// Select for a home's MLS sheet.
export const HOME_MLS_SELECT = "*, builders(name), communities(name, county)";

// Rules that apply to every field our team types into the MLS (not just the
// builder's description): no buyer-agent compensation anywhere, no contact
// info outside agent remarks and showing instructions, and real directions.
export function sheetRuleProblems(
  sections: MlsSection[],
  home: HomeForMls,
  homeDetails: Record<string, unknown>,
  communityDetails: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  const contactOk = new Set(["PrivateRemarks", "ShowingInstructions", "ShowingContactName", "ShowingContactPhone"]);
  for (const f of sections.flatMap((x) => x.fields)) {
    if (f.type !== "text" && f.type !== "longtext") continue;
    const v = resolveField(f, home, homeDetails, communityDetails).value;
    if (typeof v !== "string" || !v) continue;
    if (/(commission|compensation|co-?broke|bonus to (the )?(buyer|selling)|\d+(\.\d+)?\s*% (to|for) (buyer|selling))/i.test(v))
      problems.push(`${f.label}: mentions agent compensation, which can’t appear in any MLS field.`);
    if (!contactOk.has(f.key) && (/\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/.test(v) || /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(v) || /(https?:\/\/|www\.)/i.test(v)))
      problems.push(`${f.label}: has contact info (phone, email or website), only allowed in agent remarks and showing instructions.`);
    if (f.key === "Directions" && /^(use )?(gps|see map|map it|google)/i.test(v.trim()))
      problems.push("Directions: must be actual directions, not “use GPS” or “see map”.");
  }
  return problems;
}
