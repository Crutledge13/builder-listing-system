import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { HomeSection } from "@/components/home-section";
import { cx, dateTime } from "@/lib/format";
import { PendingButton } from "@/components/pending-button";
import { deleteShareLink, extendShareLink, linkWebsiteListing, replaceShareLink, restoreShareLink, saveWebsitePage } from "@/app/(app)/homes/[id]/share-actions";

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
// Whether an end date has passed. Kept outside the component: this page is drawn
// on the server for each request, so "now" is read once per request here.
function hasPassed(iso: string) {
  return new Date(iso).getTime() <= Date.now();
}

export async function ShareLinksPanel({
  homeId, token, canManage, notice, highlight, undo, fold,
}: { homeId: string; token: string | null; canManage: boolean; notice: React.ReactNode; highlight?: string | null; undo?: string | null; fold?: { badge?: string | null; hint?: string | null; open?: boolean } }) {
  // Everyone copies the link from the "Share link" button at the top of the
  // home; this section is only the managing part.
  if (!token || !canManage) return null;
  const supabase = await createClient();
  const [{ data }, { data: home }, { data: linked }, { data: suggestions }] = await Promise.all([
    supabase
      .from("share_links")
      .select("id, token, recipient_name, recipient_email, expires_at, revoked_at, view_count, download_count, last_viewed_at, created_at, profiles!share_links_created_by_fkey(full_name)")
      .eq("home_id", homeId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("homes").select("website_page_url, builder_id").eq("id", homeId).maybeSingle(),
    supabase.from("website_listings").select("url").eq("home_id", homeId).order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.rpc("website_link_suggestions", { p_home: homeId }),
  ]);
  const { data: brand } = home ? await supabase.from("builder_branding").select("website_url").eq("builder_id", home.builder_id).maybeSingle() : { data: null };
  const feedPage = linked?.url && /^https?:\/\//i.test(linked.url) ? linked.url : null;
  const suggestion = ((suggestions ?? []) as { website_listing_id: string; website_url: string | null }[])[0] ?? null;
  const all = (data ?? []) as unknown as Link[];
  const standing = all.find((l) => l.token === token);
  const older = all.filter((l) => l.expires_at !== null);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const url = `${origin}/s/${token}`;

  return (
    <HomeSection id="share" title="Share with a realtor" badge={fold?.badge} hint={fold?.hint} open={fold?.open}>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Copy this home&rsquo;s link with the <b className="font-semibold text-foreground">Share link</b> button at the top and send it to anyone. It opens a
        page with the listing photos, walkthrough video, vertical reel, tour links and the community&rsquo;s photos and video to download,
        plus a button to the builder&rsquo;s website. No login needed.
        {canManage && <> Choose what it shows in <Link href="/realtor-page" className="font-semibold text-foreground underline">Realtor page settings</Link>.</>}
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

      {/* Where the share page's "More info on the builder's website" button goes. */}
      <div id="website-page" className="mt-4 scroll-mt-28 rounded-2xl border border-line p-4">
        <h4 className="text-sm font-semibold">&ldquo;More info&rdquo; button on the share page</h4>
        {feedPage ? (
          <p className="mt-1 text-sm text-muted">
            Goes to this home&rsquo;s page on your website (from your connected website):{" "}
            <a href={feedPage} target="_blank" rel="noreferrer noopener" className="break-all font-medium text-foreground underline">{feedPage.replace(/^https?:\/\//, "")}</a>
          </p>
        ) : (
          <>
            {suggestion && (
              <div className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                <p>
                  We found this address on your website
                  {suggestion.website_url && <>: <a href={suggestion.website_url} target="_blank" rel="noreferrer noopener" className="break-all underline">{suggestion.website_url.replace(/^https?:\/\//, "")}</a></>}.
                  {" "}Is it the same home?
                </p>
                <form action={linkWebsiteListing} className="mt-2">
                  <input type="hidden" name="home_id" value={homeId} />
                  <input type="hidden" name="website_listing_id" value={suggestion.website_listing_id} />
                  <PendingButton pending="Linking…" className="rounded-lg bg-foreground px-3 py-1.5 font-semibold text-white hover:bg-black">Yes, link them</PendingButton>
                </form>
              </div>
            )}
            <p className="mt-1 text-sm text-muted">
              {home?.website_page_url
                ? "Goes to this home’s page on your website:"
                : brand?.website_url
                  ? `Goes to your main website (${brand.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}). Paste this home’s own page to send realtors straight to it.`
                  : "There’s no website yet, so the button is hidden. Paste this home’s page on your website to show it."}
            </p>
            <form action={saveWebsitePage} className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="home_id" value={homeId} />
              <input
                name="website_page_url"
                type="url"
                inputMode="url"
                maxLength={500}
                defaultValue={home?.website_page_url ?? ""}
                placeholder="https://www.yourbuilder.com/homes/123-main-st"
                aria-label="This home's page on your website"
                className="field-input min-w-0 flex-1 py-2 text-sm"
              />
              <PendingButton pending="Saving…" className="rounded-lg border border-foreground px-3 py-2 text-sm font-semibold hover:bg-soft">Save link</PendingButton>
            </form>
            {home?.website_page_url && <p className="mt-1 text-xs text-muted">Clear the box and save to go back to your main website.</p>}
          </>
        )}
      </div>

      {older.length > 0 && (
        <details className="mt-4 rounded-2xl border border-line" open={!!highlight}>
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">
            Older links made for one realtor ({older.length})
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {older.map((l) => {
              const off = !!l.revoked_at;
              const expired = !off && hasPassed(l.expires_at!);
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
    </HomeSection>
  );
}
