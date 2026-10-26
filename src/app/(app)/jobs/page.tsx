import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";
import { Notice } from "@/components/notice";
import { MediaGrid, MediaTile } from "@/components/media-tile";
import { MEDIA_REQUEST_SELECT, RequestCard, type MediaRequest } from "@/components/media-requests";

export default function JobsPage(props: PageProps<"/jobs">) {
  return (
    <Suspense fallback={<div className="mt-16 h-64 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Jobs />
    </Suspense>
  );
}

async function Jobs() {
  const me = await requireProfile();
  const supabase = await createClient();

  // Photographers see only their own jobs; the database enforces it.
  const { data: rows } = await supabase
    .from("media_requests")
    .select(MEDIA_REQUEST_SELECT)
    .eq("photographer_id", me.id)
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .limit(100);
  const jobs = (rows ?? []) as MediaRequest[];

  const { data: mine } = await supabase
    .from("media")
    .select(MEDIA_SELECT)
    .eq("uploaded_by", me.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  const uploads = (mine ?? []) as unknown as MediaRow[];
  const forJob = (r: MediaRequest) =>
    uploads.filter((m) => (r.home_id ? m.home_id === r.home_id : m.community_id === r.community_id && !m.home_id));

  const groups = [
    { title: "Upcoming shoots", list: jobs.filter((r) => r.status === "assigned" || r.status === "scheduled") },
    { title: "Delivered, waiting on the builder", list: jobs.filter((r) => r.status === "delivered") },
    { title: "Finished", list: jobs.filter((r) => r.status === "completed").slice(0, 10) },
  ];

  return (
    <div className="max-w-4xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Your jobs</h1>
      <p className="mt-1 text-muted">
        {me.role === "photographer"
          ? "Set a shoot time, upload and tag your photos and video, then mark the job delivered."
          : "This page is for photographers. You have no jobs assigned."}
      </p>

      <div className="mt-8 space-y-12">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="text-[22px] font-semibold">
              {g.title} <span className="font-normal text-muted">{g.list.length}</span>
            </h2>
            <div className="mt-4 space-y-4">
              {g.list.map((r) => {
                const files = forJob(r);
                return (
                  <RequestCard key={r.id} r={r} role={me.role} back="/jobs">
                    {files.length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-sm font-medium">Your uploads ({files.length}). Tap one to tag it.</p>
                        <MediaGrid>{files.slice(0, 10).map((m) => <MediaTile key={m.id} m={m} />)}</MediaGrid>
                      </div>
                    )}
                  </RequestCard>
                );
              })}
              {g.list.length === 0 && <p className="rounded-2xl border border-dashed border-line px-6 py-8 text-center text-muted">Nothing here.</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
