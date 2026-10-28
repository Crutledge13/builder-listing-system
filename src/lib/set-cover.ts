import type { SupabaseClient } from "@supabase/supabase-js";

// Make one photo the cover. For a home it also becomes photo 1 on the MLS
// listing, so the cards, the home page and the MLS all lead with the same
// picture. For a community photo (no home) it's the community's card picture.
// Runs with the person's own access: the database decides who may change it.
// Returns a problem in plain words, or null.
export async function setCover(supabase: SupabaseClient, mediaId: string): Promise<string | null> {
  const { data: m } = await supabase.from("media").select("id, home_id, community_id, kind, deleted_at").eq("id", mediaId).maybeSingle();
  if (!m || m.deleted_at) return "That photo is gone.";
  if (m.kind !== "photo") return "Only a photo can be the cover.";

  // Clear the old cover for the same home (or the same community's own photos).
  const clear = supabase.from("media").update({ is_cover: false }).eq("is_cover", true).neq("id", m.id);
  const { error: clearError } = m.home_id
    ? await clear.eq("home_id", m.home_id)
    : await clear.eq("community_id", m.community_id).is("home_id", null);
  if (clearError) return "Your role can’t change the cover photo.";
  const { data, error } = await supabase.from("media").update({ is_cover: true }).eq("id", m.id).select("id");
  if (error || !data?.length) return "Your role can’t change the cover photo.";

  // Home photo: move it to the front of the listing.
  if (m.home_id) {
    const { data: rows } = await supabase.from("listing_media").select("id, position, media_id").eq("home_id", m.home_id).order("position");
    const list = rows ?? [];
    const item = list.find((r) => r.media_id === m.id);
    if (item && list[0]?.id !== item.id) {
      const order = [item.id, ...list.filter((r) => r.id !== item.id).map((r) => r.id)];
      for (const [n, id] of order.entries()) {
        if (list.find((r) => r.id === id)!.position === n + 1) continue;
        await supabase.from("listing_media").update({ position: n + 1 }).eq("id", id);
      }
    }
  }
  return null;
}
