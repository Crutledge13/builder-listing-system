import { endsText } from "@/lib/incentives";
import { Suspense } from "react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { baths, cx, money, num } from "@/lib/format";
import type { MediaRow } from "@/lib/demo-media";
import { DISCLAIMER_TEXT, DisclaimerOverlay, MediaPicture } from "@/components/media-tile";
import { PhotoPackButton } from "@/components/photo-pack-button";
import { cleanHex, contrast, headingFont, INK, inkSafe, textOn } from "@/lib/brand-theme";
import { socialPostIdeas } from "@/lib/social-posts";
import { CopyPost, SharePageButton } from "./share-buttons";
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
  media: (Omit<MediaRow, "homes" | "communities" | "builders"> & { vertical: boolean; for_community?: boolean })[];
  tours: Tour[];
  community_tours?: Tour[];
  // What the builder's marketing team chose to show (Realtor page settings). Missing = all on.
  settings?: Partial<Record<"community" | "photos" | "walkthrough" | "reels" | "tours" | "incentives" | "open_houses" | "post_ideas" | "website", boolean>>;
  incentives?: { title: string; details: string | null; ends_on: string; scope: string }[];
  open_houses?: { starts_at: string; ends_at: string }[];
};

type Tour = { url: string; provider: string; title: string | null; branded: boolean };

const PROVIDERS: Record<string, string> = { matterport: "Matterport 3D tour", zillow_3d: "Zillow 3D Home", iguide: "iGUIDE tour", cupix: "Cupix tour", youtube: "Video on YouTube", vimeo: "Video on Vimeo", other: "Tour" };
const TZ = "America/Chicago";

// The short line on the hero that says where the home is in its life.
type Contact = { name: string; title: string | null; phone: string | null; email: string | null };

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
  const [{ data }, { data: websiteData }, { data: contactData }] = await Promise.all([
    supabase.rpc("share_page", { p_token: token }),
    supabase.rpc("share_website", { p_token: token }),
    // Who to call: the salesperson who sent it, or the community's sales team.
    supabase.rpc("share_contacts", { p_token: token }),
  ]);
  const contacts = (Array.isArray(contactData) ? contactData : []) as Contact[];
  const s = data as Shared | null;
  // The home's own page on the builder's website when we know it, otherwise their main site.
  const showWebsite = (data as Shared | null)?.settings?.website !== false;
  const website = showWebsite && typeof websiteData === "string" && /^https?:\/\//i.test(websiteData) ? websiteData : null;

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
  const all: (MediaRow & { vertical: boolean; for_community?: boolean })[] = s.media.map((m) => ({
    ...m,
    homes: { unparsed_address: h.address, stories: h.stories, plan_name: h.plan_name, bedrooms_total: h.bedrooms_total, bathrooms_full: h.bathrooms_full, bathrooms_half: h.bathrooms_half, living_area: h.living_area },
    communities: { name: s.community.name },
    builders: { name: builderName },
  })) as (MediaRow & { vertical: boolean; for_community?: boolean })[];
  // This home's items, and the community section's (the community's own photos and video).
  const rows = all.filter((m) => !m.for_community);
  const communityRows = all.filter((m) => m.for_community);
  const communityPhotos = communityRows.filter((m) => m.kind !== "video");
  const communityVideos = communityRows.filter((m) => m.kind === "video" && !m.vertical);
  const communityReels = communityRows.filter((m) => m.kind === "video" && m.vertical);
  const communityTours = s.community_tours ?? [];
  const hasCommunity = communityRows.length > 0 || communityTours.length > 0;
  const communitySlug = `${s.community.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const photos = rows.filter((m) => m.kind !== "video");
  const reels = rows.filter((m) => m.kind === "video" && m.vertical);
  const walkthroughs = rows.filter((m) => m.kind === "video" && !m.vertical);
  // The home's best photo; if the builder hides the home's photos, the community's.
  const hero = photos[0] ?? communityPhotos[0];
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
  const bathsN = h.bathrooms_full != null || h.bathrooms_half != null ? baths(h.bathrooms_full, h.bathrooms_half) : null;
  const facts = [
    h.bedrooms_total != null && { n: String(h.bedrooms_total), label: h.bedrooms_total === 1 ? "Bedroom" : "Bedrooms", icon: ICONS.bed },
    bathsN && { n: bathsN, label: bathsN === "1" ? "Bathroom" : "Bathrooms", icon: ICONS.bath },
    h.living_area != null && { n: num(h.living_area), label: "Square feet", icon: ICONS.area },
    h.stories != null && { n: String(h.stories), label: h.stories === 1 ? "Story" : "Stories", icon: ICONS.stories },
  ].filter(Boolean) as { n: string; label: string; icon: React.ReactNode }[];
  const ideas = s.settings?.post_ideas === false ? [] : socialPostIdeas(h, s.community.name, builderName, { incentives, openHouses, hasReel: reels.length > 0, photoCount: photos.length });
  const [tour, ...moreTours] = s.tours;
  const tourThumb = photos[1] ?? hero;

  const panel = (
    <div className="px-5 py-6 sm:px-7 sm:py-7" style={{ background: brand, color: onBrand }}>
      <span className="inline-block rounded-full px-3 py-1 text-sm font-semibold" style={{ background: chip, color: chip === onBrand ? brand : textOn(chip) }}>
        {statusLine(h)}
      </span>
      <h1 className="mt-3 text-[30px] font-bold leading-[1.08] tracking-tight sm:text-[36px]" style={display}>{h.address}</h1>
      <p className="mt-2 text-[16px] opacity-90">
        {h.city}, TX {h.postal_code}
        <span className="block">in {s.community.name}{h.plan_name ? `, the ${h.plan_name} plan` : ""}</span>
      </p>
      {h.list_price != null && <p className="mt-4 text-[34px] font-bold leading-none tabular-nums sm:text-[38px]" style={display}>{money(h.list_price)}</p>}
    </div>
  );

  // Beds, baths, square feet and the download, on a see-through bar over the photo.
  const factBar = (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-4 text-white sm:px-6">
      {facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          {facts.map((f) => (
            <div key={f.label} className="flex items-center gap-3">
              <span className="opacity-85">{f.icon}</span>
              <div>
                <dt className="sr-only">{f.label}</dt>
                <dd className="text-[22px] font-bold leading-none tabular-nums" style={display}>{f.n}</dd>
                <dd className="mt-1 text-sm opacity-85">{f.label}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
      {photos.length > 0 && (
        <div className="text-foreground">
        <PhotoPackButton
          name={`photos-${slug}`}
          photos={photos.map((m, i) => ({ id: m.id, file: m.source !== "demo", label: `${String(i + 1).padStart(2, "0")}-${(m.room ?? m.kind).replace(/_/g, "-")}` }))}
          readme={`Photos of ${h.address}, ${h.city}, from ${builderName}.\nFor marketing this home only.\n`}
          label={`Download all ${photos.length} photos`}
          presets={SHARE_SIZES}
          builderDefault="full"
          disclaimer={h.disclaimer ? DISCLAIMER_TEXT : undefined}
          fileBase={fileBase}
          buttonClassName="rounded-lg px-5 py-2.5 text-[15px] font-semibold hover:brightness-110 disabled:opacity-70"
          buttonStyle={{ background: brand === "#ffffff" ? INK : brand, color: textOn(brand === "#ffffff" ? INK : brand) }}
        />
        </div>
      )}
    </div>
  );

  // Social post ideas, with the reel beside them when there is one.
  const postSection = (ideas.length > 0 || reels.length > 0) && (
    <section className="rounded-2xl p-5 sm:p-7" style={{ background: tint }}>
      <h2 className="text-[24px] font-bold tracking-tight" style={display}>{reels.length > 0 ? "Ready to post" : "Social post ideas"}</h2>
      <p className="mt-1 text-sm text-muted">
        {reels.length > 0 ? "A vertical reel sized for Instagram, TikTok and Facebook, and posts written from this home’s details. " : "Posts written from this home’s details. "}
        Add your name and brokerage before posting.
      </p>
      <div className={cx("mt-5 grid gap-6", reels.length > 0 && "md:grid-cols-[auto_minmax(0,1fr)]")}>
        {reels.length > 0 && (
          <div className="flex flex-wrap gap-4">
            {reels.map((v) => (
              <figure key={v.id} className="w-[200px] max-w-full">
                <video src={`${fileBase}${v.id}#t=0.5`} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-xl bg-black object-cover" />
                <a href={`${fileBase}${v.id}?download=1`} className="mt-2 block rounded-lg py-2 text-center text-sm font-semibold hover:brightness-110" style={{ background: brand, color: onBrand }}>Download reel</a>
              </figure>
            ))}
          </div>
        )}
        {ideas.length > 0 && (
          <ul className={cx("grid gap-4", reels.length === 0 ? "lg:grid-cols-3" : "xl:grid-cols-3")}>
            {ideas.map((p) => (
              <li key={p.title} className="flex flex-col rounded-xl bg-white p-4 shadow-sm">
                <div>
                  <p className="font-semibold">{p.title}</p>
                  <span className="block text-xs text-muted">{p.pair === "reel" ? "Pair with the reel" : p.pair === "photos" ? "Pair with 4 to 10 photos" : "Pair with photo 1"}</span>
                </div>
                <p className="mt-2 flex-1 whitespace-pre-line text-[13.5px] leading-relaxed">{p.text}</p>
                <div className="mt-3"><CopyPost text={p.text} color={brandText} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );

  const about = (
    <div>
      {remarks.length > 0 ? (
        <>
          <h2 className="text-[26px] font-bold tracking-tight" style={display}>About this home</h2>
          <div className="mt-3 max-w-[68ch] space-y-4 text-[16px] leading-[1.7] text-foreground/90">
            {remarks.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </>
      ) : (
        <h2 className="text-[26px] font-bold tracking-tight" style={display}>{h.plan_name ? `The ${h.plan_name} plan` : "About this home"} in {s.community.name}</h2>
      )}
      {website && (
        <a href={website} target="_blank" rel="noreferrer noopener" className="mt-5 inline-flex items-center gap-1.5 font-semibold underline underline-offset-4" style={{ color: brandText }}>
          More info on {builders} website
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg>
        </a>
      )}
      {contacts.length > 0 && (
        <section className="mt-8 rounded-2xl border border-line p-5">
          <h3 className="text-[19px] font-bold" style={display}>{contacts.length === 1 ? "Your contact for this home" : "Your contacts for this home"}</h3>
          <ul className={cx("mt-3 grid gap-4", contacts.length > 1 && "sm:grid-cols-2")}>
            {contacts.map((c) => (
              <li key={`${c.name}-${c.email ?? ""}`} className="flex gap-3">
                <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: brand, color: onBrand }}>
                  {c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block text-[16px] font-semibold leading-snug">{c.name}</span>
                  {c.title && <span className="block text-muted">{c.title}, {builderName}</span>}
                  {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="mt-1 block font-semibold underline underline-offset-4" style={{ color: brandText }}>{c.phone}</a>}
                  {c.email && <a href={`mailto:${c.email}`} className="block break-all underline underline-offset-4" style={{ color: brandText }}>{c.email}</a>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {incentives.length > 0 && (
        <section className="mt-8 overflow-hidden rounded-2xl" style={{ background: tint }}>
          <div className="h-1.5" style={{ background: second ?? brand }} />
          <div className="p-5">
            <h3 className="text-[19px] font-bold" style={display}>{incentives.length === 1 ? "Incentive on this home" : "Incentives on this home"}</h3>
            <ul className="mt-3 space-y-3">
              {incentives.map((i, n) => (
                <li key={n}>
                  <p className="text-[16px] font-semibold leading-snug" style={{ color: brandText }}>{i.title}</p>
                  {i.details && <p className="mt-0.5 whitespace-pre-line text-sm">{i.details}</p>}
                  <p className="mt-0.5 text-xs text-muted">{endsText(i.ends_on)}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Offered by {builderName}. Terms and end dates can change; check with {builderName} before writing an offer.</p>
          </div>
        </section>
      )}
      {openHouses.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line p-5">
          <h3 className="text-[19px] font-bold" style={display}>Open houses</h3>
          <ul className="mt-2 divide-y divide-line">
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
          <p className="mt-1 text-xs text-muted">Bring your buyers. Times are Central.</p>
        </section>
      )}
    </div>
  );

  return (
    <div id="top" className="min-h-screen bg-white">
      {font.href && <link rel="stylesheet" href={font.href} precedence="default" />}
      {icon && <link rel="icon" href={icon} />}

      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-8">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={builderName} className="h-11 max-w-[220px] object-contain object-left" />
          ) : (
            <span className="text-xl font-bold tracking-tight" style={{ ...display, color: brandText }}>{builderName}</span>
          )}
          <div className="flex min-w-0 items-center gap-3">
            {tagline && <span className="hidden truncate text-[15px] text-muted md:block" style={display}>{tagline}</span>}
            <SharePageButton color={brandText} />
          </div>
        </div>
      </header>

      {/* The hero: the home's best photo, the sign panel in the builder's color at the top right, and the facts on a bar across the bottom. */}
      <section className="relative">
        {hero ? (
          <>
            <div className="relative aspect-[4/3] overflow-hidden bg-soft sm:aspect-[16/9] lg:aspect-auto lg:h-[min(640px,72vh)]">
              <span data-media-id={hero.id} className="block h-full w-full">
                <MediaPicture m={hero} size="web" fileBase={fileBase} priority className="h-full w-full" />
              </span>
              {h.disclaimer && hero.kind !== "floor_plan" && !hero.for_community && <span className="lg:hidden"><DisclaimerOverlay /></span>}
            </div>
            <div className="lg:absolute lg:right-8 lg:top-6 lg:w-[420px] lg:overflow-hidden lg:rounded-2xl lg:shadow-2xl">{panel}</div>
            <div className="bg-[#1e2125] lg:absolute lg:inset-x-8 lg:bottom-6 lg:rounded-2xl lg:bg-black/55 lg:backdrop-blur-md">
              {factBar}
              {h.disclaimer && hero.kind !== "floor_plan" && !hero.for_community && <p className="hidden px-6 pb-3 text-xs text-white/80 lg:block">{DISCLAIMER_TEXT}</p>}
            </div>
          </>
        ) : (
          <>
            {panel}
            <div className="bg-[#1e2125]">{factBar}</div>
          </>
        )}
      </section>

      <main className="mx-auto max-w-[1400px] px-4 pb-16 sm:px-8">
        {s.link.message && (
          <blockquote className="mt-8 max-w-3xl border-l-4 py-1 pl-5 text-[17px] leading-relaxed" style={{ borderColor: brandText }}>
            {s.link.message}
            <span className="mt-1 block text-sm text-muted">From {builderName}{s.link.recipient_name ? `, for ${s.link.recipient_name}` : ""}</span>
          </blockquote>
        )}

        {/* A ready-to-post reel goes near the top, owners asked (28 Oct 2026). */}
        {reels.length > 0 && <div className="mt-8">{postSection}</div>}

        <div className="mt-10">
          {h.disclaimer && photos.length > 0 && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">{DISCLAIMER_TEXT} The note is added to downloads too.</p>}
          <ShareGallery photos={photos} fileBase={fileBase} disclaimer={h.disclaimer} slug={slug} accent={brandText}>
            {about}
          </ShareGallery>
        </div>

        {tour && (
          <section className="mt-12 rounded-2xl p-3 sm:p-4" style={{ background: tint }}>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {tourThumb && (
                <a href={tour.url} target="_blank" rel="noreferrer noopener" className="relative block aspect-[16/9] w-full shrink-0 overflow-hidden rounded-xl bg-soft sm:w-[300px]" aria-label="Open the tour">
                  <MediaPicture m={tourThumb} fileBase={fileBase} className="h-full w-full" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/15">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-lg" style={{ color: brandText }}>
                      <svg aria-hidden viewBox="0 0 24 24" className="ml-1 h-7 w-7" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>
                    </span>
                  </span>
                </a>
              )}
              <div className="min-w-0 flex-1 px-2 sm:px-0">
                <h2 className="text-[24px] font-bold tracking-tight" style={{ ...display, color: brandText }}>{tour.title ?? PROVIDERS[tour.provider] ?? "Tour"}</h2>
                <p className="mt-1 text-muted">{tour.provider === "youtube" || tour.provider === "vimeo" ? "Watch the video tour of this home." : "Walk through this home online with an interactive 3D tour."}</p>
                {moreTours.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {moreTours.map((t) => (
                      <a key={t.url} href={t.url} target="_blank" rel="noreferrer noopener" className="font-semibold underline underline-offset-4" style={{ color: brandText }}>{t.title ?? PROVIDERS[t.provider] ?? "Tour"}</a>
                    ))}
                  </p>
                )}
              </div>
              <a href={tour.url} target="_blank" rel="noreferrer noopener" className="mx-2 mb-2 shrink-0 rounded-xl px-5 py-3 text-center text-[15px] font-semibold hover:brightness-110 sm:m-0 sm:mr-3" style={{ background: brand, color: onBrand }}>
                {tour.provider === "youtube" || tour.provider === "vimeo" ? "Watch the tour" : "Open the 3D tour"}
              </a>
            </div>
          </section>
        )}

        {walkthroughs.length > 0 && (
          <section className="mt-12">
            <h2 className="text-[26px] font-bold tracking-tight" style={display}>Video walkthrough</h2>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              {walkthroughs.map((v) => (
                <figure key={v.id} className="min-w-0">
                  <video src={`${fileBase}${v.id}#t=0.5`} controls playsInline preload="metadata" className="aspect-video w-full rounded-2xl bg-black" />
                  <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{v.title}</span>
                    <a href={`${fileBase}${v.id}?download=1`} className="rounded-full border-2 px-4 py-1.5 font-semibold hover:bg-soft" style={{ borderColor: brandText, color: brandText }}>Download video</a>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {reels.length === 0 && postSection && <div className="mt-12">{postSection}</div>}

        {/* The community as a whole (owners, 29 Oct 2026): its own photos, video and
            tours, so a realtor can market the community and point buyers to this home. */}
        {hasCommunity && (
          <section id="community" className="mt-16 scroll-mt-6 border-t border-line pt-12">
            <p className="text-sm font-semibold uppercase tracking-[0.12em]" style={{ color: brandText }}>The community</p>
            <h2 className="mt-1 text-[30px] font-bold leading-tight tracking-tight" style={display}>{s.community.name}</h2>
            <p className="mt-2 max-w-[68ch] text-[16px] leading-relaxed text-muted">
              {s.community.city}, Texas. Photos and video of the whole community, to market {s.community.name} and point
              interested buyers to {h.address}.
            </p>

            {(communityVideos.length > 0 || communityReels.length > 0) && (
              <div className={cx("mt-8 grid gap-6", communityVideos.length > 0 && communityReels.length > 0 && "lg:grid-cols-[minmax(0,1fr)_auto]")}>
                {communityVideos.length > 0 && (
                  <div className="grid min-w-0 gap-6">
                    {communityVideos.map((v) => (
                      <figure key={v.id} className="min-w-0">
                        <video src={`${fileBase}${v.id}#t=0.5`} controls playsInline preload="metadata" className="aspect-video w-full rounded-2xl bg-black" />
                        <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="font-medium">{v.title}</span>
                          <a href={`${fileBase}${v.id}?download=1`} className="rounded-full border-2 px-4 py-1.5 font-semibold hover:bg-soft" style={{ borderColor: brandText, color: brandText }}>Download video</a>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                {communityReels.length > 0 && (
                  <div className="flex flex-wrap gap-4">
                    {communityReels.map((v) => (
                      <figure key={v.id} className="w-[200px] max-w-full">
                        <video src={`${fileBase}${v.id}#t=0.5`} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-xl bg-black object-cover" />
                        <a href={`${fileBase}${v.id}?download=1`} className="mt-2 block rounded-lg py-2 text-center text-sm font-semibold hover:brightness-110" style={{ background: brand, color: onBrand }}>Download reel</a>
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            )}

            {communityPhotos.length > 0 && (
              <div className="mt-8">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[20px] font-bold" style={display}>Community photos</h3>
                  <PhotoPackButton
                    name={`photos-${communitySlug}`}
                    photos={communityPhotos.map((m, i) => ({ id: m.id, file: m.source !== "demo", label: `${String(i + 1).padStart(2, "0")}-${(m.room ?? m.kind).replace(/_/g, "-")}` }))}
                    readme={`Photos of ${s.community.name}, ${s.community.city}, from ${builderName}.\nFor marketing the community and its homes.\n`}
                    label={`Download all ${communityPhotos.length} community photos`}
                    presets={SHARE_SIZES}
                    builderDefault="full"
                    fileBase={fileBase}
                    buttonClassName="rounded-lg border-2 px-4 py-2 text-sm font-semibold hover:bg-soft disabled:opacity-70"
                    buttonStyle={{ borderColor: brandText, color: brandText }}
                  />
                </div>
                <ShareGallery photos={communityPhotos} fileBase={fileBase} disclaimer={false} slug={communitySlug} accent={brandText} heroShown={false} />
              </div>
            )}

            {communityTours.length > 0 && (
              <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px]">
                <span className="font-semibold">Tour the community:</span>
                {communityTours.map((t) => (
                  <a key={t.url} href={t.url} target="_blank" rel="noreferrer noopener" className="font-semibold underline underline-offset-4" style={{ color: brandText }}>{t.title ?? PROVIDERS[t.provider] ?? "Tour"}</a>
                ))}
              </p>
            )}

            {/* The funnel: from the community back to this home. */}
            <a href="#top" className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5 hover:brightness-[0.98]" style={{ background: tint }}>
              <span>
                <span className="block text-sm text-muted">Available in {s.community.name}</span>
                <span className="block text-[19px] font-bold" style={display}>{h.address}{h.list_price != null ? ` · ${money(h.list_price)}` : ""}</span>
              </span>
              <span className="rounded-xl px-5 py-2.5 text-[15px] font-semibold" style={{ background: brand, color: onBrand }}>See this home ↑</span>
            </a>
          </section>
        )}

        {rows.length === 0 && s.tours.length === 0 && !hasCommunity && (
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

const svg = (d: React.ReactNode) => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const ICONS = {
  bed: svg(<><path d="M3 18V7M3 14h18v4M21 14v-3a3 3 0 0 0-3-3h-7v6" /><circle cx="7" cy="11" r="2" /></>),
  bath: svg(<><path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM6 12V6a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2" /></>),
  area: svg(<><path d="M4 9V4h5M20 15v5h-5M4 4l7 7M20 20l-7-7" /></>),
  stories: svg(<><path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" /></>),
};
