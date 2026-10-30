"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canRequestComps, isStaff } from "@/lib/permissions";
import { sendQueuedEmails } from "@/lib/email";

const num = (v: FormDataEntryValue | null) => {
  const raw = String(v ?? "").replace(/[$,\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
};

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

export async function requestComps(formData: FormData) {
  const me = await requireProfile();
  if (!canRequestComps(me.role)) fail("/comps/new", "Your role can’t ask for comps.");
  const supabase = await createClient();
  const homeId = String(formData.get("home_id") ?? "") || null;
  const communityId = String(formData.get("community_id") ?? "") || null;
  let builderId = me.builder_id;
  if (communityId) {
    const { data: c } = await supabase.from("communities").select("builder_id").eq("id", communityId).maybeSingle();
    if (!c) fail("/comps/new", "Pick one of your communities.");
    builderId = c.builder_id;
  }
  if (!builderId) fail("/comps/new", "Pick the community these comps are for.");
  const location = String(formData.get("location") ?? "").trim().slice(0, 300);
  if (!location) fail("/comps/new", "Enter the address or area.");
  const fields = {
    price_point: num(formData.get("price_point")),
    living_area: num(formData.get("living_area")),
    bedrooms: num(formData.get("bedrooms")),
    bathrooms: num(formData.get("bathrooms")),
    stories: num(formData.get("stories")),
    year_built: num(formData.get("year_built")),
    radius_miles: num(formData.get("radius_miles")),
    months_back: num(formData.get("months_back")),
  };
  if (Object.values(fields).some((v) => Number.isNaN(v))) fail("/comps/new", "Price, size, beds and baths need to be numbers.");
  const zipText = String(formData.get("zip_codes") ?? "").trim();
  const zips = [...new Set(zipText.split(/[\s,;]+/).filter(Boolean))];
  if (!zips.length) fail("/comps/new", "Enter at least one ZIP code.");
  if (zips.length > 10 || zips.some((z) => !/^\d{5}$/.test(z))) fail("/comps/new", "ZIP codes are 5 digits each, separated by commas (up to 10).");
  const type = String(formData.get("comp_type") ?? "both");
  const { data, error } = await supabase
    .from("comp_requests")
    .insert({
      builder_id: builderId,
      community_id: communityId,
      home_id: homeId,
      location,
      city: String(formData.get("city") ?? "").trim().slice(0, 80) || null,
      zip_codes: zips,
      ...fields,
      living_area: fields.living_area === null ? null : Math.round(fields.living_area),
      comp_type: ["new", "resale", "both"].includes(type) ? type : "both",
      notes: String(formData.get("notes") ?? "").trim().slice(0, 2000) || null,
      requested_by: me.id,
    })
    .select("id")
    .single();
  if (error || !data) fail("/comps/new", error?.message.includes("row-level security") ? "You can only ask for comps for your own communities." : `Couldn’t send the request: ${error?.message}`);
  after(() => sendQueuedEmails("comp_requests", data.id));
  revalidatePath("/comps");
  redirect(`/comps/${data.id}?saved=${encodeURIComponent("Sent. Our team has it on their list and will send the comps back here and to your inbox.")}`);
}

export async function cancelComps(formData: FormData) {
  await requireProfile();
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("comp_requests").update({ status: "cancelled" }).eq("id", id);
  if (error) fail(`/comps/${id}`, "Only requests our team hasn’t started can be cancelled.");
  revalidatePath("/comps");
  redirect(`/comps/${id}?saved=${encodeURIComponent("Request cancelled.")}`);
}

// Our team: one comp, typed in from the MLS.
export async function addComp(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("id"));
  if (!isStaff(me.role)) fail(`/comps/${id}`, "Only our team adds comps.");
  const address = String(formData.get("address") ?? "").trim().slice(0, 200);
  if (!address) fail(`/comps/${id}#add`, "Enter the comp’s address.");
  const vals = {
    list_price: num(formData.get("list_price")),
    sold_price: num(formData.get("sold_price")),
    living_area: num(formData.get("living_area")),
    bedrooms: num(formData.get("bedrooms")),
    bathrooms: num(formData.get("bathrooms")),
    year_built: num(formData.get("year_built")),
    days_on_market: num(formData.get("days_on_market")),
    distance_miles: num(formData.get("distance_miles")),
  };
  if (Object.values(vals).some((v) => Number.isNaN(v))) fail(`/comps/${id}#add`, "Prices, size, beds, baths and days need to be numbers.");
  const status = String(formData.get("status") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("comp_request_items").insert({
    request_id: id,
    address,
    status: ["Sold", "Active", "Pending", "Expired", "Withdrawn"].includes(status) ? status : null,
    ...vals,
    living_area: vals.living_area === null ? null : Math.round(vals.living_area),
    close_date: String(formData.get("close_date") ?? "") || null,
    notes: String(formData.get("notes") ?? "").trim().slice(0, 500) || null,
  });
  if (error) fail(`/comps/${id}#add`, `Couldn’t add it: ${error.message}`);
  // The first comp moves a new request to in progress.
  await supabase.from("comp_requests").update({ status: "in_progress" }).eq("id", id).eq("status", "requested");
  revalidatePath(`/comps/${id}`);
  redirect(`/comps/${id}?saved=${encodeURIComponent("Comp added.")}#add`);
}

export async function removeComp(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("id"));
  if (!isStaff(me.role)) fail(`/comps/${id}`, "Only our team changes comps.");
  const supabase = await createClient();
  await supabase.from("comp_request_items").delete().eq("id", String(formData.get("item_id"))).eq("request_id", id);
  revalidatePath(`/comps/${id}`);
  redirect(`/comps/${id}#results`);
}

// Our team: send the comps back to whoever asked.
export async function deliverComps(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("id"));
  if (!isStaff(me.role)) fail(`/comps/${id}`, "Only our team sends comps.");
  const supabase = await createClient();
  const [{ count: rows }, { count: files }] = await Promise.all([
    supabase.from("comp_request_items").select("id", { count: "exact", head: true }).eq("request_id", id),
    supabase.from("deliverable_files").select("id", { count: "exact", head: true }).eq("request_table", "comp_requests").eq("request_id", id).is("deleted_at", null),
  ]);
  const note = String(formData.get("result_note") ?? "").trim().slice(0, 4000) || null;
  if (!rows && !files && !note) fail(`/comps/${id}#send`, "Add at least one comp, a file or a note before sending.");
  const { error } = await supabase.from("comp_requests").update({ status: "delivered", result_note: note }).eq("id", id);
  if (error) fail(`/comps/${id}#send`, `Couldn’t send: ${error.message}`);
  after(() => sendQueuedEmails("comp_requests", id));
  revalidatePath("/comps");
  redirect(`/comps/${id}?saved=${encodeURIComponent("Sent. They have a notice in Builder Listings and an email.")}`);
}

export async function startComps(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("id"));
  if (!isStaff(me.role)) fail(`/comps/${id}`, "Only our team updates requests.");
  const supabase = await createClient();
  await supabase.from("comp_requests").update({ status: "in_progress" }).eq("id", id).eq("status", "requested");
  revalidatePath(`/comps/${id}`);
  redirect(`/comps/${id}`);
}
