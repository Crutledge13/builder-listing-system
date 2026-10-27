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

export function editableFields(role: Role): readonly HomeField[] {
  switch (role) {
    case "platform_admin":
    case "builder_owner":
    case "manager":
      return OWNER_MANAGER_FIELDS;
    case "sales":
      return ["list_price", "build_stage", "estimated_completion"];
    case "marketing":
      return ["public_remarks"];
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
  role: Role,
  from: WorkflowStatus,
): WorkflowStatus[] {
  if (role === "platform_admin") {
    return (["draft", "in_review", "approved_for_mls", "live_on_mls"] as const)
      .filter((s) => s !== from);
  }
  const out: WorkflowStatus[] = [];
  const builderEditor = ["builder_owner", "manager", "sales", "marketing"].includes(role);
  const approver = role === "builder_owner" || role === "manager";

  if (builderEditor && from === "draft") out.push("in_review");
  if (builderEditor && from === "in_review") out.push("draft");
  if (approver && from === "in_review") out.push("approved_for_mls");
  if (approver && from === "approved_for_mls") out.push("in_review");
  if (role === "listing_coordinator" && from === "approved_for_mls") out.push("live_on_mls");
  return out;
}

export const TRANSITION_LABELS: Record<WorkflowStatus, string> = {
  draft: "Send back to draft",
  in_review: "Submit for review",
  approved_for_mls: "Approve for MLS",
  live_on_mls: "Mark live on MLS",
};

// Who may add a new home (matches the database's insert rule).
export function canAddHomes(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

// Who may upload media and edit tags (matches the database's media rules).
// Reports: our team, owners and managers for their builder, sales for their communities.
export function canSeeReports(role: Role) {
  return ["platform_admin", "listing_coordinator", "builder_owner", "manager", "sales"].includes(role);
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
export function canShareLinks(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

// Builder logo, colors and website. Mirrors private.can_edit_branding.
export function canEditBranding(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
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
  if (role === "manager") return ["sales", "marketing"];
  return [];
}

export function canManageTeam(role: Role) {
  return role === "builder_owner" || role === "manager";
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
  if (["platform_admin", "listing_coordinator", "builder_owner", "manager"].includes(role))
    return ["active", "paused", "under_contract", "sold", "withdrawn"];
  if (role === "sales") return ["active", "under_contract", "sold"];
  return [];
}

export function canToggleDisclaimer(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

export function canScheduleOpenHouses(role: Role) {
  return ["platform_admin", "builder_owner", "manager", "sales"].includes(role);
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
