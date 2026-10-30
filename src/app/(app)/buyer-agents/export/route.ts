import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { isStaff, type Role } from "@/lib/permissions";
import { loadRanking, readFilters } from "@/lib/buyer-agent-ranking";

// The buyer's agent ranking as Excel: one sheet ranked by agent, one with every sale.
export async function GET(request: Request) {
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response("Sign in first", { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, is_active").eq("id", auth.user.id).maybeSingle();
  if (!me?.is_active || !isStaff(me.role as Role)) return new Response("Not allowed", { status: 403 });
  const f = readFilters(sp);
  const { agents, error } = await loadRanking(supabase, f);
  if (error) return new Response(error, { status: 400 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Builder Listings";
  wb.created = new Date();
  const money = '"$"#,##0';
  const head = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1FB" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const ranked = wb.addWorksheet("Ranking");
  ranked.columns = [
    { header: "Rank", key: "rank", width: 7 },
    { header: "Agent", key: "agent", width: 26 },
    { header: "Brokerage", key: "office", width: 28 },
    { header: "MLS ID", key: "mls", width: 12 },
    { header: "Homes sold", key: "sold", width: 12 },
    { header: "Volume", key: "volume", width: 16, style: { numFmt: money } },
    { header: "As co-agent", key: "co", width: 12 },
    { header: "Builders", key: "builders", width: 10 },
  ];
  agents.forEach((a, i) => ranked.addRow({ rank: i + 1, agent: a.agent_name, office: a.office_name ?? "", mls: a.agent_mls_id ?? "", sold: a.homes_sold, volume: Number(a.volume), co: a.co_agent_on, builders: a.builders }));
  head(ranked);

  const sales = wb.addWorksheet("Every sale");
  sales.columns = [
    { header: "Agent", key: "agent", width: 26 },
    { header: "Brokerage", key: "office", width: 28 },
    { header: "Home", key: "home", width: 28 },
    { header: "Community", key: "community", width: 22 },
    { header: "City", key: "city", width: 16 },
    { header: "County", key: "county", width: 14 },
    { header: "MLS", key: "board", width: 10 },
    { header: "Builder", key: "builder", width: 22 },
    { header: "Close date", key: "date", width: 14, style: { numFmt: "mmm d, yyyy" } },
    { header: "Close price", key: "price", width: 14, style: { numFmt: money } },
    { header: "Co-agent", key: "co", width: 10 },
  ];
  agents.forEach((a) => a.homes.forEach((h) => sales.addRow({
    agent: a.agent_name, office: a.office_name ?? "", home: h.address, community: h.community, city: h.city, county: h.county, board: h.board ?? "",
    builder: h.builder, date: h.close_date ? new Date(h.close_date + "T12:00:00") : null, price: h.close_price, co: h.co ? "Yes" : "",
  })));
  head(sales);

  const buf = await wb.xlsx.writeBuffer();
  const where = [f.board, f.county, f.city].filter(Boolean).join(" ");
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Buyer agent ranking${where ? ` ${where.replace(/[^\w\- ]+/g, "")}` : ""}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
