"use client";

import { useEffect, useState } from "react";
import { MediaPicture, DisclaimerOverlay, DISCLAIMER_TEXT } from "@/components/media-tile";
import { DownloadMenu } from "@/components/download-menu";
import type { MediaRow } from "@/lib/demo-media";
import type { DownloadPreset } from "@/lib/image-resize";
import { cx } from "@/lib/format";

// Sizes a realtor can pick (they don't see builders' own sizes).
export const SHARE_SIZES: DownloadPreset[] = [
  { id: "full", builder_id: null, name: "Full quality (original file)", long_edge: null, format: "original", quality: 100, is_default: true },
  { id: "mls", builder_id: null, name: "MLS and print (2048 px JPG)", long_edge: 2048, format: "jpeg", quality: 85, is_default: false },
  { id: "web", builder_id: null, name: "Website (1920 px WebP)", long_edge: 1920, format: "webp", quality: 82, is_default: false },
  { id: "social", builder_id: null, name: "Social media (1080 px JPG)", long_edge: 1080, format: "jpeg", quality: 85, is_default: false },
];

// The photos around the description, as the owners sketched it (28 Oct 2026):
// four photos in a 2 x 2 grid on the left framing "About this home" on the
// right, and "See more photos" dropping the rest down underneath, full width.
// The hero photo (the first) is already at the top of the page, so the frame
// starts at the second. Hidden tiles stay on the page so the zip download can
// still find demo pictures. Tapping a photo opens it large with a download menu.
const FRAME = 4;

// `heroShown`: the first photo is already the page's hero, so start from the
// second (the home's photos). The community section shows all of its own.
export function ShareGallery({ photos, fileBase, disclaimer, slug, accent, children, heroShown = true }: { photos: MediaRow[]; fileBase: string; disclaimer: boolean; slug: string; accent?: string; children?: React.ReactNode; heroShown?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const m = open === null ? null : photos[open];
  // Photo 1 is the hero; frame from photo 2 when there are enough.
  const start = heroShown && photos.length > FRAME ? 1 : 0;
  const frame = photos.slice(start, start + FRAME);
  const rest = photos.slice(start + FRAME);

  useEffect(() => {
    if (open === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : Math.min(photos.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, photos.length]);

  const tile = (p: MediaRow, i: number, extra?: string) => (
    <button key={p.id} type="button" onClick={() => setOpen(i)} className={cx("group relative aspect-[4/3] overflow-hidden rounded-lg bg-soft text-left", extra)} aria-label={`Open ${p.title}`}>
      <span data-media-id={p.id} className="block h-full w-full">
        <MediaPicture m={p} fileBase={fileBase} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
      </span>
      {disclaimer && p.kind !== "floor_plan" && <DisclaimerOverlay small />}
    </button>
  );

  return (
    <>
      <div className={cx("grid gap-8 lg:gap-12", frame.length > 0 && children ? "lg:grid-cols-2" : "")}>
        {frame.length > 0 && (
          <div className="min-w-0">
            <div className="grid grid-cols-2 gap-2 sm:gap-3">{frame.map((p, n) => tile(p, start + n))}</div>
            {rest.length > 0 && (
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                aria-expanded={all}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[15px] font-semibold"
                style={accent ? { color: accent, background: `color-mix(in srgb, ${accent} 9%, white)` } : undefined}
              >
                <span aria-hidden className={cx("inline-block transition-transform", all && "rotate-180")}>⌄</span>
                {all ? "Show fewer photos" : `See more photos (${rest.length})`}
              </button>
            )}
          </div>
        )}
        {children && <div className="min-w-0">{children}</div>}
      </div>
      {rest.length > 0 && (
        <div className={cx("mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4", !all && "hidden")}>
          {rest.map((p, n) => tile(p, start + FRAME + n))}
        </div>
      )}

      {m && open !== null && (
        <div role="dialog" aria-modal="true" aria-label={m.title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6" onClick={() => setOpen(null)}>
          <div className="grid max-h-full w-full max-w-6xl gap-4 overflow-y-auto rounded-2xl bg-white p-3 sm:p-4 lg:grid-cols-[1fr_300px]" onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              <div id="share-view" className="relative aspect-[3/2] overflow-hidden rounded-xl bg-soft">
                <MediaPicture m={m} size="web" fileBase={fileBase} className="h-full w-full object-contain" />
                {disclaimer && m.kind !== "floor_plan" && <DisclaimerOverlay />}
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <button type="button" disabled={open === 0} onClick={() => setOpen(open - 1)} className="rounded-full border border-line px-4 py-1.5 font-semibold disabled:opacity-30">← Previous</button>
                <span className="text-muted">{open + 1} of {photos.length}</span>
                <button type="button" disabled={open === photos.length - 1} onClick={() => setOpen(open + 1)} className="rounded-full border border-line px-4 py-1.5 font-semibold disabled:opacity-30">Next →</button>
              </div>
            </div>
            <div>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{m.title}</p>
                <button type="button" onClick={() => setOpen(null)} className="rounded-full px-2 text-xl leading-none text-muted hover:text-foreground" aria-label="Close">×</button>
              </div>
              {m.caption && <p className="mt-1 text-sm text-muted">{m.caption}</p>}
              <div className="mt-4">
                <DownloadMenu
                  key={m.id}
                  mediaId={m.id}
                  fileName={`${slug}-${String(open + 1).padStart(2, "0")}`}
                  demoTargetId={m.source === "demo" ? "share-view" : undefined}
                  presets={SHARE_SIZES}
                  builderDefault="full"
                  disclaimer={disclaimer && m.kind !== "floor_plan" ? DISCLAIMER_TEXT : undefined}
                  fileBase={fileBase}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
