import Link from "next/link";
import { DemoArt, ROOM_LABELS, type MediaRow } from "@/lib/demo-media";
import { cx } from "@/lib/format";

// The picture for a media item, whatever its source. Demo pictures are drawn;
// uploads load through the private file route, which checks access first.
export function MediaPicture({ m, className }: { m: MediaRow; className?: string }) {
  if (m.source === "demo") return <DemoArt m={m} className={className} />;
  if (m.kind === "video") {
    return (
      <video src={`/api/media/${m.id}#t=0.5`} preload="metadata" muted playsInline className={cx("object-cover", className)} />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/media/${m.id}`} alt={m.title} loading="lazy" className={cx("object-cover", className)} />;
}

export function MediaTile({ m, showPlace }: { m: MediaRow; showPlace?: boolean }) {
  const place = m.homes?.unparsed_address ?? m.communities?.name;
  return (
    <Link href={`/media/${m.id}`} className="group block">
      <div className={cx("relative aspect-[3/2] overflow-hidden rounded-xl bg-soft", m.kind === "floor_plan" && "ring-1 ring-line")}>
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
          {m.kind === "video" && m.duration_seconds && (
            <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
              {Math.floor(m.duration_seconds / 60)}:{String(Math.round(m.duration_seconds % 60)).padStart(2, "0")}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 truncate text-sm font-medium group-hover:underline">{m.title}</div>
      <div className="truncate text-xs text-muted">
        {m.room ? ROOM_LABELS[m.room] : m.kind === "video" ? "Video" : "Photo"}
        {showPlace && place ? `, ${place}` : ""}
      </div>
    </Link>
  );
}

export function MediaGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{children}</div>;
}
