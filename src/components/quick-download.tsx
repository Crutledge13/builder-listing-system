"use client";

import { useState } from "react";
import { cx } from "@/lib/format";
import { extFor, renderFileBlob, renderSvg, saveBlob } from "@/lib/image-resize";

const FULL = { long_edge: null, format: "original", quality: 100 } as const;

// The small round download button in the corner of a media tile (owners,
// 28 Oct 2026): saves that one file at full quality without opening it.
// Pick another size on the photo's own page. A drawn demo picture is saved
// as a PNG; a "representative" photo gets its note drawn on, like every
// other download of it.
export function QuickDownload({ mediaId, title, kind, demo, disclaimer, className }: {
  mediaId: string;
  title: string;
  kind: string;
  demo: boolean;
  disclaimer?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "photo";
  const strip = kind === "photo" ? disclaimer : undefined;

  async function go() {
    setFailed(false);
    // A real file with nothing to draw on it: hand over the original as it is.
    if (!demo && !strip) {
      const a = document.createElement("a");
      a.href = `/api/media/${mediaId}?download=1`;
      a.click();
      return;
    }
    setBusy(true);
    try {
      if (demo && kind !== "video") {
        const svg = document.querySelector(`[data-media-id="${mediaId}"] svg`) as SVGElement | null;
        if (!svg) throw new Error("no picture");
        saveBlob(await renderSvg(svg, FULL, strip), `${name}${strip ? "-representative" : ""}.png`);
        return;
      }
      if (demo) {
        const a = document.createElement("a");
        a.href = `/api/media/${mediaId}?download=1`;
        a.click();
        return;
      }
      const res = await fetch(`/api/media/${mediaId}?download=1`);
      if (!res.ok) throw new Error("fetch");
      const file = await res.blob();
      saveBlob(await renderFileBlob(file, FULL, strip), `${name}-representative.${extFor("original", file.type)}`);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const label = failed ? "Download didn't work. Try again, or open the photo." : kind === "video" ? "Download this video" : "Download (full quality)";
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      title={label}
      aria-label={label}
      className={cx(
        "flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-foreground shadow-md ring-1 ring-black/5 transition hover:bg-white hover:text-accent disabled:opacity-70",
        failed && "text-red-700",
        className,
      )}
    >
      {busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      ) : (
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
          <path d="M8 2.5v7.5M4.75 6.75 8 10l3.25-3.25M3 12.75h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
