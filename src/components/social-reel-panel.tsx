import type { ReactNode } from "react";
import Link from "next/link";
import { HomeSection } from "@/components/home-section";
import { MediaPicture } from "@/components/media-tile";
import type { MediaRow } from "@/lib/demo-media";

// A home's vertical social media reels (9:16). Not for the MLS: reels never go
// on the listing (the database keeps them off). They show on the home's realtor
// share link, where the realtor downloads them to post about the home.
export function SocialReelPanel({
  homeId,
  reels,
  canUpload,
  canRequest,
  notice,
  open,
}: {
  open?: boolean;
  homeId: string;
  reels: MediaRow[];
  canUpload: boolean;
  canRequest: boolean;
  notice?: ReactNode;
}) {
  return (
    <HomeSection
      id="social-reel"
      title="Social media reel"
      open={open}
      badge={reels.length ? (reels.length === 1 ? "1 reel" : `${reels.length} reels`) : null}
      hint={reels.length ? "On the realtor share link, not the MLS" : canUpload ? "None yet. Open to upload one." : "None yet"}
    >
      <p className="max-w-2xl text-sm text-muted">
        A vertical video (9:16) for realtors to post about this home. It doesn&rsquo;t go on the MLS. It shows on this home&rsquo;s realtor share
        link (the &ldquo;Share link&rdquo; button at the top of this page) with a download button.
      </p>
      {notice}

      {reels.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">
          No reel yet.{canUpload ? " Upload one, or ask our photographer to shoot it." : " Marketing can upload one."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-4">
          {reels.map((m) => (
            <li key={m.id} className="w-[160px]">
              <Link href={`/media/${m.id}`} className="relative block aspect-[9/16] overflow-hidden rounded-xl bg-soft">
                <MediaPicture m={m} className="h-full w-full" />
                <span className="absolute left-1.5 top-1.5 rounded bg-white/95 px-1.5 text-[11px] font-bold shadow-sm">Reel</span>
                {m.duration_seconds ? (
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 text-[11px] font-semibold text-white">{clock(m.duration_seconds)}</span>
                ) : null}
              </Link>
              <span className="mt-1 block truncate text-xs text-muted">{m.caption ?? m.title}</span>
              <a href={`/api/media/${m.id}?download=1`} className="mt-1 inline-block text-xs font-semibold underline">Download</a>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href={`/media/upload?home=${homeId}&reel=1`} className="rounded-xl border border-foreground px-3.5 py-2 font-semibold hover:bg-soft">
            {reels.length ? "Upload another reel" : "Upload a reel"}
          </Link>
          {canRequest && (
            <a href="#photo-requests" className="rounded-xl border border-line px-3.5 py-2 font-semibold hover:border-foreground">Ask our photographer for one</a>
          )}
        </div>
      )}
    </HomeSection>
  );
}

function clock(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
