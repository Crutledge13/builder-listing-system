import { Suspense } from "react";
import { SetupNav } from "@/components/setup-nav";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { WEBSITE_PAGE_HELP } from "@/lib/website-page";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { canAddHomes, canRequestMedia, isStaff, NEED_LABELS, ROLE_LABELS, STAGE_LABELS } from "@/lib/permissions";
import { createHome } from "./actions";
import { questionSections, SectionFields } from "@/components/ntreis-questions";
import { FormSteps } from "@/components/form-steps";
import { NtreisToggle } from "@/components/ntreis-toggle";
import { RequiredPill } from "@/components/required-pill";
import { RoomsEditor } from "@/components/rooms-editor";
import { cleanRooms } from "@/lib/rooms";
import { StartFrom, type CopyOption, type PlanOption, type Prefill, type WebsiteOption } from "@/components/start-from";

export default function NewHomePage(props: PageProps<"/homes/new">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <NewHomeForm searchParams={props.searchParams} />
      <div className="mx-auto max-w-3xl"><SetupNav steps={["first_home"]} path="/homes/new" /></div>
    </Suspense>
  );
}

type Input = { name: string; label: string; type?: string; step?: string; placeholder?: string; required?: boolean; wide?: boolean; help?: string };

async function NewHomeForm({ searchParams }: { searchParams: PageProps<"/homes/new">["searchParams"] }) {
  const { error, community: preset } = await searchParams;
  const me = await requireProfile();
  sendPhotographersToJobs(me);

  if (!canAddHomes(me.role)) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-[28px] font-bold tracking-tight">Adding homes isn’t part of your role</h1>
        <p className="mt-3 text-muted">
          As {ROLE_LABELS[me.role].toLowerCase()}, you can work on homes once they’re added. Ask your
          sales team, a manager or the owner to add new ones.
        </p>
        <Link href="/homes" className="mt-6 inline-block rounded-xl border border-foreground px-5 py-2.5 font-semibold">Back to homes</Link>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: communities }, { data: boards }, { data: settings }] = await Promise.all([
    supabase.from("communities").select("id, name, city, builder_id, mls_board, builders(name)").order("name"),
    supabase.from("mls_boards").select("code, short_name, region").eq("active", true).order("code"),
    supabase.from("builder_settings").select("builder_id, mls_boards, mls_locked, website_feed_enabled"),
  ]);
  const staff = isStaff(me.role);
  const canPickMls = ["platform_admin", "listing_coordinator", "builder_owner", "manager", "marketing"].includes(me.role);
  const boardName = new Map((boards ?? []).map((b) => [b.code, b.short_name]));
  const mine = (settings ?? []).find((x) => x.builder_id === me.builder_id);
  const lockedBoard = !staff && mine?.mls_locked && mine.mls_boards?.length === 1 ? mine.mls_boards[0] : null;
  const communityBoards = Object.fromEntries((communities ?? []).map((c) => [c.id, c.mls_board ?? null]));
  const communityBuilders = Object.fromEntries((communities ?? []).map((c) => [c.id, c.builder_id as string]));
  const starters = await loadStarters(supabase, communities ?? []);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/homes" className="text-sm font-medium text-muted hover:text-foreground">Cancel</Link>
      <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight">Add a home</h1>
      <p className="mt-1 text-muted">
        Step by step, in the same order as NTREIS. It’s saved as a draft, so fill in what you know now and finish the rest later.
      </p>

      {typeof error === "string" && <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <form id="new-home" action={createHome} className="mt-8">
        <FormSteps formId="new-home" steps={[{ title: "The home" }, ...questionSections("new").map((q) => ({ title: q.title, ntreisOnly: q.ntreisOnly })), { title: "Photos and tours" }]}>
          <div className="divide-y divide-line">
        <section className="pb-8 pt-4">
          <h3 className="text-lg font-semibold">Where is it?</h3>
          <div className="mt-4 grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <label data-required="Community" className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Community<RequiredPill kind="save" /></span>
              <select name="community_id" required defaultValue={typeof preset === "string" ? preset : ""} className="field-input">
                <option value="" disabled>Choose a community</option>
                {communities?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}, {c.city}
                    {staff ? ` (${(c.builders as unknown as { name: string })?.name.replace(" (demo)", "")})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-5">
            <StartFrom formId="new-home" communityBuilders={communityBuilders} plans={starters.plans} homes={starters.homes} website={starters.website} />
          </div>
          <div className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <Text name="unparsed_address" label="Street address" placeholder="1214 Pecan Ridge Dr" required wide help="Number, street and type, e.g. 1214 Pecan Ridge Dr. We split it into Matrix’s separate street boxes." />
            <Text name="city" label="City" placeholder="Leave blank to use the community’s city" />
            <Text name="postal_code" label="ZIP" required />
            <Text name="lot_number" label="Your lot reference" placeholder="B3-L12" help="However your team refers to the lot. The plat's lot and block numbers for the MLS are asked further down." />
            <Text name="plan_name" label="Floor plan" placeholder="Brazos" />
          </div>
        </section>

        <section className="py-8">
          <h3 className="text-lg font-semibold">Which MLS?</h3>
          <p className="mt-1 text-sm text-muted">Each MLS asks for slightly different fields, so this decides what the home needs before it can go live.</p>
          {lockedBoard ? (
            <div className="mt-4 rounded-xl bg-soft px-4 py-3 text-sm">
              <b>{boardName.get(lockedBoard) ?? lockedBoard}</b>: every home for your company goes to this MLS.
              {canPickMls && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold underline">Override for this home</summary>
                  <select name="mls_board" defaultValue="" className="field-input mt-2">
                    <option value="">Keep {boardName.get(lockedBoard) ?? lockedBoard}</option>
                    {(boards ?? []).filter((b) => b.code !== lockedBoard).map((b) => <option key={b.code} value={b.code}>{b.short_name} ({b.region})</option>)}
                  </select>
                </details>
              )}
            </div>
          ) : canPickMls ? (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-medium">MLS</span>
              <select name="mls_board" defaultValue="" className="field-input">
                <option value="">Suggested: the community’s MLS (by county)</option>
                {(boards ?? []).map((b) => <option key={b.code} value={b.code}>{b.short_name} ({b.region})</option>)}
              </select>
            </label>
          ) : (
            <p className="mt-4 rounded-xl bg-soft px-4 py-3 text-sm">The MLS is picked from the community. A manager or owner can change it on the home.</p>
          )}
          {!lockedBoard && (
            <ul className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2">
              {(communities ?? []).map((c) => (
                <li key={c.id}>{c.name}: {c.mls_board ? boardName.get(c.mls_board) ?? c.mls_board : "not set"}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="py-8">
          <h3 className="text-lg font-semibold">Build stage</h3>
          <label className="mt-4 block max-w-sm">
            <select name="build_stage" defaultValue="under_construction" className="field-input">
              {Object.entries(STAGE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <span className="mt-1 block text-xs leading-snug text-muted">
              Sets NTREIS&rsquo;s construction status for you: To be built is Proposed, Under construction is New Construction - Incomplete, Move-in ready is New Construction - Complete.
            </span>
          </label>
        </section>

            <div className="pt-6">
              <NtreisToggle formId="new-home" communityBoards={communityBoards} lockedBoard={lockedBoard} />
            </div>
          </div>
          {questionSections("new").map((q) => (
            <SectionFields
              key={q.title}
              title={q.title}
              mode="new"
              extra={
                q.title === "Rooms" ? (
                  <>
                    <div data-other-mls="" hidden>
                      <Text name="stories" label="Stories" type="number" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <span className="block text-sm font-medium">Room sizes</span>
                      <p className="mb-2 mt-0.5 text-xs text-muted">Each room&rsquo;s level and size in feet. Starting from a floor plan above fills these in; you can also add them later on the home.</p>
                      <RoomsEditor formId="new-home" initial={[]} />
                    </div>
                  </>
                ) : undefined
              }
            />
          ))}
          {/* Builders who haven't connected their website can paste this home's page on it (our staff work for every builder, so they always see it). */}
          <PhotosStep canRequest={canRequestMedia(me.role)} askWebsitePage={staff || !mine?.website_feed_enabled} />
        </FormSteps>
      </form>
    </div>
  );
}

function Text({ name, label, type = "text", step, placeholder, required, wide, help }: Input) {
  return (
    <label data-required={required ? label : undefined} className={wide ? "block sm:col-span-2" : "block"}>
      <span className="block text-sm font-medium">
        {label}
        {required && <RequiredPill kind="save" />}
      </span>
      {help && <span className="mt-0.5 block text-xs leading-snug text-muted">{help}</span>}
      <input name={name} type={type} step={step} placeholder={placeholder} required={required} className="field-input mt-1.5" />
    </label>
  );
}

// Last step: where the listing's photos, video and tours come from. Photos
// themselves are added after saving (a file needs a home to belong to).
function PhotosStep({ canRequest, askWebsitePage }: { canRequest: boolean; askWebsitePage: boolean }) {
  return (
    <div className="mt-4 space-y-8">
      {askWebsitePage && (
        <label className="block">
          <span className="block text-sm font-medium">This home&rsquo;s page on your website</span>
          <span className="mt-0.5 block text-xs leading-snug text-muted">{WEBSITE_PAGE_HELP}</span>
          <input name="website_page_url" type="url" inputMode="url" maxLength={500} placeholder="https://www.yourbuilder.com/homes/123-main-st" className="field-input mt-1.5" />
        </label>
      )}
      <fieldset>
        <legend className="text-sm font-medium">Who&rsquo;s providing the photos?</legend>
        <span className="mt-0.5 block text-xs leading-snug text-muted">
          Whatever is delivered or uploaded for this home goes straight onto its MLS listing, in order. You can rearrange or remove anything later on the home&rsquo;s page.
        </span>
        <div className="mt-3 space-y-2">
          {canRequest && (
            <div className="rounded-xl border border-line p-3 has-[input[value=ours]:checked]:border-accent">
              <label className="flex items-start gap-3">
                <input type="radio" name="photos_by" value="ours" className="mt-1 accent-[#3452c7]" />
                <span>
                  <span className="font-semibold">Our photographer</span>
                  <span className="block text-sm text-muted">We send a photographer. Their photos, video and tour links land on this listing automatically.</span>
                </span>
              </label>
              <div className="ml-7 mt-2">
                <span className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {Object.entries(NEED_LABELS).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="needs" value={k} defaultChecked={k === "photos"} className="h-4 w-4 accent-[#3452c7]" /> {label}
                    </label>
                  ))}
                </span>
                <input name="shoot_notes" placeholder="Anything the photographer should know? (optional)" className="field-input mt-2" />
              </div>
            </div>
          )}
          <label className="flex items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-accent">
            <input type="radio" name="photos_by" value="own" className="mt-1 accent-[#3452c7]" />
            <span>
              <span className="font-semibold">Our own photos or video</span>
              <span className="block text-sm text-muted">After you save, you go straight to the upload page for this home.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-accent">
            <input type="radio" name="photos_by" value="later" defaultChecked className="mt-1 accent-[#3452c7]" />
            <span>
              <span className="font-semibold">Decide later</span>
              <span className="block text-sm text-muted">Add photos any time from the home&rsquo;s page.</span>
            </span>
          </label>
        </div>
      </fieldset>

      <label className="flex items-start gap-3">
        <input type="checkbox" name="include_community" value="1" className="mt-1 h-4 w-4 accent-[#3452c7]" />
        <span>
          <span className="text-sm font-medium">Add the community&rsquo;s photos and video to this listing</span>
          <span className="mt-0.5 block text-xs leading-snug text-muted">
            Amenity, entrance and aerial shots already saved for the community. Optional: they go after this home&rsquo;s own photos, and you can remove any of them later.
          </span>
        </span>
      </label>

      <fieldset>
        <legend className="text-sm font-medium">3D or video tour links (optional)</legend>
        <span className="mt-0.5 block text-xs leading-snug text-muted">
          Matterport, Zillow 3D Home, iGUIDE, Cupix, YouTube or Vimeo share links. Unbranded means no builder or agent names, logos or contact info in the tour; MLSs generally want the unbranded link.
        </span>
        {[0, 1].map((i) => (
          <div key={i} className="mt-2 grid gap-2 sm:grid-cols-[1fr_160px]">
            <input name="tour_url" type="url" placeholder="https://my.matterport.com/show/?m=..." className="field-input" />
            <select name="tour_branded" defaultValue="no" className="field-input">
              <option value="no">Unbranded</option>
              <option value="yes">Branded</option>
            </select>
          </div>
        ))}
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Start from something": floor plans, homes to copy, and website homes.
// ---------------------------------------------------------------------------
const SPEC_COLUMNS = ["plan_name", "bedrooms_total", "bathrooms_full", "bathrooms_half", "living_area", "stories", "garage_spaces", "lot_size_acres", "year_built"];
// NTREIS answers that come with a floor plan (the layout, not the lot).
const PLAN_ANSWERS = ["Levels", "LivingAreasTotal", "DiningAreasTotal", "FireplacesTotal", "AttachedGarageYN", "StructureType", "ArchitecturalStyle", "ConstructionMaterials", "FoundationDetails", "Roof"];
// NTREIS answers that belong to one lot, so they're never copied to another home.
const NOT_COPIED = new Set(["ParcelNumber", "AdditionalParcelsYN", "AdditionalParcelsDescription", "Lot", "TaxBlock", "LegalDescription", "LotSizeDimensions", "LockBoxSerialNumber", "LockBoxLocation", "Rooms"]);

function asPrefill(row: Record<string, unknown>, columns: string[], answers: Record<string, unknown> | null, answerKeys: string[] | "all"): Prefill {
  const out: Prefill = {};
  for (const c of columns) {
    const v = row[c];
    if (v !== null && v !== undefined && v !== "") out[c] = String(v);
  }
  for (const [k, v] of Object.entries(answers ?? {})) {
    if (answerKeys !== "all" && !answerKeys.includes(k)) continue;
    if (answerKeys === "all" && NOT_COPIED.has(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    out[`mls__${k}`] = Array.isArray(v) ? v.map(String) : String(v);
  }
  return out;
}

type FloorPlanRow = {
  builder_id: string; name: string; bedrooms_total: number | null; bathrooms_full: number | null; bathrooms_half: number | null;
  living_area: number | null; stories: number | null; garage_spaces: number | null; levels: string | null;
  living_areas_total: number | null; dining_areas_total: number | null; rooms: unknown;
};

type HomeRow = Record<string, unknown> & {
  id: string; builder_id: string; unparsed_address: string; plan_name: string | null; workflow_status: string;
  mls_fields: Record<string, unknown> | null; communities: { name: string } | null;
};

async function loadStarters(supabase: Awaited<ReturnType<typeof createClient>>, communities: { id: string; name: string; builder_id: string }[]) {
  const [{ data: homeRows }, { data: webRows }, { data: planRows }] = await Promise.all([
    supabase
      .from("homes")
      .select("id, builder_id, unparsed_address, plan_name, list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, lot_size_acres, stories, garage_spaces, year_built, public_remarks, workflow_status, mls_fields, updated_at, communities(name)")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase
      .from("website_listings")
      .select("id, builder_id, unparsed_address, city, postal_code, community_name, plan_name, list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, public_remarks, status_text")
      .is("home_id", null)
      .is("dismissed_at", null)
      .order("unparsed_address"),
    supabase
      .from("floor_plans")
      .select("builder_id, name, bedrooms_total, bathrooms_full, bathrooms_half, living_area, stories, garage_spaces, levels, living_areas_total, dining_areas_total, rooms")
      .eq("active", true)
      .order("name"),
  ]);
  const rows = (homeRows ?? []) as unknown as HomeRow[];

  const homes: CopyOption[] = rows
    .map((h) => ({
      id: h.id,
      builder_id: h.builder_id,
      label: `${h.unparsed_address}${h.plan_name ? `, ${h.plan_name}` : ""}${h.communities ? ` (${h.communities.name})` : ""}`,
      live: h.workflow_status === "live_on_mls",
      values: asPrefill(h, [...SPEC_COLUMNS, "list_price", "public_remarks"], h.mls_fields, "all"),
      rooms: cleanRooms(h.mls_fields?.Rooms),
    }))
    .sort((a, b) => Number(b.live) - Number(a.live));

  // Floor plans our team set up come first (specs and room sizes); otherwise a
  // plan's specs come from the most recently updated home built on it.
  const plans: PlanOption[] = [];
  const seen = new Set<string>();
  const latest = new Map<string, HomeRow>();
  for (const h of rows) {
    if (!h.plan_name) continue;
    const key = `${h.builder_id}:${h.plan_name.toLowerCase()}`;
    if (!latest.has(key)) latest.set(key, h);
  }
  for (const fp of (planRows ?? []) as FloorPlanRow[]) {
    const key = `${fp.builder_id}:${fp.name.toLowerCase()}`;
    seen.add(key);
    const h = latest.get(key);
    const base = h ? asPrefill(h, SPEC_COLUMNS.filter((c) => c !== "lot_size_acres"), h.mls_fields, PLAN_ANSWERS) : {};
    const own: Prefill = { plan_name: fp.name };
    for (const c of ["bedrooms_total", "bathrooms_full", "bathrooms_half", "living_area", "stories", "garage_spaces"] as const) if (fp[c] != null) own[c] = String(fp[c]);
    if (fp.levels) own.mls__Levels = fp.levels;
    if (fp.living_areas_total != null) own.mls__LivingAreasTotal = String(fp.living_areas_total);
    if (fp.dining_areas_total != null) own.mls__DiningAreasTotal = String(fp.dining_areas_total);
    const rooms = cleanRooms(fp.rooms);
    plans.push({ builder_id: fp.builder_id, plan: fp.name, from: "the plan our team set up", values: { ...base, ...own }, rooms: rooms.length ? rooms : cleanRooms(h?.mls_fields?.Rooms) });
  }
  for (const [key, h] of latest) {
    if (seen.has(key)) continue;
    plans.push({ builder_id: h.builder_id, plan: h.plan_name!, from: h.unparsed_address, values: asPrefill(h, SPEC_COLUMNS.filter((c) => c !== "lot_size_acres"), h.mls_fields, PLAN_ANSWERS), rooms: cleanRooms(h.mls_fields?.Rooms) });
  }
  plans.sort((a, b) => a.plan.localeCompare(b.plan));

  const website: WebsiteOption[] = (webRows ?? []).map((w) => {
    const c = communities.find((x) => x.builder_id === w.builder_id && x.name.toLowerCase() === (w.community_name ?? "").toLowerCase());
    const stage = /move/i.test(w.status_text ?? "") ? "move_in_ready" : /be built|coming/i.test(w.status_text ?? "") ? "to_be_built" : "under_construction";
    return {
      id: w.id,
      builder_id: w.builder_id,
      community_id: c?.id ?? null,
      label: `${w.unparsed_address}${w.plan_name ? `, ${w.plan_name}` : ""}${w.community_name ? ` (${w.community_name})` : ""}`,
      values: { ...asPrefill(w, ["unparsed_address", "city", "postal_code", "plan_name", "list_price", "bedrooms_total", "bathrooms_full", "bathrooms_half", "living_area", "public_remarks"], null, []), build_stage: stage },
    };
  });

  return { plans, homes, website };
}
