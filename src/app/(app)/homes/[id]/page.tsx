import { Suspense } from "react";
import { BuyerAgentFields } from "@/components/buyer-agent-fields";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { enterOwnMls } from "@/lib/mls-entry";
import {
  allowedTransitions,
  editableFields,
  isStaff,
  ROLE_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  TRANSITION_LABELS,
  type HomeField,
  type WorkflowStatus,
} from "@/lib/permissions";
import { baths, cx, dateTime, money, num } from "@/lib/format";
import { SourceBadge, StatusBadge } from "@/components/badges";
import { HomeArt } from "@/components/home-art";
import { MediaPicture } from "@/components/media-tile";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";
import {
  cancelOpenHouse,
  changeStatus,
  requestChange,
  requestReverseProspecting,
  resolveRequest,
  saveHome,
  saveRooms,
  scheduleOpenHouse,
  setBuildStage,
  setDisclaimer,
  setHomeMls,
  setMarketStatus,
  stopOpenHouseSeries,
  updateReverseProspecting,
} from "./actions";
import { nextSaturdayCentral, openHouseWhen } from "@/lib/time";
import { MEDIA_REQUEST_SELECT, RequestCard, RequestForm, type MediaRequest } from "@/components/media-requests";
import {
  canManageIncentives,
  canManageMedia,
  canShareLinks,
  canRequestComps,
  canRequestMedia,
  canRequestReverseProspecting,
  canScheduleOpenHouses,
  canToggleDisclaimer,
  marketChoices,
  MARKET_LABELS,
  TASK_KIND_LABELS,
  type MarketStatus,
} from "@/lib/permissions";
import { MarketBadge } from "@/components/badges";
import { DisclaimerOverlay } from "@/components/media-tile";
import { loadMlsSheet } from "@/lib/mls-sheet";
import { AlertCard, loadAlerts } from "@/components/alerts";
import { NtreisQuestions } from "@/components/ntreis-questions";
import { canEditMlsAnswers } from "@/lib/ntreis-form";
import { loadListingMedia } from "@/lib/listing-media";
import { ListingMediaPanel } from "@/components/listing-media-panel";
import { ShareLinksPanel } from "@/components/share-links-panel";
import { RoomsEditor } from "@/components/rooms-editor";
import { IncentiveList } from "@/components/incentive-list";
import type { Incentive } from "@/lib/incentives";
import { cleanRooms, levelLabel, roomSize } from "@/lib/rooms";
import { Deliverables } from "@/components/deliverables";
import { loadDeliverables } from "@/lib/deliverables";

export default function HomePage(props: PageProps<"/homes/[id]">) {
  return (
    <Suspense fallback={<div className="mt-16 aspect-[21/9] animate-pulse rounded-2xl bg-soft" />}>
      <HomeDetail params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

type FieldDef = {
  name: HomeField;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "stage";
  step?: string;
  wide?: boolean;
};

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Description",
    fields: [{ name: "public_remarks", label: "Listing description (goes in the MLS public remarks)", type: "textarea", wide: true }],
  },
  {
    title: "Price and specs",
    fields: [
      { name: "list_price", label: "List price ($)", type: "number", step: "1" },
      { name: "bedrooms_total", label: "Bedrooms", type: "number" },
      { name: "bathrooms_full", label: "Full baths", type: "number" },
      { name: "bathrooms_half", label: "Half baths", type: "number" },
      { name: "living_area", label: "Living area (sq ft)", type: "number" },
      { name: "lot_size_acres", label: "Lot size (acres)", type: "number", step: "0.001" },
      { name: "stories", label: "Stories", type: "number" },
      { name: "garage_spaces", label: "Garage spaces", type: "number" },
      { name: "year_built", label: "Year built", type: "number" },
    ],
  },
  {
    title: "Construction",
    fields: [
      { name: "build_stage", label: "Build stage", type: "stage" },
      { name: "estimated_completion", label: "Estimated completion", type: "date" },
    ],
  },
  {
    title: "Location",
    fields: [
      { name: "unparsed_address", label: "Street address", wide: true },
      { name: "city", label: "City" },
      { name: "postal_code", label: "ZIP" },
      { name: "lot_number", label: "Lot and block" },
      { name: "plan_name", label: "Floor plan" },
    ],
  },
];

async function HomeDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/homes/[id]">["params"];
  searchParams: PageProps<"/homes/[id]">["searchParams"];
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireProfile();
  const supabase = await createClient();

  const { data: home } = await supabase
    .from("homes")
    .select("*, communities(name), builders(name)")
    .eq("id", id)
    .maybeSingle();
  // RLS hides other builders' homes, so they look exactly like missing ones.
  if (!home) notFound();

  const { data: activity } = await supabase
    .from("activity_log")
    .select("id, action, changes, actor_id, created_at")
    .eq("home_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  const actorIds = [...new Set((activity ?? []).map((a) => a.actor_id).filter(Boolean))];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, role").in("id", actorIds)
    : { data: [] as { id: string; full_name: string; role: string }[] };
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name]));

  const [{ data: openHouses }, { data: requests }] = await Promise.all([
    supabase.from("open_houses").select("id, starts_at, ends_at, remarks, created_by, cancelled_at").eq("home_id", id).is("cancelled_at", null).gte("ends_at", new Date().toISOString()).order("starts_at"),
    supabase.from("change_requests").select("id, message, status, resolution_note, requested_by, resolved_by, created_at, resolved_at").eq("home_id", id).order("created_at", { ascending: false }),
  ]);
  const peopleIds = [...new Set((requests ?? []).flatMap((r) => [r.requested_by, r.resolved_by]).filter((x): x is string => !!x && !actorName.has(x)))];
  if (peopleIds.length) {
    const { data: more } = await supabase.from("profiles").select("id, full_name").in("id", peopleIds);
    (more ?? []).forEach((p) => actorName.set(p.id, p.full_name));
  }
  const upcomingOH = openHouses ?? [];
  const canScheduleOH = canScheduleOpenHouses(me.role);
  const staff = isStaff(me.role);

  const [{ data: series }, { data: reverse }, { data: windowSetting }, { data: homeTasks }] = await Promise.all([
    supabase.from("open_house_series").select("id, weekday, start_time, end_time, remarks, until_date, until_under_contract, ended_at, ended_reason, created_at").eq("home_id", id).order("created_at", { ascending: false }),
    supabase.from("reverse_prospect_requests").select("id, requester_name, notes, status, result_note, created_at, delivered_at").eq("home_id", id).order("created_at", { ascending: false }),
    supabase.from("app_settings").select("value").eq("key", "mls_open_house_window_days").maybeSingle(),
    staff
      ? supabase.from("tasks").select("id, kind, title, status, due_at, priority").eq("home_id", id).in("status", ["todo", "in_progress"]).order("created_at")
      : Promise.resolve({ data: null }),
  ]);
  // Builders who enter their own listings get the MLS sheet and the "mark live" step too.
  const ownMls = !staff && (await enterOwnMls(me.role, me.builder_id));
  const mlsScore = staff || ownMls ? (await loadMlsSheet(supabase, id))?.score ?? null : null;
  const alerts = await loadAlerts({ homeId: id });
  const canAnswerAlerts = ["platform_admin", "listing_coordinator", "builder_owner", "manager", "sales"].includes(me.role);

  // Which MLS, and is the listing ready for it?
  const [{ data: boards }, { data: bset }, { data: readinessRaw }] = await Promise.all([
    supabase.from("mls_boards").select("code, short_name, region, counties").eq("active", true).order("code"),
    supabase.from("builder_settings").select("mls_boards, mls_locked").eq("builder_id", home.builder_id).maybeSingle(),
    ["draft", "in_review", "approved_for_mls"].includes(home.workflow_status)
      ? supabase.rpc("mls_readiness", { p_home: id })
      : Promise.resolve({ data: null }),
  ]);
  const readiness = (readinessRaw ?? []) as { level: "block" | "warn" | "team"; code: string; message: string }[];
  const blockers = readiness.filter((r) => r.level === "block");
  const myBoards: string[] = bset?.mls_boards ?? [];
  const board = (boards ?? []).find((b) => b.code === home.mls_board);
  const canPickMls = ["platform_admin", "listing_coordinator", "builder_owner", "manager"].includes(me.role) && home.workflow_status !== "live_on_mls";
  const live = home.workflow_status === "live_on_mls";
  const canEditStage = (editableFields(me.role) as readonly string[]).includes("build_stage");
  const currentSale = (home.market_status ?? "active") as MarketStatus;
  const saleChoices = marketChoices(me.role).filter((m) => m !== currentSale);
  const lockedToOne = !!bset?.mls_locked && myBoards.length === 1 && home.mls_board === myBoards[0];
  const activeSeries = (series ?? []).filter((x) => !x.ended_at);
  const mlsWindow = Number(windowSetting?.value ?? 28);
  const openReverse = (reverse ?? []).filter((r) => r.status === "requested" || r.status === "in_progress");
  const reverseFiles = await loadDeliverables(supabase, "reverse_prospect_requests", (reverse ?? []).map((r) => r.id));
  const canResolve = ["platform_admin", "builder_owner", "manager", "marketing"].includes(me.role);
  const openRequests = (requests ?? []).filter((r) => r.status === "open");

  // Room sizes: the home's own list, and its floor plan's list to pull from.
  const rooms = cleanRooms(((home.mls_fields ?? {}) as Record<string, unknown>).Rooms);
  const { data: planRow } = home.plan_name
    ? await supabase.from("floor_plans").select("id, name, rooms").eq("builder_id", home.builder_id).ilike("name", home.plan_name).maybeSingle()
    : { data: null };
  const planRooms = cleanRooms(planRow?.rooms);
  const canEditRooms = canEditMlsAnswers(me.role);
  const { data: incentiveRows } = await supabase.rpc("home_incentives", { p_home: home.id });
  const incentives = (incentiveRows ?? []) as Incentive[];

  const { data: mediaRows, count: mediaCount } = await supabase
    .from("media")
    .select(MEDIA_SELECT, { count: "exact" })
    .eq("home_id", id)
    .is("deleted_at", null)
    .order("is_cover", { ascending: false })
    .order("sort_order");
  // What's on the MLS listing, in order (photographer deliveries, uploads, and
  // community or plan photos the builder added).
  const listing = await loadListingMedia(supabase, { id: home.id, builder_id: home.builder_id, community_id: home.community_id, plan_name: home.plan_name });
  const listedPhotos = listing.photos.filter((m) => m.kind === "photo");
  const ownPhotos = listedPhotos.length ? listedPhotos : ((mediaRows ?? []) as unknown as MediaRow[]).filter((m) => m.kind === "photo");
  // Not built yet (or few photos)? Fill in from the plan's library photos automatically.
  const { data: planRows } = ownPhotos.length < 5 && home.plan_name
    ? await supabase.from("media").select(MEDIA_SELECT).eq("builder_id", home.builder_id).eq("plan_name", home.plan_name).is("home_id", null).is("community_id", null).eq("kind", "photo").is("deleted_at", null).order("sort_order").limit(5)
    : { data: null };
  const planPhotos = (planRows ?? []) as unknown as MediaRow[];
  const gallery = [...ownPhotos, ...planPhotos].slice(0, 5);
  const usingPlanPhotos = ownPhotos.length < 5 && planPhotos.length > 0;
  const showDisclaimer = !!home.show_representative_disclaimer;
  const { data: mediaReqRows } = await supabase.from("media_requests").select(MEDIA_REQUEST_SELECT).eq("home_id", id).order("created_at", { ascending: false });
  const mediaRequests = (mediaReqRows ?? []) as MediaRequest[];
  const openMediaRequests = mediaRequests.filter((r) => !["completed", "cancelled"].includes(r.status));

  const editable = new Set(editableFields(me.role));
  const status = home.workflow_status as WorkflowStatus;
  const transitions = allowedTransitions(me.role, status, ownMls);
  const sources = (home.field_sources ?? {}) as Record<string, string>;
  const error = typeof sp.error === "string" ? sp.error : null;
  const saved = typeof sp.saved === "string" ? sp.saved : null;
  const savedText = saved ? (SAVED_MESSAGES[saved] ?? saved) : null;
  const at = typeof sp.at === "string" ? sp.at : null;
  // A message for one section shows inside that section; others show at the top.
  const sectionNotice = (name: string) =>
    at === name && (error || savedText) ? (
      <p role="status" className={`mt-4 rounded-xl px-4 py-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
        {error ?? savedText}
      </p>
    ) : null;
  const steps = Object.keys(STATUS_LABELS) as WorkflowStatus[];

  const facts = [
    { value: home.bedrooms_total ?? "—", label: "beds" },
    { value: baths(home.bathrooms_full, home.bathrooms_half), label: "baths" },
    { value: num(home.living_area), label: "sq ft" },
    { value: home.lot_size_acres ?? "—", label: "acres" },
    { value: home.stories ?? "—", label: home.stories === 1 ? "story" : "stories" },
    { value: home.garage_spaces ?? "—", label: "car garage" },
  ];

  return (
    <div>
      <Link href="/homes" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground">
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        All homes
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{home.unparsed_address}</h1>
          <p className="mt-1 text-muted">
            <Link href={`/communities/${home.community_id}`} className="font-medium text-foreground underline">{home.communities?.name}</Link>, {home.city}, TX {home.postal_code}
            {isStaff(me.role) ? `. Built by ${home.builders?.name.replace(" (demo)", "")}` : ""}
          </p>
        </div>
        {canRequestComps(me.role) && (
          <Link href={`/comps/new?home=${home.id}`} className="shrink-0 rounded-full border border-foreground px-4 py-2 text-sm font-semibold hover:bg-soft">
            Request comps
          </Link>
        )}
      </div>

      {error && !at && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {saved && !at && (
        <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {savedText}
        </p>
      )}

      {alerts.length > 0 && (
        <div className="mt-4 space-y-3">
          {alerts.map((a) => <AlertCard key={a.id} a={a} back={`/homes/${home.id}`} canAnswer={canAnswerAlerts} staff={staff} showHome={false} />)}
        </div>
      )}

      {/* Gallery: the cover photo large, then four more, like a listing page. */}
      <div className="relative mt-6 grid gap-2 overflow-hidden rounded-2xl md:grid-cols-4 md:grid-rows-2 md:[height:440px]">
        {gallery.length === 0 ? (
          <div className="relative aspect-[4/3] md:col-span-4 md:row-span-2 md:aspect-auto">
            <HomeArt seed={home.id} stories={home.stories} scene="day" className="h-full w-full" />
          </div>
        ) : (
          gallery.slice(0, 5).map((m, i) => (
            <Link
              key={m.id}
              href={`/media/${m.id}`}
              className={i === 0 ? "relative aspect-[4/3] md:col-span-2 md:row-span-2 md:aspect-auto" : "relative hidden bg-soft md:block"}
            >
              <MediaPicture m={m} size={i === 0 ? "web" : "thumb"} className="h-full w-full" />
              {showDisclaimer && <DisclaimerOverlay small={i > 0} />}
              {!m.home_id && <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold shadow-sm">Plan photo</span>}
            </Link>
          ))
        )}
        <Link
          href={`/media?home=${home.id}`}
          className="absolute bottom-4 right-4 rounded-xl border border-foreground bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-soft"
        >
          Show all {mediaCount} photos and videos
        </Link>
      </div>

      {(usingPlanPhotos || showDisclaimer || canToggleDisclaimer(me.role)) && (
        <div id="photos-note" className="mt-3 flex scroll-mt-28 flex-wrap items-center gap-3 rounded-xl bg-soft px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">
            {usingPlanPhotos
              ? `Not enough photos of this home yet, so ${home.plan_name} plan photos fill in automatically. `
              : ""}
            {showDisclaimer ? "The representative disclaimer is on: it shows on this home’s photos and is added to downloads." : "Using model or plan photos for this listing? Turn on the disclaimer so every photo says it’s representative."}
          </span>
          {canToggleDisclaimer(me.role) && (
            <form action={setDisclaimer}>
              <input type="hidden" name="id" value={home.id} />
              <input type="hidden" name="on" value={showDisclaimer ? "false" : "true"} />
              <button className={cx("rounded-lg px-3 py-2 font-semibold", showDisclaimer ? "border border-foreground bg-white hover:bg-soft" : "bg-foreground text-white hover:bg-black")}>
                {showDisclaimer ? "Turn off disclaimer" : "Add representative disclaimer"}
              </button>
            </form>
          )}
        </div>
      )}

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-6">
            <div>
              <h2 className="text-[22px] font-semibold">The {home.plan_name} plan</h2>
              <p className="text-muted">
                {STAGE_LABELS[home.build_stage]}
                {home.estimated_completion ? `, estimated ${new Date(home.estimated_completion + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}` : ""}
                {home.lot_number ? `. Lot ${home.lot_number}` : ""}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-y-6 border-b border-line py-6 sm:grid-cols-6">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-sm text-muted">{f.label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{f.value}</dd>
              </div>
            ))}
          </dl>

          <QuickLinks homeId={home.id} openRequests={openRequests.length} upcomingOH={upcomingOH.length} openShoots={openMediaRequests.length} openReverse={openReverse.length} canRequestPhotos={canRequestMedia(me.role)} />

          {homeTasks && homeTasks.length > 0 && (
            <section className="border-b border-line py-6">
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold">Our team’s open tasks</h3>
                <Link href="/tasks" className="text-sm font-semibold text-accent hover:underline">Task board →</Link>
              </div>
              <ul className="mt-3 space-y-2">
                {homeTasks.map((t) => (
                  <li key={t.id} className={cx("flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm", t.priority === "high" ? "border-red-200" : "border-line")}>
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{TASK_KIND_LABELS[t.kind]}</span>
                    <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 font-medium hover:underline">{t.title}</Link>
                    {t.status === "in_progress" && <span className="text-xs text-amber-800">In progress</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="incentives" className="scroll-mt-28 border-b border-line py-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[22px] font-semibold">Incentives</h2>
              {canManageIncentives(me.role) && <Link href={`/incentives?home=${home.id}`} className="text-sm font-semibold underline">+ Add one for this home</Link>}
            </div>
            <p className="mt-1 text-sm text-muted">What a buyer gets on this home right now: its own incentives, its community&rsquo;s, and any that cover every community.</p>
            <div className="mt-4">
              {incentives.length ? <IncentiveList items={incentives} manageHref={canManageIncentives(me.role) ? "/incentives" : undefined} /> : <p className="text-sm text-muted">No current incentives.</p>}
            </div>
          </section>

          <section id="open-houses" className="scroll-mt-28 border-b border-line py-8">
            <h3 className="text-lg font-semibold">Open houses</h3>
            {sectionNotice("open-houses")}
            <ul className="mt-4 space-y-3">
              {upcomingOH.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-4">
                  <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <span className="text-[10px] font-semibold uppercase leading-none">{new Date(o.starts_at).toLocaleDateString("en-US", { month: "short", timeZone: "America/Chicago" })}</span>
                    <span className="text-lg font-bold leading-none">{new Date(o.starts_at).toLocaleDateString("en-US", { day: "numeric", timeZone: "America/Chicago" })}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{openHouseWhen(o.starts_at, o.ends_at)}</div>
                    <div className="text-sm text-muted">
                      Set by {actorName.get(o.created_by) ?? "a teammate"}{o.remarks ? `. ${o.remarks}` : ""}
                    </div>
                  </div>
                  {canScheduleOH && (
                    <form action={cancelOpenHouse}>
                      <input type="hidden" name="id" value={home.id} />
                      <input type="hidden" name="open_house_id" value={o.id} />
                      <button className="rounded-lg px-3 py-1.5 text-sm font-semibold underline hover:bg-soft">Cancel</button>
                    </form>
                  )}
                </li>
              ))}
              {upcomingOH.length === 0 && <li className="text-muted">No open houses scheduled.</li>}
            </ul>
            {activeSeries.map((x) => (
              <div key={x.id} className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
                <svg viewBox="0 0 20 20" className="h-6 w-6 shrink-0 text-accent" aria-hidden><path d="M4 10a6 6 0 0 1 10.3-4.2M16 10a6 6 0 0 1-10.3 4.2M14 3v3h-3M6 17v-3h3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    Repeats every {WEEKDAYS[x.weekday]}, {clock(x.start_time)} to {clock(x.end_time)}
                  </div>
                  <div className="text-sm text-muted">
                    {x.until_under_contract ? "Until the home goes under contract" : `Through ${new Date(x.until_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                    . Dates are added {mlsWindow} days ahead (the MLS limit), and our team gets a reminder to enter each batch.
                    {status !== "live_on_mls" && " Dates start once the listing is live."}
                  </div>
                </div>
                {canScheduleOH && (
                  <form action={stopOpenHouseSeries}>
                    <input type="hidden" name="id" value={home.id} />
                    <input type="hidden" name="series_id" value={x.id} />
                    <button className="rounded-lg border border-foreground bg-white px-3 py-1.5 text-sm font-semibold hover:bg-soft">Stop repeating</button>
                  </form>
                )}
              </div>
            ))}
            {(series ?? []).filter((x) => x.ended_at).slice(0, 2).map((x) => (
              <p key={x.id} className="mt-2 text-sm text-muted">
                A repeating {WEEKDAYS[x.weekday]} open house ended {dateTime(x.ended_at!)}{x.ended_reason ? `: ${x.ended_reason.toLowerCase()}` : ""}.
              </p>
            ))}
            {canScheduleOH && (
              <form action={scheduleOpenHouse} className="mt-5 grid gap-3 rounded-2xl bg-soft p-4 sm:grid-cols-[1.3fr_1fr_1fr]">
                <input type="hidden" name="id" value={home.id} />
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Date</span>
                  <input name="date" type="date" required defaultValue={nextSaturdayCentral(new Date())} className="field-input" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Starts</span>
                  <input name="start" type="time" required defaultValue="13:00" className="field-input" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Ends</span>
                  <input name="end" type="time" required defaultValue="16:00" className="field-input" />
                </label>
                <label className="block sm:col-span-3">
                  <span className="mb-1 block text-sm font-medium">Note for buyers’ agents (optional)</span>
                  <input name="remarks" placeholder="Refreshments, model home tours" className="field-input" />
                </label>
                <fieldset className="sm:col-span-3">
                  <legend className="mb-2 text-sm font-medium">Repeat this?</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-sm has-[:checked]:border-accent">
                      <input type="radio" name="repeat" value="once" defaultChecked className="h-4 w-4 accent-[#3452c7]" /> Just this date
                    </label>
                    <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-sm has-[:checked]:border-accent">
                      <input type="radio" name="repeat" value="until_contract" className="h-4 w-4 accent-[#3452c7]" /> Every week until under contract
                    </label>
                    <label className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-sm has-[:checked]:border-accent">
                      <input type="radio" name="repeat" value="until_date" className="h-4 w-4 accent-[#3452c7]" /> Every week through
                      <input name="until_date" type="date" className="rounded-md border border-line px-2 py-1 text-sm" aria-label="Last date" />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    The MLS only takes open houses {mlsWindow} days ahead, so we add dates as the window moves and remind our team to enter them.
                    Repeats stop on their own if the home goes under contract, sells, is paused or comes off the market.
                  </p>
                </fieldset>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                  <button className="rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Schedule open house</button>
                  <span className="text-sm text-muted">Times are Central. Our listing coordinator adds it to the MLS.</span>
                </div>
              </form>
            )}
          </section>

          <section id="reverse-prospecting" className="scroll-mt-28 border-b border-line py-8">
            <h3 className="text-lg font-semibold">
              Reverse prospecting {openReverse.length > 0 && <span className="font-normal text-muted">{openReverse.length} in progress</span>}
            </h3>
            <p className="mt-1 text-sm text-muted">
              A list of buyers’ agents whose clients are searching for a home like this one. Our team pulls it from the MLS by hand and sends it back to whoever asked, here and in their inbox.
            </p>
            {sectionNotice("reverse-prospecting")}
            <ul className="mt-4 space-y-3">
              {(reverse ?? []).slice(0, 4).map((r) => (
                <li key={r.id} className={cx("rounded-2xl border p-4", r.status === "delivered" ? "border-line" : r.status === "cancelled" ? "border-line opacity-70" : "border-rose-200 bg-rose-50/40")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{REVERSE_LABELS[r.status]}</span>
                    <span className="text-sm text-muted">Asked by {r.requester_name ?? "someone"}, {dateTime(r.created_at)}</span>
                  </div>
                  {r.notes && <p className="mt-1 text-sm">“{r.notes}”</p>}
                  {r.result_note && <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm"><b>From our team:</b> {r.result_note}</p>}
                  {(staff || r.status === "delivered") && r.status !== "cancelled" && (
                    <Deliverables files={reverseFiles.get(r.id) ?? []} table="reverse_prospect_requests" requestId={r.id} builderId={home.builder_id} staff={staff && r.status !== "delivered"} back={`/homes/${home.id}`} />
                  )}
                  {staff && (r.status === "requested" || r.status === "in_progress") && (
                    <form action={updateReverseProspecting} className="mt-3 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={home.id} />
                      <input type="hidden" name="request_id" value={r.id} />
                      <input name="result_note" placeholder="Note for them, e.g. 14 agents; top 3 are starred" className="field-input min-w-0 flex-1 py-2 text-sm" />
                      {r.status === "requested" && <button name="status" value="in_progress" className="rounded-lg border border-foreground px-3 py-2 text-sm font-semibold hover:bg-white">Start</button>}
                      <button name="status" value="delivered" className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">Send to {r.requester_name ?? "the builder"}</button>
                    </form>
                  )}
                  {!staff && r.status === "requested" && (
                    <form action={updateReverseProspecting} className="mt-2">
                      <input type="hidden" name="id" value={home.id} />
                      <input type="hidden" name="request_id" value={r.id} />
                      <button name="status" value="cancelled" className="text-sm font-semibold underline">Cancel request</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {canRequestComps(me.role) && (
              <p className="mt-4 text-sm">
                Need to check the price? <Link href={`/comps/new?home=${home.id}`} className="font-semibold text-accent underline">Request comps for this home</Link>
              </p>
            )}
            {canRequestReverseProspecting(me.role) && openReverse.length === 0 && (
              <form action={requestReverseProspecting} className="mt-4 space-y-3">
                <input type="hidden" name="id" value={home.id} />
                <input name="notes" placeholder="Anything we should know? (optional) e.g. include the 1290 next door" className="field-input" />
                <button className="rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Request a reverse prospecting list</button>
              </form>
            )}
          </section>

          <ListingMediaPanel
            home={{ id: home.id, community_name: (home.communities as { name: string } | null)?.name ?? "the community", plan_name: home.plan_name }}
            listing={listing}
            canEdit={canManageMedia(me.role)}
            canRequest={canRequestMedia(me.role)}
            notice={sectionNotice("listing-media")}
          />

          {(canShareLinks(me.role) || isStaff(me.role) || me.role === "sales") && (
            <ShareLinksPanel homeId={home.id} canManage={canShareLinks(me.role)} notice={sectionNotice("share")} highlight={at === "share" && typeof sp.link === "string" ? sp.link : null} undo={at === "share" && typeof sp.undo === "string" ? sp.undo : null} />
          )}

          {canRequestMedia(me.role) && (
          <section id="photo-requests" className="scroll-mt-28 border-b border-line py-8">
            <h3 className="text-lg font-semibold">
              Photo requests {openMediaRequests.length > 0 && <span className="font-normal text-muted">{openMediaRequests.length} open</span>}
            </h3>
            <p className="mt-1 text-sm text-muted">Need new photos, video, drone or a floor plan? Ask here and we’ll send a photographer. Files land in this home’s media.</p>
            {sectionNotice("photo-requests")}
            <div className="mt-4 space-y-4">
              {mediaRequests.slice(0, 4).map((r) => (
                <RequestCard key={r.id} r={r} role={me.role} back={`/homes/${home.id}#photo-requests`} />
              ))}
            </div>
            {canRequestMedia(me.role) && (
              <details className="mt-4" open={mediaRequests.length === 0}>
                <summary className="cursor-pointer list-none font-semibold underline">Request photos for this home</summary>
                <div className="mt-3">
                  <RequestForm back={`/homes/${home.id}#photo-requests`} homeId={home.id} />
                </div>
              </details>
            )}
          </section>
          )}

          <section id="requests" className="scroll-mt-28 border-b border-line py-8">
            <h3 className="text-lg font-semibold">
              Change requests {openRequests.length > 0 && <span className="font-normal text-muted">{openRequests.length} open</span>}
            </h3>
            {sectionNotice("requests")}
            <p className="mt-1 text-sm text-muted">
              Spot something wrong or missing? Ask for it here. Managers, owners and marketing see and resolve requests.
            </p>
            <form action={requestChange} className="mt-4 space-y-3">
              <input type="hidden" name="id" value={home.id} />
              <textarea name="message" rows={3} required placeholder="For example: the price changed to $384,990, or add the upgraded patio to the description" className="field-input leading-relaxed" />
              <button className="rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Request a change</button>
            </form>
            <ul className="mt-6 space-y-3">
              {(requests ?? []).map((r) => (
                <li key={r.id} className={cx("rounded-2xl border p-4", r.status === "open" ? "border-amber-300 bg-amber-50/50" : "border-line")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 whitespace-pre-line">{r.message}</p>
                    <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", REQUEST_STYLES[r.status])}>{REQUEST_LABELS[r.status]}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {actorName.get(r.requested_by) ?? "Someone"}, {dateTime(r.created_at)}
                    {r.resolved_by && `. ${REQUEST_LABELS[r.status].toLowerCase()} by ${actorName.get(r.resolved_by) ?? "a teammate"}`}
                    {r.resolution_note && `: “${r.resolution_note}”`}
                  </p>
                  {canResolve && r.status === "open" && (
                    <form action={resolveRequest} className="mt-3 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={home.id} />
                      <input type="hidden" name="request_id" value={r.id} />
                      <input name="note" placeholder="Note (optional)" className="field-input max-w-xs flex-1 py-2 text-sm" />
                      <button name="status" value="done" className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">Mark done</button>
                      <button name="status" value="declined" className="rounded-lg border border-foreground px-3 py-2 text-sm font-semibold hover:bg-white">Decline</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section id="rooms" className="scroll-mt-28 border-b border-line py-8">
            <h2 className="text-[22px] font-semibold">Room sizes</h2>
            <p className="mt-1 text-sm text-muted">
              The MLS lists each room with its level and size (feet).{" "}
              {planRow ? <>Pull them from the <Link href={`/plans/${planRow.id}`} className="underline">{planRow.name} plan</Link>, then adjust anything this home does differently.</> : home.plan_name ? <>Our team hasn&rsquo;t set up the {home.plan_name} plan yet, so add the rooms here.</> : "Pick this home's floor plan to pull rooms from it."}
            </p>
            {sectionNotice("rooms")}
            {canEditRooms ? (
              <>
                {planRooms.length > 0 && (
                  <form action={saveRooms} className="mt-4">
                    <input type="hidden" name="id" value={home.id} />
                    <input type="hidden" name="rooms_json" value={JSON.stringify(planRooms)} />
                    <button className="rounded-xl border border-foreground px-4 py-2 text-sm font-semibold hover:bg-soft">
                      {rooms.length ? `Replace with the ${planRow!.name} plan’s ${planRooms.length} rooms` : `Fill from the ${planRow!.name} plan (${planRooms.length} rooms)`}
                    </button>
                  </form>
                )}
                <form action={saveRooms} className="mt-4">
                  <input type="hidden" name="id" value={home.id} />
                  <RoomsEditor key={JSON.stringify(rooms)} initial={rooms} />
                  <button className="mt-4 rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Save room sizes</button>
                </form>
              </>
            ) : rooms.length ? (
              <table className="mt-4 w-full max-w-xl text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="pb-1 font-medium">Room</th><th className="pb-1 font-medium">Level</th><th className="pb-1 font-medium">Size (ft)</th></tr></thead>
                <tbody className="divide-y divide-line">{rooms.map((r, i) => <tr key={i}><td className="py-1.5">{r.RoomType}</td><td className="py-1.5">{levelLabel(r.RoomLevel)}</td><td className="py-1.5 tabular-nums">{roomSize(r)}</td></tr>)}</tbody>
              </table>
            ) : (
              <p className="mt-4 text-sm text-muted">No room sizes yet.</p>
            )}
          </section>

          <form id="edit" action={saveHome} className="scroll-mt-28 divide-y divide-line">
            <input type="hidden" name="id" value={home.id} />
            {SECTIONS.map((section) => (
              <section key={section.title} className="py-8">
                <h3 className="text-lg font-semibold">{section.title}</h3>
                <div className="mt-4 grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                  {section.fields.map((f) => (
                    <Field key={f.name} def={f} value={home[f.name]} source={sources[f.name]} canEdit={editable.has(f.name)} />
                  ))}
                </div>
              </section>
            ))}
            {home.mls_board === "NTREIS" && (
              // Folded away until someone opens it to make a change; it opens on
              // its own after saving or when a save has a problem with it. The
              // answers inside still go with "Save changes" while it's closed.
              <details id="ntreis" open={at === "ntreis"} className="group scroll-mt-28 py-8">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 hover:bg-soft">
                  <span>
                    <span className="block text-lg font-semibold">NTREIS details</span>
                    <span className="block text-sm text-muted">
                      {canEditMlsAnswers(me.role) ? "Open to add or change this home’s NTREIS answers." : "Open to see this home’s NTREIS answers."}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold">
                    <span className="group-open:hidden">{canEditMlsAnswers(me.role) ? "Edit" : "View"}</span>
                    <span className="hidden group-open:inline">Close</span>
                    <span className="ml-1 inline-block text-muted transition-transform group-open:rotate-180" aria-hidden>▾</span>
                  </span>
                </summary>
                {sectionNotice("ntreis")}
                <p className="mt-4 text-sm text-muted">
                  The rest of what NTREIS asks for this home, with NTREIS&rsquo;s own labels and choices. <b className="text-accent">MLS required</b> marks
                  what NTREIS requires before the listing can go live. Our team fills in the listing paperwork, schools, HOA and showing setup.
                </p>
                <NtreisQuestions
                  mode="edit"
                  values={(home.mls_fields ?? {}) as Record<string, unknown>}
                  sources={sources}
                  canEdit={canEditMlsAnswers(me.role)}
                />
              </details>
            )}
            <div className="flex flex-wrap items-center gap-4 py-8">
              {editable.size > 0 || (home.mls_board === "NTREIS" && canEditMlsAnswers(me.role)) ? (
                <>
                  <button className="rounded-xl bg-foreground px-6 py-3 font-semibold text-white hover:bg-black">Save changes</button>
                  <span className="text-sm text-muted">As {ROLE_LABELS[me.role].toLowerCase()}, you can edit the fields that aren’t grayed out.</span>
                </>
              ) : (
                <span className="text-sm text-muted">As {ROLE_LABELS[me.role].toLowerCase()}, you can view these details but not change them.</span>
              )}
            </div>
          </form>

          <section className="border-t border-line py-8">
            <h3 className="text-lg font-semibold">Activity</h3>
            <ul className="mt-4 space-y-4">
              {activity?.map((a) => {
                const who = a.actor_id ? (actorName.get(a.actor_id) ?? "Someone") : "Initial import";
                return (
                  <li key={a.id} className="flex gap-3 text-[15px]">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-[11px] font-semibold">
                      {who.split(" ").map((p: string) => p[0]).slice(0, 2).join("")}
                    </span>
                    <div>
                      <span className="font-semibold">{who}</span>{" "}
                      <span>{describe(a.action, a.changes as Record<string, { from: unknown; to: unknown }>)}</span>
                      <div className="text-sm text-muted">{dateTime(a.created_at)}</div>
                    </div>
                  </li>
                );
              })}
              {!activity?.length && <li className="text-muted">No activity yet.</li>}
            </ul>
          </section>
        </div>

        {/* Sticky side card, like a booking box. */}
        <aside>
          <div className="card-lift sticky top-28 rounded-2xl border border-line bg-white p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[26px] font-bold tabular-nums leading-none">{money(home.list_price)}</div>
                {home.living_area && home.list_price && (
                  <div className="mt-1 text-sm text-muted">{money(Number(home.list_price) / home.living_area)} per sq ft</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <StatusBadge status={status} />
                <MarketBadge status={home.market_status} />
              </div>
            </div>

            {/* Home status: construction and sale, changeable any time */}
            <div id="home-status" className="mt-5 scroll-mt-28 rounded-xl border border-line p-4">
              <h4 className="text-sm font-semibold">Home status</h4>
              {sectionNotice("home-status")}
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">Construction</p>
              <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-soft p-1">
                {(["to_be_built", "under_construction", "move_in_ready"] as const).map((st) => {
                  const on = home.build_stage === st;
                  return canEditStage && !on ? (
                    <form key={st} action={setBuildStage}>
                      <input type="hidden" name="id" value={home.id} />
                      <input type="hidden" name="build_stage" value={st} />
                      <button className="w-full rounded-md px-1 py-2 text-xs font-semibold text-muted hover:bg-white hover:text-foreground">{STAGE_SHORT[st]}</button>
                    </form>
                  ) : (
                    <span key={st} className={cx("rounded-md px-1 py-2 text-center text-xs font-semibold", on ? "bg-white text-foreground shadow-sm" : "text-muted")}>{STAGE_SHORT[st]}</span>
                  );
                })}
              </div>

              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Sale</p>
              <p className="mt-1 text-sm">
                <b>{SALE_LABELS[(home.market_status ?? "active") as MarketStatus]}</b>
                {home.market_status === "under_contract" && home.purchase_contract_date ? `, since ${new Date(home.purchase_contract_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                {home.market_status === "under_contract" && (home.buyer_unrepresented || home.buyer_agent_full_name) && (
                  <span className="block text-xs text-muted">
                    {home.buyer_unrepresented ? "Buyer has no agent" : `Buyer’s agent: ${home.buyer_agent_full_name}${home.buyer_office_name ? `, ${home.buyer_office_name}` : ""}${home.co_buyer_agent_full_name ? ` and ${home.co_buyer_agent_full_name}` : ""}`}
                  </span>
                )}
                {home.market_status === "sold" && home.close_price ? `, ${money(home.close_price)}` : ""}
              </p>
              {saleChoices.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {saleChoices.map((m) =>
                    m === "under_contract" || m === "sold" ? (
                      <details key={m} className="col-span-2 rounded-lg border border-line open:border-foreground">
                        <summary className="cursor-pointer list-none px-3 py-2 text-center text-sm font-semibold">{MARKET_ACTIONS[m]}</summary>
                        <form action={setMarketStatus} className="space-y-2 border-t border-line p-3">
                          <input type="hidden" name="id" value={home.id} />
                          <input type="hidden" name="market_status" value={m} />
                          {m === "under_contract" ? (
                            <>
                              <label className="block text-sm">
                                <span className="mb-1 block font-medium">Contract date</span>
                                <input type="date" name="purchase_contract_date" required className="field-input py-2" />
                              </label>
                              <BuyerAgentFields />
                            </>
                          ) : (
                            <>
                              <label className="block text-sm">
                                <span className="mb-1 block font-medium">Close date</span>
                                <input type="date" name="close_date" required className="field-input py-2" />
                              </label>
                              <label className="block text-sm">
                                <span className="mb-1 block font-medium">Close price ($)</span>
                                <input name="close_price" inputMode="decimal" required defaultValue={home.list_price ?? ""} className="field-input py-2" />
                              </label>
                            </>
                          )}
                          {live && <p className="text-xs text-muted">The MLS requires this to change the status.</p>}
                          <button className="w-full rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">Save {MARKET_ACTIONS[m].toLowerCase()}</button>
                        </form>
                      </details>
                    ) : (
                      <form key={m} action={setMarketStatus}>
                        <input type="hidden" name="id" value={home.id} />
                        <input type="hidden" name="market_status" value={m} />
                        <button className={cx("w-full rounded-lg px-3 py-2 text-sm font-semibold", m === "active" ? "bg-accent text-white hover:brightness-110" : "border border-line hover:border-foreground")}>
                          {m === "active" && home.market_status === "under_contract" ? "Contract canceled" : MARKET_ACTIONS[m]}
                        </button>
                      </form>
                    ),
                  )}
                </div>
              )}
              <p className="mt-3 text-xs text-muted">
                {live
                  ? "Changes reach our team right away with the MLS deadline. Pausing, contracts and closings also stop open houses."
                  : "Not on the MLS yet, so nothing needs updating there."}
              </p>
            </div>

            <ol className="mt-6">
              {steps.map((s, i) => {
                const reached = steps.indexOf(status) >= i;
                const current = s === status;
                return (
                  <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < steps.length - 1 && (
                      <span className={cx("absolute left-[9px] top-5 h-[calc(100%-12px)] w-[2px]", steps.indexOf(status) > i ? "bg-foreground" : "bg-line")} />
                    )}
                    <span
                      className={cx(
                        "relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                        reached ? "border-foreground bg-foreground" : "border-line bg-white",
                      )}
                    >
                      {reached && (
                        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden><path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      )}
                    </span>
                    <span className={cx("text-[15px]", current ? "font-semibold" : reached ? "" : "text-muted")}>
                      {STATUS_LABELS[s]}
                      {s === "live_on_mls" && home.mls_number && <span className="block text-sm font-normal text-muted">MLS {home.mls_number}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>

            {/* MLS this home goes to */}
            <div className="mt-6 rounded-xl bg-soft px-4 py-3 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">MLS: {board?.short_name ?? "not set"}</span>
                {lockedToOne && <span className="text-xs text-muted">Set for {home.builders?.name.replace(" (demo)", "")}</span>}
              </div>
              {board && <p className="text-xs text-muted">{board.region}. Fields and rules follow this MLS.</p>}
              {canPickMls && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold underline">{lockedToOne ? "Override for this home" : "Change MLS"}</summary>
                  <form action={setHomeMls} className="mt-2 flex gap-2">
                    <input type="hidden" name="id" value={home.id} />
                    <select name="mls_board" defaultValue={home.mls_board ?? ""} className="field-input py-1.5 text-sm" aria-label="MLS">
                      {(boards ?? [])
                        .slice()
                        .sort((a, b) => Number(myBoards.includes(b.code)) - Number(myBoards.includes(a.code)))
                        .map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.short_name}{myBoards.includes(b.code) ? "" : " (not one of this builder’s markets)"}
                          </option>
                        ))}
                    </select>
                    <button className="rounded-lg bg-foreground px-3 text-sm font-semibold text-white">Save</button>
                  </form>
                  <p className="mt-1 text-xs text-muted">Changing the MLS changes which fields are required.</p>
                </details>
              )}
            </div>

            {/* Readiness: what would get it bounced back or fined */}
            {readiness.length > 0 || ["draft", "in_review"].includes(status) ? (
              <div id="readiness" className="mt-4 scroll-mt-28">
                <h4 className="text-sm font-semibold">{blockers.length ? `${blockers.length} thing${blockers.length > 1 ? "s" : ""} to fix before the MLS` : "Ready for the MLS"}</h4>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {readiness.map((r) => (
                    <li key={r.code} className={cx("flex gap-2 rounded-lg px-2.5 py-1.5", r.level === "block" ? "bg-red-50 text-red-900" : r.level === "warn" ? "bg-amber-50 text-amber-900" : "bg-soft text-muted")}>
                      <span aria-hidden>{r.level === "block" ? "✕" : r.level === "warn" ? "!" : "•"}</span>
                      <span>{r.message}</span>
                    </li>
                  ))}
                  {blockers.length === 0 && (
                    <li className="flex gap-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-emerald-900"><span aria-hidden>✓</span> Required fields, photos and description pass {board?.short_name ?? "the MLS"}’s rules.</li>
                  )}
                </ul>
              </div>
            ) : null}

            {transitions.length > 0 ? (
              <div className="mt-6 space-y-3">
                {transitions.map((to) => {
                  const backward = to === "draft" || (status === "approved_for_mls" && to === "in_review");
                  return (
                    <form key={to} action={changeStatus} className="space-y-3">
                      <input type="hidden" name="id" value={home.id} />
                      <input type="hidden" name="from" value={status} />
                      <input type="hidden" name="to" value={to} />
                      {to === "live_on_mls" && (
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium">MLS number</span>
                          <input name="mls_number" placeholder="From the MLS after you enter it" required className="field-input" />
                        </label>
                      )}
                      <button
                        disabled={to === "approved_for_mls" && blockers.length > 0}
                        title={to === "approved_for_mls" && blockers.length > 0 ? "Fix the items above first" : undefined}
                        className={cx(
                          "w-full rounded-xl px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50",
                          backward ? "border border-foreground hover:bg-soft" : "bg-accent text-white hover:brightness-110",
                        )}
                      >
                        {status === "approved_for_mls" && to === "in_review" ? "Send back for changes" : TRANSITION_LABELS[to]}
                      </button>
                    </form>
                  );
                })}
              </div>
            ) : (
              <p className="mt-6 rounded-xl bg-soft px-4 py-3 text-sm text-muted">{nextStepHint(status, ownMls)}</p>
            )}

            {mlsScore && (
              <Link href={`/homes/${home.id}/mls`} className="mt-6 block rounded-xl border border-line p-4 hover:border-foreground">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">MLS sheet</span>
                  <span className="text-sm text-muted">{mlsScore.filled} of {mlsScore.required} required</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft">
                  <div className={cx("h-full rounded-full", mlsScore.missing.length ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.round((mlsScore.filled / mlsScore.required) * 100)}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted">{ownMls ? "Every field the MLS needs, ready to copy." : "Our team only. Every field the MLS needs, ready to copy."}</p>
              </Link>
            )}

          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ def, value, source, canEdit }: { def: FieldDef; value: unknown; source?: string; canEdit: boolean }) {
  const v = value === null || value === undefined ? "" : String(value);
  const common = { name: def.name, disabled: !canEdit, className: "field-input", defaultValue: v };
  return (
    <label className={cx("block", def.wide && "sm:col-span-2 lg:col-span-3")}>
      <span className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-medium">
        {def.label} <SourceBadge source={source} />
      </span>
      {def.type === "textarea" ? (
        <textarea {...common} rows={5} className="field-input leading-relaxed" />
      ) : def.type === "stage" ? (
        <select {...common}>
          {Object.entries(STAGE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      ) : (
        <input {...common} type={def.type ?? "text"} step={def.step} />
      )}
    </label>
  );
}

function nextStepHint(status: WorkflowStatus, ownMls = false) {
  switch (status) {
    case "draft": return "Waiting for the builder team to submit this for review.";
    case "in_review": return "Waiting for a builder manager or owner to approve it for the MLS.";
    case "approved_for_mls": return ownMls ? "Approved. It's on your MLS work list with a work sheet to copy from." : "Approved. Our listing coordinator will enter it into the MLS.";
    case "live_on_mls": return "This listing is live on the MLS.";
  }
}

const FIELD_NAMES: Record<string, string> = {
  list_price: "price", public_remarks: "description", build_stage: "build stage",
  living_area: "square feet", bedrooms_total: "bedrooms", mls_number: "MLS number",
  estimated_completion: "completion date", unparsed_address: "address", mls_fields: "NTREIS details",
};

function describe(action: string, changes: Record<string, { from: unknown; to: unknown }>) {
  if (action === "created") return "added this home";
  if (action.startsWith("status_")) {
    const s = action.replace("status_", "") as WorkflowStatus;
    return `moved it to ${STATUS_LABELS[s] ?? s}`;
  }
  if (action === "change_requested") return `requested a change: “${(changes as unknown as { message: string }).message}”`;
  if (action === "change_request_done") return "marked a change request done";
  if (action === "change_request_declined") return "declined a change request";
  if (action === "open_house_scheduled") {
    const c = changes as unknown as { starts_at: string; ends_at: string };
    return `scheduled an open house for ${openHouseWhen(c.starts_at, c.ends_at)}`;
  }
  if (action === "open_house_cancelled") return "cancelled an open house";
  if (action === "open_house_series_started") return `set a repeating ${WEEKDAYS[(changes as unknown as { weekday: number }).weekday] ?? ""} open house`;
  if (action === "open_house_series_ended") return `ended a repeating open house${(changes as unknown as { reason?: string }).reason ? ` (${(changes as unknown as { reason: string }).reason.toLowerCase()})` : ""}`;
  if (action === "reverse_prospect_requested") return "requested a reverse prospecting list";
  if (action.startsWith("reverse_prospect_")) return `marked the reverse prospecting list ${action.replace("reverse_prospect_", "").replace("_", " ")}`;
  if (action === "media_requested") {
    const needs = (changes as unknown as { needs: string[] }).needs ?? [];
    return `requested ${needs.map((n) => NEED_TEXT[n] ?? n).join(", ") || "photos"}`;
  }
  if (action.startsWith("media_request_")) {
    const who = (changes as unknown as { photographer?: string }).photographer;
    const st = action.replace("media_request_", "");
    return st === "assigned" ? `assigned ${who ?? "a photographer"} to the photo request`
      : st === "scheduled" ? "scheduled the photo shoot"
      : st === "delivered" ? "delivered the photos"
      : st === "completed" ? "marked the photo request complete"
      : st === "cancelled" ? "cancelled the photo request"
      : st === "requested" ? "removed the photographer from the request"
      : "updated the photo request";
  }
  if (action === "listing_media_added") return `put ${(changes as unknown as { title: string }).title} on the MLS listing`;
  if (action === "listing_media_removed") return `took ${(changes as unknown as { title: string }).title} off the MLS listing`;
  if (action === "media_added") return `added ${(changes as unknown as { title: string }).title} to the media library`;
  if (action === "media_trashed") return `moved ${(changes as unknown as { title: string }).title} to the trash`;
  if (action === "media_restored") return `restored ${(changes as unknown as { title: string }).title}`;
  if (action.startsWith("incentive_")) {
    const c = (changes as unknown as { incentive?: { from: string | null; to: string | null } }).incentive;
    const what = c?.to ?? c?.from ?? "an incentive";
    return action === "incentive_added" ? `added an incentive: ${what}`
      : action === "incentive_ended" ? `ended an incentive: ${what}`
      : action === "incentive_expired" ? `incentive reached its end date: ${what}`
      : action === "incentive_extended" ? `extended an incentive: ${what}`
      : `changed an incentive: ${what}`;
  }
  if (action.startsWith("share_link_")) {
    const who = (changes as unknown as { for?: string }).for ?? "a realtor";
    const did = { created: "made a share link for", turned_off: "turned off the share link for", deleted: "deleted the share link for", restored: "put back the share link for" }[action.replace("share_link_", "")];
    if (did) return `${did} ${who}`;
  }
  if (action === "moved_to_trash") return "moved it to the trash";
  if (action === "restored") return "restored it from the trash";
  const keys = Object.keys(changes ?? {});
  if (keys.length === 1 && keys[0] === "list_price") {
    return `changed the price from ${money(changes.list_price.from as number)} to ${money(changes.list_price.to as number)}`;
  }
  return `edited the ${keys.map((k) => FIELD_NAMES[k] ?? k.replace(/_/g, " ")).join(", ")}`;
}

const SAVED_MESSAGES: Record<string, string> = {
  status: "Status updated.",
  created: "Home added as a draft. Finish any details below, then submit it for review.",
  request: "Request sent. The builder’s managers and marketing team will see it on this home.",
  resolved: "Request updated.",
  "open-house": "Open house scheduled.",
  "open-house-cancelled": "Open house cancelled.",
  "open-house-series": "Repeating open house set. Dates show above as the MLS window allows, and our team has a task to enter them.",
  "open-house-series-stopped": "Stopped repeating. Future dates are cancelled and our team will remove them from the MLS.",
  "market-active": "Listing is active again. Our team will update the MLS.",
  "stage": "Construction status saved.",
  "stage-ready": "Marked completed. We’ll get real photos: a photo request was added (unless one was already open).",
  "status-saved": "Sale status saved.",
  "market-paused": "Listing paused. Our team will update the MLS, and its open houses have stopped.",
  "market-under_contract": "Marked under contract. Our team will update the MLS, and its open houses have stopped.",
  "market-sold": "Marked sold. Our team will update the MLS.",
  "market-withdrawn": "Taken off the market. Our team will update the MLS, and its open houses have stopped.",
  "mls-board": "MLS updated. The required fields now follow that MLS.",
  "disclaimer-on": "Disclaimer on. Every photo for this home now says it’s representative.",
  "disclaimer-off": "Disclaimer off.",
  "reverse-requested": "Requested. Our team has a task and an email, and will send the list when it’s ready.",
  "reverse-in_progress": "Marked in progress.",
  "reverse-delivered": "Sent. They have a notice in Builder Listings and an email, with your note and the files.",
  "reverse-cancelled": "Request cancelled.",
};

const REQUEST_LABELS: Record<string, string> = { open: "Open", done: "Done", declined: "Declined" };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const REVERSE_LABELS: Record<string, string> = {
  requested: "Requested. On our team’s task list",
  in_progress: "Our team is pulling the list",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const MARKET_ACTIONS: Record<MarketStatus, string> = {
  active: "Available again",
  paused: "Pause",
  under_contract: "Under contract",
  sold: "Closed (sold)",
  withdrawn: "Off the market",
};
const SALE_LABELS: Record<MarketStatus, string> = {
  active: "Available",
  paused: "Paused",
  under_contract: "Under contract",
  sold: "Closed (sold)",
  withdrawn: "Off the market",
};
const STAGE_SHORT: Record<string, string> = {
  to_be_built: "To be built",
  under_construction: "Under construction",
  move_in_ready: "Completed",
};
const MARKET_HINTS: Record<MarketStatus, string> = {
  active: "Active on the MLS and showing to buyers.",
  paused: "Paused: temporarily off the MLS. Make it active again any time.",
  under_contract: "Under contract. Open houses have stopped.",
  sold: "Sold and closed.",
  withdrawn: "Taken off the market without selling.",
};
void MARKET_LABELS;
const REQUEST_STYLES: Record<string, string> = {
  open: "bg-amber-100 text-amber-900",
  done: "bg-emerald-100 text-emerald-800",
  declined: "bg-soft text-muted",
};

function QuickLinks({ homeId, openRequests, upcomingOH, openShoots, openReverse, canRequestPhotos }: { homeId: string; openRequests: number; upcomingOH: number; openShoots: number; openReverse: number; canRequestPhotos: boolean }) {
  const items = [
    { href: "#requests", title: "Request changes", sub: openRequests ? `${openRequests} open` : "Ask the builder team" },
    { href: "#open-houses", title: "Open houses", sub: upcomingOH ? `${upcomingOH} scheduled` : "Schedule one" },
    { href: "#reverse-prospecting", title: "Reverse prospecting", sub: openReverse ? "In progress" : "Request a list" },
    ...(canRequestPhotos ? [{ href: "#photo-requests", title: "Request photos", sub: openShoots ? `${openShoots} in progress` : "Send a photographer" }] : []),
    { href: `/media?home=${homeId}`, title: canRequestPhotos ? "Media" : "Photos and video", sub: canRequestPhotos ? "Home, community, plan" : "View and download" },
  ];
  return (
    <nav className="grid grid-cols-2 gap-3 border-b border-line py-6 sm:grid-cols-3 xl:grid-cols-5" aria-label="On this home">
      {items.map((i) => (
        <Link key={i.title} href={i.href} className="rounded-2xl border border-line p-4 transition-shadow hover:shadow-md">
          <div className="font-semibold">{i.title}</div>
          <div className="mt-0.5 text-sm text-muted">{i.sub}</div>
        </Link>
      ))}
    </nav>
  );
}

const NEED_TEXT: Record<string, string> = {
  photos: "photos", twilight: "twilight photos", video: "a horizontal walkthrough video", vertical_video: "a vertical social reel", drone: "drone shots", floor_plan: "a floor plan", virtual_tour: "a 3D tour",
};
