import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff, STATUS_LABELS, type WorkflowStatus } from "@/lib/permissions";
import { baths, cx, money, num } from "@/lib/format";
import { StageText, StatusBadge } from "@/components/badges";

export default function HomesPage(props: PageProps<"/homes">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading homes…</p>}>
      <HomesList searchParams={props.searchParams} />
    </Suspense>
  );
}

const STATUSES = Object.keys(STATUS_LABELS) as WorkflowStatus[];

async function HomesList({ searchParams }: { searchParams: PageProps<"/homes">["searchParams"] }) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status as WorkflowStatus) ? sp.status : null;
  const community = typeof sp.community === "string" ? sp.community : null;

  const me = await requireProfile();
  const supabase = await createClient();

  const { data: communities } = await supabase
    .from("communities")
    .select("id, name, builders(name)")
    .order("name");

  let query = supabase
    .from("homes")
    .select(
      "id, unparsed_address, city, plan_name, lot_number, list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, build_stage, workflow_status, mls_number, communities(name), builders(name)",
    )
    .is("deleted_at", null)
    .order("unparsed_address");
  if (status) query = query.eq("workflow_status", status);
  if (community) query = query.eq("community_id", community);
  const { data: homes, error } = await query;

  // Counts per status (respecting the community filter) for the tabs.
  let countQuery = supabase.from("homes").select("workflow_status").is("deleted_at", null);
  if (community) countQuery = countQuery.eq("community_id", community);
  const { data: allForCounts } = await countQuery;
  const counts = new Map<string, number>();
  allForCounts?.forEach((h) => counts.set(h.workflow_status, (counts.get(h.workflow_status) ?? 0) + 1));

  const staff = isStaff(me.role);
  const href = (s: string | null) => {
    const p = new URLSearchParams();
    if (s) p.set("status", s);
    if (community) p.set("community", community);
    const q = p.toString();
    return q ? `/homes?${q}` : "/homes";
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Homes</h1>
          <p className="mt-1 text-sm text-muted">
            {staff ? "All builders." : me.builder_name} {allForCounts?.length ?? 0} homes
            {community ? " in this community" : ""}.
          </p>
        </div>
        <form className="flex items-center gap-2" action="/homes">
          {status && <input type="hidden" name="status" value={status} />}
          <select name="community" defaultValue={community ?? ""} className="field-input w-56">
            <option value="">All communities</option>
            {communities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {staff ? ` (${(c.builders as unknown as { name: string })?.name.replace(" (demo)", "")})` : ""}
              </option>
            ))}
          </select>
          <button className="rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:bg-background">Filter</button>
        </form>
      </div>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-line">
        {[null, ...STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={href(s)}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              status === s ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {s ? STATUS_LABELS[s] : "All"}
            <span className="ml-1.5 text-xs text-muted">
              {s ? (counts.get(s) ?? 0) : (allForCounts?.length ?? 0)}
            </span>
          </Link>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-red-700">Couldn’t load homes: {error.message}</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-3 font-medium">Address</th>
              {staff && <th className="px-4 py-3 font-medium">Builder</th>}
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              <th className="px-4 py-3 text-right font-medium">Bd / Ba</th>
              <th className="px-4 py-3 text-right font-medium">Sq ft</th>
              <th className="px-4 py-3 font-medium">Build stage</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {homes?.map((h) => (
              <tr key={h.id} className="border-b border-line last:border-0 hover:bg-background">
                <td className="px-4 py-3">
                  <Link href={`/homes/${h.id}`} className="font-medium hover:text-accent hover:underline">
                    {h.unparsed_address}
                  </Link>
                  <div className="text-xs text-muted">
                    {(h.communities as unknown as { name: string })?.name} · {h.city} · Lot {h.lot_number}
                  </div>
                </td>
                {staff && (
                  <td className="px-4 py-3 text-muted">
                    {(h.builders as unknown as { name: string })?.name.replace(" (demo)", "")}
                  </td>
                )}
                <td className="px-4 py-3">{h.plan_name}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(h.list_price)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {h.bedrooms_total} / {baths(h.bathrooms_full, h.bathrooms_half)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{num(h.living_area)}</td>
                <td className="px-4 py-3"><StageText stage={h.build_stage} /></td>
                <td className="px-4 py-3">
                  <StatusBadge status={h.workflow_status} />
                  {h.mls_number && <div className="mt-0.5 text-xs text-muted">{h.mls_number}</div>}
                </td>
              </tr>
            ))}
            {homes?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">No homes match this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
