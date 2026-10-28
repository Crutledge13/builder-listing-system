import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canManageMedia, isStaff, ROLE_LABELS } from "@/lib/permissions";
import { MEDIA_REQUEST_SELECT, type MediaRequest } from "@/components/media-requests";
import { addJobTour } from "./tour-action";
import { UploadForm } from "./upload-form";
import { BackButton } from "@/components/back-button";
import { loadTagList } from "@/lib/tags";
import { AiCreditMeter } from "@/components/ai-credit-meter";
import { aiTaggingAvailable } from "@/lib/ai-tagging";

export default function UploadPage(props: PageProps<"/media/upload">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Upload searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Upload({ searchParams }: { searchParams: PageProps<"/media/upload">["searchParams"] }) {
  const sp = await searchParams;
  const me = await requireProfile();
  if (!canManageMedia(me.role) && me.role !== "photographer") {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-[28px] font-bold tracking-tight">Uploading isn’t part of your role</h1>
        <p className="mt-3 text-muted">As {ROLE_LABELS[me.role].toLowerCase()}, you can view and download media. Marketing, managers and owners upload it.</p>
        <Link href="/media" className="mt-6 inline-block rounded-xl border border-foreground px-5 py-2.5 font-semibold">Back to media</Link>
      </div>
    );
  }

  const supabase = await createClient();
  const tagList = await loadTagList(supabase);

  // Photographers upload only to their open jobs; build the choices from those.
  if (me.role === "photographer") {
    const { data: jobRows } = await supabase
      .from("media_requests")
      .select(MEDIA_REQUEST_SELECT + ", builder_id")
      .eq("photographer_id", me.id)
      .in("status", ["assigned", "scheduled", "delivered"]);
    const jobs = (jobRows ?? []) as unknown as (MediaRequest & { builder_id: string })[];
    const job = jobs.find((j) => j.id === sp.request) ?? null;
    const comms = new Map(jobs.map((j) => [j.community_id, { id: j.community_id, name: j.community_name, builder_id: j.builder_id, builderName: j.builder_name.replace(" (demo)", "") }]));
    const formProps = {
      tagList,
      communities: [...comms.values()],
      homes: jobs.filter((j) => j.home_id).map((j) => ({ id: j.home_id!, community_id: j.community_id, unparsed_address: j.address })),
      communityWide: jobs.filter((j) => !j.home_id).map((j) => j.community_id),
      presetCommunity: job?.community_id ?? null,
      presetHome: job?.home_id ?? null,
      showBuilder: true,
      doneHref: "/jobs",
      cancelHref: "/jobs",
    };
    const wantsVideo = !!job?.needs.some((n) => n === "video" || n === "vertical_video" || n === "virtual_tour");
    return (
      <div className="mx-auto max-w-3xl">
        <BackButton href="/jobs" label="Back to your jobs" />
        <h1 className="mt-4 text-[28px] font-bold leading-tight tracking-tight">Upload for {job?.address ?? "a job"}</h1>
        <p className="mt-1 text-muted">
          {job ? `${job.builder_name.replace(" (demo)", "")}, ${job.community_name}. ` : ""}
          Photos and video upload separately so each batch stays tidy. You can fix tags on any file after.
        </p>
        {jobs.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">You have no open jobs to upload to.</p>
        ) : (
          <div className="mt-8 space-y-8">
            <section className="rounded-2xl border border-line p-5">
              <h2 className="text-lg font-semibold">Photos</h2>
              <p className="mb-4 text-sm text-muted">Pick the room for each batch so the builder can find them, or let AI pick it for each photo. Floor plan PDFs go here too.</p>
              <UploadForm {...formProps} mode="photos" />
            </section>
            <section className="rounded-2xl border border-line p-5">
              <h2 className="text-lg font-semibold">Video{wantsVideo ? "" : " (if this job has any)"}</h2>
              <p className="mb-4 text-sm text-muted">Walkthroughs, drone clips and tours.</p>
              <UploadForm {...formProps} mode="videos" />
            </section>
            {job && (
              <section id="tour" className="scroll-mt-28 rounded-2xl border border-line p-5">
                <h2 className="text-lg font-semibold">3D or video tour link{job.needs.includes("virtual_tour") ? "" : " (if this job has one)"}</h2>
                <p className="mb-4 text-sm text-muted">
                  Paste the share link from Matterport, Zillow 3D Home, iGUIDE, Cupix, YouTube or Vimeo. It goes straight onto the listing. MLSs generally want the unbranded version (no names, logos or contact info).
                </p>
                {sp.tour_saved && <p className="mb-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">Tour link saved.</p>}
                {typeof sp.tour_error === "string" && <p className="mb-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800">{sp.tour_error}</p>}
                <form action={addJobTour} className="grid gap-3 sm:grid-cols-[1fr_150px_auto]">
                  <input type="hidden" name="request" value={job.id} />
                  <input name="url" type="url" required placeholder="https://my.matterport.com/show/?m=..." className="field-input" />
                  <select name="branded" defaultValue="no" className="field-input">
                    <option value="no">Unbranded</option>
                    <option value="yes">Branded</option>
                  </select>
                  <button className="rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Save link</button>
                </form>
              </section>
            )}
          </div>
        )}
      </div>
    );
  }

  const [{ data: communities }, { data: homes }] = await Promise.all([
    supabase.from("communities").select("id, name, builder_id, builders(name)").order("name"),
    supabase.from("homes").select("id, community_id, unparsed_address").is("deleted_at", null).order("unparsed_address"),
  ]);
  const presetHome = typeof sp.home === "string" ? sp.home : null;
  const presetCommunity = presetHome
    ? (homes ?? []).find((h) => h.id === presetHome)?.community_id ?? null
    : typeof sp.community === "string" ? sp.community : null;

  return (
    <div className="mx-auto max-w-3xl">
      <BackButton href={presetHome ? `/media?home=${presetHome}` : presetCommunity ? `/media?community=${presetCommunity}` : "/media"} label="Back to media" />
      <h1 className="mt-4 text-[28px] font-bold leading-tight tracking-tight">Upload photos and videos</h1>
      <p className="mt-1 text-muted">
        Files go straight into private storage. Pick where they belong and the address, plan and community tags are added for you.
      </p>
      {aiTaggingAvailable() && !isStaff(me.role) && <div className="mt-4"><AiCreditMeter builderId={me.builder_id} compact /></div>}
      <div className="mt-8">
        <UploadForm
          tagList={tagList}
          communities={(communities ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            builder_id: c.builder_id,
            builderName: (c.builders as unknown as { name: string })?.name.replace(" (demo)", "") ?? "",
          }))}
          homes={homes ?? []}
          presetCommunity={presetCommunity}
          presetHome={presetHome}
          showBuilder={isStaff(me.role)}
          cancelHref={presetHome ? `/media?home=${presetHome}` : presetCommunity ? `/media?community=${presetCommunity}` : "/media"}
        />
      </div>
    </div>
  );
}
