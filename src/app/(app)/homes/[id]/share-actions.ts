"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { cleanWebsitePage } from "@/lib/website-page";

// linkId: the link that was made or changed; the page marks it and shows the
// message next to it, and scrolls to it.
function back(homeId: string, params: Record<string, string>, linkId?: string): never {
  revalidatePath(`/homes/${homeId}`);
  const q = new URLSearchParams({ ...params, at: "share", ...(linkId ? { link: linkId } : {}) });
  redirect(`/homes/${homeId}?${q.toString()}#${linkId ? `share-${linkId}` : "share"}`);
}

// Replace the home's standing link: the current one stops working at once
// (it goes to the trash) and a new one is made in its place.
export async function replaceShareLink(formData: FormData) {
  await requireProfile();
  const homeId = String(formData.get("home_id"));
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { data } = await supabase
    .from("share_links")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("expires_at", null)
    .is("deleted_at", null)
    .select("id");
  if (!data?.length) back(homeId, { error: "Your role can’t replace this home’s link." });
  const { data: token } = await supabase.rpc("home_share_link", { p_home: homeId });
  if (!token) back(homeId, { error: "The old link is off, but a new one couldn’t be made. Reload the page to try again." });
  back(homeId, { saved: "New link made. The old one no longer works, so send this one from now on." });
}

// Delete a link: it stops working at once and leaves the list. It goes to the
// trash, so "Undo" right after puts it back as it was.
export async function deleteShareLink(formData: FormData) {
  await requireProfile();
  const homeId = String(formData.get("home_id"));
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { data } = await supabase.from("share_links").update({ deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("id");
  if (!data?.length) back(homeId, { error: "That link was already deleted, or your role can’t delete share links." });
  back(homeId, { saved: "Link deleted. Anyone who opens it now sees that it’s no longer available.", undo: id });
}

export async function restoreShareLink(formData: FormData) {
  await requireProfile();
  const homeId = String(formData.get("home_id"));
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { data } = await supabase.from("share_links").update({ deleted_at: null }).eq("id", id).not("deleted_at", "is", null).select("id");
  if (!data?.length) back(homeId, { error: "Couldn’t put that link back." });
  back(homeId, { saved: "Link is back." }, id);
}

// Give a link 30 more days (from today), or turn a turned-off link back on.
export async function extendShareLink(formData: FormData) {
  await requireProfile();
  const homeId = String(formData.get("home_id"));
  const supabase = await createClient();
  const { data: link } = await supabase.from("share_links").select("created_at").eq("id", String(formData.get("id"))).maybeSingle();
  if (!link) back(homeId, { error: "That link is gone." });
  const limit = new Date(link.created_at).getTime() + 365 * 86_400_000;
  const until = Math.min(Date.now() + 30 * 86_400_000, limit);
  if (until <= Date.now()) back(homeId, { error: "This link is a year old. Make a new one instead." });
  const { data, error } = await supabase
    .from("share_links")
    .update({ expires_at: new Date(until).toISOString(), revoked_at: null })
    .eq("id", String(formData.get("id")))
    .select("id");
  if (error || !data?.length) back(homeId, { error: "Your role can’t change share links." }, String(formData.get("id")));
  back(homeId, { saved: "Link is on for 30 more days." }, String(formData.get("id")));
}

// The home's page on the builder's website (builders without a connected website).
export async function saveWebsitePage(formData: FormData) {
  await requireProfile();
  const homeId = String(formData.get("home_id"));
  const page = cleanWebsitePage(formData.get("website_page_url"));
  if (page === "bad") back(homeId, { error: "That link doesn’t look right. Paste the full address, like https://www.yourbuilder.com/homes/123-main-st." });
  const supabase = await createClient();
  const { data, error } = await supabase.from("homes").update({ website_page_url: page }).eq("id", homeId).select("id");
  if (error || !data?.length) back(homeId, { error: "Owners, managers and marketing can change the website link." });
  back(homeId, { saved: page ? "Website link saved. The share page’s “More info” button now goes to this home’s page." : "Website link removed. The share page’s “More info” button goes to your main website." });
}

// Confirm a suggested match: this home is that listing on the builder's website.
// Only a pair the database itself suggests (same builder, same address) can be linked.
export async function linkWebsiteListing(formData: FormData) {
  await requireProfile();
  const homeId = String(formData.get("home_id"));
  const listingId = String(formData.get("website_listing_id"));
  const supabase = await createClient();
  const { data: pairs } = await supabase.rpc("website_link_suggestions", { p_home: homeId });
  if (!(pairs ?? []).some((p: { website_listing_id: string }) => p.website_listing_id === listingId)) {
    back(homeId, { error: "That website listing can’t be linked to this home anymore." });
  }
  const { data } = await supabase.from("website_listings").update({ home_id: homeId }).eq("id", listingId).is("home_id", null).select("id");
  if (!data?.length) back(homeId, { error: "Owners, managers and marketing can link website listings." });
  revalidatePath("/website-check");
  back(homeId, { saved: "Linked to the home’s page on your website." });
}
