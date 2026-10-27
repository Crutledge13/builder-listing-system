"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

function back(homeId: string, params: Record<string, string>): never {
  revalidatePath(`/homes/${homeId}`);
  redirect(`/homes/${homeId}?${new URLSearchParams({ ...params, at: "share" }).toString()}#share`);
}

const DAYS = new Set([7, 14, 30, 60, 90]);

// A new realtor share link for this home.
export async function createShareLink(formData: FormData) {
  await requireProfile();
  const homeId = String(formData.get("home_id"));
  const days = Number(formData.get("days"));
  const email = String(formData.get("recipient_email") ?? "").trim().slice(0, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back(homeId, { error: "That email address doesn’t look right." });
  const supabase = await createClient();
  const { error } = await supabase.from("share_links").insert({
    home_id: homeId,
    recipient_name: String(formData.get("recipient_name") ?? "").trim().slice(0, 120) || null,
    recipient_email: email || null,
    message: String(formData.get("message") ?? "").trim().slice(0, 1000) || null,
    expires_at: new Date(Date.now() + (DAYS.has(days) ? days : 30) * 86_400_000).toISOString(),
  });
  if (error) back(homeId, { error: error.message.includes("row-level security") ? "Owners, managers and marketing can make share links." : `Couldn’t make the link: ${error.message}` });
  back(homeId, { saved: "Share link made. Copy it below and send it to the realtor." });
}

export async function turnOffShareLink(formData: FormData) {
  await requireProfile();
  const homeId = String(formData.get("home_id"));
  const supabase = await createClient();
  const { data } = await supabase.from("share_links").update({ revoked_at: new Date().toISOString() }).eq("id", String(formData.get("id"))).select("id");
  if (!data?.length) back(homeId, { error: "Your role can’t change share links." });
  back(homeId, { saved: "Link turned off. Anyone who opens it now sees that it’s no longer available." });
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
  if (error || !data?.length) back(homeId, { error: "Your role can’t change share links." });
  back(homeId, { saved: "Link is on for 30 more days." });
}
