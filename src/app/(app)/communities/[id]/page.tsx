import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canAddHomes, isStaff, STATUS_LABELS, type WorkflowStatus } from "@/lib/permissions";
import { money } from "@/lib/format";
import { HomeCard, HomeGrid, HOME_CARD_SELECT, type HomeCardData } from "@/components/home-card";
import { StatusChips } from "@/components/status-chips";
import { HomeArt } from "@/components/home-art";
import { openHouseWhen } from "@/lib/time";

export default function CommunityPage(props: PageProps<"/communities/[id]">) {
  return (
    <Suspense fallback={<div className="mt-16 aspect-[21/6] animate-pulse rounded-2xl bg-soft" />}>
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
  const supabase = await createClient();
  const staff = isStaff(me.role);

  const { data: community } = await supabase
    .from("communities")
    .select("id, name, city, county, builder_id, builders(name)")
    .eq("id", id)
    .maybeSingle();
  // Sales see only assigned communities; anything else looks like it doesn't exist.
  if (!community) notFound();

  const { data: homeRows } = await supabase
    .from("homes")
    .select(HOME_CARD_SELECT)
    .eq("community_id", id)
    .is("deleted_at", null)
    .order("unparsed_address");
  const all = (homeRows ?? []) as unknown as HomeCardData[];
  const homes = status ? all.filter((h) => h.workflow_status === status) : all;
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
        <HomeArt seed={all[0]?.id ?? community.id} stories={2} scene="golden" className="h-56 w-full sm:h-72" />
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

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {canAddHomes(me.role) && (
          <Link href={`/homes/new?community=${community.id}`} className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110">
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            Add a home here
          </Link>
        )}
        <Link href={`/media?community=${community.id}`} className="rounded-full border border-foreground px-4 py-2.5 text-sm font-semibold hover:bg-soft">
          Community photos and videos
        </Link>
        {salesTeam.length > 0 && me.role !== "sales" && (
          <span className="text-sm text-muted">Sales team: {salesTeam.join(", ")}</span>
        )}
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-6 border-y border-line py-6 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label}>
            <dd className="text-2xl font-bold tabular-nums">{s.value}</dd>
            <dt className="text-sm text-muted">{s.label}</dt>
          </div>
        ))}
      </dl>

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
          <Link href={`/homes?community=${community.id}`} className="text-sm font-semibold underline">Open in all homes</Link>
        </div>
        <StatusChips
          active={status}
          counts={counts}
          total={all.length}
          hrefFor={(s) => (s ? `/communities/${community.id}?status=${s}` : `/communities/${community.id}`)}
        />
        <div className="mt-8">
          <HomeGrid>
            {homes.map((h) => <HomeCard key={h.id} h={h} showCommunity={false} />)}
          </HomeGrid>
          {homes.length === 0 && (
            <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-muted">No homes with this status here.</p>
          )}
        </div>
      </section>
    </div>
  );
}
