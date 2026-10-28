import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";

// Virtual tours: 3D and video tour links (Matterport, Zillow 3D Home, ...).
export type Tour = {
  id: string;
  home_id: string | null;
  community_id: string;
  provider: TourProvider;
  url: string;
  branded: boolean;
  title: string | null;
  added_by_role: string | null;
  created_at: string;
};

export const TOUR_PROVIDERS = {
  matterport: "Matterport",
  zillow_3d: "Zillow 3D Home",
  iguide: "iGUIDE",
  cupix: "Cupix",
  youtube: "YouTube",
  vimeo: "Vimeo",
  other: "Other tour",
} as const;
export type TourProvider = keyof typeof TOUR_PROVIDERS;

// Which tour service a link is from, by its web address.
export function detectProvider(url: string): TourProvider {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host.endsWith("matterport.com")) return "matterport";
  if (host.endsWith("zillow.com")) return "zillow_3d";
  if (host.endsWith("goiguide.com") || host.endsWith("iguide.com") || host.includes("youriguide")) return "iguide";
  if (host.endsWith("cupix.com")) return "cupix";
  if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube";
  if (host.endsWith("vimeo.com")) return "vimeo";
  return "other";
}

export const TOUR_SELECT = "id, home_id, community_id, provider, url, branded, title, added_by_role, created_at";

export type ListingItem =
  | { id: string; position: number; type: "media"; media: MediaRow }
  | { id: string; position: number; type: "tour"; tour: Tour };

type HomeRef = { id: string; builder_id: string; community_id: string; plan_name: string | null };

// One home's listing (photos, floor plans, video and tours in MLS order), plus
// the optional community and floor-plan items not on it yet.
export async function loadListingMedia(supabase: SupabaseClient, home: HomeRef) {
  const { data: rows } = await supabase
    .from("listing_media")
    .select("id, position, media_id, tour_id")
    .eq("home_id", home.id)
    .order("position");
  const list = rows ?? [];
  const mediaIds = list.map((r) => r.media_id).filter(Boolean) as string[];
  const tourIds = list.map((r) => r.tour_id).filter(Boolean) as string[];

  const [{ data: media }, { data: tours }, { data: community }, { data: plan }, { data: communityTours }] = await Promise.all([
    mediaIds.length ? supabase.from("media").select(MEDIA_SELECT).in("id", mediaIds) : Promise.resolve({ data: [] }),
    tourIds.length ? supabase.from("virtual_tours").select(TOUR_SELECT).in("id", tourIds) : Promise.resolve({ data: [] }),
    supabase
      .from("media")
      .select(MEDIA_SELECT)
      .eq("community_id", home.community_id)
      .is("home_id", null)
      .in("kind", ["photo", "video", "floor_plan"])
      .is("deleted_at", null)
      .order("kind")
      .order("sort_order"),
    home.plan_name
      ? supabase
          .from("media")
          .select(MEDIA_SELECT)
          .eq("builder_id", home.builder_id)
          .eq("plan_name", home.plan_name)
          .is("home_id", null)
          .is("community_id", null)
          .in("kind", ["photo", "video", "floor_plan"])
          .is("deleted_at", null)
          .order("sort_order")
      : Promise.resolve({ data: [] }),
    supabase.from("virtual_tours").select(TOUR_SELECT).eq("community_id", home.community_id).is("home_id", null).is("deleted_at", null).order("created_at"),
  ]);

  const mediaById = new Map(((media ?? []) as unknown as MediaRow[]).map((m) => [m.id, m]));
  const tourById = new Map(((tours ?? []) as Tour[]).map((t) => [t.id, t]));
  const items: ListingItem[] = [];
  for (const r of list) {
    if (r.media_id && mediaById.has(r.media_id)) items.push({ id: r.id, position: r.position, type: "media", media: mediaById.get(r.media_id)! });
    if (r.tour_id && tourById.has(r.tour_id)) items.push({ id: r.id, position: r.position, type: "tour", tour: tourById.get(r.tour_id)! });
  }
  const onListing = new Set([...mediaIds, ...tourIds]);
  const notOn = <T extends { id: string }>(xs: T[]) => xs.filter((x) => !onListing.has(x.id));
  // Social media reels never go on the MLS listing (the database refuses them too).
  const notReel = (xs: MediaRow[]) => xs.filter((m) => !isReel(m));

  const photos = items.filter((i): i is Extract<ListingItem, { type: "media" }> => i.type === "media" && i.media.kind !== "video");
  return {
    items,
    photos: photos.map((i) => i.media),
    mlsPhotos: photos.map((i) => i.media).filter((m) => m.mls_ready),
    videos: items.filter((i) => i.type === "media" && i.media.kind === "video").map((i) => (i as Extract<ListingItem, { type: "media" }>).media),
    tours: items.filter((i): i is Extract<ListingItem, { type: "tour" }> => i.type === "tour").map((i) => i.tour),
    community: notReel(notOn((community ?? []) as unknown as MediaRow[])),
    plan: notReel(notOn((plan ?? []) as unknown as MediaRow[])),
    communityTours: notOn((communityTours ?? []) as Tour[]),
  };
}

// A vertical social media reel (for realtors to post; never on the MLS).
export const REEL_TAG = "Vertical reel";
export function isReel(m: { kind: string; tags?: string[] | null }) {
  return m.kind === "video" && !!m.tags?.includes(REEL_TAG);
}

export type ListingMedia = Awaited<ReturnType<typeof loadListingMedia>>;
