import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { canManageMedia, isStaff } from "@/lib/permissions";
import { cx } from "@/lib/format";
import { MEDIA_SELECT, ROOM_LABELS, type MediaRow } from "@/lib/demo-media";
import { MediaGrid, MediaPicture, MediaTile } from "@/components/media-tile";

export default function MediaPage(props: PageProps<"/media">) {
  return (
    <Suspense fallback={<div className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[3/2] animate-pulse rounded-xl bg-soft" />)}</div>}>
      <Library searchParams={props.searchParams} />
    </Suspense>
  );
}

const ROOM_FILTERS = ["exterior", "kitchen", "living", "dining", "primary_bedroom", "primary_bath", "bedroom", "backyard", "floor_plan", "entrance", "amenity", "aerial", "site_map", "model_home"];
const KINDS = [
  { key: "photo", label: "Photos" },
  { key: "video", label: "Videos" },
  { key: "floor_plan", label: "Floor plans" },
];

function str(v: string | string[] | undefined) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function Library({ searchParams }: { searchParams: PageProps<"/media">["searchParams"] }) {
  const sp = await searchParams;
  const q = str(sp.q);
  const room = str(sp.room);
  const kind = str(sp.kind);
  const tag = str(sp.tag);
  const communityId = str(sp.community);
  const homeId = str(sp.home);
  const builderId = str(sp.builder);

  const me = await requireProfile();
  sendPhotographersToJobs(me);
  const staff = isStaff(me.role);
  const supabase = await createClient();

  // Where are we in builder > community > home? (Access rules apply to every lookup.)
  const { data: home } = homeId
    ? await supabase.from("homes").select("id, unparsed_address, city, plan_name, builder_id, community_id, show_representative_disclaimer, communities(id, name), builders(id, name)").eq("id", homeId).maybeSingle()
    : { data: null };
  const effectiveCommunity = home?.community_id ?? communityId;
  const { data: community } = effectiveCommunity
    ? await supabase.from("communities").select("id, name, city, builder_id, builders(id, name)").eq("id", effectiveCommunity).maybeSingle()
    : { data: null };
  const effectiveBuilder = (community?.builder_id as string | undefined) ?? builderId;
  const { data: builder } = effectiveBuilder && staff
    ? await supabase.from("builders").select("id, name").eq("id", effectiveBuilder).maybeSingle()
    : { data: null };

  const filtering = !!(q || room || kind || tag);
  const atTop = !home && !community && !filtering;

  const params = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = { q, room, kind, tag, community: home ? null : communityId, home: homeId, builder: community || home ? null : builderId };
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/media?${s}` : "/media";
  };

  // Results grid (scoped to the current folder).
  let results: MediaRow[] = [];
  if (!atTop) {
    let query = supabase.from("media").select(MEDIA_SELECT).is("deleted_at", null).order("sort_order").order("created_at").limit(160);
    if (home) query = query.eq("home_id", home.id);
    else if (community) query = query.eq("community_id", community.id);
    else if (builder) query = query.eq("builder_id", builder.id);
    if (room) query = query.eq("room", room);
    if (kind) query = query.eq("kind", kind);
    if (tag) query = query.contains("tags", [tag]);
    if (q) query = query.ilike("search_text", `%${q.toLowerCase().replace(/[%_]/g, "")}%`);
    const { data } = await query;
    results = (data ?? []) as unknown as MediaRow[];
  }

  // On a home: also its community's media and its floor plan's library media,
  // in case the builder team needs them (or the home isn't built yet).
  let homeCommunityMedia: MediaRow[] = [];
  let planMedia: MediaRow[] = [];
  if (home) {
    const scoped = (qb: ReturnType<typeof supabase.from>) => {
      let x = qb.select(MEDIA_SELECT).is("deleted_at", null).is("home_id", null).order("sort_order").order("created_at").limit(80);
      if (room) x = x.eq("room", room);
      if (kind) x = x.eq("kind", kind);
      if (tag) x = x.contains("tags", [tag]);
      if (q) x = x.ilike("search_text", `%${q.toLowerCase().replace(/[%_]/g, "")}%`);
      return x;
    };
    const [c, p] = await Promise.all([
      scoped(supabase.from("media")).eq("community_id", home.community_id),
      home.plan_name
        ? scoped(supabase.from("media")).eq("builder_id", home.builder_id).eq("plan_name", home.plan_name).is("community_id", null)
        : Promise.resolve({ data: [] }),
    ]);
    homeCommunityMedia = (c.data ?? []) as unknown as MediaRow[];
    planMedia = (p.data ?? []) as unknown as MediaRow[];
  }

  // Folders at the top level: one card per community you can see.
  const { data: communities } = atTop || (builder && !community)
    ? await supabase.from("communities").select("id, name, city, builder_id, builders(name)").order("name")
    : { data: null };
  const folderCommunities = (communities ?? []).filter((c) => !builder || c.builder_id === builder.id);
  const { data: covers } = folderCommunities.length
    ? await supabase.from("media").select(MEDIA_SELECT).in("community_id", folderCommunities.map((c) => c.id)).is("home_id", null).eq("room", "entrance").is("deleted_at", null)
    : { data: null };
  const { data: countRows } = folderCommunities.length
    ? await supabase.from("media").select("community_id").in("community_id", folderCommunities.map((c) => c.id)).is("deleted_at", null)
    : { data: null };
  const counts = new Map<string, number>();
  (countRows ?? []).forEach((r) => counts.set(r.community_id as string, (counts.get(r.community_id as string) ?? 0) + 1));

  // Inside a community: the homes as folders.
  const { data: homeFolders } = community && !home && !filtering
    ? await supabase.from("homes").select("id, unparsed_address, plan_name, stories").eq("community_id", community.id).is("deleted_at", null).order("unparsed_address")
    : { data: null };
  const { data: homeCovers } = homeFolders?.length
    ? await supabase.from("media").select(MEDIA_SELECT).in("home_id", homeFolders.map((h) => h.id)).eq("is_cover", true).is("deleted_at", null)
    : { data: null };
  const coverByHome = new Map(((homeCovers ?? []) as unknown as MediaRow[]).map((m) => [m.home_id, m]));
  const communityOnly = community && !home && !filtering ? results.filter((m) => !m.home_id) : results;

  // Group top-level folders by builder for our staff.
  const byBuilder = new Map<string, typeof folderCommunities>();
  folderCommunities.forEach((c) => {
    const name = (c.builders as unknown as { name: string })?.name ?? "";
    byBuilder.set(name, [...(byBuilder.get(name) ?? []), c]);
  });

  const title = home ? home.unparsed_address : community ? community.name : builder ? builder.name.replace(" (demo)", "") : "Media library";
  const uploadHref = home ? `/media/upload?home=${home.id}` : community ? `/media/upload?community=${community.id}` : "/media/upload";

  return (
    <div>
      {/* Breadcrumb: builder > community > home */}
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted" aria-label="Folders">
        <Link href="/media" className="hover:text-foreground hover:underline">Media</Link>
        {staff && (builder || community || home) && (
          <>
            <span aria-hidden>/</span>
            <Link href={`/media?builder=${(community?.builders as unknown as { id: string } | null)?.id ?? builder?.id}`} className="hover:text-foreground hover:underline">
              {((community?.builders as unknown as { name: string } | null)?.name ?? builder?.name ?? "").replace(" (demo)", "")}
            </Link>
          </>
        )}
        {community && (home || filtering) && (
          <>
            <span aria-hidden>/</span>
            <Link href={`/media?community=${community.id}`} className="hover:text-foreground hover:underline">{community.name}</Link>
          </>
        )}
      </nav>

      <div className="mt-2 flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
          <p className="mt-1 text-muted">
            {home
              ? <>Photos, video and floor plan for this home. <Link href={`/homes/${home.id}`} className="font-medium text-foreground underline">Open the home</Link></>
              : community
                ? "Community photos and video, plus a folder for every home."
                : me.role === "sales"
                  ? "Photos and video for your communities. Tap one to download."
                  : "Every photo, video and floor plan, by community and home."}
          </p>
        </div>
        <Link href="/media/requests" className="rounded-full border border-foreground px-4 py-2.5 text-sm font-semibold hover:bg-soft">
          Photo requests
        </Link>
        {canManageMedia(me.role) && (
          <Link href={uploadHref} className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110">
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Upload
          </Link>
        )}
      </div>

      {/* Search */}
      <form action="/media" className="mt-6 flex max-w-2xl items-center gap-2 rounded-full border border-line bg-white p-1.5 pl-5 shadow-sm focus-within:shadow-md">
        {homeId && <input type="hidden" name="home" value={homeId} />}
        {!homeId && communityId && <input type="hidden" name="community" value={communityId} />}
        {!homeId && !communityId && builderId && <input type="hidden" name="builder" value={builderId} />}
        {room && <input type="hidden" name="room" value={room} />}
        {kind && <input type="hidden" name="kind" value={kind} />}
        <label htmlFor="media-q" className="sr-only">Search media</label>
        <input
          id="media-q"
          name="q"
          defaultValue={q ?? ""}
          placeholder={home ? "Search this home" : community ? `Search ${community.name}` : "Search: kitchen, Brazos plan, Oak Creek, twilight…"}
          className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none"
        />
        <button className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110">Search</button>
      </form>

      {/* Room and type filters */}
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {KINDS.map((k) => (
          <Link key={k.key} href={params({ kind: kind === k.key ? null : k.key })} className={chip(kind === k.key)}>{k.label}</Link>
        ))}
        <span className="mx-1 w-px shrink-0 bg-line" aria-hidden />
        {ROOM_FILTERS.map((r) => (
          <Link key={r} href={params({ room: room === r ? null : r })} className={chip(room === r)}>{ROOM_LABELS[r]}</Link>
        ))}
      </div>
      {tag && (
        <p className="mt-3 text-sm">
          Tagged <b>{tag}</b>. <Link href={params({ tag: null })} className="underline">Clear</Link>
        </p>
      )}

      {/* Top level: community folders, grouped by builder for our staff */}
      {atTop && (
        <div className="mt-10 space-y-12">
          {[...byBuilder.entries()].map(([builderName, list]) => (
            <section key={builderName}>
              {staff && (
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 className="text-[22px] font-semibold">{builderName.replace(" (demo)", "")}</h2>
                  <Link href={`/media?builder=${list[0].builder_id}`} className="text-sm font-semibold underline">All of this builder’s media</Link>
                </div>
              )}
              <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((c) => {
                  const cover = ((covers ?? []) as unknown as MediaRow[]).find((m) => m.community_id === c.id);
                  return (
                    <Link key={c.id} href={`/media?community=${c.id}`} className="group block">
                      <div className="relative aspect-[3/2] overflow-hidden rounded-2xl bg-soft">
                        {cover && <MediaPicture m={cover} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />}
                        <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold shadow-sm">
                          {counts.get(c.id) ?? 0} files
                        </span>
                      </div>
                      <div className="mt-3 text-lg font-bold group-hover:underline">{c.name}</div>
                      <div className="text-sm text-muted">{c.city}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
          {folderCommunities.length === 0 && <Empty text="No media you can see yet." />}
        </div>
      )}

      {/* Builder level (staff): its communities */}
      {builder && !community && !home && !filtering && (
        <div className="mt-10 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {folderCommunities.map((c) => {
            const cover = ((covers ?? []) as unknown as MediaRow[]).find((m) => m.community_id === c.id);
            return (
              <Link key={c.id} href={`/media?community=${c.id}`} className="group block">
                <div className="aspect-[3/2] overflow-hidden rounded-2xl bg-soft">
                  {cover && <MediaPicture m={cover} className="h-full w-full" />}
                </div>
                <div className="mt-3 text-lg font-bold group-hover:underline">{c.name}</div>
                <div className="text-sm text-muted">{counts.get(c.id) ?? 0} files</div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Community level: community media, then a folder per home */}
      {community && !home && !filtering && (
        <>
          <section className="mt-10">
            <h2 className="text-[22px] font-semibold">Community photos and video</h2>
            <p className="mt-1 text-sm text-muted">Entrance, amenities, aerials and site plans. Use them on any home here.</p>
            <div className="mt-4">
              <MediaGrid>{communityOnly.map((m) => <MediaTile key={m.id} m={m} />)}</MediaGrid>
              {communityOnly.length === 0 && <Empty text="No community media yet." />}
            </div>
          </section>
          <section className="mt-12">
            <h2 className="text-[22px] font-semibold">Homes</h2>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {(homeFolders ?? []).map((h) => {
                const cover = coverByHome.get(h.id);
                const n = results.filter((m) => m.home_id === h.id).length;
                return (
                  <Link key={h.id} href={`/media?home=${h.id}`} className="group block">
                    <div className="relative aspect-[3/2] overflow-hidden rounded-xl bg-soft">
                      {cover && <MediaPicture m={cover} className="h-full w-full" />}
                      <span className="absolute bottom-2 left-2 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold shadow-sm">{n} files</span>
                    </div>
                    <div className="mt-2 truncate text-sm font-semibold group-hover:underline">{h.unparsed_address}</div>
                    <div className="truncate text-xs text-muted">{h.plan_name} plan</div>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* Home level: three sections */}
      {home && (
        <div className="mt-8 space-y-12">
          {home.show_representative_disclaimer && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              The representative disclaimer is on for this home, so it’s shown on these photos and added to downloads.{" "}
              <Link href={`/homes/${home.id}#photos-note`} className="font-semibold underline">Change</Link>
            </p>
          )}
          <section>
            <h2 className="text-[22px] font-semibold">This home</h2>
            <p className="mt-1 text-sm text-muted">{results.length} {results.length === 1 ? "file" : "files"} taken at {home.unparsed_address}.</p>
            <div className="mt-4">
              <MediaGrid>{results.map((m) => <MediaTile key={m.id} m={m} disclaimer={home.show_representative_disclaimer} />)}</MediaGrid>
              {results.length === 0 && <Empty text={filtering ? "Nothing here matches." : "No photos of this home yet. The plan photos below can stand in until it’s built."} />}
            </div>
          </section>
          <section>
            <h2 className="text-[22px] font-semibold">{(home.communities as unknown as { name: string } | null)?.name ?? "Community"} photos and video</h2>
            <p className="mt-1 text-sm text-muted">Entrance, amenities and aerials from the community this home is in.</p>
            <div className="mt-4">
              <MediaGrid>{homeCommunityMedia.map((m) => <MediaTile key={m.id} m={m} />)}</MediaGrid>
              {homeCommunityMedia.length === 0 && <Empty text="No community media yet." />}
            </div>
          </section>
          <section>
            <h2 className="text-[22px] font-semibold">{home.plan_name ? `${home.plan_name} floor plan` : "Floor plan"} photos and video</h2>
            <p className="mt-1 text-sm text-muted">Model home and past builds of this plan. Use them while the home is being built; turn on the representative disclaimer on the home if you list with them.</p>
            <div className="mt-4">
              <MediaGrid>{planMedia.map((m) => <MediaTile key={m.id} m={m} disclaimer={home.show_representative_disclaimer} />)}</MediaGrid>
              {planMedia.length === 0 && <Empty text="No plan photos in the library yet." />}
            </div>
          </section>
        </div>
      )}

      {/* Any search or filter outside a home: the results */}
      {!home && (filtering || (builder && filtering)) && (
        <div className="mt-8">
          <p className="mb-4 text-sm text-muted">{results.length === 160 ? "Showing the first 160 results" : `${results.length} ${results.length === 1 ? "file" : "files"}`}</p>
          <MediaGrid>{results.map((m) => <MediaTile key={m.id} m={m} showPlace={!home} />)}</MediaGrid>
          {results.length === 0 && <Empty text="Nothing matches. Try another room or search word." />}
        </div>
      )}
    </div>
  );
}

function chip(on: boolean) {
  return cx(
    "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors",
    on ? "border-foreground bg-foreground font-semibold text-white" : "border-line hover:border-foreground",
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-muted">{text}</p>;
}
