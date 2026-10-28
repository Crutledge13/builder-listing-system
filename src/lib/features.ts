import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isStaff, type Role } from "@/lib/permissions";

// Optional features our admins can turn off per builder (Admin > Builders).
// Every builder runs on the same code; differences between builders are
// settings like these, never code that checks which builder it is.
// The database keeps the same list (builder_settings.features_off check) and
// refuses comp and reverse prospecting requests when they're off.
export const FEATURES = [
  { key: "comps", label: "Comp requests", hint: "Ask our team to pull comps for a home or area" },
  { key: "reverse_prospecting", label: "Reverse prospecting", hint: "Ask our team for a list of agents with matching buyers" },
  { key: "website_check", label: "Website check", hint: "Website, Builder Listings and MLS side by side" },
  { key: "reports", label: "Reports", hint: "Listing health, days on market, Excel download" },
  { key: "builder_tasks", label: "Tasks board", hint: "The builder’s own task board" },
] as const;

export type Feature = (typeof FEATURES)[number]["key"];

// The features a builder has turned off. Our staff and photographers aren't
// limited (staff serve every builder), so they get an empty list.
export const featuresOff = cache(async (role: Role, builderId: string | null): Promise<Set<Feature>> => {
  if (isStaff(role) || !builderId) return new Set();
  const supabase = await createClient();
  const { data } = await supabase.from("builder_settings").select("features_off").eq("builder_id", builderId).maybeSingle();
  return new Set((data?.features_off ?? []) as Feature[]);
});

export async function hasFeature(me: { role: Role; builder_id: string | null }, feature: Feature): Promise<boolean> {
  return !(await featuresOff(me.role, me.builder_id)).has(feature);
}

// For pages: send someone whose builder doesn't have this feature to their start page.
export async function requireFeature(me: { role: Role; builder_id: string | null }, feature: Feature): Promise<void> {
  if (!(await hasFeature(me, feature))) redirect("/communities");
}
