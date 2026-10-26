"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type UploadedFile = { path: string; name: string; size: number; type: string };

const ROOMS = new Set(["exterior", "kitchen", "living", "dining", "primary_bedroom", "bedroom", "primary_bath", "bath", "backyard", "floor_plan", "amenity", "entrance", "aerial", "site_map", "model_home", "other"]);

function titleFrom(name: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Untitled";
}

// Records files that were already uploaded to storage from the browser.
export async function recordUploads(input: {
  communityId: string;
  homeId: string | null;
  room: string | null;
  tags: string[];
  files: UploadedFile[];
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const supabase = await createClient();

  // Reading the community (and home) as the user proves they can see them.
  const { data: community } = await supabase.from("communities").select("id, builder_id").eq("id", input.communityId).maybeSingle();
  if (!community) return { ok: false, error: "That community isn’t available to you." };
  if (input.homeId) {
    const { data: home } = await supabase.from("homes").select("id").eq("id", input.homeId).eq("community_id", community.id).maybeSingle();
    if (!home) return { ok: false, error: "That home isn’t in this community." };
  }

  const prefix = `${community.builder_id}/${community.id}/`;
  const rows = input.files
    .filter((f) => f.path.startsWith(prefix))
    .map((f, i) => ({
      builder_id: community.builder_id,
      community_id: community.id,
      home_id: input.homeId,
      kind: f.type.startsWith("video/") ? "video" : input.room === "floor_plan" ? "floor_plan" : "photo",
      room: input.room && ROOMS.has(input.room) ? input.room : null,
      title: titleFrom(f.name),
      tags: input.tags.slice(0, 30),
      source: "upload",
      storage_path: f.path,
      mime_type: f.type || null,
      size_bytes: f.size,
      mls_ready: false,
      sort_order: 100 + i,
    }));
  if (rows.length === 0) return { ok: false, error: "No files to record." };

  const { error } = await supabase.from("media").insert(rows);
  if (error) {
    return {
      ok: false,
      error: error.message.includes("row-level security") ? "Your role can’t add media for this builder." : `Couldn’t save: ${error.message}`,
    };
  }
  revalidatePath("/media");
  return { ok: true, count: rows.length };
}
