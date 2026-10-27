import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { cx, dateTime } from "@/lib/format";
import { CopyButton } from "@/components/mls-client";
import { PendingButton } from "@/components/pending-button";
import { createShareLink, deleteShareLink, extendShareLink, restoreShareLink } from "@/app/(app)/homes/[id]/share-actions";

type Link = {
  id: string; token: string; recipient_name: string | null; recipient_email: string | null; message: string | null;
  expires_at: string; revoked_at: string | null; view_count: number; download_count: number; last_viewed_at: string | null;
  created_at: string; profiles: { full_name: string } | null;
};

// "Share with a realtor" on a home: make a private, expiring link to a page
// with this home's photos, walkthrough and reel, and see who opened it.
// highlight: the link just made or changed, marked in the list with the message next to it.
// undo: the link just deleted, offered back next to the message.
export async function ShareLinksPanel({ homeId, canShare, notice, highlight, undo }: { homeId: string; canShare: boolean; notice: React.ReactNode; highlight?: string | null; undo?: string | null }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("share_links")
    .select("id, token, recipient_name, recipient_email, message, expires_at, revoked_at, view_count, download_count, last_viewed_at, created_at, profiles!share_links_created_by_fkey(full_name)")
    .eq("home_id", homeId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const links = (data ?? []) as unknown as Link[];
  if (!canShare && links.length === 0) return null;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const now = Date.now();

  return (
    <section id="share" className="scroll-mt-28 border-b border-line py-8">
      <h3 className="text-lg font-semibold">Share with a realtor</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Make a private link to a page with this home’s listing photos, walkthrough video, vertical reel and tour links, so a realtor can
        download them for their own marketing. No login needed. The link expires, you can turn it off any time, and you’ll see when it’s opened.
      </p>
      {!highlight && notice}
      {undo && canShare && (
        <form action={restoreShareLink} className="mt-2">
          <input type="hidden" name="home_id" value={homeId} />
          <input type="hidden" name="id" value={undo} />
          <PendingButton pending="Putting it back…" className="text-sm font-semibold underline">Undo</PendingButton>
        </form>
      )}

      {canShare && (
        <details className="mt-4 rounded-2xl border border-line" open={links.length === 0 && !highlight}>
          <summary className="cursor-pointer list-none px-4 py-3 font-semibold">+ Make a share link</summary>
          <form action={createShareLink} className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
            <input type="hidden" name="home_id" value={homeId} />
            <label className="block"><span className="mb-1 block text-sm font-medium">Realtor’s name (optional)</span><input name="recipient_name" maxLength={120} placeholder="e.g. Jane Smith, Keller Williams" className="field-input" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium">Their email (optional, for your records)</span><input name="recipient_email" type="email" maxLength={200} className="field-input" /></label>
            <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium">A note on the page (optional)</span><input name="message" maxLength={1000} placeholder="e.g. Thanks for showing this one! Co-op details are in the MLS." className="field-input" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium">Works for</span>
              <select name="days" defaultValue="30" className="field-input">
                <option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option>
              </select>
            </label>
            <div className="flex items-end"><PendingButton pending="Making link…" className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:brightness-110">Make link</PendingButton></div>
            <p className="text-xs text-muted sm:col-span-2">The page shows only this home: what’s on its listing, plus its walkthrough and reel. Nothing else about your company, and no other homes.</p>
          </form>
        </details>
      )}

      {links.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {links.map((l) => {
            const off = !!l.revoked_at;
            const expired = !off && new Date(l.expires_at).getTime() <= now;
            const live = !off && !expired;
            const url = `${origin}/s/${l.token}`;
            return (
              <li key={l.id} id={`share-${l.id}`} className={cx("scroll-mt-28 p-4", !live && "bg-soft/60", l.id === highlight && "rounded-2xl ring-2 ring-accent ring-inset")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {l.recipient_name ?? l.recipient_email ?? "Share link"}
                    {l.recipient_name && l.recipient_email && <span className="font-normal text-muted"> · {l.recipient_email}</span>}
                  </span>
                  <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", live ? "bg-emerald-100 text-emerald-800" : "bg-line text-muted")}>
                    {live ? `On until ${dateTime(l.expires_at)}` : off ? "Turned off" : "Expired"}
                  </span>
                </div>
                {live && (
                  <div className="mt-2 flex items-center gap-2">
                    <input readOnly value={url} className="field-input min-w-0 flex-1 py-1.5 font-mono text-xs" aria-label="Share link" />
                    <CopyButton value={url} label="Copy link" />
                    <a href={url} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-semibold text-accent underline">Preview</a>
                  </div>
                )}
                <p className="mt-2 text-sm text-muted">
                  Opened {l.view_count} {l.view_count === 1 ? "time" : "times"}{l.last_viewed_at ? ` (last ${dateTime(l.last_viewed_at)})` : ""} · {l.download_count} {l.download_count === 1 ? "download" : "downloads"} · made by {l.profiles?.full_name ?? "someone"} {dateTime(l.created_at)}
                </p>
                {canShare && (
                  <div className="mt-2 flex flex-wrap gap-3 text-sm">
                    <form action={deleteShareLink}>
                      <input type="hidden" name="home_id" value={homeId} />
                      <input type="hidden" name="id" value={l.id} />
                      <PendingButton
                        pending="Deleting…"
                        confirm={live ? "Delete this link? It stops working right away, so the realtor won’t be able to open it." : "Delete this link?"}
                        className="font-semibold text-red-700 underline"
                      >
                        Delete
                      </PendingButton>
                    </form>
                    <form action={extendShareLink}>
                      <input type="hidden" name="home_id" value={homeId} />
                      <input type="hidden" name="id" value={l.id} />
                      <PendingButton pending={live ? "Adding 30 days…" : "Turning back on…"} className="font-semibold underline">{live ? "Add 30 days" : "Turn back on for 30 days"}</PendingButton>
                    </form>
                  </div>
                )}
                {l.id === highlight && <div className="-mt-1">{notice}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
