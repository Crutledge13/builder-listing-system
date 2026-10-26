import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canManageMedia, isStaff } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { DemoArt, MEDIA_SELECT, ROOM_LABELS, type MediaRow } from "@/lib/demo-media";
import { DownloadDrawn, VideoPlayer } from "@/components/media-client";
import { makeCover, saveMedia, setTrashed } from "./actions";

export default function MediaItemPage(props: PageProps<"/media/[id]">) {
  return (
    <Suspense fallback={<div className="mt-16 aspect-[3/2] max-w-4xl animate-pulse rounded-2xl bg-soft" />}>
      <Item params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

const MESSAGES: Record<string, string> = {
  "1": "Saved.",
  cover: "This is now the cover photo for the home.",
  trashed: "Moved to the trash. It’s kept for 30 days and can be restored until then.",
  restored: "Restored from the trash.",
};

async function Item({ params, searchParams }: { params: PageProps<"/media/[id]">["params"]; searchParams: PageProps<"/media/[id]">["searchParams"] }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireProfile();
  const supabase = await createClient();

  const { data } = await supabase.from("media").select(MEDIA_SELECT + ", deleted_at, uploaded_by, size_bytes").eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as unknown as MediaRow & { deleted_at: string | null; uploaded_by: string | null; size_bytes: number | null };
  const manage = canManageMedia(me.role);
  const fileName = m.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase();
  const backHref = m.home_id ? `/media?home=${m.home_id}` : m.community_id ? `/media?community=${m.community_id}` : "/media";
  const backLabel = m.homes?.unparsed_address ?? m.communities?.name ?? "Media";
  const error = typeof sp.error === "string" ? sp.error : null;
  const saved = typeof sp.saved === "string" ? MESSAGES[sp.saved] : null;

  const { data: uploader } = m.uploaded_by
    ? await supabase.from("profiles").select("full_name").eq("id", m.uploaded_by).maybeSingle()
    : { data: null };

  return (
    <div>
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground">
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {backLabel}
      </Link>

      {m.deleted_at && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">This file is in the trash and hidden from the library.</p>
      )}
      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {saved && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{saved}</p>}

      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div>
          <div id="media-view" className="overflow-hidden rounded-2xl bg-soft ring-1 ring-line">
            <div className="aspect-[3/2]">
              {m.kind === "video" ? (
                <VideoPlayer src={`/api/media/${m.id}`}>
                  {m.source === "demo" ? <DemoArt m={m} className="h-full w-full" /> : <span className="block h-full w-full bg-black" />}
                </VideoPlayer>
              ) : m.source === "demo" ? (
                <DemoArt m={m} className="h-full w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${m.id}`} alt={m.title} className="h-full w-full object-contain" />
              )}
            </div>
          </div>
          <h1 className="mt-5 text-[26px] font-bold leading-tight tracking-tight">{m.title}</h1>
          <p className="mt-1 text-muted">
            {m.room ? ROOM_LABELS[m.room] : m.kind === "video" ? "Video" : "Photo"}
            {m.homes ? <>, <Link href={`/homes/${m.home_id}`} className="text-foreground underline">{m.homes.unparsed_address}</Link></> : null}
            {m.communities ? <>, <Link href={`/communities/${m.community_id}`} className="text-foreground underline">{m.communities.name}</Link></> : null}
            {isStaff(me.role) && m.builders ? `, ${m.builders.name.replace(" (demo)", "")}` : ""}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {m.tags.map((t) => (
              <Link key={t} href={`/media?tag=${encodeURIComponent(t)}`} className="rounded-full bg-soft px-3 py-1 text-sm hover:bg-line">
                {t}
              </Link>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="card-lift rounded-2xl border border-line bg-white p-5">
            {m.source === "demo" && m.kind !== "video" ? (
              <DownloadDrawn targetId="media-view" fileName={fileName} />
            ) : (
              <a href={`/api/media/${m.id}?download=1`} className="block w-full rounded-xl bg-accent px-4 py-3 text-center font-semibold text-white hover:brightness-110">
                Download
              </a>
            )}
            <dl className="mt-5 space-y-2 text-sm">
              <Row label="Type" value={m.kind === "floor_plan" ? "Floor plan" : m.kind === "video" ? "Video" : "Photo"} />
              <Row label="Ready for MLS" value={m.mls_ready ? "Yes" : "No"} />
              {m.is_cover && <Row label="Cover photo" value="Yes" />}
              <Row label="Added" value={`${dateTime(m.created_at)}${uploader ? ` by ${uploader.full_name}` : m.source === "demo" ? " (demo file)" : ""}`} />
              {m.size_bytes ? <Row label="Size" value={`${(m.size_bytes / 1_048_576).toFixed(1)} MB`} /> : null}
            </dl>
            <p className="mt-4 text-xs text-muted">Links to this file expire after an hour, so they can’t be passed around.</p>
          </div>

          {manage && !m.deleted_at && (
            <form action={saveMedia} className="rounded-2xl border border-line p-5">
              <h2 className="font-semibold">Details and tags</h2>
              <input type="hidden" name="id" value={m.id} />
              <label className="mt-4 block">
                <span className="mb-1 block text-sm font-medium">Title</span>
                <input name="title" defaultValue={m.title} required className="field-input" />
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-sm font-medium">Room or type</span>
                <select name="room" defaultValue={m.room ?? ""} className="field-input">
                  <option value="">None</option>
                  {Object.entries(ROOM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-sm font-medium">Tags, separated by commas</span>
                <textarea name="tags" rows={3} defaultValue={m.tags.join(", ")} className="field-input text-sm leading-relaxed" />
                <span className="mt-1 block text-xs text-muted">The address, plan, community and room are added automatically.</span>
              </label>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="mls_ready" defaultChecked={m.mls_ready} className="h-4 w-4 accent-[#3452c7]" />
                Ready for the MLS
              </label>
              <button className="mt-4 w-full rounded-xl bg-foreground px-4 py-2.5 font-semibold text-white hover:bg-black">Save</button>
            </form>
          )}

          {manage && (
            <div className="space-y-2">
              {m.home_id && m.kind === "photo" && !m.is_cover && !m.deleted_at && (
                <form action={makeCover}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="home_id" value={m.home_id} />
                  <button className="w-full rounded-xl border border-foreground px-4 py-2.5 font-semibold hover:bg-soft">Make this the cover photo</button>
                </form>
              )}
              <form action={setTrashed}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="trash" value={m.deleted_at ? "0" : "1"} />
                <button className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-red-700 underline hover:bg-red-50">
                  {m.deleted_at ? "Restore from the trash" : "Move to the trash"}
                </button>
              </form>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
