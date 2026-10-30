import { createClient } from "@/lib/supabase/server";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";
import { MediaPicture } from "@/components/media-tile";
import { PendingButton } from "@/components/pending-button";
import { reviewPhotos } from "@/app/(app)/media/review/actions";

// Our photographer's files waiting for approval on a home or a community
// (owners, 29 Oct 2026). Everything starts ticked: "Approve all" or untick the
// ones not to use and save. Approved ones go on the home's listing for the MLS.
export async function loadPendingPhotos(place: { homeId?: string; communityId?: string }) {
  const supabase = await createClient();
  let q = supabase.from("media").select(MEDIA_SELECT).eq("review_status", "pending").is("deleted_at", null).order("created_at").limit(200);
  if (place.homeId) q = q.eq("home_id", place.homeId);
  else if (place.communityId) q = q.eq("community_id", place.communityId).is("home_id", null);
  else return [];
  const { data } = await q;
  return (data ?? []) as unknown as MediaRow[];
}

export function PhotoApproval({ items, back, canReview, forHome }: { items: MediaRow[]; back: string; canReview: boolean; forHome: boolean }) {
  if (!items.length) return null;
  if (!canReview) {
    return (
      <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {items.length} new {items.length === 1 ? "file" : "files"} from our photographer {items.length === 1 ? "is" : "are"} waiting for marketing to approve.
      </p>
    );
  }
  return (
    <form action={reviewPhotos} className="rounded-2xl border border-amber-300 bg-amber-50/40 p-4">
      <input type="hidden" name="back" value={back} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <b>{items.length} new {items.length === 1 ? "file" : "files"} from our photographer.</b>{" "}
          {forHome ? "Approved ones go on this home’s listing for the MLS (and its realtor page)." : "Approved ones can be used on the community’s homes and realtor pages."} Untick any you don’t want to use.
        </p>
        <div className="flex flex-wrap gap-2">
          <PendingButton pending="Saving…" className="rounded-lg border border-foreground bg-white px-3 py-2 text-sm font-semibold hover:bg-soft">Save my picks</PendingButton>
          <button name="decision" value="all" className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">Approve all {items.length}</button>
        </div>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((m) => (
          <li key={m.id}>
            <input type="hidden" name="media_id" value={m.id} />
            <label className="group block cursor-pointer">
              <span className="relative block aspect-[3/2] overflow-hidden rounded-xl bg-soft ring-2 ring-transparent has-[:checked]:ring-accent">
                <MediaPicture m={m} className="h-full w-full" />
                <input type="checkbox" name="approve" value={m.id} defaultChecked className="peer absolute left-2 top-2 h-5 w-5 accent-[#3452c7]" aria-label={`Use ${m.title}`} />
                <span className="absolute inset-0 hidden items-center justify-center bg-white/70 text-sm font-semibold text-muted peer-[:not(:checked)]:flex">Don&rsquo;t use</span>
              </span>
              <span className="mt-1 block truncate text-xs">{m.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </form>
  );
}
