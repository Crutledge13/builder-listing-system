// What each role may do, for showing the right buttons and fields on screen.
// The database enforces the same rules (supabase/migrations), so if these ever
// disagree, the database wins and the change is refused.

export type Role =
  | "platform_admin"
  | "listing_coordinator"
  | "builder_owner"
  | "manager"
  | "sales"
  | "marketing";

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
