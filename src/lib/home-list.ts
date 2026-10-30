import type { FColumn, FRow } from "@/components/filter-table";
import type { HomeCardData } from "@/components/home-card";
import { baths, money, num } from "@/lib/format";
import { MARKET_LABELS, STAGE_LABELS, STATUS_LABELS, type MarketStatus } from "@/lib/permissions";

// The list view of homes (Homes and each community's page; owners, 29 Oct
// 2026): the key facts for every home on one screen, with search, filters and
// sorting. Add HOME_LIST_EXTRA to the HOME_CARD_SELECT query.
export type ListHome = HomeCardData & { live_at?: string | null; expected_close_date?: string | null };

export const HOME_LIST_EXTRA = ", live_at, expected_close_date";

export function HOME_LIST_COLUMNS(staff: boolean, community = true): FColumn[] {
  return [
    { label: "Home" }, ...(community ? [{ label: "Community" }] : []), { label: "Plan" }, { label: "Price", numeric: true }, { label: "Beds / baths" },
    { label: "Sq ft", numeric: true }, { label: "Stage" }, { label: "Listing" }, { label: "Sale" }, { label: "Days on MLS", numeric: true }, { label: "MLS #" },
    ...(staff ? [{ label: "Builder" }] : []),
  ];
}

// Days since a date. Outside any component: pages are drawn once per request.
function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

// One home as a row of the list view: the key facts at a glance.
export function homeRow(h: ListHome, staff: boolean, community = true): FRow {
  const sale = h.market_status ? MARKET_LABELS[h.market_status as MarketStatus] ?? h.market_status : h.workflow_status === "live_on_mls" ? "Active" : "Not listed yet";
  const days = h.workflow_status === "live_on_mls" && h.live_at && !["sold", "withdrawn"].includes(h.market_status ?? "")
    ? daysSince(h.live_at) : null;
  const stage = STAGE_LABELS[h.build_stage] ?? h.build_stage;
  const communityName = h.communities?.name ?? "";
  return {
    cells: [
      { text: h.unparsed_address, href: `/homes/${h.id}` },
      ...(community ? [{ text: communityName }] : []),
      { text: h.plan_name ?? "" },
      { text: h.list_price ? money(h.list_price) : "—", sort: h.list_price ? Number(h.list_price) : -1 },
      { text: `${h.bedrooms_total ?? "—"} / ${baths(h.bathrooms_full, h.bathrooms_half) || "—"}`, sort: h.bedrooms_total ?? -1 },
      { text: h.living_area ? num(h.living_area) : "—", sort: h.living_area ?? -1 },
      { text: stage },
      { text: STATUS_LABELS[h.workflow_status] },
      { text: sale + (h.market_status === "under_contract" && h.expected_close_date ? `, closes ${new Date(h.expected_close_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""), tone: h.market_status === "under_contract" ? "good" : undefined },
      { text: days === null ? "—" : String(days), sort: days ?? -1, tone: days !== null && days > 90 ? "warn" : undefined },
      { text: h.mls_number ?? "" },
      ...(staff ? [{ text: (h.builders?.name ?? "").replace(" (demo)", "") }] : []),
    ],
    tags: { community: communityName, plan: h.plan_name ?? "", status: STATUS_LABELS[h.workflow_status], sale, stage, builder: (h.builders?.name ?? "").replace(" (demo)", "") },
  };
}
