"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

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
