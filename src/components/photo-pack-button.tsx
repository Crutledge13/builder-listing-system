"use client";

import { useState } from "react";

export type PackPhoto = { id: string; label: string; file: boolean };

// MLS photo pack: the listing's MLS-ready photos in MLS order, named
// 01-exterior.jpg, 02-kitchen.jpg, ... in one zip, so our team can drop them
// straight into the MLS photo upload. Built in the browser: each photo comes
// through the normal access-checked link, so nothing big passes through our server.
export function PhotoPackButton({ name, photos, readme }: { name: string; photos: PackPhoto[]; readme: string }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [done, setDone] = useState(0);

  async function build() {
    setState("working");
    setDone(0);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const notes: string[] = [];
      for (const p of photos) {
        if (!p.file) {
          notes.push(`${p.label}: demo picture (drawn on screen, no file).`);
        } else {
          const res = await fetch(`/api/media/${p.id}?download=1`);
          if (!res.ok) notes.push(`${p.label}: couldn't be downloaded.`);
          else {
            const type = res.headers.get("content-type") ?? "";
            const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("heic") ? "heic" : "jpg";
            zip.file(`${p.label}.${ext}`, await res.blob());
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

  return (
    <button type="button" onClick={build} disabled={state === "working"} className="font-semibold text-accent underline disabled:no-underline disabled:opacity-70">
      {state === "working" ? `Packing ${done} of ${photos.length}…` : state === "error" ? "Download failed, try again" : "Download MLS photo pack (.zip)"}
    </button>
  );
}
