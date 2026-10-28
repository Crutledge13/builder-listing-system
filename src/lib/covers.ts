import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";

// The real photo to show on a card instead of the drawn picture. Picked in the
// database (public.home_cover_photos / community_cover_photos): the chosen
// cover, else the first photo on the listing. Two small queries for a whole
// list, never one per card.

async function rows(supabase: SupabaseClient, ids: string[]) {
  if (!ids.length) return new Map<string, MediaRow>();
  const { data } = await supabase.from("media").select(MEDIA_SELECT).in("id", ids);
  return new Map(((data ?? []) as unknown as MediaRow[]).map((m) => [m.id, m]));
}

export async function loadHomeCovers(supabase: SupabaseClient, homeIds: string[]): Promise<Map<string, MediaRow>> {
  const ids = [...new Set(homeIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const { data } = await supabase.rpc("home_cover_photos", { p_homes: ids });
  const pairs = (data ?? []) as { home_id: string; media_id: string }[];
  const media = await rows(supabase, pairs.map((p) => p.media_id));
  return new Map(pairs.flatMap((p) => (media.get(p.media_id) ? [[p.home_id, media.get(p.media_id)!] as const] : [])));
}

export async function loadCommunityCovers(supabase: SupabaseClient, communityIds: string[]): Promise<Map<string, MediaRow>> {
  const ids = [...new Set(communityIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const { data } = await supabase.rpc("community_cover_photos", { p_communities: ids });
  const pairs = (data ?? []) as { community_id: string; media_id: string }[];
  const media = await rows(supabase, pairs.map((p) => p.media_id));
  return new Map(pairs.flatMap((p) => (media.get(p.media_id) ? [[p.community_id, media.get(p.media_id)!] as const] : [])));
}
