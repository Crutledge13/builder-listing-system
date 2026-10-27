"use client";

import { useEffect, useState } from "react";
import { MediaPicture, DisclaimerOverlay, DISCLAIMER_TEXT } from "@/components/media-tile";
import { DownloadMenu } from "@/components/download-menu";
import type { MediaRow } from "@/lib/demo-media";
import type { DownloadPreset } from "@/lib/image-resize";

// Sizes a realtor can pick (they don't see builders' own sizes).
export const SHARE_SIZES: DownloadPreset[] = [
  { id: "full", builder_id: null, name: "Full quality (original file)", long_edge: null, format: "original", quality: 100, is_default: true },
  { id: "mls", builder_id: null, name: "MLS and print (2048 px JPG)", long_edge: 2048, format: "jpeg", quality: 85, is_default: false },
  { id: "web", builder_id: null, name: "Website (1920 px WebP)", long_edge: 1920, format: "webp", quality: 82, is_default: false },
  { id: "social", builder_id: null, name: "Social media (1080 px JPG)", long_edge: 1080, format: "jpeg", quality: 85, is_default: false },
];

// The photo grid; tapping a photo opens it large with a download menu.
export function ShareGallery({ photos, fileBase, disclaimer, slug }: { photos: MediaRow[]; fileBase: string; disclaimer: boolean; slug: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const m = open === null ? null : photos[open];

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

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((p, i) => (
          <button key={p.id} type="button" onClick={() => setOpen(i)} className="group relative aspect-[3/2] overflow-hidden rounded-xl bg-soft text-left" aria-label={`Open ${p.title}`}>
            <span data-media-id={p.id} className="block h-full w-full">
              <MediaPicture m={p} fileBase={fileBase} className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
            </span>
            {disclaimer && p.kind !== "floor_plan" && <DisclaimerOverlay small />}
          </button>
        ))}
      </div>

      {m && open !== null && (
        <div role="dialog" aria-modal="true" aria-label={m.title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6" onClick={() => setOpen(null)}>
          <div className="grid max-h-full w-full max-w-6xl gap-4 overflow-y-auto rounded-2xl bg-white p-3 sm:p-4 lg:grid-cols-[1fr_300px]" onClick={(e) => e.stopPropagation()}>
            <div className="relative">
              <div id="share-view" className="relative aspect-[3/2] overflow-hidden rounded-xl bg-soft">
                <MediaPicture m={m} fileBase={fileBase} className="h-full w-full object-contain" />
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
