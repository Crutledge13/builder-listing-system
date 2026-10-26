import { Suspense } from "react";
import Link from "next/link";
import { BuilderLogo } from "@/components/avatar";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { canAddCommunities, isStaff } from "@/lib/permissions";
import { money } from "@/lib/format";
import { HomeArt } from "@/components/home-art";
import { AttentionPanel, loadAlerts } from "@/components/alerts";
import { Notice } from "@/components/notice";

export default function CommunitiesPage(props: PageProps<"/communities">) {
  return (
    <Suspense fallback={<div className="mt-20 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-2xl bg-soft" />)}</div>}>
      <Notice searchParams={props.searchParams} />
      <CommunityList />
    </Suspense>
  );
}

async function CommunityList() {
  const me = await requireProfile();
  sendPhotographersToJobs(me);
  const supabase = await createClient();
  const staff = isStaff(me.role);

  const [{ data: communities }, { data: homes }, { data: openHouses }] = await Promise.all([
    supabase.from("communities").select("id, name, city, county, builder_id, builders(name, builder_branding(logo_updated_at))").order("name"),
    supabase.from("homes").select("id, community_id, stories, list_price, workflow_status").is("deleted_at", null),
    supabase.from("open_houses").select("home_id").is("cancelled_at", null).gte("ends_at", new Date().toISOString()),
  ]);

  const homeCommunity = new Map((homes ?? []).map((h) => [h.id, h.community_id]));
  const upcoming = new Map<string, number>();
  (openHouses ?? []).forEach((o) => {
    const c = homeCommunity.get(o.home_id);
    if (c) upcoming.set(c, (upcoming.get(c) ?? 0) + 1);
  });

  // Builders: what needs an answer from them (still available? completion date passed?).
  const alerts = staff ? [] : await loadAlerts();
  const title = me.role === "sales" ? "Your communities" : "Communities";
  const subtitle =
    me.role === "sales"
      ? "The communities you’re assigned to. Ask your manager if one is missing."
      : staff
        ? "Every community across all builders."
        : `Every community from ${me.builder_name?.replace(" (demo)", "")}.`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
          <p className="mt-1 text-muted">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/homes" className="rounded-full border border-foreground px-4 py-2.5 text-sm font-semibold hover:bg-soft">
            View all homes
          </Link>
          {canAddCommunities(me.role) && (
            <Link href="/communities/new" className="rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110">
              + Add a community
            </Link>
          )}
        </div>
      </div>

      <AttentionPanel alerts={alerts} back="/communities" canAnswer={me.role !== "marketing"} staff={false} fullHref="/attention" />

      <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {communities?.map((c) => {
          const list = (homes ?? []).filter((h) => h.community_id === c.id);
          const prices = list.map((h) => Number(h.list_price)).filter((n) => n > 0);
          const live = list.filter((h) => h.workflow_status === "live_on_mls").length;
          const waiting = list.filter((h) => h.workflow_status === "in_review" || h.workflow_status === "approved_for_mls").length;
          const oh = upcoming.get(c.id) ?? 0;
          const picks = list.slice(0, 3);
          const brand = c.builders as unknown as { name: string; builder_branding: { logo_updated_at: string | null } | null } | null;
          const logoAt = brand?.builder_branding?.logo_updated_at;
          return (
            <Link key={c.id} href={`/communities/${c.id}`} className="group block">
              <div className="relative grid aspect-[4/3] grid-cols-3 grid-rows-2 gap-1 overflow-hidden rounded-2xl bg-soft">
                {logoAt && (
                  <span className="absolute left-3 top-3 z-10 rounded-xl bg-white/95 px-2.5 py-1.5 shadow-sm">
                    <BuilderLogo builderId={c.builder_id} name={brand?.name ?? ""} version={logoAt} className="h-6 max-w-[110px]" />
                  </span>
                )}
                <div className="col-span-2 row-span-2 overflow-hidden">
                  <HomeArt seed={picks[0]?.id ?? c.id} stories={picks[0]?.stories} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
                </div>
                <div className="overflow-hidden"><HomeArt seed={picks[1]?.id ?? c.id + "b"} stories={picks[1]?.stories} scene="golden" className="h-full w-full" /></div>
                <div className="overflow-hidden"><HomeArt seed={picks[2]?.id ?? c.id + "c"} stories={picks[2]?.stories} scene="twilight" className="h-full w-full" /></div>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <h2 className="truncate text-lg font-bold group-hover:underline">{c.name}</h2>
                {prices.length > 0 && <span className="shrink-0 text-sm text-muted">From {money(Math.min(...prices))}</span>}
              </div>
              <p className="text-[15px] text-muted">
                {c.city}, {c.county} County
                {staff ? `. ${(c.builders as unknown as { name: string })?.name.replace(" (demo)", "")}` : ""}
              </p>
              <p className="mt-1 text-[15px]">
                <b className="font-semibold">{list.length}</b> homes, <b className="font-semibold">{live}</b> live on the MLS
                {waiting > 0 && <>, <b className="font-semibold">{waiting}</b> in approval</>}
              </p>
              {oh > 0 && (
                <p className="mt-2 inline-flex rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
                  {oh} upcoming open {oh === 1 ? "house" : "houses"}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      {communities?.length === 0 && (
        <div className="mt-10 rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <p className="font-semibold">No communities yet</p>
          <p className="mt-1 text-muted">
            {me.role === "sales" ? "You haven’t been assigned to a community. Ask your manager to add you." : "Communities you add will show here."}
          </p>
        </div>
      )}
    </div>
  );
}
