import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { cx, dateTime } from "@/lib/format";
import { PendingButton } from "@/components/pending-button";
import { deleteShareLink, extendShareLink, replaceShareLink, restoreShareLink } from "@/app/(app)/homes/[id]/share-actions";

type Link = {
  id: string; token: string; recipient_name: string | null; recipient_email: string | null;
  expires_at: string | null; revoked_at: string | null; view_count: number; download_count: number; last_viewed_at: string | null;
  created_at: string; profiles: { full_name: string } | null;
};

// "Share with a realtor" on a home: the home's one standing link, always
// there to copy and send to anyone. It opens a page with this home's listing
// photos, walkthrough, reel and tour links, plus a button to the builder's
// website. Older one-off links (made for a named realtor, with an end date)
// are listed underneath until they're deleted.
//
// canManage: owners, managers, marketing, our admins (replace the link, see
//   how often it's opened, delete older links). Everyone else who can see the
//   home (salespeople, our coordinators) just copies it.
// highlight: the older link just changed, marked with the message next to it.
// undo: the older link just deleted, offered back next to the message.
export async function ShareLinksPanel({
  homeId, token, canManage, notice, highlight, undo,
}: { homeId: string; token: string | null; canManage: boolean; notice: React.ReactNode; highlight?: string | null; undo?: string | null }) {
  // Everyone copies the link from the "Share link" button at the top of the
  // home; this section is only the managing part.
  if (!token || !canManage) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("share_links")
    .select("id, token, recipient_name, recipient_email, expires_at, revoked_at, view_count, download_count, last_viewed_at, created_at, profiles!share_links_created_by_fkey(full_name)")
    .eq("home_id", homeId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const all = (data ?? []) as unknown as Link[];
  const standing = all.find((l) => l.token === token);
  const older = all.filter((l) => l.expires_at !== null);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const url = `${origin}/s/${token}`;
  const now = Date.now();

  return (
    <section id="share" className="scroll-mt-28 border-b border-line py-8">
      <h3 className="text-lg font-semibold">Share with a realtor</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Copy this home&rsquo;s link with the <b className="font-semibold text-foreground">Share link</b> button at the top and send it to anyone. It opens a
        page with the listing photos, walkthrough video, vertical reel and tour links to download, plus a button to the builder&rsquo;s
        website. No login needed.
      </p>
      {!highlight && notice}
      {undo && canManage && (
        <form action={restoreShareLink} className="mt-2">
          <input type="hidden" name="home_id" value={homeId} />
          <input type="hidden" name="id" value={undo} />
          <PendingButton pending="Putting it back…" className="text-sm font-semibold underline">Undo</PendingButton>
        </form>
      )}

      <div className="mt-4 rounded-2xl border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">See what the realtor sees</a>
          {standing && (
            <span className="text-muted">
              Opened {standing.view_count} {standing.view_count === 1 ? "time" : "times"}
              {standing.last_viewed_at ? ` (last ${dateTime(standing.last_viewed_at)})` : ""} · {standing.download_count}{" "}
              {standing.download_count === 1 ? "download" : "downloads"}
            </span>
          )}
          {standing && (
            <form action={replaceShareLink}>
              <input type="hidden" name="home_id" value={homeId} />
              <input type="hidden" name="id" value={standing.id} />
              <PendingButton
                pending="Making a new link…"
                confirm="Replace this home’s link? The current link stops working right away, and anyone you sent it to will need the new one."
                className="font-semibold text-red-700 underline"
              >
                Replace link
              </PendingButton>
            </form>
          )}
        </div>
      </div>

      {older.length > 0 && (
        <details className="mt-4 rounded-2xl border border-line" open={!!highlight}>
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">
            Older links made for one realtor ({older.length})
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {older.map((l) => {
              const off = !!l.revoked_at;
              const expired = !off && new Date(l.expires_at!).getTime() <= now;
              const live = !off && !expired;
              return (
                <li key={l.id} id={`share-${l.id}`} className={cx("scroll-mt-28 p-4", !live && "bg-soft/60", l.id === highlight && "ring-2 ring-accent ring-inset")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">
                      {l.recipient_name ?? l.recipient_email ?? "Share link"}
                      {l.recipient_name && l.recipient_email && <span className="font-normal text-muted"> · {l.recipient_email}</span>}
                    </span>
                    <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", live ? "bg-emerald-100 text-emerald-800" : "bg-line text-muted")}>
                      {live ? `On until ${dateTime(l.expires_at!)}` : off ? "Turned off" : "Expired"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Opened {l.view_count} {l.view_count === 1 ? "time" : "times"} · {l.download_count} {l.download_count === 1 ? "download" : "downloads"} · made by {l.profiles?.full_name ?? "someone"} {dateTime(l.created_at)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm">
                    <form action={deleteShareLink}>
                      <input type="hidden" name="home_id" value={homeId} />
                      <input type="hidden" name="id" value={l.id} />
                      <PendingButton
                        pending="Deleting…"
                        confirm={live ? "Delete this link? It stops working right away." : "Delete this link?"}
                        className="font-semibold text-red-700 underline"
                      >
                        Delete
                      </PendingButton>
                    </form>
                    {live && (
                      <form action={extendShareLink}>
                        <input type="hidden" name="home_id" value={homeId} />
                        <input type="hidden" name="id" value={l.id} />
                        <PendingButton pending="Adding 30 days…" className="font-semibold underline">Add 30 days</PendingButton>
                      </form>
                    )}
                  </div>
                  {l.id === highlight && <div className="-mt-1">{notice}</div>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
