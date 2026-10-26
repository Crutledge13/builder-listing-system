"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { detectProvider } from "@/lib/listing-media";

// Changes to what goes on a home's MLS listing. The database decides who may
// (owners, managers, marketing and our admins) and checks every item belongs
// to the home, its community or its floor plan.

const ID = /^[0-9a-f-]{36}$/i;

function back(homeId: string, params: Record<string, string>): never {
  revalidatePath(`/homes/${homeId}`, "layout");
  redirect(`/homes/${homeId}?${new URLSearchParams({ ...params, at: "listing-media" }).toString()}#listing-media`);
}

function friendly(message: string) {
  if (message.includes("row-level security")) return "You don’t have permission to change this listing’s photos.";
  if (message.includes("doesn't belong")) return "That item isn’t from this home, its community or its floor plan.";
  if (message.includes("virtual_tours_url_check")) return "Paste the full tour link, starting with https://";
  return `Couldn’t save: ${message}`;
}

function homeIdFrom(formData: FormData) {
  const id = String(formData.get("home_id") ?? "");
  if (!ID.test(id)) redirect("/homes");
  return id;
}

// Add one or more community, floor-plan or tour items to the listing.
export async function addToListing(formData: FormData) {
  const homeId = homeIdFrom(formData);
  await requireProfile();
  const supabase = await createClient();
  const media = formData.getAll("media_id").map(String).filter((x) => ID.test(x));
  const tours = formData.getAll("tour_id").map(String).filter((x) => ID.test(x));
  if (media.length + tours.length === 0) back(homeId, { error: "Pick something to add." });
  // One at a time so each goes on the end in the order shown.
  for (const media_id of media) {
    const { error } = await supabase.from("listing_media").insert({ home_id: homeId, media_id });
    if (error && !error.message.includes("duplicate")) back(homeId, { error: friendly(error.message) });
  }
  for (const tour_id of tours) {
    const { error } = await supabase.from("listing_media").insert({ home_id: homeId, tour_id });
    if (error && !error.message.includes("duplicate")) back(homeId, { error: friendly(error.message) });
  }
  const n = media.length + tours.length;
  back(homeId, { saved: `Added ${n} ${n === 1 ? "item" : "items"} to the listing.` });
}

// Take an item off the listing. The photo itself stays in the media library.
export async function removeFromListing(formData: FormData) {
  const homeId = homeIdFrom(formData);
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.from("listing_media").delete().eq("id", String(formData.get("item_id"))).eq("home_id", homeId).select("id");
  if (error) back(homeId, { error: friendly(error.message) });
  if (!data?.length) back(homeId, { error: "You don’t have permission to change this listing’s photos." });
  back(homeId, { saved: "Taken off the listing. It’s still in the media library." });
}

// Move an item up, down or to the front.
export async function moveListingItem(formData: FormData) {
  const homeId = homeIdFrom(formData);
  await requireProfile();
  const supabase = await createClient();
  const itemId = String(formData.get("item_id"));
  const dir = String(formData.get("dir"));
  const { data: rows } = await supabase.from("listing_media").select("id, position").eq("home_id", homeId).order("position");
  const list = rows ?? [];
  const i = list.findIndex((r) => r.id === itemId);
  if (i < 0) back(homeId, { error: "That item isn’t on the listing any more." });
  const order = list.map((r) => r.id);
  order.splice(i, 1);
  const to = dir === "first" ? 0 : dir === "up" ? Math.max(i - 1, 0) : Math.min(i + 1, list.length - 1);
  order.splice(to, 0, itemId);
  // Renumber only the rows whose place changed.
  for (const [n, id] of order.entries()) {
    if (list.find((r) => r.id === id)!.position === n + 1) continue;
    const { error } = await supabase.from("listing_media").update({ position: n + 1 }).eq("id", id);
    if (error) back(homeId, { error: friendly(error.message) });
  }
  back(homeId, { saved: dir === "first" ? "Now the first photo on the MLS." : "Order saved." });
}

// Add a tour link to this home (it goes on the listing) or to the whole
// community (so any home there can add it).
export async function addTour(formData: FormData) {
  const homeId = homeIdFrom(formData);
  await requireProfile();
  const supabase = await createClient();
  const url = String(formData.get("url") ?? "").trim();
  if (!/^https:\/\/\S+$/i.test(url)) back(homeId, { error: "Paste the full tour link, starting with https://" });
  const forCommunity = formData.get("scope") === "community";
  const { data: home } = await supabase.from("homes").select("community_id").eq("id", homeId).maybeSingle();
  if (!home) back(homeId, { error: "Home not found." });
  const title = String(formData.get("title") ?? "").trim().slice(0, 120) || null;
  const { error } = await supabase.from("virtual_tours").insert({
    home_id: forCommunity ? null : homeId,
    community_id: home.community_id,
    provider: detectProvider(url),
    url,
    branded: formData.get("branded") === "yes",
    title,
  });
  if (error) back(homeId, { error: friendly(error.message) });
  back(homeId, { saved: forCommunity ? "Tour saved for the whole community. Add it to this listing below." : "Tour added to the listing." });
}

// Move a tour to the trash (it comes off every listing).
export async function trashTour(formData: FormData) {
  const homeId = homeIdFrom(formData);
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.from("virtual_tours").update({ deleted_at: new Date().toISOString() }).eq("id", String(formData.get("tour_id"))).select("id");
  if (error) back(homeId, { error: friendly(error.message) });
  if (!data?.length) back(homeId, { error: "You don’t have permission to remove that tour." });
  back(homeId, { saved: "Tour moved to the trash." });
}
