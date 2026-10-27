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

const DAYS = new Set([7, 14, 30, 60, 90]);

// A new realtor share link for this home.
export async function createShareLink(formData: FormData) {
  const me = await requireProfile();
  const homeId = String(formData.get("home_id"));
  const days = Number(formData.get("days"));
  const email = String(formData.get("recipient_email") ?? "").trim().slice(0, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back(homeId, { error: "That email address doesn’t look right." });
  const name = String(formData.get("recipient_name") ?? "").trim().slice(0, 120) || null;
  const supabase = await createClient();

  // A second click (or a double tap) on the same form: hand back the link
  // this person just made instead of making a copy.
  let recent = supabase
    .from("share_links")
    .select("id")
    .eq("home_id", homeId)
    .eq("created_by", me.id)
    .is("revoked_at", null)
    .is("deleted_at", null)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  recent = name ? recent.eq("recipient_name", name) : recent.is("recipient_name", null);
  recent = email ? recent.eq("recipient_email", email) : recent.is("recipient_email", null);
  const { data: dupe } = await recent.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (dupe) back(homeId, { saved: "Share link made. Copy it here and send it to the realtor." }, dupe.id);

  const { data: made, error } = await supabase
    .from("share_links")
    .insert({
      home_id: homeId,
      recipient_name: name,
      recipient_email: email || null,
      message: String(formData.get("message") ?? "").trim().slice(0, 1000) || null,
      expires_at: new Date(Date.now() + (DAYS.has(days) ? days : 30) * 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !made) back(homeId, { error: error?.message.includes("row-level security") ? "Owners, managers and marketing can make share links." : `Couldn’t make the link: ${error?.message ?? "unknown problem"}` });
  back(homeId, { saved: "Share link made. Copy it here and send it to the realtor." }, made.id);
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
