import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadListingMedia } from "@/lib/listing-media";
import { cleanRooms } from "@/lib/rooms";
import { completeness, HOME_MLS_SELECT, MLS_BOARD_SELECT, sectionsForBoard, type HomeForMls, type MlsBoard } from "@/lib/mls-fields";

// Everything our team needs to enter one home on the MLS.
export async function loadMlsSheet(supabase: SupabaseClient, homeId: string) {
  const { data: home } = await supabase.from("homes").select(HOME_MLS_SELECT).eq("id", homeId).maybeSingle();
  if (!home) return null;
  const h = home as unknown as HomeForMls & { community_id: string; builder_id: string; unparsed_address: string; workflow_status: string; mls_number: string | null; market_status: string | null; mls_board: string | null; plan_name: string | null };
  const [{ data: rows }, listing, { data: boardRow }] = await Promise.all([
    supabase.from("mls_details").select("home_id, community_id, data, sources, updated_at").or(`home_id.eq.${homeId},community_id.eq.${h.community_id}`),
    // The listing: photos, video and tours in MLS order.
    loadListingMedia(supabase, { id: h.id, builder_id: h.builder_id, community_id: h.community_id, plan_name: h.plan_name }),
    h.mls_board ? supabase.from("mls_boards").select(MLS_BOARD_SELECT).eq("code", h.mls_board).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const board = (boardRow ?? null) as MlsBoard | null;
  const sections = sectionsForBoard(board);
  const homeDetails = (rows?.find((r) => r.home_id === homeId)?.data ?? {}) as Record<string, unknown>;
  const communityDetails = (rows?.find((r) => r.community_id === h.community_id)?.data ?? {}) as Record<string, unknown>;
  return {
    home: h,
    homeDetails,
    communityDetails,
    photos: listing.photos,
    mlsPhotos: listing.mlsPhotos,
    videos: listing.videos,
    tours: listing.tours,
    board,
    sections,
    rooms: cleanRooms(((h as unknown as { mls_fields?: Record<string, unknown> | null }).mls_fields ?? {}).Rooms),
    score: completeness(h, homeDetails, communityDetails, sections),
  };
}

export type MlsSheet = NonNullable<Awaited<ReturnType<typeof loadMlsSheet>>>;
