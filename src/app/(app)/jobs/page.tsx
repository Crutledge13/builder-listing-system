import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";
import { Notice } from "@/components/notice";
import { MediaGrid, MediaTile } from "@/components/media-tile";
import { MEDIA_REQUEST_SELECT, RequestCard, type MediaRequest } from "@/components/media-requests";
import { cx, dateTime } from "@/lib/format";
import { PAYMENT_STATUS, cents } from "@/lib/payments";

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

  const [{ data: payments }, { data: rates }] = await Promise.all([
    supabase.from("photographer_payments").select("id, address, line_items, amount_cents, status, approved_at, paid_at, created_at").eq("photographer_id", me.id).order("created_at", { ascending: false }),
    supabase.from("photographer_rates").select("need, label, amount_cents").order("amount_cents", { ascending: false }),
  ]);
  const pay = payments ?? [];
  const total = (st: string) => pay.filter((p) => p.status === st).reduce((n, p) => n + p.amount_cents, 0);

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

        <section id="earnings" className="scroll-mt-28">
          <h2 className="text-[22px] font-semibold">Earnings</h2>
          <p className="mt-1 text-sm text-muted">Each job is priced from our rate card when the builder marks it complete. Our team approves it, then it’s paid.</p>
          <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">Demo only: payments aren’t sent from here yet.</p>
          <dl className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "Waiting for approval", value: total("pending") },
              { label: "Approved, to be paid", value: total("approved") },
              { label: "Paid", value: total("paid") },
            ].map((t) => (
              <div key={t.label} className="rounded-2xl border border-line p-4">
                <dt className="text-sm text-muted">{t.label}</dt>
                <dd className="text-2xl font-bold tabular-nums">{cents(t.value)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 divide-y divide-line rounded-2xl border border-line">
            {pay.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{p.address}</div>
                  <div className="text-sm text-muted">
                    {(p.line_items as { label: string }[]).map((l) => l.label).join(", ")}. {p.paid_at ? `Paid ${dateTime(p.paid_at)}` : p.approved_at ? `Approved ${dateTime(p.approved_at)}` : `Added ${dateTime(p.created_at)}`}
                  </div>
                </div>
                <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", PAYMENT_STATUS[p.status].style)}>{PAYMENT_STATUS[p.status].label}</span>
                <span className="w-24 text-right font-semibold tabular-nums">{cents(p.amount_cents)}</span>
              </div>
            ))}
            {pay.length === 0 && <p className="p-4 text-sm text-muted">No completed jobs yet.</p>}
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold underline">Rate card</summary>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {(rates ?? []).map((r) => (
                <li key={r.need} className="flex justify-between rounded-lg bg-soft px-3 py-2"><span>{r.label}</span><b>{cents(r.amount_cents)}</b></li>
              ))}
            </ul>
          </details>
        </section>
      </div>
    </div>
  );
}
