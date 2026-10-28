"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aiTaggingAvailable, tagMedia } from "@/lib/ai-tagging";

function back(id: string, params: Record<string, string>): never {
  redirect(`/media/${id}?${new URLSearchParams(params).toString()}`);
}

const ROOMS = new Set(["exterior", "kitchen", "living", "dining", "primary_bedroom", "bedroom", "primary_bath", "bath", "backyard", "floor_plan", "amenity", "entrance", "aerial", "site_map", "model_home", "other"]);

export async function saveMedia(formData: FormData) {
  const id = String(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  const room = String(formData.get("room") ?? "");
  // Picked from the shared list; the database also drops anything not on it.
  const tags = formData.getAll("tag").map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  if (!title) back(id, { error: "Give it a title." });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media")
    .update({ title, room: ROOMS.has(room) ? room : null, tags, mls_ready: formData.get("mls_ready") === "on" })
    .eq("id", id)
    .select("id");
  if (error) back(id, { error: `Couldn’t save: ${error.message}` });
  if (!data?.length) back(id, { error: "Your role can’t edit media." });
  revalidatePath("/media");
  back(id, { saved: "1" });
}

export async function makeCover(formData: FormData) {
  const id = String(formData.get("id"));
  const homeId = String(formData.get("home_id") ?? "");
  const supabase = await createClient();
  if (homeId) {
    await supabase.from("media").update({ is_cover: false }).eq("home_id", homeId).eq("is_cover", true);
  }
  const { data } = await supabase.from("media").update({ is_cover: true }).eq("id", id).select("id");
  if (!data?.length) back(id, { error: "Your role can’t change the cover photo." });
  revalidatePath("/media");
  back(id, { saved: "cover" });
}

export async function setTrashed(formData: FormData) {
  const id = String(formData.get("id"));
  const trash = formData.get("trash") === "1";
  const supabase = await createClient();
  const { data } = await supabase
    .from("media")
    .update({ deleted_at: trash ? new Date().toISOString() : null, is_cover: false })
    .eq("id", id)
    .select("id");
  if (!data?.length) back(id, { error: "Your role can’t remove media." });
  revalidatePath("/media");
  back(id, { saved: trash ? "trashed" : "restored" });
}

export async function rerunAi(formData: FormData) {
  const id = String(formData.get("id"));
  if (!aiTaggingAvailable()) back(id, { error: "AI tagging is off until the ANTHROPIC_API_KEY setting is added in Vercel." });
  const supabase = await createClient();
  // Let AI replace its own earlier room pick (a person's pick is never touched).
  const { data } = await supabase.from("media").update({ ai_status: "pending" }).eq("id", id).select("id");
  if (!data?.length) back(id, { error: "You can’t change this file." });
  await tagMedia(supabase, [id]);
  revalidatePath("/media");
  const { data: after } = await supabase.from("media").select("ai_status").eq("id", id).maybeSingle();
  if (after?.ai_status === "no_credits") back(id, { error: "This month’s AI credits are used up, so AI didn’t look at it. Ask our team if you need more." });
  back(id, { saved: "ai" });
}

// A person looked at an AI warning (people, signs, text, blur) and says the
// photo is fine for the MLS. Clears it from the listing's readiness check.
export async function clearAiWarning(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("media").update({ mls_ready: true }).eq("id", id).select("home_id");
  if (error) back(id, { error: `Couldn’t save: ${error.message}` });
  if (!data?.length) back(id, { error: "Your role can’t edit media." });
  revalidatePath("/media");
  if (data[0].home_id) revalidatePath(`/homes/${data[0].home_id}`);
  back(id, { saved: "cleared" });
}

// Ask our team to add a tag to the shared list.
export async function requestTag(formData: FormData) {
  const mediaId = String(formData.get("media_id"));
  const label = String(formData.get("label") ?? "").trim().slice(0, 40);
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  if (!label) back(mediaId, { error: "Type the tag you’d like." });
  const supabase = await createClient();
  const { data: existing } = await supabase.from("media_tags").select("label, aliases").eq("active", true);
  const match = (existing ?? []).find((t) => t.label.toLowerCase() === label.toLowerCase() || (t.aliases as string[]).includes(label.toLowerCase()));
  if (match) back(mediaId, { error: `“${match.label}” is already on the list. Pick it in the tags box.` });
  const { error } = await supabase.from("media_tag_requests").insert({ label, note, media_id: mediaId });
  if (error) back(mediaId, { error: "Your role can’t ask for tags." });
  back(mediaId, { saved: "tagreq" });
}
