import { Suspense } from "react";
import Link from "next/link";
import { BuilderLogo } from "@/components/avatar";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { builderFocus } from "@/lib/builder-focus";
import { requireProfile } from "@/lib/auth";
import { isStaff, MARKET_LABELS, type MarketStatus } from "@/lib/permissions";
import { cx, money } from "@/lib/format";
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
const SHOW = 10; // rows before a list collapses
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });

async function ReportView({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const me = await requireProfile();
  const staff = isStaff(me.role);
  if (!staff && me.role !== "builder_owner" && me.role !== "manager") redirect("/communities");
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
  const [r, alerts] = await Promise.all([buildReport(supabase, builderId, range), loadAlerts({ builderId })]);
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
          <p className="mt-1 text-muted">{range.label}</p>
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
          <Rows
            items={stale.map((s, i) => (
              <li key={s.home.id + i} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
                <Link href={`/homes/${s.home.id}`} className="font-medium hover:underline">{s.home.unparsed_address}</Link>
                <span className="text-amber-900">{s.why}</span>
              </li>
            ))}
          />
        </Section>
      )}

      <Section title="Days on market" hint="Every listing live at the end of the period, longest first.">
        <Table
          head={["Home", "Community", "Price", "Live since", "Days"]}
          rows={r.dom.map(({ h, days }) => [
            <Link key="a" href={`/homes/${h.id}`} className="font-medium hover:underline">{h.unparsed_address}</Link>,
            h.communities?.name ?? "",
            money(h.list_price),
            shortDate(h.live_at!),
            <span key="d" className={cx("font-semibold tabular-nums", days >= 60 && "text-amber-900")}>{days}</span>,
          ])}
          empty="No live listings."
        />
      </Section>

      <Section title="Price changes" hint="Every price change in this period.">
        <Table
          head={["Home", "Date", "From", "To", "Change"]}
          rows={r.prices.map((p) => [
            <Link key="a" href={`/homes/${p.home.id}`} className="font-medium hover:underline">{p.home.unparsed_address}</Link>,
            shortDate(p.at),
            money(p.from),
            money(p.to),
            <span key="c" className={cx("font-semibold tabular-nums", p.to < p.from ? "text-red-800" : "text-emerald-800")}>{p.to < p.from ? "−" : "+"}{money(Math.abs(p.to - p.from))}</span>,
          ])}
          empty="No price changes in this period."
        />
      </Section>

      <Section title="Under contract or sold" hint="Homes that went under contract or sold in this period.">
        <Table
          head={["Home", "Community", "Status", "Date", "Close price"]}
          rows={r.contracts.map((h) => [
            <Link key="a" href={`/homes/${h.id}`} className="font-medium hover:underline">{h.unparsed_address}</Link>,
            h.communities?.name ?? "",
            MARKET_LABELS[(h.market_status ?? "active") as MarketStatus],
            shortDate(h.market_status_at!),
            h.close_price ? money(h.close_price) : "—",
          ])}
          empty="None in this period."
        />
      </Section>

      <Section title="On the website but not on the MLS" hint="Homes the builder is marketing that buyers’ agents can’t find on the MLS yet.">
        <Table
          head={["Home", "Community", "Website price", "Website status", "Builder Listings"]}
          rows={r.notOnMls.map((w) => [
            w.home ? <Link key="a" href={`/homes/${w.home.id}`} className="font-medium hover:underline">{w.unparsed_address}</Link> : <span key="a" className="font-medium">{w.unparsed_address}</span>,
            w.community_name ?? "",
            money(w.list_price),
            w.status_text ?? "",
            w.home ? w.home.workflow_status.replace(/_/g, " ") : <Link key="n" href="/website-check?tab=new" className="text-accent underline">Not added yet</Link>,
          ])}
          empty="Every home on the website is live on the MLS."
        />
      </Section>

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

// A list that shows the first 10 and folds the rest away.
function Rows({ items }: { items: React.ReactNode[] }) {
  return (
    <>
      <ul className="divide-y divide-line">{items.slice(0, SHOW)}</ul>
      {items.length > SHOW && (
        <details className="group border-t border-line">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-semibold text-accent print:hidden">
            <span className="group-open:hidden">Show all {items.length}</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">{items.slice(SHOW)}</ul>
        </details>
      )}
    </>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="px-4 py-4 text-sm text-muted">{empty}</p>;
  const tr = (r: React.ReactNode[], i: number) => (
    <tr key={i}>{r.map((c, j) => <td key={j} className="px-4 py-2">{c}</td>)}</tr>
  );
  const table = (body: React.ReactNode[][], withHead: boolean, offset = 0) => (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        {withHead && (
          <thead>
            <tr className="text-left text-xs text-muted">{head.map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
          </thead>
        )}
        <tbody className="divide-y divide-line">{body.map((r, i) => tr(r, i + offset))}</tbody>
      </table>
    </div>
  );
  return (
    <>
      {table(rows.slice(0, SHOW), true)}
      {rows.length > SHOW && (
        <details className="group border-t border-line">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-semibold text-accent print:hidden">
            <span className="group-open:hidden">Show all {rows.length} homes</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          {table(rows.slice(SHOW), false, SHOW)}
        </details>
      )}
    </>
  );
}
