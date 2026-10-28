import { endsText } from "@/lib/incentives";
import { Suspense } from "react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { baths, money, num } from "@/lib/format";
import type { MediaRow } from "@/lib/demo-media";
import { DISCLAIMER_TEXT, DisclaimerOverlay, MediaPicture } from "@/components/media-tile";
import { PhotoPackButton } from "@/components/photo-pack-button";
import { cleanHex, contrast, headingFont, inkSafe, textOn } from "@/lib/brand-theme";
import { ShareGallery, SHARE_SIZES } from "./share-gallery";

// The page a builder shares with a realtor: a branded flyer for one home that
// gets the realtor excited to show it, with everything they need to market it
// (listing photos, walkthrough video, vertical reel, tour links, incentives,
// open houses, a button to the builder's website). It's drawn in the builder's
// own colors, font, logo and tagline from /branding. No login; the link's code
// is checked by the database (public.share_page). Each home has one standing
// link with no end date (older one-off links expire); the builder can replace
// or delete it.

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
  builder: {
    id: string; name: string; logo_updated_at: string | null; icon_updated_at?: string | null; primary_color: string | null; secondary_color?: string | null;
    fonts?: string[]; tagline?: string | null; website_url: string | null;
  };
  media: (Omit<MediaRow, "homes" | "communities" | "builders"> & { vertical: boolean })[];
  tours: { url: string; provider: string; title: string | null; branded: boolean }[];
  incentives?: { title: string; details: string | null; ends_on: string; scope: string }[];
  open_houses?: { starts_at: string; ends_at: string }[];
};

const PROVIDERS: Record<string, string> = { matterport: "Matterport 3D tour", zillow_3d: "Zillow 3D Home", iguide: "iGUIDE tour", cupix: "Cupix tour", youtube: "Video on YouTube", vimeo: "Video on Vimeo", other: "Tour" };
const TZ = "America/Chicago";

// The short line on the hero that says where the home is in its life.
function statusLine(h: Shared["home"]) {
  if (h.market_status === "sold") return "Sold";
  if (h.market_status === "under_contract") return "Under contract";
  if (h.build_stage === "move_in_ready") return "Move-in ready";
  if (h.estimated_completion) {
    const [y, m] = h.estimated_completion.split("-").map(Number);
    const when = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return `Ready ${when}`;
  }
  return h.build_stage === "under_construction" ? "Under construction" : "To be built";
}

function openHouseText(o: { starts_at: string; ends_at: string }) {
  const s = new Date(o.starts_at);
  const e = new Date(o.ends_at);
  const day = s.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });
  const t = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).replace(":00", "").toLowerCase();
  return { day, time: `${t(s)} to ${t(e)}` };
}

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
  // "Mesquite Creek Homes’" rather than "Homes’s".
  const builders = /s$/i.test(builderName) ? `${builderName}\u2019` : `${builderName}\u2019s`;
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
  const incentives = s.incentives ?? [];
  const openHouses = s.open_houses ?? [];

  // The builder's look (set on /branding), made safe to use.
  const brand = cleanHex(s.builder.primary_color) ?? "#3452c7";
  const onBrand = textOn(brand);
  const brandText = inkSafe(brand); // brand color as text on white, or ink if it's too pale
  const second = cleanHex(s.builder.secondary_color);
  const chip = second && contrast(second, brand) >= 1.6 ? second : onBrand;
  const tint = `color-mix(in srgb, ${brand} 7%, white)`;
  const font = headingFont(s.builder.fonts);
  const display = font.family ? { fontFamily: `${font.family}, var(--font-sans)` } : undefined;
  const tagline = s.builder.tagline?.trim() || null;
  const logo = s.builder.logo_updated_at ? `/s/${token}/logo?v=${encodeURIComponent(s.builder.logo_updated_at)}` : null;
  // The square icon (falls back to the main logo) for the footer mark and the browser tab.
  const iconAt = s.builder.icon_updated_at ?? s.builder.logo_updated_at;
  const icon = iconAt ? `/s/${token}/icon?v=${encodeURIComponent(iconAt)}` : null;

  const expires = s.link.expires_at
    ? new Date(s.link.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: TZ })
    : null;
  const remarks = (h.public_remarks ?? "").trim().split(/\n\s*\n/).filter(Boolean);
  const facts = [
    h.bedrooms_total != null && { n: String(h.bedrooms_total), label: h.bedrooms_total === 1 ? "bedroom" : "bedrooms" },
    (h.bathrooms_full != null || h.bathrooms_half != null) && { n: baths(h.bathrooms_full, h.bathrooms_half), label: "baths" },
    h.living_area != null && { n: num(h.living_area), label: "square feet" },
    h.stories != null && { n: String(h.stories), label: h.stories === 1 ? "story" : "stories" },
  ].filter(Boolean) as { n: string; label: string }[];

  const panel = (
    <div className="px-5 py-6 sm:px-8 sm:py-8" style={{ background: brand, color: onBrand }}>
      <span className="inline-block rounded-full px-3 py-1 text-sm font-semibold" style={{ background: chip, color: chip === onBrand ? brand : textOn(chip) }}>
        {statusLine(h)}
      </span>
      <h1 className="mt-3 text-[32px] font-bold leading-[1.05] tracking-tight sm:text-[44px]" style={display}>{h.address}</h1>
      <p className="mt-2 text-[17px] opacity-90">
        {h.city}, TX {h.postal_code}
        <span className="block">in {s.community.name}{h.plan_name ? `, the ${h.plan_name} plan` : ""}</span>
      </p>
      {h.list_price != null && <p className="mt-5 text-[34px] font-bold leading-none tabular-nums sm:text-[40px]" style={display}>{money(h.list_price)}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      {font.href && <link rel="stylesheet" href={font.href} precedence="default" />}
      {icon && <link rel="icon" href={icon} />}

      <header>
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-4 sm:px-8">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={builderName} className="h-12 max-w-[200px] object-contain object-left" />
          ) : (
            <span className="text-xl font-bold tracking-tight" style={{ ...display, color: brandText }}>{builderName}</span>
          )}
          <div className="flex min-w-0 items-center gap-4">
            {tagline && <span className="hidden truncate text-[15px] text-muted md:block" style={display}>{tagline}</span>}
            {website && (
              <a href={website} target="_blank" rel="noreferrer noopener" className="hidden shrink-0 rounded-full border-2 px-4 py-1.5 text-sm font-semibold hover:bg-soft sm:inline-block" style={{ borderColor: brandText, color: brandText }}>
                Visit {builderName}
              </a>
            )}
          </div>
        </div>
      </header>

      {/* The hero: the home's best photo with a sign panel in the builder's color, like the sign in its front yard. */}
      <section className="mx-auto max-w-[1400px] sm:px-8">
        {hero ? (
          <div className="relative">
            <div className="relative aspect-[4/3] overflow-hidden bg-soft sm:aspect-[16/9] sm:rounded-2xl lg:aspect-[2/1]">
              <MediaPicture m={hero} size="web" fileBase={fileBase} priority className="h-full w-full" />
              {h.disclaimer && hero.kind !== "floor_plan" && <DisclaimerOverlay />}
            </div>
            <div className="md:absolute md:bottom-0 md:left-8 md:w-[min(520px,55%)] md:translate-y-1/4 md:overflow-hidden md:rounded-2xl md:shadow-xl">{panel}</div>
          </div>
        ) : (
          <div className="overflow-hidden sm:rounded-2xl">{panel}</div>
        )}
      </section>

      <main className="mx-auto max-w-[1400px] px-4 pb-16 sm:px-8">
        {/* Facts and the two things a realtor came for. */}
        <div className={hero ? "md:ml-[calc(min(520px,55%)+3rem)] md:min-h-[9rem]" : ""}>
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 pt-6 md:pt-8">
            {facts.length > 0 && (
              <dl className="flex flex-wrap gap-x-8 gap-y-3">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt className="sr-only">{f.label}</dt>
                    <dd className="text-[26px] font-bold leading-none tabular-nums" style={display}>{f.n}</dd>
                    <dd className="mt-1 text-sm text-muted">{f.label}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {photos.length > 0 && (
                <PhotoPackButton
                  name={`photos-${slug}`}
                  photos={photos.map((m, i) => ({ id: m.id, file: m.source !== "demo", label: `${String(i + 1).padStart(2, "0")}-${(m.room ?? m.kind).replace(/_/g, "-")}` }))}
                  readme={`Photos of ${h.address}, ${h.city}, from ${builderName}.\nFor marketing this home only.\n`}
                  label={`Download all ${photos.length} photos`}
                  presets={SHARE_SIZES}
                  builderDefault="full"
                  disclaimer={h.disclaimer ? DISCLAIMER_TEXT : undefined}
                  fileBase={fileBase}
                  buttonClassName="rounded-full px-5 py-2.5 text-[15px] font-semibold hover:brightness-110 disabled:opacity-70"
                  buttonStyle={{ background: brand, color: onBrand }}
                />
              )}
            </div>
          </div>
        </div>

        {s.link.message && (
          <blockquote className="mt-10 max-w-3xl border-l-4 py-1 pl-5 text-[17px] leading-relaxed" style={{ borderColor: brandText }}>
            {s.link.message}
            <span className="mt-1 block text-sm text-muted">From {builderName}{s.link.recipient_name ? `, for ${s.link.recipient_name}` : ""}</span>
          </blockquote>
        )}

        {/* The story of the home, with what helps sell it right beside it. */}
        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
          <div className="min-w-0">
            {remarks.length > 0 && (
              <section>
                <h2 className="text-[26px] font-bold tracking-tight" style={display}>About this home</h2>
                <div className="mt-4 max-w-[68ch] space-y-4 text-[16px] leading-[1.7]">
                  {remarks.map((p, i) => (
                    <p key={i} className={i === 0 ? "text-[19px] leading-[1.6]" : "text-foreground/85"}>{p}</p>
                  ))}
                </div>
              </section>
            )}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-6 inline-block rounded-full px-5 py-2.5 text-[15px] font-semibold hover:brightness-110"
                style={{ background: brand, color: onBrand }}
              >
                More info on {builders} website
              </a>
            )}
          </div>

          {(incentives.length > 0 || openHouses.length > 0) && (
            <aside className="space-y-6">
              {incentives.length > 0 && (
                <section className="overflow-hidden rounded-2xl" style={{ background: tint }}>
                  <div className="h-1.5" style={{ background: second ?? brand }} />
                  <div className="p-5">
                    <h2 className="text-[20px] font-bold" style={display}>{incentives.length === 1 ? "Incentive on this home" : "Incentives on this home"}</h2>
                    <ul className="mt-3 space-y-4">
                      {incentives.map((i, n) => (
                        <li key={n}>
                          <p className="text-[17px] font-semibold leading-snug" style={{ color: brandText }}>{i.title}</p>
                          {i.details && <p className="mt-1 whitespace-pre-line text-sm">{i.details}</p>}
                          <p className="mt-1 text-xs text-muted">{endsText(i.ends_on)}</p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 text-xs text-muted">Offered by {builderName}. Terms and end dates can change; check with {builderName} before writing an offer.</p>
                  </div>
                </section>
              )}
              {openHouses.length > 0 && (
                <section className="rounded-2xl border border-line p-5">
                  <h2 className="text-[20px] font-bold" style={display}>Open houses</h2>
                  <ul className="mt-3 divide-y divide-line">
                    {openHouses.map((o) => {
                      const t = openHouseText(o);
                      return (
                        <li key={o.starts_at} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2.5">
                          <span className="font-semibold">{t.day}</span>
                          <span className="text-sm text-muted">{t.time}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-xs text-muted">Bring your buyers. Times are Central.</p>
                </section>
              )}
            </aside>
          )}
        </div>

        {photos.length > 0 && (
          <section className="mt-16">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[26px] font-bold tracking-tight" style={display}>Photos</h2>
              <p className="text-sm text-muted">Tap a photo to see it large and download it at the size you need.</p>
            </div>
            {h.disclaimer && <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">{DISCLAIMER_TEXT} The note is added to downloads too.</p>}
            <div className="mt-5">
              <ShareGallery photos={photos} fileBase={fileBase} disclaimer={h.disclaimer} slug={slug} accent={brandText} />
            </div>
          </section>
        )}

        {(walkthroughs.length > 0 || reels.length > 0) && (
          <section className="mt-16">
            <h2 className="text-[26px] font-bold tracking-tight" style={display}>Video</h2>
            <p className="mt-1 text-sm text-muted">Download them and post them as your own. The reels are sized for Instagram, TikTok and Facebook.</p>
            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
              {walkthroughs.length > 0 && (
                <div className="min-w-0 space-y-6">
                  {walkthroughs.map((v) => (
                    <figure key={v.id}>
                      <video src={`${fileBase}${v.id}`} controls playsInline preload="metadata" className="aspect-video w-full rounded-2xl bg-black" />
                      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium">{v.title} <span className="font-normal text-muted">(walkthrough)</span></span>
                        <a href={`${fileBase}${v.id}?download=1`} className="rounded-full border-2 px-4 py-1.5 font-semibold hover:bg-soft" style={{ borderColor: brandText, color: brandText }}>Download video</a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {reels.length > 0 && (
                <div className="flex flex-wrap gap-6">
                  {reels.map((v) => (
                    <figure key={v.id} className="w-[240px] max-w-full">
                      <video src={`${fileBase}${v.id}`} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-2xl bg-black object-cover" />
                      <figcaption className="mt-2 space-y-2 text-sm">
                        <span className="block font-medium">{v.title} <span className="font-normal text-muted">(social media reel)</span></span>
                        <a href={`${fileBase}${v.id}?download=1`} className="inline-block rounded-full border-2 px-4 py-1.5 font-semibold hover:bg-soft" style={{ borderColor: brandText, color: brandText }}>Download reel</a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {s.tours.length > 0 && (
          <section className="mt-16">
            <h2 className="text-[26px] font-bold tracking-tight" style={display}>Walk through it online</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.tours.map((t) => (
                <a key={t.url} href={t.url} target="_blank" rel="noreferrer noopener" className="rounded-2xl border-2 border-line px-5 py-4 hover:border-current" style={{ color: brandText }}>
                  <span className="block text-[17px] font-semibold">{t.title ?? PROVIDERS[t.provider] ?? "Tour"}</span>
                  <span className="mt-0.5 block text-sm text-muted">{t.branded ? "Branded" : "Unbranded, fine for the MLS"}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {rows.length === 0 && s.tours.length === 0 && (
          <p className="mt-12 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">Photos and video for this home are on the way. Check back soon.</p>
        )}
      </main>

      {/* Sign-off in the builder's color. */}
      <footer style={{ background: brand, color: onBrand }}>
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-6 px-4 py-10 sm:px-8">
          <div className="flex min-w-0 items-center gap-5">
            {icon && (
              <span className="shrink-0 rounded-xl bg-white p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={icon} alt="" className="h-14 w-14 object-contain" />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[22px] font-bold leading-tight" style={display}>{tagline ?? builderName}</p>
              {tagline && <p className="mt-0.5 opacity-85">{builderName}</p>}
            </div>
          </div>
          {website && (
            <a href={website} target="_blank" rel="noreferrer noopener" className="rounded-full px-5 py-2.5 text-[15px] font-semibold hover:opacity-90" style={{ background: onBrand, color: brand }}>
              More info on {builders} website
            </a>
          )}
        </div>
        <div className="mx-auto max-w-[1400px] px-4 pb-8 text-sm opacity-80 sm:px-8">
          Shared by {builderName} for marketing this home.{expires && <> This link works until {expires}.</>}
        </div>
      </footer>
    </div>
  );
}
