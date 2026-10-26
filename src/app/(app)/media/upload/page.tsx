import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canManageMedia, isStaff, ROLE_LABELS } from "@/lib/permissions";
import { MEDIA_REQUEST_SELECT, type MediaRequest } from "@/components/media-requests";
import { UploadForm } from "./upload-form";

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
    return (
      <div className="mx-auto max-w-3xl">
        <Link href="/jobs" className="text-sm font-medium text-muted hover:text-foreground">Back to your jobs</Link>
        <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight">Upload for {job?.address ?? "a job"}</h1>
        <p className="mt-1 text-muted">Pick the room for each batch so the builder can find them. You can fix tags on any file after.</p>
        <div className="mt-8">
          {jobs.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">You have no open jobs to upload to.</p>
          ) : (
            <UploadForm
              communities={[...comms.values()]}
              homes={jobs.filter((j) => j.home_id).map((j) => ({ id: j.home_id!, community_id: j.community_id, unparsed_address: j.address }))}
              communityWide={jobs.filter((j) => !j.home_id).map((j) => j.community_id)}
              presetCommunity={job?.community_id ?? null}
              presetHome={job?.home_id ?? null}
              showBuilder
              doneHref="/jobs"
            />
          )}
        </div>
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
      <Link href="/media" className="text-sm font-medium text-muted hover:text-foreground">Cancel</Link>
      <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight">Upload photos and videos</h1>
      <p className="mt-1 text-muted">
        Files go straight into private storage. Pick where they belong and the address, plan and community tags are added for you.
      </p>
      <div className="mt-8">
        <UploadForm
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
        />
      </div>
    </div>
  );
}
