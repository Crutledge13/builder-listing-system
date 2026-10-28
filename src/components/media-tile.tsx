import Link from "next/link";
import { QuickDownload } from "@/components/quick-download";
import { DemoArt, ROOM_LABELS, type MediaRow } from "@/lib/demo-media";
import { cx } from "@/lib/format";

// The picture for a media item, whatever its source. Demo pictures are drawn;
// uploads load through the private file route, which checks access first.
//
// Grids and cards get the small preview (size "thumb", ~640 px), never the
// original, and only once they scroll into view. Pass size="web" for a photo's
// own page. Videos show their still frame; only videos uploaded before stills
// existed fall back to loading the video's first moments.
// fileBase: where files come from (the signed-in route, or a share link's).
// priority: one of the first few pictures on the page (above the fold): load it right away, first in line.
export function MediaPicture({ m, className, size = "thumb", fileBase = "/api/media/", priority = false }: { m: MediaRow; className?: string; size?: "thumb" | "web"; fileBase?: string; priority?: boolean }) {
  if (m.source === "demo") return <DemoArt m={m} className={className} />;
  if (m.kind === "video" && !m.thumb_path) {
    return (
      <video src={`${fileBase}${m.id}#t=0.5`} preload="metadata" muted playsInline className={cx("object-cover", className)} />
    );
  }
  // A PDF (usually a floor plan drawing) has no picture to show: a plain card instead of a broken image.
  if (m.mime_type === "application/pdf" && !m.thumb_path) {
    return (
      <span className={cx("flex flex-col items-center justify-center gap-1 bg-soft text-muted", className)}>
        <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden><path d="M7 3h7l5 5v13H7z M14 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        <span className="text-xs font-semibold">PDF</span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`${fileBase}${m.id}?size=${size}`} alt={m.title} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" className={cx("object-cover", className)} />;
}

export const DISCLAIMER_TEXT = "Representative photo. Actual home, features and finishes may vary.";

// The disclaimer strip laid over a photo when a home uses plan or model photos.
export function DisclaimerOverlay({ small }: { small?: boolean }) {
  return (
    <span className={cx("pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 text-center font-medium text-white", small ? "px-2 py-1 text-[10px] leading-tight" : "px-4 py-2 text-xs sm:text-sm")}>
      {DISCLAIMER_TEXT}
    </span>
  );
}

// A floor plan opens its plan's folder (every photo of that plan); pass direct to open the file itself.
export function planFolderHref(builderId: string, plan: string) {
  return `/media/plan?builder=${builderId}&name=${encodeURIComponent(plan)}`;
}

export function MediaTile({ m, showPlace, disclaimer, direct }: { m: MediaRow; showPlace?: boolean; disclaimer?: boolean; direct?: boolean }) {
  const place = m.homes?.unparsed_address ?? m.communities?.name;
  const plan = m.plan_name ?? m.homes?.plan_name;
  const href = m.kind === "floor_plan" && plan && !direct ? planFolderHref(m.builder_id, plan) : `/media/${m.id}`;
  return (
    <div className="group relative">
    <Link href={href} className="block">
      <div data-media-id={m.id} className={cx("relative aspect-[3/2] overflow-hidden rounded-xl bg-soft", m.kind === "floor_plan" && "ring-1 ring-line")}>
        <MediaPicture m={m} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
        {m.kind === "video" && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 backdrop-blur">
              <svg viewBox="0 0 16 16" className="ml-0.5 h-5 w-5" aria-hidden><path d="M4 2.5v11l9-5.5z" fill="#fff" /></svg>
            </span>
          </span>
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          {m.is_cover && <span className="rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold shadow-sm">Cover</span>}
          {m.plan_name && !m.home_id && <span className="rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold shadow-sm">{m.plan_name} plan</span>}
          {m.kind === "video" && m.duration_seconds && (
            <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
              {Math.floor(m.duration_seconds / 60)}:{String(Math.round(m.duration_seconds % 60)).padStart(2, "0")}
            </span>
          )}
        </div>
        {disclaimer && m.kind !== "floor_plan" && <DisclaimerOverlay small />}
      </div>
      <div className="mt-2 truncate text-sm font-medium group-hover:underline">{m.title}</div>
      <div className="truncate text-xs text-muted">
        {m.room_source === "ai" && <span className="mr-1 rounded bg-violet-50 px-1 py-px text-[10px] font-semibold text-violet-700" title="Room picked by AI">AI</span>}
        {m.ai_status === "pending" && !m.room ? "AI is sorting…" : m.room ? ROOM_LABELS[m.room] : m.kind === "video" ? "Video" : "Photo"}
        {showPlace && place ? `, ${place}` : ""}
      </div>
    </Link>
    {/* Quick download, over the picture's corner (outside the link, so it never opens the photo). */}
    <div className="pointer-events-none absolute inset-x-0 top-0 aspect-[3/2]">
      <QuickDownload
        mediaId={m.id}
        title={m.title}
        kind={m.kind}
        demo={m.source === "demo"}
        disclaimer={disclaimer && m.kind !== "floor_plan" ? DISCLAIMER_TEXT : undefined}
        className={cx("pointer-events-auto absolute right-2", disclaimer && m.kind !== "floor_plan" ? "bottom-12" : "bottom-2")}
      />
    </div>
    </div>
  );
}

export function MediaGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{children}</div>;
}
