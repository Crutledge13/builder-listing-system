import Link from "next/link";
import { baths, money, num } from "@/lib/format";
import type { WorkflowStatus } from "@/lib/permissions";
import { MarketBadge, StageText, StatusBadge } from "@/components/badges";
import { HomeArt } from "@/components/home-art";
import { MediaPicture } from "@/components/media-tile";
import type { MediaRow } from "@/lib/demo-media";

export type HomeCardData = {
  id: string;
  builder_id?: string;
  community_id?: string | null;
  unparsed_address: string;
  city: string;
  plan_name: string | null;
  list_price: number | null;
  bedrooms_total: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  living_area: number | null;
  stories: number | null;
  build_stage: string;
  workflow_status: WorkflowStatus;
  mls_number: string | null;
  market_status?: string | null;
  communities: { name: string } | null;
  builders: { name: string } | null;
};

export const HOME_CARD_SELECT =
  "id, unparsed_address, city, plan_name, lot_number, list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, stories, build_stage, workflow_status, mls_number, market_status, community_id, builder_id, communities(name), builders(name)";

// cover: the home's real card photo (chosen cover, else first listing photo; loadHomeCovers). Drawn picture until there is one.
export function HomeCard({ h, showBuilder, showCommunity = true, incentive, cover, priority }: { h: HomeCardData; showBuilder?: boolean; showCommunity?: boolean; incentive?: { title: string; more: number }; cover?: MediaRow; priority?: boolean }) {
  return (
    <Link href={`/homes/${h.id}`} className="group block">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-soft">
        {cover ? (
          <MediaPicture m={cover} priority={priority} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <HomeArt seed={h.id} stories={h.stories} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <StatusBadge status={h.workflow_status} floating />
          <MarketBadge status={h.market_status} floating />
        </div>
        {h.mls_number && (
          <span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
            MLS {h.mls_number}
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-bold tabular-nums">{money(h.list_price)}</span>
          <span className="text-xs text-muted"><StageText stage={h.build_stage} /></span>
        </div>
        <div className="mt-0.5 flex gap-3 text-[15px]">
          <span><b className="font-semibold">{h.bedrooms_total ?? "—"}</b> bd</span>
          <span><b className="font-semibold">{baths(h.bathrooms_full, h.bathrooms_half)}</b> ba</span>
          <span><b className="font-semibold">{num(h.living_area)}</b> sq ft</span>
        </div>
        <div className="mt-1 truncate text-[15px] group-hover:underline">{h.unparsed_address}, {h.city}</div>
        <div className="truncate text-sm text-muted">
          {h.plan_name} plan{showCommunity ? ` in ${h.communities?.name}` : ""}
          {showBuilder ? `, ${h.builders?.name.replace(" (demo)", "")}` : ""}
        </div>
        {incentive && (
          <div className="mt-1.5 truncate text-sm font-medium text-violet-800" title={incentive.title}>
            <span aria-hidden>★ </span>{incentive.title}{incentive.more > 0 ? ` +${incentive.more} more` : ""}
          </div>
        )}
      </div>
    </Link>
  );
}

export function HomeGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>;
}
