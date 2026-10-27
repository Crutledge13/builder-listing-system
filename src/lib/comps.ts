// Labels for comp requests (shared by the list and detail pages).
export const COMP_STATUS: Record<string, { label: string; style: string }> = {
  requested: { label: "Waiting on our team", style: "bg-amber-100 text-amber-900" },
  in_progress: { label: "Being pulled", style: "bg-accent-soft text-accent" },
  delivered: { label: "Ready", style: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "Cancelled", style: "bg-soft text-muted" },
};

export const COMP_TYPE: Record<string, string> = { both: "New and resale", new: "New construction only", resale: "Resale only" };
