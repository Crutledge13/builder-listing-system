import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff, STATUS_LABELS, type WorkflowStatus } from "@/lib/permissions";
import { baths, cx, money, num } from "@/lib/format";
import { StageText, StatusBadge } from "@/components/badges";
import { HomeArt } from "@/components/home-art";

export default function HomesPage(props: PageProps<"/homes">) {
  return (
    <Suspense fallback={<GridSkeleton />}>
      <HomesList searchParams={props.searchParams} />
    </Suspense>
  );
}

function GridSkeleton() {
  return (
    <div className="mt-20 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[4/3] animate-pulse rounded-2xl bg-soft" />
          <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-soft" />
          <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-soft" />
        </div>
      ))}
    </div>
  );
}

const STATUSES = Object.keys(STATUS_LABELS) as WorkflowStatus[];

type Row = {
  id: string;
  unparsed_address: string;
  city: string;
  plan_name: string | null;
  lot_number: string | null;
  list_price: number | null;
  bedrooms_total: number | null;
  bathrooms_full: number | null;
  bathrooms_half: number | null;
  living_area: number | null;
  stories: number | null;
  build_stage: string;
  workflow_status: WorkflowStatus;
  mls_number: string | null;
  communities: { name: string } | null;
  builders: { name: string } | null;
};

async function HomesList({ searchParams }: { searchParams: PageProps<"/homes">["searchParams"] }) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status as WorkflowStatus) ? (sp.status as WorkflowStatus) : null;
  const community = typeof sp.community === "string" ? sp.community : null;

  const me = await requireProfile();
  const supabase = await createClient();

  const { data: communities } = await supabase.from("communities").select("id, name, builders(name)").order("name");

  let query = supabase
    .from("homes")
    .select(
      "id, unparsed_address, city, plan_name, lot_number, list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, stories, build_stage, workflow_status, mls_number, communities(name), builders(name)",
    )
    .is("deleted_at", null)
    .order("unparsed_address");
  if (community) query = query.eq("community_id", community);
  const { data, error } = await query;
  const all = (data ?? []) as unknown as Row[];
  const homes = status ? all.filter((h) => h.workflow_status === status) : all;

  const counts = new Map<string, number>();
  all.forEach((h) => counts.set(h.workflow_status, (counts.get(h.workflow_status) ?? 0) + 1));

  const staff = isStaff(me.role);
  const communityName = communities?.find((c) => c.id === community)?.name;
  const href = (s: string | null, c: string | null = community) => {
    const p = new URLSearchParams();
    if (s) p.set("status", s);
    if (c) p.set("community", c);
    const q = p.toString();
    return q ? `/homes?${q}` : "/homes";
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">
            {communityName ?? (staff ? "All homes" : "Your homes")}
          </h1>
          <p className="mt-1 text-muted">
            {all.length} {all.length === 1 ? "home" : "homes"}
            {!staff && me.builder_name ? ` from ${me.builder_name.replace(" (demo)", "")}` : staff ? " across every builder" : ""}
          </p>
        </div>

        <form action="/homes" className="flex items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <label className="sr-only" htmlFor="community">Community</label>
          <select
            id="community"
            name="community"
            defaultValue={community ?? ""}
            className="rounded-full border border-line bg-white px-4 py-2.5 text-sm font-medium shadow-sm hover:shadow-md"
          >
            <option value="">All communities</option>
            {communities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {staff ? ` (${(c.builders as unknown as { name: string })?.name.replace(" (demo)", "")})` : ""}
              </option>
            ))}
          </select>
          <button className="rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-white hover:bg-black">Show</button>
        </form>
      </div>

      <div className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {[null, ...STATUSES].map((s) => {
          const active = status === s;
          return (
            <Link
              key={s ?? "all"}
              href={href(s)}
              className={cx(
                "shrink-0 rounded-full border px-4 py-2 text-sm transition-colors",
                active ? "border-foreground bg-foreground font-semibold text-white" : "border-line hover:border-foreground",
              )}
            >
              {s ? STATUS_LABELS[s] : "All"}
              <span className={cx("ml-2", active ? "text-white/70" : "text-muted")}>
                {s ? (counts.get(s) ?? 0) : all.length}
              </span>
            </Link>
          );
        })}
      </div>

      {error && <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">Couldn’t load homes: {error.message}</p>}

      <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {homes.map((h) => (
          <Link key={h.id} href={`/homes/${h.id}`} className="group block">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-soft">
              <HomeArt seed={h.id} stories={h.stories} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
              <div className="absolute left-3 top-3">
                <StatusBadge status={h.workflow_status} floating />
              </div>
              {h.mls_number && (
                <span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
                  MLS {h.mls_number}
                </span>
              )}
            </div>
            <div className="mt-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-bold tabular-nums">{money(h.list_price)}</span>
                <span className="text-xs text-muted"><StageText stage={h.build_stage} /></span>
              </div>
              <div className="mt-0.5 flex gap-3 text-[15px]">
                <span><b className="font-semibold">{h.bedrooms_total ?? "—"}</b> bd</span>
                <span><b className="font-semibold">{baths(h.bathrooms_full, h.bathrooms_half)}</b> ba</span>
                <span><b className="font-semibold">{num(h.living_area)}</b> sq ft</span>
              </div>
              <div className="mt-1 truncate text-[15px] group-hover:underline">{h.unparsed_address}, {h.city}</div>
              <div className="truncate text-sm text-muted">
                {h.plan_name} plan in {h.communities?.name}
                {staff ? `, ${h.builders?.name.replace(" (demo)", "")}` : ""}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {homes.length === 0 && !error && (
        <div className="mt-10 rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <p className="font-semibold">No homes here yet</p>
          <p className="mt-1 text-sm text-muted">Try another status or community.</p>
          <Link href={href(null, null)} className="mt-4 inline-block rounded-full border border-foreground px-4 py-2 text-sm font-semibold">
            Show all homes
          </Link>
        </div>
      )}
    </div>
  );
}
