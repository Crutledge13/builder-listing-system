import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canEditPlans, canManageMedia, isStaff } from "@/lib/permissions";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";
import { MediaGrid, MediaTile, planFolderHref } from "@/components/media-tile";
import { PlanPhotoUpload } from "../plan-photo-upload";
import { ELEVATION_TAG, type PlanMediaKind } from "@/lib/plan-media";
import { AiCreditMeter } from "@/components/ai-credit-meter";
import { dateTime } from "@/lib/format";
import { levelLabel, roomSize, type Room } from "@/lib/rooms";
import type { PlanScan } from "@/lib/plan-scan";
import { planScanAvailable } from "@/lib/plan-scan";
import { Notice } from "@/components/notice";
import { BackButton } from "@/components/back-button";
import { ImageUpload } from "@/components/image-upload";
import { RoomsEditor } from "@/components/rooms-editor";
import { dismissScan, rescanPlan, savePlan, savePlanFile, useScan } from "../actions";

// Reading a plan with AI can take a little while.
export const maxDuration = 120;

export default function PlanPage(props: PageProps<"/plans/[id]">) {
  return (
    <div className="mx-auto max-w-4xl">
      <BackButton href="/plans" label="All floor plans" />
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-soft" />}>
        <div className="mt-4"><Notice searchParams={props.searchParams} /></div>
        <Plan params={props.params} />
      </Suspense>
    </div>
  );
}

const LEVELS = ["One", "One and One Half", "Two", "Three Or More", "Multi/Split"];

async function Plan({ params }: { params: PageProps<"/plans/[id]">["params"] }) {
  const { id } = await params;
  const me = await requireProfile();
  if (me.role === "photographer") redirect("/jobs");
  const staff = isStaff(me.role);
  const supabase = await createClient();
  const { data: p } = await supabase.from("floor_plans").select("*, builders(name)").eq("id", id).maybeSingle();
  if (!p) notFound();
  // Our team, or the builder's owners, managers and marketing (the database checks it is their builder).
  const canEdit = canEditPlans(me.role) && (staff || me.builder_id === p.builder_id);
  const rooms = (p.rooms ?? []) as Room[];
  const scan = p.scan as PlanScan | null;
  const builder = (p.builders as { name: string } | null)?.name.replace(" (demo)", "") ?? "";

  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">{builder}</p>
      <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">{p.name} plan</h1>

      <section id="scan" className="mt-6 scroll-mt-28 rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Plan with room sizes</h2>
        <p className="mt-1 text-sm text-muted">
          One file: the plan drawing with room dimensions on it{planScanAvailable() ? ", which AI reads the room sizes from" : ""}. If the plan has a sheet per floor, put them in one PDF.
          This isn&rsquo;t the brochure, and it doesn&rsquo;t go on the MLS; drawings for the listing go under &ldquo;Floor plan drawings&rdquo; below.
        </p>
        {p.plan_file_path ? (
          <p className="mt-1 text-sm"><a href={`/api/plan-file/${p.id}`} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">{p.plan_file_name ?? "Open the plan"}</a></p>
        ) : (
          <p className="mt-1 text-sm text-muted">{canEdit ? (planScanAvailable() ? "Upload the plan (PDF or image) with room dimensions on it. AI reads the room sizes off it for you to check." : "Upload the plan (PDF or image) so everyone can open it, then enter the room sizes below.") : "No plan file uploaded yet."}</p>
        )}
        {canEdit && planScanAvailable() && <div className="mt-3"><AiCreditMeter builderId={p.builder_id} staff={staff} compact /></div>}
        {canEdit && (
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <ImageUpload
              bucket="plan-files"
              folder={p.builder_id}
              accept="application/pdf,image/png,image/jpeg,image/webp"
              typesLabel="a PDF, PNG, JPG or WebP"
              maxMb={25}
              label="plan with room sizes"
              busyLabel={planScanAvailable() ? "Uploading and reading… (up to a minute)" : "Uploading…"}
              hasImage={!!p.plan_file_path}
              save={savePlanFile.bind(null, p.id)}
            />
            {p.plan_file_path && !scan && planScanAvailable() && (
              <form action={rescanPlan}>
                <input type="hidden" name="id" value={p.id} />
                <button className="rounded-xl px-3 py-2 text-sm font-semibold text-accent underline">Read the room sizes again (25 credits)</button>
              </form>
            )}
          </div>
        )}

        {canEdit && scan && (
          <div className="mt-4 rounded-2xl border border-accent bg-accent-soft/40 p-4">
            <p className="font-semibold">Here’s what we read off the plan{p.scanned_at ? ` (${dateTime(p.scanned_at)})` : ""}</p>
            <p className="mt-1 text-sm text-muted">
              {[scan.bedrooms_total != null && `${scan.bedrooms_total} bd`, scan.bathrooms_full != null && `${scan.bathrooms_full} full ba`, scan.bathrooms_half ? `${scan.bathrooms_half} half ba` : null, scan.living_area && `${scan.living_area} sq ft`, scan.stories && `${scan.stories} story`].filter(Boolean).join(" · ")}
            </p>
            <RoomTable rooms={scan.rooms} />
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={useScan}><input type="hidden" name="id" value={p.id} /><button className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:brightness-110">Use these rooms</button></form>
              <form action={dismissScan}><input type="hidden" name="id" value={p.id} /><button className="rounded-xl px-4 py-2.5 text-sm font-semibold underline">Dismiss</button></form>
            </div>
            <p className="mt-2 text-xs text-muted">Read by AI, so check a few sizes against the plan. Using them replaces the room list below; specs only fill blanks.</p>
          </div>
        )}
      </section>

      <PlanPhotos planId={p.id} name={p.name} builderId={p.builder_id} canUpload={canManageMedia(me.role) && (staff || me.builder_id === p.builder_id)} />

      {canEdit ? (
        <form action={savePlan} className="mt-6 space-y-6">
          <input type="hidden" name="id" value={p.id} />
          <section className="rounded-2xl border border-line p-5">
            <h2 className="font-semibold">Specs</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-3"><span className="mb-1 block text-sm font-medium">Plan name</span><input name="name" required maxLength={80} defaultValue={p.name} className="field-input" /></label>
              <N name="bedrooms_total" label="Bedrooms" v={p.bedrooms_total} />
              <N name="bathrooms_full" label="Full baths" v={p.bathrooms_full} />
              <N name="bathrooms_half" label="Half baths" v={p.bathrooms_half} />
              <div className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-medium">Living area (sq ft)</span>
                <div className="flex items-center gap-2">
                  <input name="living_area" inputMode="numeric" defaultValue={p.living_area ?? ""} placeholder="From, e.g. 3228" aria-label="Living area from" className="field-input" />
                  <span className="text-sm text-muted">to</span>
                  <input name="living_area_max" inputMode="numeric" defaultValue={p.living_area_max ?? ""} placeholder="Optional, e.g. 3410" aria-label="Living area up to" className="field-input" />
                </div>
                <span className="mt-1 block text-xs leading-snug text-muted">Heated square feet. Give a range if it changes with the elevation. Each home still gets its own exact number (the MLS takes one), starting from the first.</span>
              </div>
              <label className="block"><span className="mb-1 block text-sm font-medium">Stories</span>
                <select name="levels" defaultValue={p.levels ?? (p.stories === 1 ? "One" : p.stories === 2 ? "Two" : p.stories && p.stories >= 3 ? "Three Or More" : "")} className="field-input"><option value="">Choose</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
                <span className="mt-1 block text-xs leading-snug text-muted">NTREIS&rsquo;s choices. One and One Half: mostly one story with a small upstairs, like a single game room.</span>
              </label>
              <N name="garage_spaces" label="Garage spaces" v={p.garage_spaces} />
              <N name="living_areas_total" label="# Living areas" v={p.living_areas_total} />
              <N name="dining_areas_total" label="# Dining areas" v={p.dining_areas_total} />
              <label className="block sm:col-span-3"><span className="mb-1 block text-sm font-medium">Notes (optional)</span><input name="notes" maxLength={2000} defaultValue={p.notes ?? ""} className="field-input" /></label>
            </div>
          </section>
          <section className="rounded-2xl border border-line p-5">
            <h2 className="font-semibold">Rooms and sizes</h2>
            <p className="mt-1 text-sm text-muted">Homes built on this plan pull this list in. Sizes are in feet.</p>
            <div className="mt-4"><RoomsEditor key={p.updated_at} initial={rooms} /></div>
          </section>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p.active} className="h-4 w-4 accent-[#3452c7]" /> In use (untick to retire a plan the builder no longer offers)</label>
          <button className="rounded-xl bg-foreground px-6 py-3 font-semibold text-white hover:bg-black">Save plan</button>
        </form>
      ) : (
        <section className="mt-6 rounded-2xl border border-line p-5">
          <h2 className="font-semibold">Rooms and sizes</h2>
          {rooms.length ? <RoomTable rooms={rooms} /> : <p className="mt-2 text-sm text-muted">No room sizes yet.</p>}
          <p className="mt-3 text-sm text-muted">Something wrong? Ask your owner, manager or marketing lead to fix the plan.</p>
        </section>
      )}
    </>
  );
}

// The plan's own files, in three slots (tester notes, 28 Oct 2026): floor
// plan drawings, elevation renderings, and model home photos and video. Homes
// on this plan can add any of them to their listing, and show them, marked
// "representative", until they have five photos of their own.
async function PlanPhotos({ planId, name, builderId, canUpload }: { planId: string; name: string; builderId: string; canUpload: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("media").select(MEDIA_SELECT).eq("builder_id", builderId).eq("plan_name", name)
    .is("home_id", null).is("community_id", null).is("deleted_at", null).order("sort_order").limit(120);
  const list = (data ?? []) as unknown as MediaRow[];
  const drawings = list.filter((m) => m.kind === "floor_plan");
  const elevations = list.filter((m) => m.kind !== "floor_plan" && (m.tags ?? []).includes(ELEVATION_TAG));
  const photos = list.filter((m) => !drawings.includes(m) && !elevations.includes(m));
  const slots: { kind: PlanMediaKind; id: string; title: string; about: string; items: MediaRow[] }[] = [
    { kind: "drawings", id: "drawings", title: "Floor plan drawings", about: "The layout drawings that go on the MLS listing, one per floor.", items: drawings },
    { kind: "elevations", id: "elevations", title: "Elevation renderings", about: "Drawings or renderings of the front of the house for each elevation (A, B, C…).", items: elevations },
    { kind: "photos", id: "photos", title: "Model home photos and video", about: "Real photos of a finished home on this plan. Homes on this plan show them, marked “representative”, until they have photos of their own.", items: photos },
  ];
  return (
    <section id="plan-media" className="mt-6 scroll-mt-28 rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Drawings and photos of this plan</h2>
        {list.length > 0 && <a href={planFolderHref(builderId, name)} className="text-sm font-semibold underline">Open the {name} folder</a>}
      </div>
      <p className="mt-1 text-sm text-muted">Any home on the {name} plan can add these to its listing from its own page.</p>
      {slots.map((slot) => (
        <div key={slot.kind} id={slot.id} className="mt-6 scroll-mt-28 border-t border-line pt-5">
          <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
            {slot.title}
            <span className="font-normal text-muted">{slot.items.length ? `${slot.items.length}` : "none yet"}</span>
          </h3>
          <p className="mt-0.5 text-sm text-muted">{slot.about}</p>
          {slot.items.length > 0 && <div className="mt-3"><MediaGrid>{slot.items.map((m) => <MediaTile key={m.id} m={m} direct />)}</MediaGrid></div>}
          {canUpload && <div className="mt-3"><PlanPhotoUpload planId={planId} builderId={builderId} kind={slot.kind} /></div>}
        </div>
      ))}
    </section>
  );
}

function RoomTable({ rooms }: { rooms: Room[] }) {
  return (
    <table className="mt-3 w-full text-sm">
      <thead className="text-left text-xs text-muted"><tr><th className="pb-1 font-medium">Room</th><th className="pb-1 font-medium">Level</th><th className="pb-1 font-medium">Size (ft)</th></tr></thead>
      <tbody className="divide-y divide-line">
        {rooms.map((r, i) => <tr key={i}><td className="py-1.5">{r.RoomType}</td><td className="py-1.5">{levelLabel(r.RoomLevel)}</td><td className="py-1.5 tabular-nums">{roomSize(r)}</td></tr>)}
      </tbody>
    </table>
  );
}

function N({ name, label, v }: { name: string; label: string; v: number | null }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span><input name={name} type="number" min="0" defaultValue={v ?? ""} className="field-input" /></label>;
}
