"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function back(id: string, params: Record<string, string>): never {
  redirect(`/media/${id}?${new URLSearchParams(params).toString()}`);
}

const ROOMS = new Set(["exterior", "kitchen", "living", "dining", "primary_bedroom", "bedroom", "primary_bath", "bath", "backyard", "floor_plan", "amenity", "entrance", "aerial", "site_map", "model_home", "other"]);

export async function saveMedia(formData: FormData) {
  const id = String(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  const room = String(formData.get("room") ?? "");
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 30);
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
