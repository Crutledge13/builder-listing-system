// What each role may do, for showing the right buttons and fields on screen.
// The database enforces the same rules (supabase/migrations), so if these ever
// disagree, the database wins and the change is refused.

export type Role =
  | "platform_admin"
  | "listing_coordinator"
  | "builder_owner"
  | "manager"
  | "sales"
  | "marketing"
  | "photographer";

export type WorkflowStatus =
  | "draft"
  | "in_review"
  | "approved_for_mls"
  | "live_on_mls";

// Who is asking: a role, or the signed-in person (so the sales switches count).
// Salespeople can have "MLS entry" switched on (owners, 29 Oct 2026): for their
// assigned communities they add homes, fill in every listing detail and the
// community setup, and reorder the listing photos. "Needs marketing approval"
// (on by default) decides whether marketing approves before our team gets it.
// Mirrors private.sales_mls_on / sales_skips_approval / sales_may_edit_listing.
export type Who = Role | { role: Role; sales_mls_entry?: boolean | null; sales_needs_approval?: boolean | null };

export function roleOf(who: Who): Role {
  return typeof who === "string" ? who : who.role;
}

export function salesMlsOn(who: Who) {
  return typeof who !== "string" && who.role === "sales" && !!who.sales_mls_entry;
}

export function salesSkipsApproval(who: Who) {
  return salesMlsOn(who) && typeof who !== "string" && who.sales_needs_approval === false;
}

// May this salesperson change a home's listing details in this state? Needing
// approval locks them once it's Ready for MLS or live (they send a change request).
export function salesMayEditListing(who: Who, status?: WorkflowStatus | null) {
  if (!salesMlsOn(who)) return false;
  return salesSkipsApproval(who) || !status || status === "draft" || status === "in_review";
}

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: "Platform admin",
  listing_coordinator: "Listing coordinator",
  builder_owner: "Builder owner",
  manager: "Manager",
  sales: "Sales",
  marketing: "Marketing",
  photographer: "Photographer",
};

export const STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved_for_mls: "Ready for MLS",
  live_on_mls: "Live on MLS",
};

export const STAGE_LABELS: Record<string, string> = {
  to_be_built: "To be built",
  under_construction: "Under construction",
  move_in_ready: "Move-in ready",
};

export const HOME_FIELDS = [
  "unparsed_address",
  "city",
  "postal_code",
  "lot_number",
  "plan_name",
  "list_price",
  "bedrooms_total",
  "bathrooms_full",
  "bathrooms_half",
  "living_area",
  "lot_size_acres",
  "stories",
  "garage_spaces",
  "year_built",
  "public_remarks",
  "build_stage",
  "estimated_completion",
] as const;

export type HomeField = (typeof HOME_FIELDS)[number];

const OWNER_MANAGER_FIELDS: readonly HomeField[] = HOME_FIELDS;

// `status` is the home's listing status (matters for salespeople with MLS entry).
export function editableFields(who: Who, status?: WorkflowStatus | null): readonly HomeField[] {
  const role = roleOf(who);
  if (role === "sales" && salesMayEditListing(who, status)) return OWNER_MANAGER_FIELDS;
  switch (role) {
    case "platform_admin":
    case "builder_owner":
    case "manager":
    case "marketing":
      return OWNER_MANAGER_FIELDS;
    case "sales":
      return ["list_price", "build_stage", "estimated_completion"];
    default:
      return [];
  }
}

export function isPhotographer(role: Role) {
  return role === "photographer";
}

export function isStaff(role: Role) {
  return role === "platform_admin" || role === "listing_coordinator";
}

// Status changes this role may make from the current status.
export function allowedTransitions(
  who: Who,
  from: WorkflowStatus,
  enterOwnMls = false, // the builder enters its own listings in the MLS
): WorkflowStatus[] {
  const role = roleOf(who);
  if (role === "platform_admin") {
    return (["draft", "in_review", "approved_for_mls", "live_on_mls"] as const)
      .filter((s) => s !== from);
  }
  const out: WorkflowStatus[] = [];
  const builderEditor = ["builder_owner", "manager", "sales", "marketing"].includes(role);
  const approver = role === "builder_owner" || role === "manager" || role === "marketing";

  if (builderEditor && from === "draft") out.push("in_review");
  if (builderEditor && from === "in_review") out.push("draft");
  if (approver && from === "in_review") out.push("approved_for_mls");
  if (approver && from === "approved_for_mls") out.push("in_review");
  // Salespeople who don't need marketing's approval send it straight to our team.
  if (salesSkipsApproval(who) && (from === "draft" || from === "in_review")) out.push("approved_for_mls");
  if (salesSkipsApproval(who) && from === "approved_for_mls") out.push("draft");
  if (role === "listing_coordinator" && from === "approved_for_mls") out.push("live_on_mls");
  if (enterOwnMls && ["builder_owner", "manager", "marketing"].includes(role) && from === "approved_for_mls") out.push("live_on_mls");
  return out;
}

export const TRANSITION_LABELS: Record<WorkflowStatus, string> = {
  draft: "Send back to draft",
  in_review: "Submit for review",
  approved_for_mls: "Approve for MLS",
  live_on_mls: "Mark live on MLS",
};

// Who may add a new home (matches the database's insert rule).
export function canAddHomes(who: Who) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(roleOf(who)) || salesMlsOn(who);
}

// Reorder the listing photos and pick the cover without the rest of media
// managing (salespeople with MLS entry). Mirrors the listing_media / media rules.
export function canArrangeListing(who: Who, status?: WorkflowStatus | null) {
  return canManageMedia(roleOf(who)) || salesMayEditListing(who, status);
}

// Who may upload media and edit tags (matches the database's media rules).
// Reports: our team, owners, managers and marketing for their builder, sales for their communities.
export function canSeeReports(role: Role) {
  return ["platform_admin", "listing_coordinator", "builder_owner", "manager", "marketing", "sales"].includes(role);
}

// The builder's own to-do board. Mirrors private.on_builder_board.
export function canUseBuilderBoard(role: Role) {
  return ["builder_owner", "manager", "marketing"].includes(role);
}

// Who can ask our team for comps. Mirrors the comp_requests rules.
export function canRequestComps(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "sales", "marketing"].includes(role);
}

// Realtor share links for a home. Mirrors private.can_share.
// Add, extend and end incentives (builder, community or home).
export function canManageIncentives(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

export function canShareLinks(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

// Builder logo, colors and website. Mirrors private.can_edit_branding.
export function canEditBranding(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

// Floor plans: our team, and the builder's owners, managers and marketing for
// their own builder. Mirrors the floor_plans policies (is_staff or can_edit_branding).
export function canEditPlans(role: Role) {
  return ["platform_admin", "listing_coordinator", "builder_owner", "manager", "marketing"].includes(role);
}

export function canManageMedia(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

// Who may ask for a photo shoot (matches the database's request rules).
// Sales view and download media but don't request photo shoots.
export function canRequestMedia(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

export const NEED_LABELS: Record<string, string> = {
  photos: "Photos",
  twilight: "Twilight photos",
  video: "Walkthrough video (horizontal)",
  vertical_video: "Vertical social reel (9:16)",
  drone: "Drone or aerial",
  floor_plan: "Floor plan",
  virtual_tour: "3D virtual tour",
};

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  requested: "Needs a photographer",
  assigned: "Photographer assigned",
  scheduled: "Shoot scheduled",
  delivered: "Delivered, ready to review",
  completed: "Complete",
  cancelled: "Cancelled",
};

// ---------------------------------------------------------------------------
// Builder team management (mirrors private.can_manage_person)
// ---------------------------------------------------------------------------
export function rolesICanGive(role: Role): Role[] {
  if (role === "builder_owner") return ["builder_owner", "manager", "sales", "marketing"];
  if (role === "manager" || role === "marketing") return ["sales", "marketing"];
  return [];
}

export function canManageTeam(role: Role) {
  return role === "builder_owner" || role === "manager" || role === "marketing";
}

export function canAddCommunities(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

// ---------------------------------------------------------------------------
// Listing status on the market (mirrors enforce_home_edit_rules)
// ---------------------------------------------------------------------------
export type MarketStatus = "active" | "paused" | "under_contract" | "sold" | "withdrawn";

export const MARKET_LABELS: Record<MarketStatus, string> = {
  active: "Active",
  paused: "Paused",
  under_contract: "Under contract",
  sold: "Sold",
  withdrawn: "Off the market",
};

export function marketChoices(role: Role): MarketStatus[] {
  if (["platform_admin", "listing_coordinator", "builder_owner", "manager", "marketing"].includes(role))
    return ["active", "paused", "under_contract", "sold", "withdrawn"];
  if (role === "sales") return ["active", "under_contract", "sold"];
  return [];
}

export function canToggleDisclaimer(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

export function canScheduleOpenHouses(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing", "sales"].includes(role);
}

export function canRequestReverseProspecting(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "sales", "marketing"].includes(role);
}

export function canSeeWebsiteCheck(role: Role) {
  return ["platform_admin", "listing_coordinator", "builder_owner", "manager", "marketing"].includes(role);
}

// ---------------------------------------------------------------------------
// Our team's task board
// ---------------------------------------------------------------------------
export const TASK_KIND_LABELS: Record<string, string> = {
  mls_entry: "Enter in MLS",
  mls_update: "Update MLS",
  open_house_mls: "Open house on MLS",
  listing_status: "Listing status",
  change_request: "Change request",
  photo_request: "Photographer",
  reverse_prospecting: "Reverse prospecting",
  comps: "Comps",
  issue: "Help request",
  other: "Other",
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};
