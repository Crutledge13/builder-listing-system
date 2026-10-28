"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canEditPlans, isStaff } from "@/lib/permissions";
import { cleanRooms } from "@/lib/rooms";
import { PLAN_MODEL, planScanAvailable, scanFloorPlan, type PlanScan } from "@/lib/plan-scan";
import { creditStatus, finishCredits, outOfCreditsMessage, spendCredits } from "@/lib/ai-credits";
import { STORIES_FROM_LEVELS } from "@/lib/ntreis-fields";

function go(path: string, params: Record<string, string>, hash = ""): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}${hash}`);
}

const int = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const x = Math.round(Number(s));
  return Number.isFinite(x) && x >= 0 ? x : null;
};

// Square feet "from" and "to". A plan can come out a little bigger with some
// elevations, so it can have a range; "3228-3410" typed in one box works too.
function sqftRange(formData: FormData) {
  const raw = String(formData.get("living_area") ?? "");
  const both = raw.match(/^\s*([\d,]+)\s*(?:-|–|to)\s*([\d,]+)\s*$/i);
  let low = both ? int(both[1].replace(/,/g, "")) : int(raw.replace(/,/g, ""));
  let high = both ? int(both[2].replace(/,/g, "")) : int(String(formData.get("living_area_max") ?? "").replace(/,/g, ""));
  if (low === 0) low = null;
  if (high === 0) high = null;
  if (low !== null && high !== null && high < low) [low, high] = [high, low];
  if (low === null && high !== null) [low, high] = [high, null];
  return { living_area: low, living_area_max: high !== null && high !== low ? high : null };
}

function specs(formData: FormData) {
  // One "Stories" question, using NTREIS's choices (One, One and One Half,
  // Two...). It fills both the NTREIS Levels answer and our stories number.
  const levels = String(formData.get("levels") ?? "") || null;
  return {
    name: String(formData.get("name") ?? "").trim().slice(0, 80),
    bedrooms_total: int(formData.get("bedrooms_total")),
    bathrooms_full: int(formData.get("bathrooms_full")),
    bathrooms_half: int(formData.get("bathrooms_half")),
    ...sqftRange(formData),
    stories: levels ? (STORIES_FROM_LEVELS[levels] ?? null) : int(formData.get("stories")),
    garage_spaces: int(formData.get("garage_spaces")),
    levels,
    living_areas_total: int(formData.get("living_areas_total")),
    dining_areas_total: int(formData.get("dining_areas_total")),
    notes: String(formData.get("notes") ?? "").trim().slice(0, 2000) || null,
    rooms: cleanRooms(JSON.parse(String(formData.get("rooms_json") ?? "[]") || "[]")),
  };
}

export async function createPlan(formData: FormData) {
  const me = await requireProfile();
  if (!canEditPlans(me.role)) go("/plans", { error: "Your role can’t add floor plans." });
  // Our team picks the builder; everyone else adds to their own.
  const builderId = isStaff(me.role) ? String(formData.get("builder_id") ?? "") : (me.builder_id ?? "");
  const s = specs(formData);
  if (!builderId || !s.name) go("/plans", { error: "Pick the builder and name the plan." }, "#new");
  const supabase = await createClient();
  const { data, error } = await supabase.from("floor_plans").insert({ builder_id: builderId, ...s }).select("id").single();
  if (error || !data) go("/plans", { error: error?.message.includes("duplicate") ? "That builder already has a plan with that name." : `Couldn’t add it: ${error?.message}` }, "#new");
  revalidatePath("/plans");
  go(`/plans/${data.id}`, { saved: planScanAvailable() ? "Plan added. Upload the plan file to read the rooms off it, or add them by hand." : "Plan added. Upload the plan file and enter the room sizes below." });
}

export async function savePlan(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("id"));
  if (!canEditPlans(me.role)) go(`/plans/${id}`, { error: "Your role can’t change floor plans." });
  const supabase = await createClient();
  const { error } = await supabase.from("floor_plans").update({ ...specs(formData), active: formData.get("active") === "on" }).eq("id", id);
  if (error) go(`/plans/${id}`, { error: error.message.includes("duplicate") ? "That builder already has a plan with that name." : `Couldn’t save: ${error.message}` });
  revalidatePath("/plans");
  go(`/plans/${id}`, { saved: "Plan saved." });
}

// Read the plan file with AI; keep what it found as a suggestion.
async function runScan(id: string): Promise<{ error?: string }> {
  if (!planScanAvailable()) return { error: "Reading plans needs the AI key (ANTHROPIC_API_KEY) set up on the server. Add the rooms by hand meanwhile." };
  const supabase = await createClient();
  const { data: p } = await supabase.from("floor_plans").select("plan_file_path, builder_id").eq("id", id).maybeSingle();
  if (!p?.plan_file_path) return { error: "Upload the plan file first." };
  // Reading a plan costs AI credits; reserve them before calling the AI.
  let usageId: string | null = null;
  try {
    usageId = await spendCredits(supabase, p.builder_id, "plan_read", id);
  } catch {
    return { error: "Couldn’t check your AI credits. Try again in a minute." };
  }
  if (!usageId) return { error: outOfCreditsMessage(await creditStatus(supabase, p.builder_id)) + " You can still add the rooms by hand." };
  const { data: link } = await supabase.storage.from("plan-files").createSignedUrl(p.plan_file_path, 600);
  if (!link) {
    await finishCredits(supabase, usageId, false);
    return { error: "Couldn’t open the plan file." };
  }
  const ext = p.plan_file_path.split(".").pop()?.toLowerCase();
  const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  let scan: PlanScan | null = null;
  try {
    const read = await scanFloorPlan(link.signedUrl, mime);
    scan = read.scan;
    // The AI did the work, so the credits are used even if it found no rooms.
    await finishCredits(supabase, usageId, true, PLAN_MODEL, read.usage);
  } catch {
    await finishCredits(supabase, usageId, false);
    return { error: "The AI couldn’t read that file (no credits used). A clearer PDF or image of the plan usually works." };
  }
  if (!scan || !scan.rooms.length) return { error: "The AI didn’t find any room sizes on that file." };
  await supabase.from("floor_plans").update({ scan, scanned_at: new Date().toISOString() }).eq("id", id);
  return {};
}

export async function savePlanFile(id: string, path: string, fileName: string): Promise<{ error?: string }> {
  const me = await requireProfile();
  if (!canEditPlans(me.role)) return { error: "Your role can’t upload plan files." };
  const supabase = await createClient();
  const { data: before } = await supabase.from("floor_plans").select("plan_file_path").eq("id", id).maybeSingle();
  const { error } = await supabase.from("floor_plans").update({ plan_file_path: path, plan_file_name: fileName.slice(0, 200) }).eq("id", id);
  if (error) return { error: "Couldn’t attach the plan file." };
  if (before?.plan_file_path && before.plan_file_path !== path) await supabase.storage.from("plan-files").remove([before.plan_file_path]);
  revalidatePath(`/plans/${id}`);
  // AI off (no key): the file is saved; room sizes are added by hand below.
  if (!planScanAvailable()) return {};
  const scanned = await runScan(id);
  revalidatePath(`/plans/${id}`);
  return scanned.error ? { error: `Saved the plan file. ${scanned.error}` } : {};
}

export async function rescanPlan(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("id"));
  if (!canEditPlans(me.role)) go(`/plans/${id}`, { error: "Your role can’t change floor plans." });
  const r = await runScan(id);
  go(`/plans/${id}`, r.error ? { error: r.error } : { saved: "Read the plan again. Check what it found." }, "#scan");
}

// Use what the AI read: rooms replace the list; specs fill only what's empty.
export async function useScan(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("id"));
  if (!canEditPlans(me.role)) go(`/plans/${id}`, { error: "Your role can’t change floor plans." });
  const supabase = await createClient();
  const { data: p } = await supabase.from("floor_plans").select("*").eq("id", id).maybeSingle();
  const scan = p?.scan as PlanScan | null;
  if (!p || !scan) go(`/plans/${id}`, { error: "Nothing to use. Read the plan first." });
  const patch: Record<string, unknown> = { rooms: scan.rooms, scan: null };
  for (const k of ["bedrooms_total", "bathrooms_full", "bathrooms_half", "living_area", "stories", "garage_spaces"] as const) {
    if (p[k] == null && scan[k] != null) patch[k] = scan[k];
  }
  // Stories and NTREIS Levels are one question on the plan: keep them together.
  if (p.levels == null && typeof patch.stories === "number") patch.levels = patch.stories >= 3 ? "Three Or More" : patch.stories === 2 ? "Two" : "One";
  await supabase.from("floor_plans").update(patch).eq("id", id);
  revalidatePath(`/plans/${id}`);
  go(`/plans/${id}`, { saved: "Rooms filled in from the plan. Check them and save if you change anything." });
}

export async function dismissScan(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("id"));
  if (!canEditPlans(me.role)) go(`/plans/${id}`, { error: "Your role can’t change floor plans." });
  const supabase = await createClient();
  await supabase.from("floor_plans").update({ scan: null }).eq("id", id);
  go(`/plans/${id}`, { saved: "Dismissed." });
}
