import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { money } from "@/lib/format";
import { loadRanking, readFilters } from "@/lib/buyer-agent-ranking";

// Which buyers' agents sell the most of our builders' homes, by market (owners,
// 29 Oct 2026). Our team only. Built from the buyer's agent recorded on each
// sale (name, brokerage and MLS ID, asked when a home goes under contract or sells).
export default function BuyerAgentsPage(props: PageProps<"/buyer-agents">) {
  return (
    <div className="mx-auto max-w-5xl">
      <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
        <Ranking searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Ranking({ searchParams }: { searchParams: PageProps<"/buyer-agents">["searchParams"] }) {
  const me = await requireProfile();
  if (!isStaff(me.role)) redirect("/communities");
  const sp = await searchParams;
  const f = readFilters(sp);
  const supabase = await createClient();
  const [{ agents, error }, { data: boards }, { data: places }] = await Promise.all([
    loadRanking(supabase, f),
    supabase.from("mls_boards").select("code, short_name").eq("active", true).order("code"),
    supabase.from("communities").select("county, city"),
  ]);
  const counties = [...new Set((places ?? []).map((p) => p.county).filter(Boolean))].sort();
  const cities = [...new Set((places ?? []).map((p) => p.city).filter(Boolean))].sort();
  const query = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const sold = agents.reduce((n, a) => n + a.homes_sold, 0);

  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">Our team</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">Buyer&rsquo;s agent ranking</h1>
          <p className="mt-1 max-w-2xl text-muted">
            The buyers&rsquo; agents who sold the most of our builders&rsquo; homes, from the buyer&rsquo;s agent recorded on each sale. Narrow it to a market to see who to court there.
          </p>
        </div>
        <a href={`/buyer-agents/export${query ? `?${query}` : ""}`} className="rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110">Download Excel</a>
      </div>

      <form action="/buyer-agents" className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl bg-soft p-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">MLS</span>
          <select name="board" defaultValue={f.board ?? ""} className="field-input py-2">
            <option value="">Every MLS</option>
            {(boards ?? []).map((b) => <option key={b.code} value={b.code}>{b.short_name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">County</span>
          <select name="county" defaultValue={f.county ?? ""} className="field-input py-2">
            <option value="">Every county</option>
            {counties.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">City</span>
          <select name="city" defaultValue={f.city ?? ""} className="field-input py-2">
            <option value="">Every city</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Closed from</span>
          <input type="date" name="from" defaultValue={f.from ?? ""} className="field-input py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">To</span>
          <input type="date" name="to" defaultValue={f.to ?? ""} className="field-input py-2" />
        </label>
        <button className="rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-white hover:bg-black">Show</button>
        {query && <Link href="/buyer-agents" className="text-sm font-semibold underline">Clear</Link>}
      </form>

      {error && <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">Couldn’t load the ranking: {error}</p>}
      <p className="mt-6 text-sm text-muted">{agents.length} {agents.length === 1 ? "agent" : "agents"}, {sold} {sold === 1 ? "home" : "homes"} sold. Ranked by homes sold, then sales volume.</p>

      <ol className="mt-3 divide-y divide-line rounded-2xl border border-line">
        {agents.map((a, i) => (
          <li key={a.agent_key}>
            <details className="group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-soft [&::-webkit-details-marker]:hidden">
                <span className="w-8 text-lg font-bold tabular-nums text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{a.agent_name}</span>
                  <span className="block text-sm text-muted">{[a.office_name, a.agent_mls_id ? `MLS ID ${a.agent_mls_id}` : null].filter(Boolean).join(" · ") || "No brokerage recorded"}</span>
                </span>
                <span className="text-right text-sm">
                  <b className="text-base tabular-nums">{a.homes_sold}</b> {a.homes_sold === 1 ? "home" : "homes"}
                  <span className="block text-muted tabular-nums">{money(a.volume)}</span>
                </span>
              </summary>
              <ul className="divide-y divide-line border-t border-line bg-soft/40 text-sm">
                {a.homes.map((h) => (
                  <li key={`${h.home_id}-${h.co}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 pl-16">
                    <span>
                      <Link href={`/homes/${h.home_id}`} className="font-medium hover:underline">{h.address}</Link>
                      <span className="text-muted"> · {h.community}, {h.city} · {h.builder}{h.co ? " · as co-agent" : ""}</span>
                    </span>
                    <span className="tabular-nums text-muted">
                      {h.close_date ? new Date(h.close_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                      {h.close_price ? ` · ${money(h.close_price)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
        {agents.length === 0 && !error && <li className="px-4 py-10 text-center text-muted">No sales with a buyer&rsquo;s agent recorded here yet.</li>}
      </ol>
    </>
  );
}
