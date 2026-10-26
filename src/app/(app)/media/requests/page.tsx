import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canRequestMedia, isStaff } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { MEDIA_REQUEST_SELECT, RequestCard, RequestForm, type MediaRequest } from "@/components/media-requests";

export default function MediaRequestsPage(props: PageProps<"/media/requests">) {
  return (
    <Suspense fallback={<div className="mt-16 h-64 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Requests />
    </Suspense>
  );
}

async function Requests() {
  const me = await requireProfile();
  if (me.role === "sales") redirect("/media");
  if (me.role === "photographer") redirect("/jobs");
  const supabase = await createClient();
  const staff = isStaff(me.role);

  const [{ data: rows }, { data: communities }, { data: homes }, { data: photographers }] = await Promise.all([
    supabase.from("media_requests").select(MEDIA_REQUEST_SELECT).order("created_at", { ascending: false }).limit(200),
    supabase.from("communities").select("id, name").order("name"),
    supabase.from("homes").select("id, community_id, unparsed_address").is("deleted_at", null).order("unparsed_address"),
    me.role === "platform_admin"
      ? supabase.from("profiles").select("id, full_name").eq("role", "photographer").order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const all = (rows ?? []) as MediaRequest[];
  const groups = [
    { title: "Delivered, ready to review", hint: "The photographer is done. Check the photos, then mark it complete or send it back.", list: all.filter((r) => r.status === "delivered") },
    { title: "Needs a photographer", hint: staff ? "Assign a photographer and, if you know it, the shoot time." : "Our team will assign a photographer soon.", list: all.filter((r) => r.status === "requested") },
    { title: "Scheduled", hint: "A photographer is on it.", list: all.filter((r) => r.status === "assigned" || r.status === "scheduled") },
    { title: "Recently finished", hint: "", list: all.filter((r) => r.status === "completed" || r.status === "cancelled").slice(0, 10) },
  ];
  if (staff) [groups[0], groups[1]] = [groups[1], groups[0]];

  return (
    <div>
      <Link href="/media" className="text-sm font-medium text-muted hover:text-foreground">Media library</Link>
      <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight">Photo requests</h1>
      <p className="mt-1 text-muted">
        {staff
          ? "Every request from every builder. Assign photographers and schedule shoots."
          : "Ask for photos, video, drone or a floor plan. We send a photographer and the files land in the media library."}
      </p>

      {canRequestMedia(me.role) && (
        <details className="mt-6" open={all.length === 0}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110">
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            New request
          </summary>
          <div className="mt-4 max-w-3xl">
            <RequestForm back="/media/requests" targets={{ communities: communities ?? [], homes: homes ?? [] }} />
          </div>
        </details>
      )}

      <div className="mt-10 space-y-12">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="text-[22px] font-semibold">
              {g.title} <span className="font-normal text-muted">{g.list.length}</span>
            </h2>
            {g.hint && <p className="mt-1 text-muted">{g.hint}</p>}
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {g.list.map((r) => (
                <RequestCard key={r.id} r={r} role={me.role} back="/media/requests" photographers={photographers ?? []} showBuilder={staff} />
              ))}
            </div>
            {g.list.length === 0 && <p className="rounded-2xl border border-dashed border-line px-6 py-8 text-center text-muted">Nothing here.</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
