import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { builderFocus } from "@/lib/builder-focus";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { canAddHomes, isStaff, STATUS_LABELS, type WorkflowStatus } from "@/lib/permissions";
import { HomeCard, HomeGrid, HOME_CARD_SELECT, type HomeCardData } from "@/components/home-card";
import { cardIncentive, INCENTIVE_SELECT, type Incentive } from "@/lib/incentives";
import { StatusChips } from "@/components/status-chips";

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

type Row = HomeCardData;

async function HomesList({ searchParams }: { searchParams: PageProps<"/homes">["searchParams"] }) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status as WorkflowStatus) ? (sp.status as WorkflowStatus) : null;
  const community = typeof sp.community === "string" ? sp.community : null;

  const me = await requireProfile();
  sendPhotographersToJobs(me);
  const supabase = await createClient();

  const focus = await builderFocus(me.role);
  let cq = supabase.from("communities").select("id, name, builders(name)").order("name");
  if (focus) cq = cq.eq("builder_id", focus);
  const { data: communities } = await cq;

  let query = supabase
    .from("homes")
    .select(HOME_CARD_SELECT)
    .is("deleted_at", null)
    .order("unparsed_address");
  if (community) query = query.eq("community_id", community);
  if (focus) query = query.eq("builder_id", focus);
  const { data, error } = await query;
  const all = (data ?? []) as unknown as Row[];
  const homes = status ? all.filter((h) => h.workflow_status === status) : all;
  let iq = supabase.from("incentives").select(INCENTIVE_SELECT).eq("status", "active");
  if (focus) iq = iq.eq("builder_id", focus);
  const incentives = ((await iq).data ?? []) as Incentive[];

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
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">
            {communityName ?? "All homes"}
          </h1>
          <p className="mt-1 text-muted">
            {all.length} {all.length === 1 ? "home" : "homes"}
            {!staff && me.builder_name ? ` from ${me.builder_name.replace(" (demo)", "")}` : staff ? " across every builder" : ""}
          </p>
        </div>

        <form action="/homes" className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          {status && <input type="hidden" name="status" value={status} />}
          <label className="sr-only" htmlFor="community">Community</label>
          <select
            id="community"
            name="community"
            defaultValue={community ?? ""}
            className="min-w-0 flex-1 truncate rounded-full border border-line bg-white px-4 py-2.5 text-sm font-medium shadow-sm hover:shadow-md sm:max-w-xs sm:flex-none"
          >
            <option value="">All communities</option>
            {communities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {staff ? ` (${(c.builders as unknown as { name: string })?.name.replace(" (demo)", "")})` : ""}
              </option>
            ))}
          </select>
          <button className="shrink-0 rounded-full border border-foreground px-4 py-2.5 text-sm font-semibold hover:bg-soft">Show</button>
        </form>
        {canAddHomes(me.role) && (
          <Link href={community ? `/homes/new?community=${community}` : "/homes/new"} className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110">
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            Add a home
          </Link>
        )}
      </div>

      <StatusChips active={status} counts={counts} total={all.length} hrefFor={(st) => href(st)} />

      {error && <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">Couldn’t load homes: {error.message}</p>}

      <div className="mt-8">
        <HomeGrid>
          {homes.map((h) => (
            <HomeCard key={h.id} h={h} showBuilder={staff} incentive={cardIncentive(incentives, h)} />
          ))}
        </HomeGrid>
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
