import { Suspense } from "react";
import { BuilderLogo } from "@/components/avatar";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { builderFocus } from "@/lib/builder-focus";
import { requireProfile } from "@/lib/auth";
import { requireFeature } from "@/lib/features";
import { canSeeReports, isStaff, MARKET_LABELS, type MarketStatus } from "@/lib/permissions";
import { FilterTable, type FRow } from "@/components/filter-table";
import { money } from "@/lib/format";
import { TZ } from "@/lib/time";
import { buildReport, parseRange } from "@/lib/report";
import { PrintButton } from "@/components/print-button";
import { AttentionPanel, loadAlerts } from "@/components/alerts";

// Listing health for one builder: proof of value at renewal time, and an
// early warning for homes sitting too long.
export default function ReportsPage(props: PageProps<"/reports">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <ReportView searchParams={props.searchParams} />
    </Suspense>
  );
}

const RANGES = [
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "month", label: "A month" },
  { key: "year", label: "A year" },
  { key: "custom", label: "Custom dates" },
];
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });

async function ReportView({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const me = await requireProfile();
  await requireFeature(me, "reports");
  const staff = isStaff(me.role);
  if (!canSeeReports(me.role)) redirect("/communities");
  const sales = me.role === "sales";
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: builders } = staff ? await supabase.from("builders").select("id, name").order("name") : { data: null };
  // Our team: the builder picked on this page, else the one picked in the top bar, else the first.
  const focus = await builderFocus(me.role);
  const builderId = staff ? (typeof sp.builder === "string" ? sp.builder : focus ?? builders?.[0]?.id) : me.builder_id;
  if (!builderId) return <p className="text-muted">No builders yet.</p>;
  const builderName = (staff ? builders?.find((b) => b.id === builderId)?.name : me.builder_name)?.replace(" (demo)", "") ?? "";

  const { data: brand } = await supabase.from("builder_branding").select("logo_updated_at").eq("builder_id", builderId).maybeSingle();
  const range = parseRange(sp);
  // Narrow to one community (salespeople only ever get their own communities).
  const { data: communities } = await supabase.from("communities").select("id, name").eq("builder_id", builderId).order("name");
  const communityId = typeof sp.community === "string" && (communities ?? []).some((c) => c.id === sp.community) ? sp.community : null;
  const communityName = (communities ?? []).find((c) => c.id === communityId)?.name ?? null;
  const [r, allAlerts] = await Promise.all([buildReport(supabase, builderId, range, { communityId }), loadAlerts({ builderId })]);
  const alerts = communityId ? allAlerts.filter((a) => r.homeIds.includes(a.home_id)) : allAlerts;
  const stale = r.stale.filter((s) => staff || !s.staffOnly);

  // Pickers: the last 24 months and last 5 years.
  const now = new Date();
  const months = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15));
    return { value: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
  });
  const years = Array.from({ length: 5 }, (_, i) => String(now.getUTCFullYear() - i));
  const query = new URLSearchParams({
    ...(staff ? { builder: builderId } : {}),
    ...(communityId ? { community: communityId } : {}),
    range: range.key,
    ...(range.key === "month" ? { month: range.month } : {}),
    ...(range.key === "year" ? { year: range.year } : {}),
    ...(range.key === "custom" ? { from: range.from, to: range.to } : {}),
  }).toString();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">Listing health report</p>
          <h1 className="mt-1 flex items-center gap-3 text-[28px] font-bold leading-tight tracking-tight">
            {brand?.logo_updated_at && <BuilderLogo builderId={builderId} name={builderName} version={brand.logo_updated_at} className="h-10 max-w-[140px]" />}
            {builderName}
          </h1>
          <p className="mt-1 text-muted">{range.label}{communityName ? ` · ${communityName}` : sales ? " · your communities" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <a href={`/reports/export?${query}`} className="rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110">Download Excel</a>
          <PrintButton />
        </div>
      </div>

      {/* Filters */}
      <form action="/reports" className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl bg-soft p-4 print:hidden">
        {staff && builders && (
          <label className="text-sm">
            <span className="mb-1 block font-medium">Builder</span>
            <select name="builder" defaultValue={builderId} className="field-input py-2">
              {builders.map((b) => <option key={b.id} value={b.id}>{b.name.replace(" (demo)", "")}</option>)}
            </select>
          </label>
        )}
        {(communities ?? []).length > 1 && (
          <label className="text-sm">
            <span className="mb-1 block font-medium">Community</span>
            <select name="community" defaultValue={communityId ?? ""} className="field-input py-2">
              <option value="">{sales ? "All my communities" : "All communities"}</option>
              {(communities ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="mb-1 block font-medium">Period</span>
          <select name="range" defaultValue={range.key} className="field-input py-2">
            {RANGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Month</span>
          <select name="month" defaultValue={range.month} className="field-input py-2">
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Year</span>
          <select name="year" defaultValue={range.year} className="field-input py-2">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">From</span>
          <input type="date" name="from" defaultValue={range.from} className="field-input py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">To</span>
          <input type="date" name="to" defaultValue={range.to} className="field-input py-2" />
        </label>
        <button className="rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-white hover:bg-black">Show report</button>
        <p className="w-full text-xs text-muted">Month applies to “A month”, Year to “A year”, From and To to “Custom dates”.</p>
      </form>

      <div className="print:hidden">
        <AttentionPanel alerts={alerts} back={`/reports?${query}`} canAnswer={me.role !== "marketing"} staff={staff} fullHref={staff ? "/compliance" : "/attention"} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Live on the MLS", value: String(r.live.length), sub: `${r.wentLive.length} went live in this period` },
          { label: "Average days on market", value: r.avgDom === null ? "—" : String(r.avgDom), sub: `${r.dom.filter((x) => x.days >= 60).length} over 60 days` },
          { label: "Price changes", value: String(r.prices.length), sub: r.prices.length ? `${r.netPrice < 0 ? "−" : "+"}${money(Math.abs(r.netPrice))} net` : "none" },
          { label: "Under contract or sold", value: String(r.contracts.length), sub: "in this period" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-line p-4">
            <dt className="text-sm text-muted">{s.label}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{s.value}</dd>
            <dd className="text-xs text-muted">{s.sub}</dd>
          </div>
        ))}
      </dl>

      {stale.length > 0 && (
        <Section title="Needs a look" hint="Homes sitting too long, caught before anyone has to ask.">
          <FilterTable
            columns={[{ label: "Home" }, { label: "Community" }, { label: "Why" }]}
            rows={stale.map((x) => ({
              cells: [{ text: x.home.unparsed_address, href: `/homes/${x.home.id}` }, { text: x.home.communities?.name ?? "" }, { text: x.why, tone: "warn" }],
              tags: tagsFor(x.home),
            }))}
            filters={["community", "plan"]}
            empty="Nothing sitting too long."
          />
        </Section>
      )}

      <Section title="Days on market" hint="Every listing live at the end of the period, longest first.">
        <FilterTable
          columns={[{ label: "Home" }, { label: "Community" }, { label: "Price", numeric: true }, { label: "Live since" }, { label: "Days", numeric: true }]}
          rows={r.dom.map(({ h, days }) => ({
            cells: [
              { text: h.unparsed_address, href: `/homes/${h.id}` },
              { text: h.communities?.name ?? "" },
              { text: money(h.list_price), sort: Number(h.list_price ?? 0) },
              { text: shortDate(h.live_at!), sort: h.live_at! },
              { text: String(days), sort: days, tone: days >= 60 ? "warn" : undefined },
            ],
            tags: tagsFor(h),
          }))}
          filters={["community", "plan", "status"]}
          defaultSort={{ col: 4, desc: true }}
          empty="No live listings."
        />
      </Section>

      <Section title="Price changes" hint="Every price change in this period.">
        <FilterTable
          columns={[{ label: "Home" }, { label: "Date" }, { label: "From", numeric: true }, { label: "To", numeric: true }, { label: "Change", numeric: true }]}
          rows={r.prices.map((p) => ({
            cells: [
              { text: p.home.unparsed_address, href: `/homes/${p.home.id}` },
              { text: shortDate(p.at), sort: p.at },
              { text: money(p.from), sort: p.from },
              { text: money(p.to), sort: p.to },
              { text: `${p.to < p.from ? "−" : "+"}${money(Math.abs(p.to - p.from))}`, sort: p.to - p.from, tone: p.to < p.from ? "bad" : "good" },
            ],
            tags: { ...tagsFor(p.home), status: p.to < p.from ? "Price drop" : "Price increase" },
          }))}
          filters={["community", "plan", "status"]}
          noun="changes"
          empty="No price changes in this period."
        />
      </Section>

      <Section title="Under contract or sold" hint="Homes that went under contract or sold in this period.">
        <FilterTable
          columns={[{ label: "Home" }, { label: "Community" }, { label: "Status" }, { label: "Date" }, { label: "Close price", numeric: true }]}
          rows={r.contracts.map((h) => ({
            cells: [
              { text: h.unparsed_address, href: `/homes/${h.id}` },
              { text: h.communities?.name ?? "" },
              { text: MARKET_LABELS[(h.market_status ?? "active") as MarketStatus] },
              { text: shortDate(h.market_status_at!), sort: h.market_status_at! },
              { text: h.close_price ? money(h.close_price) : "—", sort: Number(h.close_price ?? 0) },
            ],
            tags: tagsFor(h),
          }))}
          filters={["community", "plan", "status"]}
          empty="None in this period."
        />
      </Section>

      {!sales && (
        <Section title="On the website but not on the MLS" hint="Homes the builder is marketing that buyers’ agents can’t find on the MLS yet.">
          <FilterTable
            columns={[{ label: "Home" }, { label: "Community" }, { label: "Website price", numeric: true }, { label: "Website status" }, { label: "Builder Listings" }]}
            rows={r.notOnMls.map((w) => ({
              cells: [
                { text: w.unparsed_address, href: w.home ? `/homes/${w.home.id}` : undefined },
                { text: w.community_name ?? "" },
                { text: money(w.list_price), sort: Number(w.list_price ?? 0) },
                { text: w.status_text ?? "" },
                w.home ? { text: w.home.workflow_status.replace(/_/g, " ") } : { text: "Not added yet", href: "/website-check?tab=new" },
              ],
              tags: { community: w.community_name ?? "", status: w.home ? w.home.workflow_status.replace(/_/g, " ") : "Not added yet" },
            }))}
            filters={["community", "status"]}
            empty="Every home on the website is live on the MLS."
          />
        </Section>
      )}

      <Section title="MLS compliance" hint="Problems caught and fixed before the MLS could fine them.">
        <p className="px-4 py-3 text-sm">
          <b>{r.issues.caught}</b> issue{r.issues.caught === 1 ? "" : "s"} caught in this period, <b>{r.issues.resolved}</b> resolved
          {r.issues.urgent ? `, ${r.issues.urgent} urgent` : ""}. Listings now:{" "}
          {Object.entries(r.statusNow).map(([k, n]) => `${n} ${(MARKET_LABELS[k as MarketStatus] ?? k).toLowerCase()}`).join(", ") || "none"}.
        </p>
      </Section>
    </div>
  );
}

// What each list can be filtered by.
function tagsFor(h: { communities: { name: string } | null; plan_name: string | null; market_status: string | null; workflow_status: string }): FRow["tags"] {
  return {
    community: h.communities?.name ?? "",
    plan: h.plan_name ?? "",
    status: h.workflow_status === "live_on_mls" ? MARKET_LABELS[(h.market_status ?? "active") as MarketStatus] : h.workflow_status.replace(/_/g, " "),
  };
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-line">
      <div className="bg-soft px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      {children}
    </section>
  );
}
