import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "@/lib/format";
import { DISCLAIMER_TEXT, MediaPicture } from "@/components/media-tile";
import { PhotoPackButton } from "@/components/photo-pack-button";
import type { DownloadPreset } from "@/lib/image-resize";
import type { MediaRow } from "@/lib/demo-media";
import { TOUR_PROVIDERS, type ListingMedia, type Tour } from "@/lib/listing-media";
import { addToListing, addTour, makeListingCover, moveListingItem, removeFromListing, trashTour } from "@/app/(app)/homes/[id]/listing-actions";

// Everything that goes on this home's MLS listing, in MLS order, and the
// places more can come from: our photographer, the builder's own uploads, the
// community's photos and video, the floor plan's photos, and tour links.
export function ListingMediaPanel({
  home,
  listing,
  canEdit,
  canRequest,
  notice,
  download,
}: {
  home: { id: string; community_name: string; plan_name: string | null; address?: string; disclaimer?: boolean };
  listing: ListingMedia;
  canEdit: boolean;
  canRequest: boolean;
  notice?: ReactNode;
  // Download all of this home's listing photos at a picked size (the "Download media" button at the top jumps here).
  download?: { presets: DownloadPreset[]; builderDefault: string | null };
}) {
  const media = listing.items.filter((i) => i.type === "media");
  // The cover is always one of this home's own photos (what its cards show):
  // the chosen one, or until then its first own photo in listing order.
  const ownPhotos = media.map((i) => (i as Extract<typeof i, { type: "media" }>).media).filter((m) => m.kind === "photo" && m.home_id === home.id);
  const coverId = (ownPhotos.find((m) => m.is_cover) ?? ownPhotos[0])?.id;
  // MLS photo numbers (videos aren't numbered).
  const numbers = media.reduce<number[]>((acc, i) => {
    const prev = acc.length ? Math.max(0, ...acc) : 0;
    acc.push((i as Extract<typeof i, { type: "media" }>).media.kind === "video" ? 0 : prev + 1);
    return acc;
  }, []);

  return (
    <section id="listing-media" className="scroll-mt-28 border-b border-line py-8">
      <h3 className="text-lg font-semibold">Listing photos, video and tours</h3>
      <p className="mt-1 text-sm text-muted">
        Exactly what goes on the MLS, in order. Anything our photographer delivers for this home, or anyone uploads to it, lands here on its own.
        Community and floor plan photos, video and tours are optional: add the ones you want.
      </p>
      {notice}

      {(download && listing.photos.length > 0) || listing.videos.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-soft p-4">
          {download && listing.photos.length > 0 && (
            <PhotoPackButton
              name={`photos-${(home.address ?? "home").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              photos={listing.photos.map((m, i) => ({ id: m.id, file: m.source !== "demo", label: `${String(i + 1).padStart(2, "0")}-${(m.room ?? m.kind).replace(/_/g, "-")}` }))}
              readme={`Listing photos of ${home.address ?? "this home"}, in MLS order, downloaded from Builder Listings.\n`}
              label={`Download all ${listing.photos.length} photos (.zip)`}
              presets={download.presets}
              builderDefault={download.builderDefault}
              disclaimer={home.disclaimer ? DISCLAIMER_TEXT : undefined}
            />
          )}
          <Link href={`/media?home=${home.id}`} className="text-sm font-semibold underline">
            {listing.videos.length > 0 ? "Videos and every file for this home" : "Every file for this home"}
          </Link>
        </div>
      ) : null}

      {canEdit && (
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href={`/media/upload?home=${home.id}`} className="rounded-xl border border-foreground px-3.5 py-2 font-semibold hover:bg-soft">Upload your own photos or video</Link>
          {canRequest && <a href="#photo-requests" className="rounded-xl border border-line px-3.5 py-2 font-semibold hover:border-foreground">Request our photographer</a>}
          <a href="#add-tour" className="rounded-xl border border-line px-3.5 py-2 font-semibold hover:border-foreground">Add a 3D or video tour link</a>
        </div>
      )}

      {/* On the listing, in MLS order */}
      <h4 className="mt-6 text-sm font-semibold">
        On the listing <span className="font-normal text-muted">{plural(listing.photos.length, "photo")} · {plural(listing.videos.length, "video")} · {plural(listing.tours.length, "tour")}</span>
      </h4>
      {canEdit && listing.photos.length > 1 && (
        <p className="mt-1 text-xs text-muted">
          <b className="font-semibold text-foreground">★ Cover:</b> the photo on this home&rsquo;s cards and at the top of its page. Pick one with
          &ldquo;Make cover&rdquo;; it also becomes photo 1 on the MLS.
        </p>
      )}
      {media.length === 0 ? (
        <p className="mt-2 rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">
          Nothing on the listing yet. Photos appear here when our photographer delivers or you upload them, or add community and floor plan photos below.
        </p>
      ) : (
        <ol className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((item, idx) => {
            const m = (item as Extract<typeof item, { type: "media" }>).media;
            const isVideo = m.kind === "video";
            // The cover: the chosen one, or (until one is chosen) photo 1.
            const isCover = m.id === coverId;
            return (
              <li key={item.id} className="min-w-0">
                <Link href={`/media/${m.id}`} className={cx("relative block aspect-[3/2] overflow-hidden rounded-lg bg-soft", isCover && "ring-2 ring-accent ring-offset-2")}>
                  <MediaPicture m={m} className="h-full w-full" />
                  <span className="absolute left-1.5 top-1.5 rounded bg-white/95 px-1.5 text-[11px] font-bold shadow-sm">{isVideo ? "Video" : numbers[idx]}</span>
                  <span className="absolute right-1.5 top-1.5 rounded bg-white/95 px-1.5 text-[10px] font-semibold text-muted shadow-sm">{whereFrom(m)}</span>
                  {isCover && (
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">★ Cover</span>
                  )}
                  {!isVideo && !m.mls_ready && !isCover && (
                    <span className="absolute inset-x-1.5 bottom-1.5 rounded bg-amber-100/95 px-1.5 py-0.5 text-center text-[10px] font-semibold text-amber-900">Not MLS-ready: check it</span>
                  )}
                </Link>
                <span className="mt-1 block truncate text-xs text-muted">{m.caption ?? m.title}</span>
                {canEdit && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {idx > 0 && <Move homeId={home.id} itemId={item.id} dir="up" label="← Earlier" />}
                    {idx < media.length - 1 && <Move homeId={home.id} itemId={item.id} dir="down" label="Later →" />}
                    {!isVideo && !isCover && m.home_id === home.id && (
                      <form action={makeListingCover}>
                        <input type="hidden" name="home_id" value={home.id} />
                        <input type="hidden" name="media_id" value={m.id} />
                        <button className="font-semibold text-accent underline">★ Make cover</button>
                      </form>
                    )}
                    {idx > 0 && !isVideo && <Move homeId={home.id} itemId={item.id} dir="first" label="Make first" />}
                    <form action={removeFromListing}>
                      <input type="hidden" name="home_id" value={home.id} />
                      <input type="hidden" name="item_id" value={item.id} />
                      <button className="font-semibold text-red-700 underline" title="Takes it off the listing; it stays in the media library">Remove</button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Tours on the listing */}
      {listing.tours.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {listing.items.filter((i) => i.type === "tour").map((item) => {
            const t = (item as Extract<typeof item, { type: "tour" }>).tour;
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <TourLabel t={t} />
                <span className="flex-1" />
                {canEdit && (
                  <form action={removeFromListing}>
                    <input type="hidden" name="home_id" value={home.id} />
                    <input type="hidden" name="item_id" value={item.id} />
                    <button className="text-xs font-semibold text-red-700 underline">Remove from listing</button>
                  </form>
                )}
                {canEdit && t.home_id && (
                  <form action={trashTour}>
                    <input type="hidden" name="home_id" value={home.id} />
                    <input type="hidden" name="tour_id" value={t.id} />
                    <button className="text-xs font-semibold text-muted underline">Delete link</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Optional: community, floor plan, community tours */}
      {canEdit && (
        <>
          <Optional homeId={home.id} title={`From ${home.community_name} (community)`} items={listing.community} empty="No community photos or video yet." />
          {home.plan_name && (
            <Optional homeId={home.id} title={`From the ${home.plan_name} floor plan`} items={listing.plan} empty="No photos for this floor plan yet." hint="Model or plan photos: turn on the representative disclaimer if the listing uses them." />
          )}
          {listing.communityTours.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-semibold">Community tours</h4>
              <ul className="mt-2 divide-y divide-line rounded-2xl border border-line">
                {listing.communityTours.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <TourLabel t={t} />
                    <span className="flex-1" />
                    <form action={addToListing}>
                      <input type="hidden" name="home_id" value={home.id} />
                      <input type="hidden" name="tour_id" value={t.id} />
                      <button className="rounded-lg border border-foreground px-3 py-1 text-xs font-semibold hover:bg-soft">Add to listing</button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Add a tour link */}
          <details id="add-tour" className="mt-6 scroll-mt-28 rounded-2xl border border-line p-4">
            <summary className="cursor-pointer font-semibold">Add a 3D or video tour link</summary>
            <form action={addTour} className="mt-4 grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="home_id" value={home.id} />
              <label className="block sm:col-span-2">
                <span className="block text-sm font-medium">Tour link</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">
                  Paste the share link from Matterport, Zillow 3D Home, iGUIDE, Cupix, YouTube or Vimeo. We recognize the service from the link.
                </span>
                <input name="url" type="url" required placeholder="https://my.matterport.com/show/?m=..." className="field-input mt-1.5" />
              </label>
              <label className="block">
                <span className="block text-sm font-medium">Name (optional)</span>
                <input name="title" placeholder="e.g. Model home walkthrough" className="field-input mt-1.5" />
              </label>
              <fieldset>
                <legend className="text-sm font-medium">Branded or unbranded?</legend>
                <span className="mt-0.5 block text-xs leading-snug text-muted">
                  Unbranded means no builder or agent names, logos or contact info in the tour. MLSs generally want the unbranded link; add both if you have both.
                </span>
                <div className="mt-1.5 flex gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="branded" value="no" defaultChecked className="accent-[#3452c7]" /> Unbranded</label>
                  <label className="flex items-center gap-2"><input type="radio" name="branded" value="yes" className="accent-[#3452c7]" /> Branded</label>
                </div>
              </fieldset>
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium">Which home is it of?</legend>
                <div className="mt-1.5 flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="scope" value="home" defaultChecked className="accent-[#3452c7]" /> This home (goes on its listing)</label>
                  <label className="flex items-center gap-2"><input type="radio" name="scope" value="community" className="accent-[#3452c7]" /> The model home or community (any home there can add it)</label>
                </div>
              </fieldset>
              <div><button className="rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Save tour</button></div>
            </form>
          </details>
        </>
      )}
    </section>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function whereFrom(m: MediaRow) {
  if (m.home_id) return m.kind === "floor_plan" ? "Floor plan" : "This home";
  if (m.community_id) return "Community";
  return "Plan";
}

function Move({ homeId, itemId, dir, label }: { homeId: string; itemId: string; dir: string; label: string }) {
  return (
    <form action={moveListingItem}>
      <input type="hidden" name="home_id" value={homeId} />
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="dir" value={dir} />
      <button className="font-semibold underline">{label}</button>
    </form>
  );
}

function TourLabel({ t }: { t: Tour }) {
  return (
    <span className="min-w-0">
      <span className="font-semibold">{t.title ?? TOUR_PROVIDERS[t.provider]}</span>
      {t.title && <span className="ml-2 rounded bg-soft px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted">{TOUR_PROVIDERS[t.provider]}</span>}
      <span className={cx("ml-1 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", t.branded ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700")}>
        {t.branded ? "Branded" : "Unbranded"}
      </span>
      {t.added_by_role === "photographer" && <span className="ml-1 text-[11px] text-muted">from our photographer</span>}
      <a href={t.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block max-w-[28rem] truncate text-xs text-accent underline">{t.url}</a>
    </span>
  );
}

function Optional({ homeId, title, items, empty, hint }: { homeId: string; title: string; items: MediaRow[]; empty: string; hint?: string }) {
  const photos = items.filter((m) => m.kind !== "video");
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{title} <span className="font-normal text-muted">optional</span></h4>
        {photos.length > 1 && (
          <form action={addToListing}>
            <input type="hidden" name="home_id" value={homeId} />
            {photos.map((m) => <input key={m.id} type="hidden" name="media_id" value={m.id} />)}
            <button className="text-xs font-semibold text-accent underline">Add all {photos.length} photos</button>
          </form>
        )}
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((m) => (
            <li key={m.id} className="min-w-0">
              <div className="relative aspect-[3/2] overflow-hidden rounded-lg bg-soft opacity-90">
                <MediaPicture m={m} className="h-full w-full" />
                {m.kind === "video" && <span className="absolute left-1 top-1 rounded bg-white/95 px-1.5 text-[10px] font-bold">Video</span>}
              </div>
              <form action={addToListing} className="mt-1">
                <input type="hidden" name="home_id" value={homeId} />
                <input type="hidden" name="media_id" value={m.id} />
                <button className="w-full rounded-md border border-line py-1 text-xs font-semibold hover:border-foreground">+ Add</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
