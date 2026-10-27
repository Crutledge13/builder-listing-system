import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { builderFocus } from "@/lib/builder-focus";
import { requireProfile } from "@/lib/auth";
import { canEditBranding, canRequestMedia, isStaff } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { MEDIA_REQUEST_SELECT, RequestCard, RequestForm, type MediaRequest } from "@/components/media-requests";
import { saveShootContact } from "./actions";

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

  const focus = await builderFocus(me.role);
  let rq = supabase.from("media_requests").select(MEDIA_REQUEST_SELECT).order("created_at", { ascending: false }).limit(200);
  if (focus) rq = rq.eq("builder_id", focus);
  const [{ data: rows }, { data: communities }, { data: homes }, { data: photographers }] = await Promise.all([
    rq,
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

      {!staff && canEditBranding(me.role) && me.builder_id && <ShootContact builderId={me.builder_id} />}

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

// The contact and access notes photographers see on every job for this builder.
async function ShootContact({ builderId }: { builderId: string }) {
  const supabase = await createClient();
  const { data: c } = await supabase.from("builder_photo_info").select("contact_name, contact_phone, contact_email, access_notes").eq("builder_id", builderId).maybeSingle();
  const missing = !c?.contact_name && !c?.contact_phone;
  return (
    <details className="mt-6 max-w-3xl rounded-2xl border border-line" open={missing}>
      <summary className="cursor-pointer list-none px-5 py-4">
        <span className="font-semibold">Who photographers call</span>
        <span className="mt-0.5 block text-sm text-muted">
          {missing ? "Not set yet. Photographers see this on every job, so they can reach you if something’s wrong at a home." : `${c?.contact_name ?? ""}${c?.contact_phone ? `, ${c.contact_phone}` : ""}`}
        </span>
      </summary>
      <form action={saveShootContact} className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-3">
        <label className="block"><span className="mb-1 block text-sm font-medium">Name</span><input name="contact_name" defaultValue={c?.contact_name ?? ""} maxLength={80} className="field-input" /></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">Phone</span><input name="contact_phone" type="tel" defaultValue={c?.contact_phone ?? ""} maxLength={30} className="field-input" /></label>
        <label className="block"><span className="mb-1 block text-sm font-medium">Email</span><input name="contact_email" type="email" defaultValue={c?.contact_email ?? ""} maxLength={200} className="field-input" /></label>
        <label className="block sm:col-span-3">
          <span className="mb-1 block text-sm font-medium">Getting in (optional)</span>
          <input name="access_notes" defaultValue={c?.access_notes ?? ""} maxLength={1000} placeholder="e.g. Check in at the model home first. Don’t put lockbox codes here; send those per shoot." className="field-input" />
        </label>
        <div className="sm:col-span-3"><button className="rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Save</button></div>
      </form>
    </details>
  );
}
