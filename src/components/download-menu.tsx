"use client";

import { useEffect, useState } from "react";
import {
  FORMAT_LABELS, extFor, isUntouched, rememberPreset, renderFileBlob, renderSvg, saveBlob, startingPreset, type DownloadPreset,
} from "@/lib/image-resize";

const CUSTOM = "custom";

// Download one photo at a chosen size: full quality, MLS, website, social,
// the builder's own sizes, or a custom size typed in.
export function DownloadMenu({
  mediaId,
  fileName,
  demoTargetId,
  presets,
  builderDefault,
  disclaimer,
  offerDisclaimer,
}: {
  mediaId: string;
  fileName: string;
  demoTargetId?: string; // drawn demo picture: the element holding its <svg>
  presets: DownloadPreset[];
  builderDefault: string | null; // the builder's default size, if it set one
  disclaimer?: string; // always drawn on (the builder turned the disclaimer on)
  offerDisclaimer?: string; // optional, ticked by the person (plan library photos)
}) {
  const [choice, setChoice] = useState("");
  const [custom, setCustom] = useState({ long_edge: 1600, format: "jpeg" as DownloadPreset["format"], quality: 85 });
  const [addStrip, setAddStrip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setChoice(startingPreset(presets, builderDefault)), [presets, builderDefault]);

  const preset: Pick<DownloadPreset, "long_edge" | "format" | "quality"> =
    choice === CUSTOM ? custom : presets.find((p) => p.id === choice) ?? { long_edge: null, format: "original", quality: 100 };
  const strip = disclaimer ?? (addStrip ? offerDisclaimer : undefined);

  async function download() {
    setError(null);
    if (choice !== CUSTOM) rememberPreset(choice);
    setBusy(true);
    try {
      if (demoTargetId) {
        const svg = document.getElementById(demoTargetId)?.querySelector("svg");
        if (!svg) throw new Error("Couldn’t find the picture.");
        const blob = await renderSvg(svg, preset, strip);
        saveBlob(blob, `${fileName}${strip ? "-representative" : ""}.${extFor(preset.format === "original" ? "png" : preset.format)}`);
        return;
      }
      // Full quality with nothing drawn on it: hand over the original file as it is.
      if (isUntouched(preset) && !strip) {
        window.location.href = `/api/media/${mediaId}?download=1`;
        return;
      }
      const res = await fetch(`/api/media/${mediaId}?download=1`);
      if (!res.ok) throw new Error("Couldn’t get the photo. Try again.");
      const file = await res.blob();
      const blob = await renderFileBlob(file, preset, strip);
      saveBlob(blob, `${fileName}${strip ? "-representative" : ""}.${extFor(preset.format, file.type)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The download didn’t work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const builderOwn = presets.filter((p) => p.builder_id);
  const builtIn = presets.filter((p) => !p.builder_id);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Size</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)} className="field-input">
          {builderOwn.length > 0 && (
            <optgroup label="Your company’s sizes">
              {builderOwn.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          )}
          <optgroup label="Standard sizes">
            {builtIn.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
          <option value={CUSTOM}>Custom size…</option>
        </select>
      </label>

      {choice === CUSTOM && (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-soft p-3">
          <label className="col-span-2 block">
            <span className="mb-1 block text-xs font-medium">Longest side (pixels)</span>
            <input type="number" min={200} max={8000} step={10} value={custom.long_edge} onChange={(e) => setCustom({ ...custom, long_edge: Math.max(200, Math.min(8000, Number(e.target.value) || 1600)) })} className="field-input py-2" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Format</span>
            <select value={custom.format} onChange={(e) => setCustom({ ...custom, format: e.target.value as DownloadPreset["format"] })} className="field-input py-2">
              {(["jpeg", "webp", "png"] as const).map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">Quality {custom.format === "png" ? "" : `(${custom.quality})`}</span>
            <input type="range" min={40} max={100} value={custom.quality} disabled={custom.format === "png"} onChange={(e) => setCustom({ ...custom, quality: Number(e.target.value) })} className="mt-3 w-full accent-[#3452c7]" />
          </label>
        </div>
      )}

      {offerDisclaimer && !disclaimer && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={addStrip} onChange={(e) => setAddStrip(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#3452c7]" />
          Add the “representative” disclaimer to the picture
        </label>
      )}

      <button type="button" onClick={download} disabled={busy || !choice} className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white hover:brightness-110 disabled:opacity-60">
        {busy ? "Preparing…" : "Download"}
      </button>
      {disclaimer && <p className="text-xs text-muted">The “representative” strip is added because this home shows the disclaimer.</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <p className="text-xs text-muted">Pictures are never made bigger than the original. Your choice is remembered for next time.</p>
    </div>
  );
}
