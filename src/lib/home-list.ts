import type { FColumn, FRow } from "@/components/filter-table";
import type { HomeCardData } from "@/components/home-card";
import { baths, money, num } from "@/lib/format";
import { MARKET_LABELS, STAGE_LABELS, STATUS_LABELS, type MarketStatus } from "@/lib/permissions";

// The list view of homes (Homes and each community's page; owners, 29 Oct
// 2026): the key facts for every home on one screen, with search, filters and
// sorting. Add HOME_LIST_EXTRA to the HOME_CARD_SELECT query.
export type ListHome = HomeCardData & { live_at?: string | null; expected_close_date?: string | null };

export const HOME_LIST_EXTRA = ", live_at, expected_close_date";

export function HOME_LIST_COLUMNS(staff: boolean, community = true, needsHeader?: string): FColumn[] {
  return [
    { label: "Home" }, ...(needsHeader ? [{ label: needsHeader }] : []), ...(community ? [{ label: "Community" }] : []), { label: "Plan" }, { label: "Price", numeric: true }, { label: "Beds / baths" },
    { label: "Sq ft", numeric: true }, { label: "Stage" }, { label: "Listing" }, { label: "Sale" }, { label: "Days on MLS", numeric: true }, { label: "MLS #" },
    ...(staff ? [{ label: "Builder" }] : []),
  ];
}

// Days since a date. Outside any component: pages are drawn once per request.
function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

// One home as a row of the list view: the key facts at a glance. `needs` is
// what this home needs from the person looking (loadNeedsYou); pass the map
// to add the "Needs you" column and put those homes first on phones.
export function homeRow(h: ListHome, staff: boolean, community = true, needs?: Map<string, string>): FRow {
  const sale = h.market_status ? MARKET_LABELS[h.market_status as MarketStatus] ?? h.market_status : h.workflow_status === "live_on_mls" ? "Active" : "Not listed yet";
  const days = h.workflow_status === "live_on_mls" && h.live_at && !["sold", "withdrawn"].includes(h.market_status ?? "")
    ? daysSince(h.live_at) : null;
  const stage = STAGE_LABELS[h.build_stage] ?? h.build_stage;
  const communityName = h.communities?.name ?? "";
  const builderName = (h.builders?.name ?? "").replace(" (demo)", "");
  const why = needs?.get(h.id);
  const bedBath = h.bedrooms_total ? `${h.bedrooms_total} bd / ${baths(h.bathrooms_full, h.bathrooms_half) || "—"} ba` : "";
  const listing = STATUS_LABELS[h.workflow_status];
  const sold = h.market_status === "sold" || h.market_status === "under_contract";
  return {
    // The phone summary: address and price, one grey line, then what needs
    // the person, where the listing is, and the sale.
    summary: {
      title: h.unparsed_address,
      href: `/homes/${h.id}`,
      right: { text: h.list_price ? money(h.list_price) : "No price", tone: h.list_price ? undefined : "muted" },
      owner: staff ? builderName : undefined,
      sub: [community && communityName, h.plan_name, bedBath, h.living_area ? `${num(h.living_area)} sq ft` : ""].filter(Boolean).join(" · "),
      chips: [
        ...(why ? [{ text: why, tone: "warn" as const }] : []),
        { text: h.workflow_status === "live_on_mls" && days !== null ? `${listing}, ${days} days` : listing, tone: h.workflow_status === "live_on_mls" ? "good" as const : h.workflow_status === "draft" ? "muted" as const : "accent" as const },
        ...(sold ? [{ text: sale, tone: "good" as const }] : []),
        ...(h.workflow_status !== "live_on_mls" ? [{ text: stage, tone: "muted" as const }] : []),
      ],
      flag: !!why,
    },
    cells: [
      { text: h.unparsed_address, href: `/homes/${h.id}` },
      ...(needs ? [{ text: why ?? "", sort: why ? 0 : 1, tone: why ? ("warn" as const) : undefined }] : []),
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
      ...(staff ? [{ text: builderName }] : []),
    ],
    tags: { community: communityName, plan: h.plan_name ?? "", status: listing, sale, stage, builder: builderName },
  };
}
