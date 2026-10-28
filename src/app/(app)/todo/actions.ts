"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { hasFeature } from "@/lib/features";
import { safePath } from "@/lib/safe-path";

function back(formData: FormData, params: Record<string, string>): never {
  const to = String(formData.get("back") ?? "/todo");
  const safe = safePath(to, "/todo");
  revalidatePath("/todo");
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}${new URLSearchParams(params).toString()}`);
}

// The page is hidden when this feature is off for the builder; refuse its
// actions too, so nothing works around a turned-off feature.
async function featureOn(formData: FormData) {
  const me = await requireProfile();
  if (!(await hasFeature(me, "builder_tasks"))) back(formData, { error: "The Tasks board isn’t turned on for your company." });
}

export async function updateTodo(formData: FormData) {
  await featureOn(formData);
  await requireProfile();
  const patch: Record<string, string | null> = {};
  const status = String(formData.get("status") ?? "");
  if (["todo", "in_progress", "done", "cancelled"].includes(status)) patch.status = status;
  if (formData.has("assignee_id")) patch.assignee_id = String(formData.get("assignee_id") ?? "") || null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("builder_tasks").update(patch).eq("id", String(formData.get("id"))).select("id");
  if (error || !data?.length) back(formData, { error: error && /Assign it|closes on its own|start a task/.test(error.message) ? error.message : "Couldn’t change that task." });
  back(formData, { saved: status === "done" ? "Closed: the listing will expire on its date." : status === "in_progress" ? "Started." : "Saved." });
}

// Extend a listing that's close to its MLS Expire Date (owners and managers).
// The new date goes on the MLS sheet and on the MLS update for our team.
export async function extendListing(formData: FormData) {
  await featureOn(formData);
  await requireProfile();
  const homeId = String(formData.get("home_id"));
  const until = String(formData.get("until") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) back(formData, { error: "Pick the new end date." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("extend_listing", { p_home: homeId, p_until: until });
  if (error) back(formData, { error: /owner or manager|after today/.test(error.message) ? error.message : "Couldn’t extend the listing." });
  revalidatePath("/", "layout");
  back(formData, { saved: "Listing extended. The MLS will be updated with the new end date." });
}
