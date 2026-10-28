import { endsText } from "@/lib/incentives";
import { Suspense } from "react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { baths, money, num } from "@/lib/format";
import type { MediaRow } from "@/lib/demo-media";
import { DISCLAIMER_TEXT, DisclaimerOverlay, MediaPicture } from "@/components/media-tile";
import { PhotoPackButton } from "@/components/photo-pack-button";
import { ShareGallery, SHARE_SIZES } from "./share-gallery";

// The page a builder shares with a realtor: one home's listing photos,
// walkthrough video, vertical reel and tour links, ready to download for the
// realtor's own marketing. No login; the link's code is checked by the
// database (public.share_page). Each home has one standing link with no end date (older one-off links expire); the builder can replace or delete it.

export const metadata: Metadata = {
  title: "Listing media",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

type Shared = {
  link: { recipient_name: string | null; message: string | null; expires_at: string | null };
  home: {
    id: string; address: string; city: string; postal_code: string; plan_name: string | null; list_price: number | null;
    bedrooms_total: number | null; bathrooms_full: number | null; bathrooms_half: number | null; living_area: number | null;
    stories: number | null; build_stage: string; estimated_completion: string | null; public_remarks: string | null;
    disclaimer: boolean; market_status: string | null;
  };
  community: { name: string; city: string };
  builder: { id: string; name: string; logo_updated_at: string | null; primary_color: string | null; website_url: string | null };
  media: (Omit<MediaRow, "homes" | "communities" | "builders"> & { vertical: boolean })[];
  tours: { url: string; provider: string; title: string | null; branded: boolean }[];
  incentives?: { title: string; details: string | null; ends_on: string; scope: string }[];
};

const STAGE: Record<string, string> = { to_be_built: "To be built", under_construction: "Under construction", move_in_ready: "Move-in ready" };
const PROVIDERS: Record<string, string> = { matterport: "Matterport 3D tour", zillow_3d: "Zillow 3D Home", iguide: "iGUIDE tour", cupix: "Cupix tour", youtube: "Video (YouTube)", vimeo: "Video (Vimeo)", other: "Tour" };

export default function SharePage(props: PageProps<"/s/[token]">) {
  return (
    <Suspense fallback={<div className="mx-auto mt-16 h-96 max-w-5xl animate-pulse rounded-2xl bg-soft" />}>
      <Share params={props.params} />
    </Suspense>
  );
}

async function Share({ params }: { params: PageProps<"/s/[token]">["params"] }) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data }, { data: websiteData }] = await Promise.all([
    supabase.rpc("share_page", { p_token: token }),
    supabase.rpc("share_website", { p_token: token }),
  ]);
  const s = data as Shared | null;
  // The home's own page on the builder's website when we know it, otherwise their main site.
  const website = typeof websiteData === "string" && /^https?:\/\//i.test(websiteData) ? websiteData : null;

  if (!s) {
    return (
      <main className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-[28px] font-bold tracking-tight">This link isn’t available</h1>
        <p className="mt-3 text-muted">It may have expired or been turned off. Ask the builder who sent it for a new one.</p>
      </main>
    );
  }

  const h = s.home;
  const builderName = s.builder.name.replace(" (demo)", "");
  const fileBase = `/s/${token}/file/`;
  const slug = h.address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Shape each item like the rest of the app, so drawn demo pictures look the same.
  const rows: (MediaRow & { vertical: boolean })[] = s.media.map((m) => ({
    ...m,
    homes: { unparsed_address: h.address, stories: h.stories, plan_name: h.plan_name, bedrooms_total: h.bedrooms_total, bathrooms_full: h.bathrooms_full, bathrooms_half: h.bathrooms_half, living_area: h.living_area },
    communities: { name: s.community.name },
    builders: { name: builderName },
  })) as (MediaRow & { vertical: boolean })[];
  const photos = rows.filter((m) => m.kind !== "video");
  const reels = rows.filter((m) => m.kind === "video" && m.vertical);
  const walkthroughs = rows.filter((m) => m.kind === "video" && !m.vertical);
  const hero = photos[0];
  const accent = s.builder.primary_color ?? "#3452c7";
  const expires = s.link.expires_at
    ? new Date(s.link.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" })
    : null;
  const websiteButton = website ? (
    <a
      href={website}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"
      style={{ background: accent }}
    >
      More info on {builderName}&rsquo;s website <span aria-hidden>↗</span>
    </a>
  ) : null;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          {s.builder.logo_updated_at ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/s/${token}/logo?v=${encodeURIComponent(s.builder.logo_updated_at)}`} alt={builderName} className="h-10 max-w-[180px] object-contain" />
          ) : (
            <span className="text-lg font-bold tracking-tight">{builderName}</span>
          )}
          {s.link.recipient_name && <span className="text-sm text-muted">Shared with {s.link.recipient_name}</span>}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8">
        {hero && (
          <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-soft sm:aspect-[21/9]">
            <MediaPicture m={hero} size="web" fileBase={fileBase} className="h-full w-full" />
            {h.disclaimer && hero.kind !== "floor_plan" && <DisclaimerOverlay />}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ background: accent }}>{STAGE[h.build_stage] ?? "New construction"}</span>
            <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight sm:text-[34px]">{h.address}</h1>
            <p className="text-muted">{h.city}, TX {h.postal_code} · {s.community.name}{h.plan_name ? ` · ${h.plan_name} plan` : ""}</p>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
              {h.bedrooms_total != null && <span><b>{h.bedrooms_total}</b> beds</span>}
              {(h.bathrooms_full != null || h.bathrooms_half != null) && <span><b>{baths(h.bathrooms_full, h.bathrooms_half)}</b> baths</span>}
              {h.living_area != null && <span><b>{num(h.living_area)}</b> sq ft</span>}
              {h.stories != null && <span><b>{h.stories}</b> {h.stories === 1 ? "story" : "stories"}</span>}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            {h.list_price != null && <p className="text-[28px] font-bold tabular-nums">{money(h.list_price)}</p>}
            {websiteButton}
          </div>
        </div>

        {s.link.message && (
          <blockquote className="mt-6 rounded-2xl border-l-4 bg-soft px-5 py-4 text-[15px]" style={{ borderColor: accent }}>
            {s.link.message}
            <span className="mt-1 block text-sm text-muted">From {builderName}</span>
          </blockquote>
        )}
        {h.public_remarks && <p className="mt-6 max-w-3xl whitespace-pre-line text-[15px] leading-relaxed">{h.public_remarks}</p>}

        {(s.incentives ?? []).length > 0 && (
          <section className="mt-8 max-w-3xl">
            <h2 className="text-[22px] font-semibold">Current incentives</h2>
            <ul className="mt-3 space-y-2">
              {(s.incentives ?? []).map((i, n) => (
                <li key={n} className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">{i.title}</span>
                    <span className="text-xs text-muted">{endsText(i.ends_on)}</span>
                  </div>
                  {i.details && <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{i.details}</p>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">Offered by {builderName}. Terms and end dates can change; check with {builderName} before writing an offer.</p>
          </section>
        )}

        {photos.length > 0 && (
          <section className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[22px] font-semibold">Photos <span className="font-normal text-muted">{photos.length}</span></h2>
              <PhotoPackButton
                name={`photos-${slug}`}
                photos={photos.map((m, i) => ({ id: m.id, file: m.source !== "demo", label: `${String(i + 1).padStart(2, "0")}-${(m.room ?? m.kind).replace(/_/g, "-")}` }))}
                readme={`Photos of ${h.address}, ${h.city}, from ${builderName}.\nFor marketing this home only.\n`}
                label="Download all photos (.zip)"
                presets={SHARE_SIZES}
                builderDefault="full"
                disclaimer={h.disclaimer ? DISCLAIMER_TEXT : undefined}
                fileBase={fileBase}
              />
            </div>
            <p className="mt-1 text-sm text-muted">Tap a photo to see it large and download it at the size you need.</p>
            {h.disclaimer && <p className="mt-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">{DISCLAIMER_TEXT} The note is added to downloads too.</p>}
            <div className="mt-4">
              <ShareGallery photos={photos} fileBase={fileBase} disclaimer={h.disclaimer} slug={slug} />
            </div>
          </section>
        )}

        {(walkthroughs.length > 0 || reels.length > 0) && (
          <section className="mt-12">
            <h2 className="text-[22px] font-semibold">Video</h2>
            <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_auto]">
              {walkthroughs.length > 0 && (
                <div className="space-y-6">
                  {walkthroughs.map((v) => (
                    <figure key={v.id}>
                      <video src={`${fileBase}${v.id}`} controls playsInline preload="metadata" className="aspect-video w-full rounded-2xl bg-black" />
                      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium">{v.title} <span className="font-normal text-muted">· Walkthrough (horizontal)</span></span>
                        <a href={`${fileBase}${v.id}?download=1`} className="rounded-full border border-foreground px-4 py-1.5 font-semibold hover:bg-soft">Download video</a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {reels.length > 0 && (
                <div className="flex flex-wrap gap-6">
                  {reels.map((v) => (
                    <figure key={v.id} className="w-[260px]">
                      <video src={`${fileBase}${v.id}`} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-2xl bg-black object-cover" />
                      <figcaption className="mt-2 space-y-2 text-sm">
                        <span className="block font-medium">{v.title} <span className="font-normal text-muted">· Social media reel (9:16), ready to post</span></span>
                        <a href={`${fileBase}${v.id}?download=1`} className="inline-block rounded-full border border-foreground px-4 py-1.5 font-semibold hover:bg-soft">Download reel</a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {s.tours.length > 0 && (
          <section className="mt-12">
            <h2 className="text-[22px] font-semibold">Tours</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              {s.tours.map((t) => (
                <a key={t.url} href={t.url} target="_blank" rel="noreferrer noopener" className="rounded-xl border border-line px-4 py-3 text-sm font-semibold hover:border-foreground">
                  {t.title ?? PROVIDERS[t.provider] ?? "Tour"} ↗
                  <span className="block text-xs font-normal text-muted">{t.branded ? "Branded" : "Unbranded (MLS-friendly)"}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {photos.length === 0 && rows.length === 0 && s.tours.length === 0 && (
          <p className="mt-10 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">Photos and video for this home are on the way. Check back soon.</p>
        )}

        <footer className="mt-16 border-t border-line pt-6 text-sm text-muted">
          <p>
            Shared by {builderName} for marketing this home.{expires && <> This link works until {expires}.</>}
            {website && <> For more information, visit <a href={website} target="_blank" rel="noreferrer noopener" className="underline">{website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>.</>}
          </p>
        </footer>
      </main>
    </div>
  );
}
