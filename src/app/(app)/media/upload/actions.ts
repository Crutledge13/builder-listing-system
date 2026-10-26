"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { after } from "next/server";
import { aiTaggingAvailable, tagMedia } from "@/lib/ai-tagging";

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
  const me = await requireProfile();

  let community: { id: string; builder_id: string } | null = null;
  if (me.role === "photographer") {
    // Photographers: the upload must match one of their open jobs.
    let q = supabase
      .from("media_requests")
      .select("community_id, builder_id")
      .eq("photographer_id", me.id)
      .eq("community_id", input.communityId)
      .in("status", ["assigned", "scheduled", "delivered"]);
    q = input.homeId ? q.eq("home_id", input.homeId) : q.is("home_id", null);
    const { data: job } = await q.limit(1).maybeSingle();
    if (!job) return { ok: false, error: "That isn’t one of your open jobs." };
    community = { id: job.community_id, builder_id: job.builder_id };
  } else {
    // Reading the community (and home) as the user proves they can see them.
    const { data } = await supabase.from("communities").select("id, builder_id").eq("id", input.communityId).maybeSingle();
    if (!data) return { ok: false, error: "That community isn’t available to you." };
    community = data;
    if (input.homeId) {
      const { data: home } = await supabase.from("homes").select("id").eq("id", input.homeId).eq("community_id", community.id).maybeSingle();
      if (!home) return { ok: false, error: "That home isn’t in this community." };
    }
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
      ai_status: aiTaggingAvailable() && f.type.startsWith("image/") ? "pending" : null,
    }));
  if (rows.length === 0) return { ok: false, error: "No files to record." };

  const { data: inserted, error } = await supabase.from("media").insert(rows).select("id");
  if (error) {
    return {
      ok: false,
      error: error.message.includes("row-level security") ? "Your role can’t add media for this builder." : `Couldn’t save: ${error.message}`,
    };
  }
  revalidatePath("/media");
  // AI looks at the photos after we've answered, so nobody waits on it.
  const ids = (inserted ?? []).map((r) => r.id as string);
  after(() => tagMedia(supabase, ids));
  return { ok: true, count: rows.length };
}
