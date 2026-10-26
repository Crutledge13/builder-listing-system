"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canAddHomes } from "@/lib/permissions";

const TEXT = ["unparsed_address", "city", "postal_code", "lot_number", "plan_name", "public_remarks", "build_stage", "estimated_completion"] as const;
const NUMBERS = ["list_price", "bedrooms_total", "bathrooms_full", "bathrooms_half", "living_area", "lot_size_acres", "stories", "garage_spaces", "year_built"] as const;

function fail(message: string): never {
  redirect(`/homes/new?${new URLSearchParams({ error: message }).toString()}`);
}

export async function createHome(formData: FormData) {
  const me = await requireProfile();
  if (!canAddHomes(me.role)) fail("Your role can’t add homes. Ask a manager or owner.");

  const supabase = await createClient();
  const communityId = String(formData.get("community_id") ?? "");
  // Reading the community through RLS proves the user can see it, and tells us its builder.
  const { data: community } = await supabase
    .from("communities")
    .select("id, builder_id, city")
    .eq("id", communityId)
    .maybeSingle();
  if (!community) fail("Pick a community for this home.");

  const row: Record<string, string | number | null> = {
    builder_id: community.builder_id,
    community_id: community.id,
    workflow_status: "draft",
  };
  const sources: Record<string, string> = {};

  for (const f of TEXT) {
    const v = String(formData.get(f) ?? "").trim();
    row[f] = v === "" ? null : v;
    if (v !== "") sources[f] = "staff";
  }
  for (const f of NUMBERS) {
    const raw = String(formData.get(f) ?? "").trim().replace(/[$,]/g, "");
    if (raw === "") {
      row[f] = null;
      continue;
    }
    const n = Number(raw);
    if (Number.isNaN(n)) fail(`${f.replace(/_/g, " ")} must be a number.`);
    row[f] = n;
    sources[f] = "staff";
  }

  if (!row.unparsed_address) fail("Enter the street address.");
  if (!row.city) row.city = community.city;
  if (!row.postal_code) fail("Enter the ZIP code.");
  if (!row.build_stage) row.build_stage = "under_construction";

  // Which MLS: blank means the database picks the community's MLS (by county).
  const board = String(formData.get("mls_board") ?? "");
  if (board && ["platform_admin", "listing_coordinator", "builder_owner", "manager"].includes(me.role)) {
    const { data: ok } = await supabase.from("mls_boards").select("code").eq("code", board).eq("active", true).maybeSingle();
    if (ok) row.mls_board = board;
  }

  const { data, error } = await supabase
    .from("homes")
    .insert({ ...row, field_sources: sources })
    .select("id")
    .single();
  if (error || !data) {
    fail(error?.message.includes("row-level security") ? "You don’t have permission to add homes for that builder." : `Couldn’t save the home: ${error?.message}`);
  }

  revalidatePath("/homes");
  revalidatePath("/approvals");
  redirect(`/homes/${data.id}?saved=created`);
}
