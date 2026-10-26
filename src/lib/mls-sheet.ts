import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";
import { completeness, HOME_MLS_SELECT, MLS_BOARD_SELECT, sectionsForBoard, type HomeForMls, type MlsBoard } from "@/lib/mls-fields";

// Everything our team needs to enter one home on the MLS.
export async function loadMlsSheet(supabase: SupabaseClient, homeId: string) {
  const { data: home } = await supabase.from("homes").select(HOME_MLS_SELECT).eq("id", homeId).maybeSingle();
  if (!home) return null;
  const h = home as unknown as HomeForMls & { community_id: string; builder_id: string; unparsed_address: string; workflow_status: string; mls_number: string | null; market_status: string | null; mls_board: string | null };
  const [{ data: rows }, { data: photos }, { data: boardRow }] = await Promise.all([
    supabase.from("mls_details").select("home_id, community_id, data, sources, updated_at").or(`home_id.eq.${homeId},community_id.eq.${h.community_id}`),
    supabase
      .from("media")
      .select(MEDIA_SELECT)
      .eq("home_id", homeId)
      .in("kind", ["photo", "floor_plan"])
      .is("deleted_at", null)
      .order("is_cover", { ascending: false })
      .order("sort_order"),
    h.mls_board ? supabase.from("mls_boards").select(MLS_BOARD_SELECT).eq("code", h.mls_board).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const board = (boardRow ?? null) as MlsBoard | null;
  const sections = sectionsForBoard(board);
  const homeDetails = (rows?.find((r) => r.home_id === homeId)?.data ?? {}) as Record<string, unknown>;
  const communityDetails = (rows?.find((r) => r.community_id === h.community_id)?.data ?? {}) as Record<string, unknown>;
  const all = (photos ?? []) as unknown as MediaRow[];
  return {
    home: h,
    homeDetails,
    communityDetails,
    photos: all,
    mlsPhotos: all.filter((m) => m.mls_ready),
    board,
    sections,
    score: completeness(h, homeDetails, communityDetails, sections),
  };
}

export type MlsSheet = NonNullable<Awaited<ReturnType<typeof loadMlsSheet>>>;
