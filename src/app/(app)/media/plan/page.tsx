import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { canManageMedia, isStaff } from "@/lib/permissions";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";
import { MediaGrid, MediaTile } from "@/components/media-tile";

// One floor plan's folder: the plan drawing, model home photos and video,
// and the photos of every home built on that plan.
export default function PlanFolderPage(props: PageProps<"/media/plan">) {
  return (
    <Suspense fallback={<div className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-[3/2] animate-pulse rounded-xl bg-soft" />)}</div>}>
      <PlanFolder searchParams={props.searchParams} />
    </Suspense>
  );
}

async function PlanFolder({ searchParams }: { searchParams: PageProps<"/media/plan">["searchParams"] }) {
  const sp = await searchParams;
  const name = typeof sp.name === "string" ? sp.name.trim() : "";
  const me = await requireProfile();
  sendPhotographersToJobs(me);
  const builderId = isStaff(me.role) ? (typeof sp.builder === "string" ? sp.builder : "") : me.builder_id ?? "";
  if (!name || !builderId) notFound();
  const supabase = await createClient();

  const [{ data: builder }, { data: library }, { data: homes }] = await Promise.all([
    supabase.from("builders").select("id, name").eq("id", builderId).maybeSingle(),
    supabase.from("media").select(MEDIA_SELECT).eq("builder_id", builderId).eq("plan_name", name).is("home_id", null).is("deleted_at", null).order("sort_order"),
    supabase.from("homes").select("id, unparsed_address, build_stage, communities(name)").eq("builder_id", builderId).eq("plan_name", name).is("deleted_at", null).order("unparsed_address"),
  ]);
  const homeIds = (homes ?? []).map((h) => h.id);
  const { data: homeMedia } = homeIds.length
    ? await supabase.from("media").select(MEDIA_SELECT).in("home_id", homeIds).is("deleted_at", null).order("is_cover", { ascending: false }).order("sort_order")
    : { data: [] };

  const lib = (library ?? []) as unknown as MediaRow[];
  const fromHomes = (homeMedia ?? []) as unknown as MediaRow[];
  const floorPlans = [...lib, ...fromHomes].filter((m) => m.kind === "floor_plan");
  const model = lib.filter((m) => m.kind !== "floor_plan");
  const specs = floorPlans.find((m) => m.caption)?.caption;
  if (!lib.length && !(homes ?? []).length) notFound();

  return (
    <div>
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted" aria-label="Folders">
        <Link href="/media" className="hover:text-foreground hover:underline">Media</Link>
        {isStaff(me.role) && builder && (
          <>
            <span aria-hidden>/</span>
            <Link href={`/media?builder=${builder.id}`} className="hover:text-foreground hover:underline">{builder.name.replace(" (demo)", "")}</Link>
          </>
        )}
        <span aria-hidden>/</span>
        <span>Floor plans</span>
      </nav>
      <div className="mt-2 flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">The {name} plan</h1>
          <p className="mt-1 text-muted">{specs ? `${specs}. ` : ""}Every photo of this plan: the floor plan, the model home, and each home built on it.</p>
        </div>
        {canManageMedia(me.role) && (
          <Link href="/media/upload" className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110">Upload</Link>
        )}
      </div>

      <div className="mt-8 space-y-12">
        <section>
          <h2 className="text-[22px] font-semibold">Floor plan</h2>
          <div className="mt-4">
            <MediaGrid>{floorPlans.map((m) => <MediaTile key={m.id} m={m} direct showPlace={!!m.home_id} />)}</MediaGrid>
            {floorPlans.length === 0 && <Empty text="No floor plan drawing yet." />}
          </div>
        </section>

        <section>
          <h2 className="text-[22px] font-semibold">Model home photos and video</h2>
          <p className="mt-1 text-sm text-muted">Representative photos to use while a home on this plan is being built.</p>
          <div className="mt-4">
            <MediaGrid>{model.map((m) => <MediaTile key={m.id} m={m} />)}</MediaGrid>
            {model.length === 0 && <Empty text="No model home photos yet." />}
          </div>
        </section>

        <section>
          <h2 className="text-[22px] font-semibold">Homes built on the {name} plan</h2>
          <div className="mt-4 space-y-8">
            {(homes ?? []).map((h) => {
              const list = fromHomes.filter((m) => m.home_id === h.id && m.kind !== "floor_plan");
              return (
                <div key={h.id}>
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">
                      {h.unparsed_address} <span className="font-normal text-muted">{(h.communities as unknown as { name: string } | null)?.name}</span>
                    </h3>
                    <Link href={`/media?home=${h.id}`} className="text-sm font-semibold underline">All {list.length} files</Link>
                  </div>
                  <MediaGrid>{list.slice(0, 10).map((m) => <MediaTile key={m.id} m={m} />)}</MediaGrid>
                  {list.length === 0 && <p className="text-sm text-muted">No photos of this home yet.</p>}
                </div>
              );
            })}
            {(homes ?? []).length === 0 && <Empty text="No homes on this plan that you can see." />}
          </div>
        </section>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">{text}</p>;
}
