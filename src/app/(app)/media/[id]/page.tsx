import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canManageMedia, isStaff } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { DemoArt, MEDIA_SELECT, ROOM_LABELS, type MediaRow } from "@/lib/demo-media";
import { VideoPlayer } from "@/components/media-client";
import { DownloadMenu } from "@/components/download-menu";
import { PRESET_SELECT, type DownloadPreset } from "@/lib/image-resize";
import { DISCLAIMER_TEXT, DisclaimerOverlay, planFolderHref } from "@/components/media-tile";
import { clearAiWarning, makeCover, requestTag, rerunAi, saveMedia, setTrashed } from "./actions";
import { TagPicker } from "@/components/tag-picker";
import { BackButton } from "@/components/back-button";
import { loadTagList, pickedTags } from "@/lib/tags";
import { aiTaggingAvailable } from "@/lib/ai-tagging";

export default function MediaItemPage(props: PageProps<"/media/[id]">) {
  return (
    <Suspense fallback={<div className="mt-16 aspect-[3/2] max-w-4xl animate-pulse rounded-2xl bg-soft" />}>
      <Item params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

const MESSAGES: Record<string, string> = {
  "1": "Saved.",
  cover: "This is now the cover photo: it shows on the cards (and for a home, it's photo 1 on the MLS).",
  trashed: "Moved to the trash. It’s kept for 30 days and can be restored until then.",
  restored: "Restored from the trash.",
  ai: "AI took another look.",
  cleared: "Marked OK for the MLS. The warning no longer holds up the listing.",
  tagreq: "Sent. Our team will add the tag or point you to one that fits.",
};

async function Item({ params, searchParams }: { params: PageProps<"/media/[id]">["params"]; searchParams: PageProps<"/media/[id]">["searchParams"] }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireProfile();
  const supabase = await createClient();

  const { data } = await supabase.from("media").select(MEDIA_SELECT + ", deleted_at, uploaded_by, size_bytes, caption_source").eq("id", id).maybeSingle();
  if (!data) notFound();
  const raw = data as unknown as MediaRow & { deleted_at: string | null; uploaded_by: string | null; size_bytes: number | null; caption_source: string | null };
  const m = { ...raw, caption_source_is_ai: raw.caption_source === "ai" };
  const manage = canManageMedia(me.role) || (me.role === "photographer" && m.uploaded_by === me.id);
  const photographer = me.role === "photographer";
  const fileName = m.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase();
  const backHref = me.role === "photographer" ? "/jobs" : m.home_id ? `/media?home=${m.home_id}` : m.community_id ? `/media?community=${m.community_id}` : "/media";
  const backLabel = me.role === "photographer" ? "Your jobs" : m.homes?.unparsed_address ?? m.communities?.name ?? "Media";
  const error = typeof sp.error === "string" ? sp.error : null;
  const saved = typeof sp.saved === "string" ? MESSAGES[sp.saved] : null;

  // Plan library photos are always representative; a home's own photos are when the builder turned the disclaimer on.
  const { data: homeFlag } = m.home_id
    ? await supabase.from("homes").select("show_representative_disclaimer").eq("id", m.home_id).maybeSingle()
    : { data: null };
  const isPlanItem = !!m.plan_name && !m.home_id;
  const disclaimer = m.kind === "photo" && !!homeFlag?.show_representative_disclaimer;
  const offerDisclaimer = m.kind === "photo" && isPlanItem && !disclaimer;

  const allTags = manage ? await loadTagList(supabase, { includeRetired: true }) : [];
  const picked = pickedTags(m.tags, allTags);
  const autoTags = m.tags.filter((t) => !picked.some((p) => p.toLowerCase() === t.toLowerCase()));
  const { data: myRequests } = manage
    ? await supabase.from("media_tag_requests").select("id, label, status, answer").eq("media_id", m.id).eq("requested_by", me.id).order("created_at", { ascending: false }).limit(5)
    : { data: null };

  const { data: presetRows } = await supabase.from("download_presets").select(PRESET_SELECT).order("sort").order("name");
  const presets = (presetRows ?? []) as DownloadPreset[];
  const { data: brand } = await supabase.from("builder_branding").select("default_download_preset").eq("builder_id", m.builder_id).maybeSingle();

  const { data: uploader } = m.uploaded_by
    ? await supabase.from("profiles").select("full_name").eq("id", m.uploaded_by).maybeSingle()
    : { data: null };

  return (
    <div>
      <BackButton href={backHref} label={me.role === "photographer" ? "Back to your jobs" : `Back to ${backLabel}`} />

      {m.deleted_at && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">This file is in the trash and hidden from the library.</p>
      )}
      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {saved && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{saved}</p>}

      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div>
          <div id="media-view" className="overflow-hidden rounded-2xl bg-soft ring-1 ring-line">
            <div className="relative aspect-[3/2]">
              {disclaimer && <DisclaimerOverlay />}
              {m.kind === "video" ? (
                <VideoPlayer src={`/api/media/${m.id}`}>
                  {m.source === "demo" ? <DemoArt m={m} className="h-full w-full" /> : <span className="block h-full w-full bg-black" />}
                </VideoPlayer>
              ) : m.source === "demo" ? (
                <DemoArt m={m} className="h-full w-full" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${m.id}?size=web`} alt={m.title} decoding="async" className="h-full w-full object-contain" />
              )}
            </div>
          </div>
          <h1 className="mt-5 text-[26px] font-bold leading-tight tracking-tight">{m.title}</h1>
          <p className="mt-1 text-muted">
            {m.room ? ROOM_LABELS[m.room] : m.kind === "video" ? "Video" : "Photo"}
            {m.homes && !photographer ? <>, <Link href={`/homes/${m.home_id}`} className="text-foreground underline">{m.homes.unparsed_address}</Link></> : null}
            {m.communities && !photographer ? <>, <Link href={`/communities/${m.community_id}`} className="text-foreground underline">{m.communities.name}</Link></> : null}
            {isStaff(me.role) && m.builders ? `, ${m.builders.name.replace(" (demo)", "")}` : ""}
          </p>
          {(m.plan_name ?? m.homes?.plan_name) && !photographer && (
            <Link href={planFolderHref(m.builder_id, (m.plan_name ?? m.homes?.plan_name)!)} className="mt-3 inline-flex rounded-full bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent hover:underline">
              See every photo of the {m.plan_name ?? m.homes?.plan_name} plan →
            </Link>
          )}
          {m.caption && <p className="mt-3 text-[15px]">{m.caption}{m.caption_source_is_ai ? <span className="ml-2 text-xs text-violet-700">written by AI</span> : null}</p>}
          <AiPanel m={m} canRerun={manage && m.source === "upload" && m.kind === "photo" && aiTaggingAvailable()} canClear={manage} />
          <div className="mt-4 flex flex-wrap gap-2">
            {m.tags.map((t) => (
              photographer ? <span key={t} className="rounded-full bg-soft px-3 py-1 text-sm">{t}</span> : <Link key={t} href={`/media?tag=${encodeURIComponent(t)}`} className="rounded-full bg-soft px-3 py-1 text-sm hover:bg-line">
                {t}
              </Link>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="card-lift rounded-2xl border border-line bg-white p-5">
            {m.kind === "video" || (m.source !== "demo" && !(m.mime_type ?? "").startsWith("image/")) ? (
              <a href={`/api/media/${m.id}?download=1`} className="block w-full rounded-xl bg-accent px-4 py-3 text-center font-semibold text-white hover:brightness-110">
                Download
              </a>
            ) : (
              <DownloadMenu
                mediaId={m.id}
                fileName={fileName}
                demoTargetId={m.source === "demo" ? "media-view" : undefined}
                presets={presets}
                builderDefault={brand?.default_download_preset ?? null}
                disclaimer={disclaimer ? DISCLAIMER_TEXT : undefined}
                offerDisclaimer={offerDisclaimer ? DISCLAIMER_TEXT : undefined}
              />
            )}
            <dl className="mt-5 space-y-2 text-sm">
              <Row label="Type" value={m.kind === "floor_plan" ? "Floor plan" : m.kind === "video" ? "Video" : "Photo"} />
              <Row label="Ready for MLS" value={m.mls_ready ? "Yes" : "No"} />
              {isPlanItem && <Row label="Plan library" value={`${m.plan_name} plan (representative)`} />}
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
                <span className="mb-1 flex items-center gap-2 text-sm font-medium">
                  Room or type
                  {m.room_source === "ai" && <span className="rounded bg-violet-50 px-1.5 py-px text-[11px] font-semibold text-violet-700">Picked by AI</span>}
                </span>
                <select name="room" defaultValue={m.room ?? ""} className="field-input">
                  <option value="">None</option>
                  {Object.entries(ROOM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <div className="mt-3">
                <span className="mb-1 block text-sm font-medium">Tags</span>
                <TagPicker list={allTags.filter((t) => t.active)} defaultValue={picked} requestHref="#request-tag" />
                <span className="mt-1 block text-xs text-muted">
                  Pick from our shared list so everyone’s photos stay searchable the same way.
                  {autoTags.length > 0 && <> Added automatically: {autoTags.join(", ")}.</>}
                </span>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="mls_ready" defaultChecked={m.mls_ready} className="h-4 w-4 accent-[#3452c7]" />
                Ready for the MLS
              </label>
              <button className="mt-4 w-full rounded-xl bg-foreground px-4 py-2.5 font-semibold text-white hover:bg-black">Save</button>
            </form>
          )}

          {manage && !m.deleted_at && (
            <details id="request-tag" className="rounded-2xl border border-line p-5">
              <summary className="cursor-pointer font-semibold">Need a tag that isn’t on the list?</summary>
              <form action={requestTag} className="mt-3 space-y-3">
                <input type="hidden" name="media_id" value={m.id} />
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Tag you’d like</span>
                  <input name="label" required maxLength={40} placeholder="e.g. Wine room" className="field-input" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Why (optional)</span>
                  <input name="note" maxLength={500} placeholder="What it’s for, so our team can name it well" className="field-input" />
                </label>
                <button className="w-full rounded-xl border border-foreground px-4 py-2.5 font-semibold hover:bg-soft">Send to our team</button>
                <p className="text-xs text-muted">Our team adds it to the list (or points you to an existing tag). If approved, it’s added to this photo.</p>
              </form>
              {myRequests && myRequests.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                  {myRequests.map((r) => (
                    <li key={r.id}>
                      “{r.label}”: {r.status === "pending" ? "waiting on our team" : r.status === "approved" ? "approved" : "not added"}
                      {r.answer && <span className="text-muted">. {r.answer}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}

          {manage && (
            <div className="space-y-2">
              {!photographer && (m.home_id || m.community_id) && !m.plan_name && m.kind === "photo" && !m.is_cover && !m.deleted_at && (
                <form action={makeCover}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="w-full rounded-xl border border-foreground px-4 py-2.5 font-semibold hover:bg-soft">★ Make this the cover photo</button>
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

const FLAG_TEXT: Record<string, string> = {
  blurry: "looks blurry",
  dark: "looks dark",
  people: "has people in it",
  signage_or_logo: "shows a sign or logo",
  text_overlay: "has text on it",
  not_a_home_photo: "may not be a home photo",
};

function AiPanel({ m, canRerun, canClear }: { m: MediaRow; canRerun: boolean; canClear: boolean }) {
  const s = m.ai_suggestion;
  if (!m.ai_status && !canRerun) return null;
  return (
    <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/50 p-4 text-sm">
      {m.ai_status === "pending" && <p>AI is looking at this photo. Refresh in a moment.</p>}
      {m.ai_status === "skipped" && <p className="text-muted">AI didn’t look at this file{m.mime_type === "image/heic" ? " (iPhone HEIC photos can’t be read; pick the room yourself)" : ""}.</p>}
      {m.ai_status === "failed" && <p className="text-muted">AI couldn’t read this photo. Pick the room yourself, or try again.</p>}
      {m.ai_status === "no_credits" && <p className="text-muted">AI didn’t label this photo because this month’s AI credits were used up. Pick the room yourself, or try again after they reset.</p>}
      {m.ai_status === "done" && s && (
        <>
          <p>
            <b className="font-semibold">AI thinks this is the {ROOM_LABELS[s.room]?.toLowerCase() ?? s.room}</b>{" "}
            <span className="text-muted">({Math.round(s.confidence * 100)}% sure)</span>.
            {m.room_source === "staff" && m.room !== s.room ? " A person changed it, so their choice is kept." : " Change it below if it’s wrong."}
          </p>
          {s.flags.length > 0 && (
            <div className="mt-2 text-amber-900">
              <p>Check before using on the MLS: this photo {s.flags.map((f) => FLAG_TEXT[f] ?? f).join(", ")}.</p>
              {canClear && !m.mls_ready && (
                <form action={clearAiWarning} className="mt-2">
                  <input type="hidden" name="id" value={m.id} />
                  <button className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black">I checked it: OK for the MLS</button>
                  <span className="ml-2 text-xs text-muted">Or move it to the trash.</span>
                </form>
              )}
              {m.mls_ready && <p className="mt-1 text-xs text-emerald-800">A person marked this OK for the MLS.</p>}
            </div>
          )}
        </>
      )}
      {canRerun && aiTaggingAvailable() && m.ai_status !== "pending" && (
        <form action={rerunAi} className="mt-3">
          <input type="hidden" name="id" value={m.id} />
          <button className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-violet-50">
            {m.ai_status === "done" ? "Ask AI again (1 credit)" : "Let AI label this photo (1 credit)"}
          </button>
        </form>
      )}
    </div>
  );
}
