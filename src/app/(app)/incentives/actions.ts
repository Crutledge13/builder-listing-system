"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canManageIncentives } from "@/lib/permissions";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function back(formData: FormData, params: Record<string, string>, anchor?: string): never {
  const to = String(formData.get("back") ?? "/incentives");
  const safe = to.startsWith("/") && !to.startsWith("//") ? to.split("#")[0] : "/incentives";
  revalidatePath("/incentives");
  revalidatePath("/homes", "layout");
  revalidatePath("/communities", "layout");
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}${new URLSearchParams(params).toString()}${anchor ? `#${anchor}` : ""}`);
}

// Turn a database refusal into plain words.
function friendly(message: string) {
  if (/Agent compensation|end date|another builder|wasn.t found/.test(message)) return message;
  if (message.includes("row-level security")) return "Your role can’t change incentives.";
  return `Couldn’t save: ${message}`;
}

export async function addIncentive(formData: FormData) {
  const me = await requireProfile();
  if (!canManageIncentives(me.role)) back(formData, { error: "Your role can’t add incentives." });
  const title = String(formData.get("title") ?? "").trim().slice(0, 120);
  const endsOn = String(formData.get("ends_on") ?? "");
  if (!title) back(formData, { error: "Give the incentive a short title, like “$10,000 toward closing costs”." });
  if (!DATE.test(endsOn)) back(formData, { error: "Every incentive needs an end date." });
  const scope = String(formData.get("scope") ?? "builder");
  const builderId = me.role === "platform_admin" ? String(formData.get("builder_id") ?? "") : me.builder_id;
  const communityId = scope === "community" ? String(formData.get("community_id") ?? "") : "";
  const homeId = scope === "home" ? String(formData.get("home_id") ?? "") : "";
  if (scope === "community" && !communityId) back(formData, { error: "Pick the community." });
  if (scope === "home" && !homeId) back(formData, { error: "Pick the home." });
  if (!builderId && !homeId) back(formData, { error: "Pick the builder." });

  const supabase = await createClient();
  let b = builderId;
  if (homeId) {
    const { data: h } = await supabase.from("homes").select("builder_id").eq("id", homeId).maybeSingle();
    if (!h) back(formData, { error: "That home wasn’t found." });
    b = h.builder_id;
  }
  const { data, error } = await supabase
    .from("incentives")
    .insert({
      builder_id: b,
      community_id: communityId || null,
      home_id: homeId || null,
      title,
      details: String(formData.get("details") ?? "").trim().slice(0, 2000) || null,
      ends_on: endsOn,
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error || !data) back(formData, { error: friendly(error?.message ?? "") });
  back(formData, { saved: "Incentive added. If it covers live listings, our team will add it on the MLS." }, `i-${data.id}`);
}

export async function extendIncentive(formData: FormData) {
  await requireProfile();
  const id = String(formData.get("id"));
  const endsOn = String(formData.get("ends_on") ?? "");
  if (!DATE.test(endsOn)) back(formData, { error: "Pick the new end date." }, `i-${id}`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("incentives").update({ ends_on: endsOn, status: "active" }).eq("id", id).select("id");
  if (error) back(formData, { error: friendly(error.message) }, `i-${id}`);
  if (!data?.length) back(formData, { error: "Your role can’t change incentives." }, `i-${id}`);
  back(formData, { saved: "Extended. We’ll update the MLS for any live listings." }, `i-${id}`);
}

export async function endIncentive(formData: FormData) {
  await requireProfile();
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("incentives").update({ status: "ended" }).eq("id", id).eq("status", "active").select("id");
  if (error) back(formData, { error: friendly(error.message) }, `i-${id}`);
  if (!data?.length) back(formData, { error: "Couldn’t end it (it may have ended already)." }, `i-${id}`);
  back(formData, { saved: "Ended. It’s off your listings, and our team will take it off the MLS." }, `i-${id}`);
}

export async function editIncentive(formData: FormData) {
  await requireProfile();
  const id = String(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim().slice(0, 120);
  if (!title) back(formData, { error: "The title can’t be empty." }, `i-${id}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incentives")
    .update({ title, details: String(formData.get("details") ?? "").trim().slice(0, 2000) || null })
    .eq("id", id)
    .select("id");
  if (error) back(formData, { error: friendly(error.message) }, `i-${id}`);
  if (!data?.length) back(formData, { error: "Your role can’t change incentives." }, `i-${id}`);
  back(formData, { saved: "Saved." }, `i-${id}`);
}
