import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff, MARKET_LABELS, type MarketStatus } from "@/lib/permissions";
import { cx, money } from "@/lib/format";
import { TZ } from "@/lib/time";
import { PrintButton } from "@/components/print-button";

// Monthly listing health for one builder: proof of value at renewal time, and
// an early warning for homes sitting too long.
export default function ReportsPage(props: PageProps<"/reports">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Report searchParams={props.searchParams} />
    </Suspense>
  );
}

const DAY = 86_400_000;

function centralMonth(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
}
function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  // Central time is UTC-5 or -6; a 6-hour shift keeps month edges right for reporting.
  return { start: new Date(Date.UTC(y, m - 1, 1, 6)), end: new Date(Date.UTC(y, m, 1, 6)) };
}
function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
const days = (ms: number) => Math.max(0, Math.round(ms / DAY));
const hoursText = (h: number) => (h < 48 ? `${Math.round(h)} hours` : `${(h / 24).toFixed(1)} days`);

type Home = {
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

async function Report({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const me = await requireProfile();
  const staff = isStaff(me.role);
  if (!staff && me.role !== "builder_owner" && me.role !== "manager") redirect("/communities");
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: builders } = staff ? await supabase.from("builders").select("id, name").order("name") : { data: null };
  const builderId = staff ? (typeof sp.builder === "string" ? sp.builder : builders?.[0]?.id) : me.builder_id;
  if (!builderId) return <p className="text-muted">No builders yet.</p>;
  const builderName = (staff ? builders?.find((b) => b.id === builderId)?.name : me.builder_name)?.replace(" (demo)", "") ?? "";

  const now = new Date();
  const thisMonth = centralMonth(now);
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : thisMonth;
  const { start, end } = monthBounds(month);
  const asOf = end < now ? end : now;
  const months = Array.from({ length: 6 }, (_, i) => centralMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15))));

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
  const homes = (homeRows ?? []) as unknown as Home[];
  const byId = new Map(homes.map((h) => [h.id, h]));

  // Live at the end of the month (or now): went live by then and hadn't left the market.
  const liveAt = (h: Home) => h.live_at && new Date(h.live_at) <= asOf;
  const offMarketBy = (h: Home) => h.market_status && h.market_status !== "active" && h.market_status_at && new Date(h.market_status_at) <= asOf;
  const live = homes.filter((h) => h.workflow_status === "live_on_mls" && liveAt(h) && !offMarketBy(h));
  const wentLive = homes.filter((h) => h.live_at && new Date(h.live_at) >= start && new Date(h.live_at) < end);
  const closed = homes.filter((h) => h.market_status_at && new Date(h.market_status_at) >= start && new Date(h.market_status_at) < end && (h.market_status === "sold" || h.market_status === "under_contract"));

  // Days on market for listings live at month end.
  const dom = live.map((h) => ({ h, d: days(asOf.getTime() - new Date(h.live_at!).getTime()) })).sort((a, b) => b.d - a.d);
  const avgDom = dom.length ? Math.round(dom.reduce((n, x) => n + x.d, 0) / dom.length) : 0;

  // Price changes this month.
  const prices = (priceRows ?? [])
    .filter((r) => (r.changes as Record<string, unknown>)?.list_price)
    .map((r) => {
      const c = (r.changes as { list_price: { from: number; to: number } }).list_price;
      return { home: byId.get(r.home_id as string), from: Number(c.from), to: Number(c.to), at: r.created_at as string };
    })
    .filter((p) => p.home);
  const net = prices.reduce((n, p) => n + (p.to - p.from), 0);

  // Our speed: approval to live on the MLS.
  const speed = wentLive.filter((h) => h.approved_at).map((h) => ({ h, hours: (new Date(h.live_at!).getTime() - new Date(h.approved_at!).getTime()) / 3_600_000 }));
  const avgSpeed = speed.length ? speed.reduce((n, x) => n + x.hours, 0) / speed.length : null;
  const within24 = speed.filter((x) => x.hours <= 24).length;
  const waiting = homes.filter((h) => h.workflow_status === "approved_for_mls" && h.approved_at).map((h) => ({ h, hours: (now.getTime() - new Date(h.approved_at!).getTime()) / 3_600_000 }));

  // On the builder's website but not live on the MLS.
  const notOnMls = (web ?? []).filter((w) => {
    const h = w.home_id ? byId.get(w.home_id) : null;
    if (/sold|closed/i.test(w.status_text ?? "")) return false;
    return !h || h.workflow_status !== "live_on_mls";
  });

  // Sitting too long.
  const stale = [
    ...dom.filter((x) => x.d >= 60).map((x) => ({ id: x.h.id, address: x.h.unparsed_address, why: `Live ${x.d} days with no contract. Consider a price review or new photos.` })),
    ...waiting.filter((x) => x.hours > 48).map((x) => ({ id: x.h.id, address: x.h.unparsed_address, why: `Approved ${hoursText(x.hours)} ago and not on the MLS yet.` })),
    ...homes.filter((h) => h.workflow_status === "in_review" && now.getTime() - new Date(h.updated_at).getTime() > 7 * DAY)
      .map((h) => ({ id: h.id, address: h.unparsed_address, why: "Waiting on the builder’s approval for over a week." })),
  ];

  const alerts = alertRows ?? [];
  const href = (p: Record<string, string>) => `/reports?${new URLSearchParams({ ...(staff ? { builder: builderId } : {}), month, ...p }).toString()}`;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">Listing health report</p>
          <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">{builderName}, {monthLabel(month)}</h1>
          <p className="mt-1 text-muted">{month === thisMonth ? `Month to date, as of ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ })}.` : "Full month."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {staff && builders && (
            <form action="/reports" className="flex gap-2">
              <input type="hidden" name="month" value={month} />
              <select name="builder" defaultValue={builderId} className="field-input py-2" aria-label="Builder">
                {builders.map((b) => <option key={b.id} value={b.id}>{b.name.replace(" (demo)", "")}</option>)}
              </select>
              <button className="rounded-lg border border-line px-3 text-sm font-semibold hover:border-foreground">Show</button>
            </form>
          )}
          <PrintButton />
        </div>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 print:hidden">
        {months.map((m) => (
          <Link key={m} href={href({ month: m })} className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold", m === month ? "bg-foreground text-white" : "bg-soft")}>
            {monthLabel(m)}
          </Link>
        ))}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: "Live on the MLS", value: String(live.length), sub: `${wentLive.length} new this month` },
          { label: "Average days on market", value: dom.length ? String(avgDom) : "—", sub: `${dom.filter((x) => x.d >= 60).length} over 60 days` },
          { label: "Price changes", value: String(prices.length), sub: prices.length ? `${net < 0 ? "−" : "+"}${money(Math.abs(net))} net` : "none" },
          { label: "Approval to live", value: avgSpeed === null ? "—" : hoursText(avgSpeed), sub: speed.length ? `${within24} of ${speed.length} within a day` : "no new listings" },
          { label: "Under contract or sold", value: String(closed.length), sub: "this month" },
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
          <ul className="divide-y divide-line">
            {stale.map((s, i) => (
              <li key={s.id + i} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
                <Link href={`/homes/${s.id}`} className="font-medium hover:underline">{s.address}</Link>
                <span className="text-amber-900">{s.why}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Days on market" hint={`Every listing live at ${month === thisMonth ? "today" : "the end of the month"}, longest first.`}>
        <Table
          head={["Home", "Community", "Price", "Live since", "Days"]}
          rows={dom.map(({ h, d }) => [
            <Link key="a" href={`/homes/${h.id}`} className="font-medium hover:underline">{h.unparsed_address}</Link>,
            h.communities?.name ?? "",
            money(h.list_price),
            new Date(h.live_at!).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ }),
            <span key="d" className={cx("font-semibold tabular-nums", d >= 60 && "text-amber-900")}>{d}</span>,
          ])}
          empty="No live listings."
        />
      </Section>

      <Section title="Price changes" hint="Every change our team updated on the MLS this month.">
        <Table
          head={["Home", "Date", "From", "To", "Change"]}
          rows={prices.map((p) => [
            <Link key="a" href={`/homes/${p.home!.id}`} className="font-medium hover:underline">{p.home!.unparsed_address}</Link>,
            new Date(p.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ }),
            money(p.from),
            money(p.to),
            <span key="c" className={cx("font-semibold tabular-nums", p.to < p.from ? "text-red-800" : "text-emerald-800")}>{p.to < p.from ? "−" : "+"}{money(Math.abs(p.to - p.from))}</span>,
          ])}
          empty="No price changes this month."
        />
      </Section>

      <Section title="How fast our team got listings live" hint="From the builder’s approval to live on the MLS.">
        <Table
          head={["Home", "Approved", "Live", "Time"]}
          rows={speed.map(({ h, hours }) => [
            <Link key="a" href={`/homes/${h.id}`} className="font-medium hover:underline">{h.unparsed_address}</Link>,
            new Date(h.approved_at!).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ }),
            new Date(h.live_at!).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ }),
            <span key="t" className={cx("font-semibold", hours <= 24 ? "text-emerald-800" : hours > 48 && "text-amber-900")}>{hoursText(hours)}</span>,
          ])}
          empty="No listings went live this month."
        />
        {waiting.length > 0 && (
          <p className="border-t border-line px-4 py-2.5 text-sm text-muted">
            Waiting now: {waiting.map((w) => `${w.h.unparsed_address} (${hoursText(w.hours)})`).join(", ")}.
          </p>
        )}
      </Section>

      <Section title="On the website but not on the MLS" hint="Homes the builder is marketing that buyers' agents can't find on the MLS yet.">
        <Table
          head={["Home", "Community", "Website price", "Website status", "Builder Listings"]}
          rows={notOnMls.map((w) => {
            const h = w.home_id ? byId.get(w.home_id) : null;
            return [
              h ? <Link key="a" href={`/homes/${h.id}`} className="font-medium hover:underline">{w.unparsed_address}</Link> : <span key="a" className="font-medium">{w.unparsed_address}</span>,
              w.community_name ?? "",
              money(w.list_price),
              w.status_text ?? "",
              h ? h.workflow_status.replace(/_/g, " ") : <Link key="n" href="/website-check?tab=new" className="text-accent underline">Not added yet</Link>,
            ];
          })}
          empty="Every home on the website is live on the MLS."
        />
      </Section>

      <Section title="MLS compliance" hint="Problems caught and fixed before the MLS could fine them.">
        <p className="px-4 py-3 text-sm">
          <b>{alerts.length}</b> issue{alerts.length === 1 ? "" : "s"} caught this month, <b>{alerts.filter((a) => a.resolved_at).length}</b> resolved
          {alerts.filter((a) => a.severity === "urgent").length ? `, ${alerts.filter((a) => a.severity === "urgent").length} urgent` : ""}.
          {" "}Listings now: {Object.entries(
            homes.filter((h) => h.workflow_status === "live_on_mls").reduce<Record<string, number>>((acc, h) => {
              const k = (h.market_status ?? "active") as MarketStatus;
              acc[MARKET_LABELS[k] ?? k] = (acc[MARKET_LABELS[k] ?? k] ?? 0) + 1;
              return acc;
            }, {}),
          ).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ") || "none"}.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-line break-inside-avoid">
      <div className="bg-soft px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="px-4 py-4 text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {head.map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="px-4 py-2">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
