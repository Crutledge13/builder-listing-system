"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canManageMedia } from "@/lib/permissions";
import { aiTaggingAvailable, tagMedia } from "@/lib/ai-tagging";
import type { UploadedFile } from "@/app/(app)/media/upload/actions";
import { ELEVATION_TAG, type PlanMediaKind } from "@/lib/plan-media";

function titleFrom(name: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Untitled";
}

// Records photos (and video) already uploaded from the browser into a floor
// plan's library: the model home pictures homes on this plan borrow until
// they have their own (media with plan_name and no home or community).
export async function recordPlanPhotos(planId: string, files: UploadedFile[], kind: PlanMediaKind = "photos"): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const me = await requireProfile();
  if (!canManageMedia(me.role)) return { ok: false, error: "Your role can’t upload photos." };
  const supabase = await createClient();
  // Reading the plan as the person proves they can see it.
  const { data: plan } = await supabase.from("floor_plans").select("id, name, builder_id").eq("id", planId).maybeSingle();
  if (!plan) return { ok: false, error: "That floor plan isn’t available to you." };

  const prefix = `${plan.builder_id}/plans/${plan.id}/`;
  const rows = files
    .filter((f) => f.path.startsWith(prefix))
    .slice(0, 100)
    .map((f, i) => ({
      builder_id: plan.builder_id,
      community_id: null,
      home_id: null,
      plan_name: plan.name,
      kind: f.type.startsWith("video/") ? "video" : kind === "drawings" ? "floor_plan" : "photo",
      // Set by the slot it was added in, so AI doesn't guess these.
      room: kind === "drawings" ? "floor_plan" : kind === "elevations" ? "exterior" : null,
      title: titleFrom(f.name),
      tags: kind === "elevations" ? [ELEVATION_TAG] : [],
      source: "upload",
      storage_path: f.path,
      thumb_path: f.thumbPath?.startsWith(prefix) ? f.thumbPath : null,
      web_path: f.webPath?.startsWith(prefix) ? f.webPath : null,
      mime_type: f.type || null,
      size_bytes: f.size,
      // OK for the MLS unless the AI (or a person) finds something wrong with it.
      mls_ready: true,
      sort_order: 100 + i,
      // Drawings aren't photos of rooms; AI looks only at the others.
      ai_status: aiTaggingAvailable() && kind !== "drawings" && f.type.startsWith("image/") ? "pending" : null,
    }));
  if (!rows.length) return { ok: false, error: "No files to record." };

  const { data: inserted, error } = await supabase.from("media").insert(rows).select("id");
  if (error) return { ok: false, error: error.message.includes("row-level security") ? "Your role can’t add photos for this builder." : `Couldn’t save: ${error.message}` };
  revalidatePath(`/plans/${plan.id}`);
  revalidatePath("/media");
  const ids = (inserted ?? []).map((r) => r.id as string);
  if (kind !== "drawings") after(() => tagMedia(supabase, ids));
  return { ok: true, count: rows.length };
}
