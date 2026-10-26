"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { allowedTransitions, canAddHomes, editableFields, isStaff, type HomeField } from "@/lib/permissions";
import { sendQueuedEmails } from "@/lib/email";
import { COMPARE_FIELDS } from "./fields";

function back(formData: FormData, params: Record<string, string>): never {
  const to = String(formData.get("back") ?? "/website-check");
  const [path, query] = to.split("?");
  const sp = new URLSearchParams(query ?? "");
  sp.delete("error");
  sp.delete("saved");
  Object.entries(params).forEach(([k, v]) => sp.set(k, v));
  redirect(`${path}?${sp.toString()}`);
}

function friendly(msg: string) {
  if (msg.includes("row-level security") || msg.includes("cannot change")) return "Your role can’t make that change.";
  return `Couldn’t save: ${msg}`;
}

// The builder's website feed: on/off, address, and how we read it.
export async function saveFeedSettings(formData: FormData) {
  const builderId = String(formData.get("builder_id"));
  const supabase = await createClient();
  const source = String(formData.get("website_feed_source") ?? "") || null;
  const { error } = await supabase.from("builder_settings").upsert({
    builder_id: builderId,
    website_url: String(formData.get("website_url") ?? "").trim() || null,
    website_feed_enabled: formData.get("website_feed_enabled") === "on",
    website_feed_source: source,
    updated_at: new Date().toISOString(),
  });
  if (error) back(formData, { error: friendly(error.message) });
  revalidatePath("/website-check");
  back(formData, { saved: "Website feed settings saved." });
}

// Demo only: the real feed would run on a schedule through the shared import door.
export async function syncFeedNow(formData: FormData) {
  const builderId = String(formData.get("builder_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("builder_settings")
    .update({ website_feed_last_synced_at: new Date().toISOString() })
    .eq("builder_id", builderId);
  if (error) back(formData, { error: friendly(error.message) });
  revalidatePath("/website-check");
  back(formData, { saved: "Checked the website. (In the demo the website data is made up, so nothing new came in.)" });
}

// One click: make a home from what's on the builder's website.
export async function addFromWebsite(formData: FormData) {
  const me = await requireProfile();
  if (!canAddHomes(me.role)) back(formData, { error: "Ask a manager or owner to add homes." });
  const listingId = String(formData.get("listing_id"));
  const communityId = String(formData.get("community_id") ?? "");
  const send = formData.get("mode") === "send";
  const supabase = await createClient();

  const { data: w } = await supabase.from("website_listings").select("*").eq("id", listingId).maybeSingle();
  if (!w) back(formData, { error: "That website listing is gone." });
  if (w.home_id) back(formData, { error: "That home is already in Builder Listings." });
  const { data: community } = await supabase.from("communities").select("id, builder_id, city").eq("id", communityId).maybeSingle();
  if (!community || community.builder_id !== w.builder_id) back(formData, { error: "Pick the community this home is in." });

  // Only the easy fields come from the website; each is marked as coming from it.
  const row: Record<string, unknown> = {
    builder_id: w.builder_id,
    community_id: community.id,
    workflow_status: "draft",
    unparsed_address: w.unparsed_address,
    city: w.city ?? community.city,
    postal_code: w.postal_code,
    plan_name: w.plan_name,
    list_price: w.list_price,
    bedrooms_total: w.bedrooms_total,
    bathrooms_full: w.bathrooms_full,
    bathrooms_half: w.bathrooms_half,
    living_area: w.living_area,
    public_remarks: w.public_remarks,
    build_stage: /move/i.test(w.status_text ?? "") ? "move_in_ready" : /be built|coming/i.test(w.status_text ?? "") ? "to_be_built" : "under_construction",
  };
  const sources: Record<string, string> = {};
  for (const k of Object.keys(row)) if (!["builder_id", "community_id", "workflow_status"].includes(k) && row[k] != null) sources[k] = "website";
  row.field_sources = sources;

  const { data: home, error } = await supabase.from("homes").insert(row).select("id").single();
  if (error || !home) back(formData, { error: friendly(error?.message ?? "unknown") });
  await supabase.from("website_listings").update({ home_id: home.id }).eq("id", w.id);

  // "Push it live": submit and approve in one go, which puts it on our team's
  // list to enter into the MLS. (Our team still enters it into the MLS by hand.)
  let reached = "draft";
  if (send) {
    for (const [from, to] of [["draft", "in_review"], ["in_review", "approved_for_mls"]] as const) {
      if (!allowedTransitions(me.role, from).includes(to)) break;
      const { error: e } = await supabase.from("homes").update({ workflow_status: to }).eq("id", home.id);
      if (e) break;
      reached = to;
    }
  }
  const message =
    reached === "approved_for_mls"
      ? "Added from your website and sent to our team to enter into the MLS. Add photos and any MLS-only details below."
      : reached === "in_review"
        ? "Added from your website and sent to a manager or owner to approve."
        : "Added from your website as a draft. Fill in the MLS-only details, then submit it.";
  revalidatePath("/", "layout");
  redirect(`/homes/${home.id}?saved=${encodeURIComponent(message)}`);
}

export async function dismissWebsiteListing(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("website_listings").update({ dismissed_at: new Date().toISOString() }).eq("id", String(formData.get("listing_id")));
  if (error) back(formData, { error: friendly(error.message) });
  revalidatePath("/website-check");
  back(formData, { saved: "Hidden. It won’t show here again." });
}

// Copy one value from the website into Builder Listings.
export async function useWebsiteValue(formData: FormData) {
  const me = await requireProfile();
  const homeId = String(formData.get("home_id"));
  const field = String(formData.get("field")) as HomeField;
  if (!COMPARE_FIELDS.some((f) => f.key === field)) back(formData, { error: "Unknown field." });
  if (!editableFields(me.role).includes(field)) back(formData, { error: "Your role can’t change that field." });
  const supabase = await createClient();
  const [{ data: w }, { data: h }] = await Promise.all([
    supabase.from("website_listings").select(field).eq("home_id", homeId).maybeSingle(),
    supabase.from("homes").select("field_sources").eq("id", homeId).maybeSingle(),
  ]);
  if (!w || !h) back(formData, { error: "Couldn’t find that home’s website listing." });
  const value = (w as Record<string, unknown>)[field];
  const { data, error } = await supabase
    .from("homes")
    .update({ [field]: value, field_sources: { ...((h.field_sources ?? {}) as Record<string, string>), [field]: "website" } })
    .eq("id", homeId)
    .select("id, workflow_status");
  if (error) back(formData, { error: friendly(error.message) });
  if (!data?.length) back(formData, { error: "Your role can’t change this home." });
  revalidatePath("/", "layout");
  back(formData, {
    saved: data[0].workflow_status === "live_on_mls" ? "Updated from the website. Our team has a task to update the MLS too." : "Updated from the website.",
  });
}

// The MLS shows something different from Builder Listings: ask our team to fix the MLS.
export async function askToFixMls(formData: FormData) {
  const me = await requireProfile();
  const homeId = String(formData.get("home_id"));
  const address = String(formData.get("address"));
  const summary = String(formData.get("summary"));
  const supabase = await createClient();
  if (isStaff(me.role)) {
    const { error } = await supabase.from("tasks").insert({
      kind: "mls_update",
      title: `Fix the MLS for ${address}`,
      details: `The MLS doesn’t match Builder Listings:\n${summary}`,
      home_id: homeId,
      builder_id: String(formData.get("builder_id")),
      created_by: me.id,
      assignee_id: me.id,
      priority: "high",
    });
    if (error) back(formData, { error: friendly(error.message) });
    revalidatePath("/", "layout");
    back(formData, { saved: "Added a task to fix the MLS." });
  }
  const { data, error } = await supabase
    .from("issue_reports")
    .insert({ reported_by: me.id, kind: "problem", page: `Website check: ${address}`, message: `Please update the MLS for ${address}. It doesn’t match Builder Listings:\n${summary}` })
    .select("id")
    .single();
  if (error || !data) back(formData, { error: friendly(error?.message ?? "unknown") });
  after(() => sendQueuedEmails(supabase, "issue_reports", data.id));
  back(formData, { saved: "Sent to our team. They’ll update the MLS." });
}
