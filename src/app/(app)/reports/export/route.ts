import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { canSeeReports, isStaff, MARKET_LABELS, type MarketStatus, type Role } from "@/lib/permissions";
import { buildReport, parseRange } from "@/lib/report";
import { hasFeature } from "@/lib/features";

// The listing health report as an Excel file. Same numbers as the page.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Sign in first", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, builder_id, is_active").eq("id", auth.user.id).maybeSingle();
  if (!me?.is_active) return new Response("Not allowed", { status: 403 });
  const role = me.role as Role;
  const staff = isStaff(role);
  if (!canSeeReports(role)) return new Response("Not allowed", { status: 403 });
  if (!(await hasFeature({ role, builder_id: me.builder_id }, "reports"))) return new Response("Reports aren’t turned on for your company", { status: 403 });
  const builderId = staff ? sp.builder : me.builder_id;
  if (!builderId) return new Response("Pick a builder", { status: 400 });
  // The database only returns builders this person may see.
  const { data: builder } = await supabase.from("builders").select("name").eq("id", builderId).maybeSingle();
  if (!builder) return new Response("Not found", { status: 404 });

  const range = parseRange(sp);
  // One community, if picked (and visible to this person).
  const { data: community } = sp.community
    ? await supabase.from("communities").select("id, name").eq("id", sp.community).eq("builder_id", builderId).maybeSingle()
    : { data: null };
  const r = await buildReport(supabase, builderId, range, { communityId: community?.id ?? null });
  const name = builder.name.replace(" (demo)", "");

  const wb = new ExcelJS.Workbook();
  wb.creator = "Builder Listings";
  wb.created = new Date();
  const money = '"$"#,##0';
  const addSheet = (title: string, columns: { header: string; key: string; width: number; numFmt?: string }[], rows: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(title, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1FB" } };
    rows.forEach((row) => ws.addRow(row));
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return ws;
  };
  const d = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 34 }, { width: 22 }];
  [
    ["Listing health report", name],
    ["Period", range.label],
    ["Created", new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })],
    [],
    ["Live on the MLS", r.live.length],
    ["Went live in this period", r.wentLive.length],
    ["Average days on market", r.avgDom ?? "—"],
    ["Live over 60 days", r.dom.filter((x) => x.days >= 60).length],
    ["Price changes", r.prices.length],
    ["Net price change", r.netPrice],
    ["Under contract or sold", r.contracts.length],
    ["On the website, not on the MLS", r.notOnMls.length],
    ["MLS issues caught", r.issues.caught],
    ["MLS issues resolved", r.issues.resolved],
  ].forEach((row) => summary.addRow(row));
  summary.getRow(1).font = { bold: true, size: 14 };
  summary.getCell("B10").numFmt = money;

  addSheet("By community", [
    { header: "Community", key: "community", width: 24 },
    { header: "Listed now", key: "listed", width: 12 },
    { header: "Average days on market", key: "avg", width: 22 },
    { header: "Longest days on market", key: "longest", width: 22 },
    { header: "Under contract", key: "uc", width: 15 },
    { header: "Sold in period", key: "sold", width: 15 },
    { header: "Coming soon", key: "coming", width: 13 },
  ], r.byCommunity.map((c) => ({ community: c.community, listed: c.listed, avg: c.avgDays ?? "—", longest: c.longest ?? "—", uc: c.underContract, sold: c.soldInRange, coming: c.coming })));

  addSheet("Days on market", [
    { header: "Home", key: "home", width: 28 },
    { header: "Community", key: "community", width: 22 },
    { header: "Status", key: "status", width: 16 },
    { header: "List price", key: "price", width: 14, numFmt: money },
    { header: "Live since", key: "live", width: 14, numFmt: "mmm d, yyyy" },
    { header: "Days on market", key: "days", width: 16 },
  ], r.dom.map(({ h, days }) => ({
    home: h.unparsed_address, community: h.communities?.name ?? "", status: MARKET_LABELS[(h.market_status ?? "active") as MarketStatus],
    price: h.list_price, live: d(h.live_at), days,
  })));

  addSheet("By floor plan", [
    { header: "Community", key: "community", width: 24 },
    { header: "Floor plan", key: "plan", width: 20 },
    { header: "Listed now", key: "listed", width: 12 },
    { header: "Lowest price", key: "low", width: 14, numFmt: money },
    { header: "Highest price", key: "high", width: 14, numFmt: money },
    { header: "Average days on market", key: "avg", width: 22 },
    { header: "Under contract", key: "uc", width: 15 },
    { header: "Sold in period", key: "sold", width: 15 },
    { header: "Coming soon", key: "coming", width: 13 },
  ], r.byPlan.map((p) => ({ community: p.community, plan: p.plan, listed: p.listed, low: p.low, high: p.high, avg: p.avgDays ?? "—", uc: p.underContract, sold: p.soldInRange, coming: p.coming })));

  addSheet("Price changes", [
    { header: "Home", key: "home", width: 28 },
    { header: "Date", key: "date", width: 14, numFmt: "mmm d, yyyy" },
    { header: "From", key: "from", width: 14, numFmt: money },
    { header: "To", key: "to", width: 14, numFmt: money },
    { header: "Change", key: "change", width: 14, numFmt: money },
  ], r.prices.map((p) => ({ home: p.home.unparsed_address, date: d(p.at), from: p.from, to: p.to, change: p.to - p.from })));

  addSheet("Under contract or sold", [
    { header: "Home", key: "home", width: 28 },
    { header: "Community", key: "community", width: 22 },
    { header: "Status", key: "status", width: 16 },
    { header: "Date", key: "date", width: 14, numFmt: "mmm d, yyyy" },
    { header: "Close price", key: "close", width: 14, numFmt: money },
  ], r.contracts.map((h) => ({
    home: h.unparsed_address, community: h.communities?.name ?? "", status: MARKET_LABELS[(h.market_status ?? "active") as MarketStatus],
    date: d(h.market_status_at), close: h.close_price,
  })));

  addSheet("Website not on MLS", [
    { header: "Home", key: "home", width: 28 },
    { header: "Community", key: "community", width: 22 },
    { header: "Website price", key: "price", width: 14, numFmt: money },
    { header: "Website status", key: "status", width: 18 },
    { header: "Builder Listings", key: "ours", width: 20 },
  ], r.notOnMls.map((w) => ({
    home: w.unparsed_address, community: w.community_name ?? "", price: w.list_price, status: w.status_text ?? "",
    ours: w.home ? w.home.workflow_status.replace(/_/g, " ") : "Not added yet",
  })));

  addSheet("Needs a look", [
    { header: "Home", key: "home", width: 28 },
    { header: "Why", key: "why", width: 70 },
  ], r.stale.filter((s) => staff || !s.staffOnly).map((s) => ({ home: s.home.unparsed_address, why: s.why })));

  const buf = await wb.xlsx.writeBuffer();
  const file = `${name} listing report ${range.label}`.replace(/[^\w\- ]+/g, "").replace(/\s+/g, " ").trim();
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
