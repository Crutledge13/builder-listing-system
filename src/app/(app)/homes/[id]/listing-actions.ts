"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { detectProvider } from "@/lib/listing-media";
import { setCover } from "@/lib/set-cover";
import { aiTaggingAvailable, tagMedia } from "@/lib/ai-tagging";

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

// Save a new order: renumber only the rows whose place changed. Returns an
// error message, or null when it saved.
async function saveOrder(supabase: Awaited<ReturnType<typeof createClient>>, list: { id: string; position: number }[], order: string[]) {
  for (const [n, id] of order.entries()) {
    if (list.find((r) => r.id === id)!.position === n + 1) continue;
    const { error } = await supabase.from("listing_media").update({ position: n + 1 }).eq("id", id);
    if (error) return friendly(error.message);
  }
  return null;
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
  const problem = await saveOrder(supabase, list, order);
  if (problem) back(homeId, { error: problem });
  back(homeId, { saved: dir === "first" ? "Now the first photo on the MLS." : "Order saved." });
}

// Drag and drop: put one item where another one is (the one there moves
// along). Called from the photo grid in the browser, so it returns instead
// of redirecting; the grid refreshes the page.
export async function dropListingItem(homeIdRaw: string, itemId: string, beforeId: string | null): Promise<{ error?: string }> {
  if (!ID.test(homeIdRaw) || !ID.test(itemId) || (beforeId !== null && !ID.test(beforeId))) return { error: "Couldn’t move that photo." };
  await requireProfile();
  const supabase = await createClient();
  const { data: rows } = await supabase.from("listing_media").select("id, position").eq("home_id", homeIdRaw).order("position");
  const list = rows ?? [];
  if (!list.some((r) => r.id === itemId)) return { error: "That photo isn’t on the listing any more." };
  const order = list.map((r) => r.id).filter((id) => id !== itemId);
  const at = beforeId === null ? order.length : order.indexOf(beforeId);
  order.splice(at < 0 ? order.length : at, 0, itemId);
  const problem = await saveOrder(supabase, list, order);
  if (problem) return { error: problem };
  revalidatePath(`/homes/${homeIdRaw}`, "layout");
  return {};
}

// Rename a photo right from the grid (tester notes: no need to open each one).
export async function renameListingPhoto(mediaId: string, name: string): Promise<{ error?: string }> {
  const title = name.trim().replace(/\s+/g, " ").slice(0, 140);
  if (!ID.test(mediaId)) return { error: "Couldn’t rename that photo." };
  if (!title) return { error: "Give it a name." };
  await requireProfile();
  const supabase = await createClient();
  const { data: m } = await supabase.from("media").select("id, caption").eq("id", mediaId).maybeSingle();
  if (!m) return { error: "That photo isn’t available to you." };
  // The grid shows the caption when there is one, so the new name replaces it
  // too (and counts as a person's edit, so AI never changes it back).
  const { data, error } = await supabase.from("media").update(m.caption ? { title, caption: title } : { title }).eq("id", mediaId).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "Your role can’t rename photos." };
  revalidatePath("/media");
  revalidatePath("/homes", "layout");
  return {};
}

// Ask AI to label this home's photos that have no room yet (for example ones
// uploaded before AI was switched on). 1 AI credit per photo.
export async function labelListingPhotos(formData: FormData) {
  const homeId = homeIdFrom(formData);
  await requireProfile();
  if (!aiTaggingAvailable()) back(homeId, { error: "AI labeling is off until the ANTHROPIC_API_KEY setting is added in Vercel." });
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("media")
    .select("id")
    .eq("home_id", homeId)
    .eq("kind", "photo")
    .eq("source", "upload")
    .is("room", null)
    .is("deleted_at", null)
    .limit(60);
  // (HEIC photos without a screen-size copy are skipped by tagMedia itself.)
  const ids = (rows ?? []).map((r) => r.id as string);
  if (!ids.length) back(homeId, { saved: "Every photo already has a room." });
  const { data: marked } = await supabase.from("media").update({ ai_status: "pending" }).in("id", ids).select("id");
  if (!marked?.length) back(homeId, { error: "Your role can’t change these photos." });
  after(() => tagMedia(supabase, marked.map((r) => r.id as string)));
  back(homeId, { saved: `AI is labeling ${marked.length} ${marked.length === 1 ? "photo" : "photos"}. Refresh in a minute to see the rooms and names.` });
}

// "Make cover": the picture on this home's cards, and photo 1 on the MLS.
export async function makeListingCover(formData: FormData) {
  const homeId = homeIdFrom(formData);
  await requireProfile();
  const supabase = await createClient();
  const problem = await setCover(supabase, String(formData.get("media_id")));
  if (problem) back(homeId, { error: problem });
  revalidatePath("/homes");
  revalidatePath("/communities", "layout");
  back(homeId, { saved: "Cover photo set. It shows on this home’s cards and is now photo 1 on the MLS." });
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
