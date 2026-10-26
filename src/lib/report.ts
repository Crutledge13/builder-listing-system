import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TZ } from "@/lib/time";

// Listing health for one builder over a date range. Shared by the Reports
// page and its Excel download so the numbers always match.

const DAY = 86_400_000;

export type RangeKey = "30d" | "90d" | "month" | "year" | "custom";
export type Range = { key: RangeKey; start: Date; end: Date; label: string; month: string; year: string; from: string; to: string };

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
// Midnight Central for a calendar date (6 hours after UTC midnight is close enough for reporting edges).
const centralStart = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 6));
};
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });

export function parseRange(sp: Record<string, string | string[] | undefined>, now = new Date()): Range {
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = ymd(now);
  const thisMonth = today.slice(0, 7);
  const thisYear = today.slice(0, 4);
  const key = (["30d", "90d", "month", "year", "custom"].includes(get("range")) ? get("range") : "month") as RangeKey;
  const month = /^\d{4}-\d{2}$/.test(get("month")) ? get("month") : thisMonth;
  const year = /^\d{4}$/.test(get("year")) ? get("year") : thisYear;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(get("from")) ? get("from") : ymd(new Date(now.getTime() - 30 * DAY));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(get("to")) ? get("to") : today;
  const base = { month, year, from, to };

  if (key === "30d" || key === "90d") {
    const n = key === "30d" ? 30 : 90;
    return { key, start: new Date(now.getTime() - n * DAY), end: now, label: `Last ${n} days`, ...base };
  }
  if (key === "year") {
    const start = centralStart(`${year}-01-01`);
    const end = new Date(Math.min(centralStart(`${Number(year) + 1}-01-01`).getTime(), now.getTime()));
    return { key, start, end, label: year === thisYear ? `${year} so far` : year, ...base };
  }
  if (key === "custom") {
    const [a, b] = from <= to ? [from, to] : [to, from];
    const start = centralStart(a);
    const end = new Date(Math.min(centralStart(b).getTime() + DAY, now.getTime()));
    return { key, start, end, label: `${fmt(start)} to ${fmt(new Date(end.getTime() - 1))}`, ...base };
  }
  const [y, m] = month.split("-").map(Number);
  const start = centralStart(`${month}-01`);
  const end = new Date(Math.min(Date.UTC(y, m, 1, 6), now.getTime()));
  const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { key, start, end, label: month === thisMonth ? `${name} so far` : name, ...base };
}

export type ReportHome = {
  id: string;
  unparsed_address: string;
  community_id: string;
  list_price: number | null;
  workflow_status: string;
  market_status: string | null;
  build_stage: string;
  approved_at: string | null;
  live_at: string | null;
  market_status_at: string | null;
  close_price: number | null;
  close_date: string | null;
  updated_at: string;
  communities: { name: string } | null;
};

export async function buildReport(supabase: SupabaseClient, builderId: string, range: Range) {
  const now = new Date();
  const { start, end } = range;
  const [{ data: homeRows }, { data: priceRows }, { data: web }, { data: alertRows }] = await Promise.all([
    supabase
      .from("homes")
      .select("id, unparsed_address, community_id, list_price, workflow_status, market_status, build_stage, approved_at, live_at, market_status_at, close_price, close_date, updated_at, communities(name)")
      .eq("builder_id", builderId)
      .is("deleted_at", null),
    supabase.from("activity_log").select("home_id, changes, created_at").eq("builder_id", builderId).eq("action", "edited")
      .gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at"),
    supabase.from("website_listings").select("id, unparsed_address, community_name, list_price, status_text, home_id").eq("builder_id", builderId).is("dismissed_at", null),
    supabase.from("home_alerts").select("kind, severity, created_at, resolved_at").eq("builder_id", builderId).gte("created_at", start.toISOString()).lt("created_at", end.toISOString()),
  ]);
  const homes = (homeRows ?? []) as unknown as ReportHome[];
  const byId = new Map(homes.map((h) => [h.id, h]));

  // Live at the end of the range: went live by then and hadn't left the market.
  const offMarketBy = (h: ReportHome) => h.market_status && h.market_status !== "active" && h.market_status_at && new Date(h.market_status_at) <= end;
  const live = homes.filter((h) => h.workflow_status === "live_on_mls" && h.live_at && new Date(h.live_at) <= end && !offMarketBy(h));
  const inRange = (iso: string | null) => !!iso && new Date(iso) >= start && new Date(iso) < end;
  const wentLive = homes.filter((h) => inRange(h.live_at));
  const contracts = homes.filter((h) => inRange(h.market_status_at) && (h.market_status === "sold" || h.market_status === "under_contract"));

  const dom = live.map((h) => ({ h, days: Math.max(0, Math.round((end.getTime() - new Date(h.live_at!).getTime()) / DAY)) })).sort((a, b) => b.days - a.days);
  const avgDom = dom.length ? Math.round(dom.reduce((n, x) => n + x.days, 0) / dom.length) : null;

  const prices = (priceRows ?? [])
    .filter((r) => (r.changes as Record<string, unknown>)?.list_price)
    .map((r) => {
      const c = (r.changes as { list_price: { from: number; to: number } }).list_price;
      return { home: byId.get(r.home_id as string)!, from: Number(c.from), to: Number(c.to), at: r.created_at as string };
    })
    .filter((p) => p.home);
  const netPrice = prices.reduce((n, p) => n + (p.to - p.from), 0);

  const notOnMls = (web ?? [])
    .filter((w) => {
      const h = w.home_id ? byId.get(w.home_id) : null;
      if (/sold|closed/i.test(w.status_text ?? "")) return false;
      return !h || h.workflow_status !== "live_on_mls";
    })
    .map((w) => ({ ...w, home: w.home_id ? byId.get(w.home_id) ?? null : null }));

  // Homes sitting too long (builder-facing); staffOnly items are about our own queue.
  const stale = [
    ...dom.filter((x) => x.days >= 60).map((x) => ({ home: x.h, why: `Live ${x.days} days with no contract. Consider a price review or new photos.`, staffOnly: false })),
    ...homes
      .filter((h) => h.workflow_status === "in_review" && now.getTime() - new Date(h.updated_at).getTime() > 7 * DAY)
      .map((h) => ({ home: h, why: "Waiting on the builder’s approval for over a week.", staffOnly: false })),
    ...homes
      .filter((h) => h.workflow_status === "approved_for_mls" && h.approved_at && now.getTime() - new Date(h.approved_at).getTime() > 2 * DAY)
      .map((h) => ({ home: h, why: "Approved more than 2 days ago and not on the MLS yet.", staffOnly: true })),
  ];

  const statusNow = homes.filter((h) => h.workflow_status === "live_on_mls").reduce<Record<string, number>>((acc, h) => {
    const k = h.market_status ?? "active";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const alerts = alertRows ?? [];

  return {
    live,
    wentLive,
    contracts,
    dom,
    avgDom,
    prices,
    netPrice,
    notOnMls,
    stale,
    statusNow,
    issues: { caught: alerts.length, resolved: alerts.filter((a) => a.resolved_at).length, urgent: alerts.filter((a) => a.severity === "urgent").length },
  };
}

export type Report = Awaited<ReturnType<typeof buildReport>>;
