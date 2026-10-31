import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { hasFeature } from "@/lib/features";
import { canAddHomes, isStaff, STATUS_LABELS, type WorkflowStatus } from "@/lib/permissions";
import { cx, money } from "@/lib/format";
import { HomeCard, HomeGrid, HOME_CARD_SELECT } from "@/components/home-card";
import { cardIncentive, forHome, INCENTIVE_SELECT, type Incentive } from "@/lib/incentives";
import { IncentiveList } from "@/components/incentive-list";
import { canBulkChangePrices, canManageIncentives, canRequestComps } from "@/lib/permissions";
import { StatusChips } from "@/components/status-chips";
import { HomeArt } from "@/components/home-art";
import { MediaPicture } from "@/components/media-tile";
import { loadCommunityCovers, loadHomeCovers } from "@/lib/covers";
import { openHouseWhen } from "@/lib/time";
import { setAssignments } from "@/app/(app)/admin/actions";
import { Notice } from "@/components/notice";
import { communityCompleteness, communitySections, mergeCommunityDetails, MLS_BOARD_SELECT, type MlsBoard } from "@/lib/mls-fields";
import { HOME_LIST_COLUMNS, HOME_LIST_EXTRA, homeRow, type ListHome } from "@/lib/home-list";
import { FilterTable } from "@/components/filter-table";
import { loadNeedsYou } from "@/lib/needs-you";
import { viewPref } from "@/lib/view-pref";
import { ViewToggle } from "@/components/view-toggle";

export default function CommunityPage(props: PageProps<"/communities/[id]">) {
  return (
    <Suspense fallback={<div className="mt-16 aspect-[21/6] animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <CommunityDetail params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

const STATUSES = Object.keys(STATUS_LABELS) as WorkflowStatus[];

async function CommunityDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/communities/[id]">["params"];
  searchParams: PageProps<"/communities/[id]">["searchParams"];
}) {
  const { id } = await params;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status as WorkflowStatus) ? (sp.status as WorkflowStatus) : null;
  const me = await requireProfile();
  sendPhotographersToJobs(me);
  const supabase = await createClient();
  const staff = isStaff(me.role);
  const compsOn = await hasFeature(me, "comps");

  const { data: community } = await supabase
    .from("communities")
    .select("id, name, city, county, builder_id, mls_board, mls_fields, builders(name)")
    .eq("id", id)
    .maybeSingle();
  // Sales see only assigned communities; anything else looks like it doesn't exist.
  if (!community) notFound();

  const { data: homeRows } = await supabase
    .from("homes")
    .select(HOME_CARD_SELECT + HOME_LIST_EXTRA)
    .eq("community_id", id)
    .is("deleted_at", null)
    .order("unparsed_address");
  const all = (homeRows ?? []) as unknown as ListHome[];
  const view = await viewPref("homes");
  const homes = status ? all.filter((h) => h.workflow_status === status) : all;
  const [{ data: incentiveRows }, homeCovers, communityCovers, needs] = await Promise.all([
    supabase.from("incentives").select(INCENTIVE_SELECT).eq("builder_id", community.builder_id).eq("status", "active").order("ends_on"),
    loadHomeCovers(supabase, all.map((h) => h.id)),
    loadCommunityCovers(supabase, [community.id]),
    view === "list" ? loadNeedsYou(me.role, me.builder_id, all) : Promise.resolve(null),
  ]);
  const banner = communityCovers.get(community.id);
  const incentives = (incentiveRows ?? []) as Incentive[];
  // What the community page lists: this community's and the builder-wide ones.
  const communityIncentives = forHome(incentives, { id: "", builder_id: community.builder_id, community_id: community.id });
  const homeIds = all.map((h) => h.id);
  const addressOf = new Map(all.map((h) => [h.id, h.unparsed_address]));

  const [{ data: openHouses }, { data: requests }, { data: team }] = await Promise.all([
    homeIds.length
      ? supabase.from("open_houses").select("id, home_id, starts_at, ends_at").in("home_id", homeIds).is("cancelled_at", null).gte("ends_at", new Date().toISOString()).order("starts_at").limit(6)
      : Promise.resolve({ data: [] as { id: string; home_id: string; starts_at: string; ends_at: string }[] }),
    homeIds.length
      ? supabase.from("change_requests").select("id").in("home_id", homeIds).eq("status", "open")
      : Promise.resolve({ data: [] as { id: string }[] }),
    supabase.from("community_assignments").select("profiles(full_name)").eq("community_id", id),
  ]);
  const canManageTeam = ["platform_admin", "builder_owner", "manager", "marketing"].includes(me.role);
  const { data: builderSales } = canManageTeam
    ? await supabase.from("profiles").select("id, full_name, online_sales").eq("builder_id", community.builder_id).eq("role", "sales").eq("is_active", true).order("full_name")
    : { data: null };
  const { data: thisTeam } = canManageTeam
    ? await supabase.from("community_assignments").select("profile_id").eq("community_id", id)
    : { data: null };
  const onTeam = new Set((thisTeam ?? []).map((t) => t.profile_id));

  // How much of the community's shared MLS setup is answered (not for sales).
  let setup: { filled: number; required: number } | null = null;
  if (me.role !== "sales") {
    const [{ data: board }, { data: staffRow }] = await Promise.all([
      community.mls_board ? supabase.from("mls_boards").select(MLS_BOARD_SELECT).eq("code", community.mls_board).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("mls_details").select("data").eq("community_id", id).maybeSingle(),
    ]);
    setup = communityCompleteness(community, mergeCommunityDetails(community.mls_fields as Record<string, unknown>, (staffRow?.data ?? {}) as Record<string, unknown>), communitySections(board as MlsBoard | null));
  }

  const counts = new Map<string, number>();
  all.forEach((h) => counts.set(h.workflow_status, (counts.get(h.workflow_status) ?? 0) + 1));
  const prices = all.map((h) => Number(h.list_price)).filter((n) => n > 0);
  const salesTeam = (team ?? []).map((t) => (t.profiles as unknown as { full_name: string })?.full_name).filter(Boolean);

  const stats = [
    { value: all.length, label: "homes" },
    { value: counts.get("live_on_mls") ?? 0, label: "live on the MLS" },
    { value: (counts.get("in_review") ?? 0) + (counts.get("approved_for_mls") ?? 0), label: "in approval" },
    { value: openHouses?.length ?? 0, label: "upcoming open houses" },
    { value: requests?.length ?? 0, label: "open change requests" },
  ];

  return (
    <div>
      <Link href="/communities" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground">
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {me.role === "sales" ? "Your communities" : "Communities"}
      </Link>

      <div className="relative mt-4 overflow-hidden rounded-3xl">
        {banner ? (
          <MediaPicture m={banner} size="web" priority className="h-56 w-full sm:h-72" />
        ) : (
          <HomeArt seed={all[0]?.id ?? community.id} stories={2} scene="golden" className="h-56 w-full sm:h-72" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-8">
          <h1 className="text-[32px] font-bold leading-tight tracking-tight sm:text-[40px]">{community.name}</h1>
          <p className="mt-1 text-white/85">
            {community.city}, {community.county} County
            {staff ? `. ${(community.builders as unknown as { name: string })?.name.replace(" (demo)", "")}` : ""}
            {prices.length > 0 ? `. Homes from ${money(Math.min(...prices))} to ${money(Math.max(...prices))}` : ""}
          </p>
        </div>
      </div>

      {/* Phones (owners, 30 Oct 2026): "Add a home here" across the full width,
          the rest as equal tiles two to a row. Computers keep the row of pills. */}
      <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        {canAddHomes(me.role) && (
          <Link href={`/homes/new?community=${community.id}`} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white hover:brightness-110 sm:rounded-full sm:py-2.5">
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            Add a home here
          </Link>
        )}
        {setup && (
          <Link
            href={`/communities/${community.id}/setup`}
            className={cx(TILE, setup.filled < setup.required ? "border-accent bg-accent-soft text-accent hover:brightness-95 sm:border-accent" : "hover:bg-soft")}
          >
            <TileIcon d="M3 4h10M3 8h10M3 12h6" />
            <span className="sm:hidden">Setup</span><span className="hidden sm:inline">Community setup</span>
            {setup.filled < setup.required ? ` (${setup.filled} of ${setup.required})` : " ✓"}
          </Link>
        )}
        {canBulkChangePrices(me.role) && all.length > 0 && (
          <Link href={`/communities/${community.id}/prices`} className={cx(TILE, "hover:bg-soft")}>
            <TileIcon d="M8 2v12M11 4.5H6.75a2 2 0 0 0 0 4h2.5a2 2 0 0 1 0 4H5" />
            Change prices
          </Link>
        )}
        <Link href={`/media?community=${community.id}`} className={cx(TILE, "hover:bg-soft")}>
          <TileIcon d="M2 4h12v9H2zM2 11l3.5-3.5 3 3 2-2L14 12" />
          <span className="sm:hidden">Photos and videos</span><span className="hidden sm:inline">Community photos and videos</span>
        </Link>
        {canRequestComps(me.role) && compsOn && (
          <Link href={`/comps/new?community=${community.id}`} className={cx(TILE, "hover:bg-soft")}>
            <TileIcon d="M3 13V8M8 13V3M13 13V6" />
            Request comps
          </Link>
        )}
        {salesTeam.length > 0 && me.role !== "sales" && (
          <span className="col-span-2 mt-1 text-sm text-muted sm:mt-0">Sales team: {salesTeam.join(", ")}</span>
        )}
      </div>

      {canManageTeam && builderSales && (
        <details className="mt-4 rounded-2xl border border-line p-4">
          <summary className="cursor-pointer text-[15px] font-semibold sm:text-base">Manage the sales team<span className="hidden sm:inline"> for {community.name}</span></summary>
          <p className="mt-2 text-sm text-muted">Salespeople only see the communities they’re on.</p>
          <div className="mt-3 space-y-2">
            {builderSales.map((p) => (
              <form key={p.id} action={setAssignments} className="flex items-center justify-between gap-3 rounded-xl bg-soft px-3 py-2">
                <input type="hidden" name="profile_id" value={p.id} />
                <input type="hidden" name="scope" value={community.id} />
                <input type="hidden" name="back" value={`/communities/${community.id}`} />
                {!onTeam.has(p.id) && <input type="hidden" name="community_id" value={community.id} />}
                <span className="text-sm font-medium">{p.full_name}{p.online_sales && <span className="ml-2 text-xs font-normal text-muted">Online sales counselor</span>}</span>
                <button className={onTeam.has(p.id) ? "rounded-lg border border-foreground px-3 py-1.5 text-sm font-semibold hover:bg-white" : "rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black"}>
                  {onTeam.has(p.id) ? "Remove" : "Add to this community"}
                </button>
              </form>
            ))}
            {builderSales.length === 0 && <p className="text-sm text-muted">This builder has no salespeople yet.</p>}
          </div>
        </details>
      )}

      <dl className="mt-8 grid grid-cols-2 gap-6 border-y border-line py-6 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label}>
            <dd className="text-2xl font-bold tabular-nums">{s.value}</dd>
            <dt className="text-sm text-muted">{s.label}</dt>
          </div>
        ))}
      </dl>

      {(communityIncentives.length > 0 || canManageIncentives(me.role)) && (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[22px] font-semibold">Incentives</h2>
            {canManageIncentives(me.role) && <Link href={`/incentives?community=${community.id}`} className="text-sm font-semibold underline">+ Add one for {community.name}</Link>}
          </div>
          <div className="mt-4 max-w-3xl">
            {communityIncentives.length ? (
              <IncentiveList items={communityIncentives} manageHref={canManageIncentives(me.role) ? "/incentives" : undefined} />
            ) : (
              <p className="text-sm text-muted">No current incentives for this community.</p>
            )}
          </div>
        </section>
      )}

      {openHouses && openHouses.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[22px] font-semibold">Upcoming open houses</h2>
          <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
            {openHouses.map((o) => (
              <Link key={o.id} href={`/homes/${o.home_id}#open-houses`} className="min-w-[240px] rounded-2xl border border-line p-4 hover:shadow-md">
                <div className="font-semibold">{openHouseWhen(o.starts_at, o.ends_at)}</div>
                <div className="mt-1 truncate text-sm text-muted">{addressOf.get(o.home_id)}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[22px] font-semibold">Homes in {community.name}</h2>
          <div className="flex items-center gap-3">
            <ViewToggle name="homes" view={view} />
            <Link href={`/homes?community=${community.id}`} className="text-sm font-semibold underline">Open in all homes</Link>
          </div>
        </div>
        <StatusChips
          active={status}
          counts={counts}
          total={all.length}
          hrefFor={(s) => (s ? `/communities/${community.id}?status=${s}` : `/communities/${community.id}`)}
        />
        <div className="mt-8">
          {view === "list" ? (
            homes.length > 0 && (
              <div className="rounded-2xl border border-line">
                <FilterTable columns={HOME_LIST_COLUMNS(false, false, needs?.header)} rows={homes.map((h) => homeRow(h, false, false, needs?.reasons))} filters={["plan", "sale", "stage"]} empty="No homes here yet." pageSize={500} minWidth={1180} />
              </div>
            )
          ) : (
            <HomeGrid>
              {homes.map((h, i) => <HomeCard key={h.id} h={h} showCommunity={false} incentive={cardIncentive(incentives, h)} cover={homeCovers.get(h.id)} priority={i < 4} />)}
            </HomeGrid>
          )}
          {homes.length === 0 && (
            <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-muted">No homes with this status here.</p>
          )}
        </div>
      </section>
    </div>
  );
}

// The quick-link buttons under a community's banner: tiles on phones, pills on computers.
const TILE = "inline-flex min-w-0 items-center justify-center gap-2 rounded-xl border border-line px-3 py-3 text-center text-sm font-semibold sm:rounded-full sm:border-foreground sm:px-4 sm:py-2.5";

function TileIcon({ d }: { d: string }) {
  return <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
