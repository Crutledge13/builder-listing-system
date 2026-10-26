// Generated test pictures for demo media records, drawn right on the page.
// Real uploads never come through here; they're served from private storage
// with expiring links (see src/app/api/media/[id]/route.ts).
import { HomeArt } from "@/components/home-art";
import { CommunityArt, FloorPlanArt, RoomArt } from "@/components/media-art";

export type MediaRow = {
  id: string;
  title: string;
  kind: "photo" | "video" | "floor_plan";
  room: string | null;
  tags: string[];
  source: "demo" | "upload";
  demo_key: string | null;
  mime_type: string | null;
  home_id: string | null;
  community_id: string | null;
  builder_id: string;
  is_cover: boolean;
  mls_ready: boolean;
  sort_order: number;
  created_at: string;
  duration_seconds: number | null;
  homes: {
    unparsed_address: string;
    stories: number | null;
    plan_name: string | null;
    bedrooms_total: number | null;
    bathrooms_full: number | null;
    bathrooms_half: number | null;
    living_area: number | null;
  } | null;
  communities: { name: string } | null;
  builders: { name: string } | null;
};

export const MEDIA_SELECT =
  "id, title, kind, room, tags, source, demo_key, mime_type, home_id, community_id, builder_id, is_cover, mls_ready, sort_order, created_at, duration_seconds, homes(unparsed_address, stories, plan_name, bedrooms_total, bathrooms_full, bathrooms_half, living_area), communities(name), builders(name)";

const DEMO_VIDEOS = new Set(["video:home1", "video:home2", "video:home3", "video:community"]);

export function demoVideoFile(key: string) {
  return DEMO_VIDEOS.has(key) ? `${key.replace("video:", "")}.mp4` : null;
}

// The drawn picture for a demo item (or a video's still frame).
export function DemoArt({ m, className }: { m: MediaRow; className?: string }) {
  const [group, a, b] = (m.demo_key ?? "").split(":");
  const seed = m.home_id ?? m.community_id ?? m.id;
  const h = m.homes;
  if (group === "home") return <HomeArt seed={seed} stories={h?.stories} scene={b === "twilight" ? "twilight" : "day"} className={className} />;
  if (group === "room") return <RoomArt room={a as Parameters<typeof RoomArt>[0]["room"]} seed={seed} className={className} />;
  if (group === "floor_plan") {
    const baths = (h?.bathrooms_full ?? 0) + (h?.bathrooms_half ?? 0) * 0.5;
    return <FloorPlanArt plan={h?.plan_name ?? "Plan"} beds={h?.bedrooms_total ?? 3} baths={String(baths || 2)} sqft={h?.living_area ?? null} className={className} />;
  }
  if (group === "community") return <CommunityArt kind={a as Parameters<typeof CommunityArt>[0]["kind"]} name={m.communities?.name ?? ""} seed={seed} className={className} />;
  if (group === "video") {
    return a === "community"
      ? <CommunityArt kind="entrance" name={m.communities?.name ?? ""} seed={seed} className={className} />
      : <HomeArt seed={seed} stories={h?.stories} scene="golden" className={className} />;
  }
  return <HomeArt seed={seed} className={className} />;
}

export const ROOM_LABELS: Record<string, string> = {
  exterior: "Exterior",
  kitchen: "Kitchen",
  living: "Living room",
  dining: "Dining",
  primary_bedroom: "Primary bedroom",
  bedroom: "Bedroom",
  primary_bath: "Primary bath",
  bath: "Bath",
  backyard: "Backyard",
  floor_plan: "Floor plan",
  amenity: "Amenity",
  entrance: "Entrance",
  aerial: "Aerial",
  site_map: "Site plan",
  model_home: "Model home",
  other: "Other",
};
