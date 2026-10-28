"use client";

import { useState, useSyncExternalStore } from "react";
import { isUntouched, rememberPreset, renderFileBlob, renderSvg, pickStartingPreset, readRememberedPreset, subscribeRememberedPreset, extFor, type DownloadPreset } from "@/lib/image-resize";

export type PackPhoto = { id: string; label: string; file: boolean };
type Size = Pick<DownloadPreset, "long_edge" | "format" | "quality">;

// A zip of photos, named 01-exterior.jpg, 02-kitchen.jpg, ... Built in the
// browser: each photo comes through the normal access-checked link and is
// resized here if a size is picked, so nothing big passes through our server.
//
// size:    one fixed size (the MLS pack uses the MLS size).
// presets: let the person pick (Download all photos on a home).
export function PhotoPackButton({
  name,
  photos,
  readme,
  label = "Download MLS photo pack (.zip)",
  size,
  presets,
  builderDefault = null,
  disclaimer,
  fileBase = "/api/media/",
  buttonClassName,
  buttonStyle,
}: {
  fileBase?: string;
  // Optional look for the button (the realtor share page draws it in the builder's color).
  buttonClassName?: string;
  buttonStyle?: React.CSSProperties;
  name: string;
  photos: PackPhoto[];
  readme: string;
  label?: string;
  size?: Size;
  presets?: DownloadPreset[];
  builderDefault?: string | null;
  disclaimer?: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [done, setDone] = useState(0);
  const [picked, setChoice] = useState<string | null>(null);
  // Start from the person's last size (remembered in this browser), else the builder's default.
  const remembered = useSyncExternalStore(subscribeRememberedPreset, readRememberedPreset, () => null);
  const choice = !presets
    ? ""
    : picked && presets.some((p) => p.id === picked)
      ? picked
      : pickStartingPreset(presets, builderDefault ?? null, remembered);

  const chosen: Size | undefined = presets ? presets.find((p) => p.id === choice) : size;

  async function build() {
    setState("working");
    setDone(0);
    if (presets && choice) rememberPreset(choice);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const notes: string[] = [];
      for (const p of photos) {
        if (!p.file) {
          // Demo pictures are drawn on the page; save the one shown in its tile, if it's here.
          const svg = document.querySelector(`[data-media-id="${p.id}"] svg`) as SVGElement | null;
          if (svg) {
            const size = chosen ?? { long_edge: null, format: "original" as const, quality: 100 };
            zip.file(`${p.label}.${extFor(size.format === "original" ? "png" : size.format)}`, await renderSvg(svg, size, disclaimer));
          } else notes.push(`${p.label}: demo picture (drawn on screen, no file).`);
        } else {
          const res = await fetch(`${fileBase}${p.id}?download=1`);
          if (!res.ok) notes.push(`${p.label}: couldn't be downloaded.`);
          else {
            const original = await res.blob();
            const keep = !chosen || (isUntouched(chosen) && !disclaimer);
            try {
              const out = keep ? original : await renderFileBlob(original, chosen, disclaimer);
              zip.file(`${p.label}.${extFor(keep ? "original" : chosen.format, original.type)}`, out);
            } catch {
              // A file the browser can't resize (e.g. HEIC) goes in as it is.
              zip.file(`${p.label}.${extFor("original", original.type)}`, original);
              notes.push(`${p.label}: kept at full size (this browser can't resize that file type).`);
            }
          }
        }
        setDone((d) => d + 1);
      }
      zip.file("README.txt", notes.length ? `${readme}\nNotes:\n${notes.map((x) => `- ${x}`).join("\n")}\n` : readme);
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setState("done");
    } catch {
      setState("error");
    }
  }

  const button = (
    <button type="button" onClick={build} disabled={state === "working" || (!!presets && !choice)} className={buttonClassName ?? "font-semibold text-accent underline disabled:no-underline disabled:opacity-70"} style={buttonStyle}>
      {state === "working" ? `Packing ${done} of ${photos.length}…` : state === "error" ? "Download failed, try again" : label}
    </button>
  );
  if (!presets) return button;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select value={choice} onChange={(e) => setChoice(e.target.value)} className="field-input w-auto py-1.5 text-sm" aria-label="Size">
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {button}
    </span>
  );
}
