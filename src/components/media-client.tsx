"use client";

import { useState } from "react";

// Plays a video only when asked, showing a still picture until then.
export function VideoPlayer({ src, children }: { src: string; children: React.ReactNode }) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return <video src={src} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />;
  }
  return (
    <button type="button" onClick={() => setPlaying(true)} className="group relative block h-full w-full" aria-label="Play video">
      {children}
      <span className="absolute inset-0 flex items-center justify-center bg-black/10">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 backdrop-blur transition-transform group-hover:scale-105">
          <svg viewBox="0 0 16 16" className="ml-1 h-7 w-7" aria-hidden><path d="M4 2.5v11l9-5.5z" fill="#fff" /></svg>
        </span>
      </span>
    </button>
  );
}

// Saves the drawn demo picture on screen as an image file.
export function DownloadDrawn({ targetId, fileName, disclaimer, label = "Download" }: { targetId: string; fileName: string; disclaimer?: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const svg = document.getElementById(targetId)?.querySelector("svg");
        if (!svg) return;
        const clone = svg.cloneNode(true) as SVGElement;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", "1440");
        clone.setAttribute("height", "960");
        if (disclaimer) {
          // Lay the disclaimer strip into the picture itself, in its own coordinates.
          const vb = (clone.getAttribute("viewBox") ?? "0 0 1440 960").split(/[ ,]+/).map(Number);
          const [x, y, w, h] = vb.length === 4 ? vb : [0, 0, 1440, 960];
          const ns = "http://www.w3.org/2000/svg";
          const band = document.createElementNS(ns, "rect");
          band.setAttribute("x", String(x)); band.setAttribute("y", String(y + h * 0.92));
          band.setAttribute("width", String(w)); band.setAttribute("height", String(h * 0.08));
          band.setAttribute("fill", "rgba(0,0,0,0.6)");
          const text = document.createElementNS(ns, "text");
          text.setAttribute("x", String(x + w / 2)); text.setAttribute("y", String(y + h * 0.97));
          text.setAttribute("text-anchor", "middle"); text.setAttribute("fill", "#fff");
          text.setAttribute("font-family", "Arial, sans-serif"); text.setAttribute("font-size", String(h * 0.032));
          text.textContent = disclaimer;
          clone.append(band, text);
        }
        const blob = new Blob([clone.outerHTML], { type: "image/svg+xml" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${fileName}.svg`;
        a.click();
        URL.revokeObjectURL(a.href);
      }}
      className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white hover:brightness-110"
    >
      {label}
    </button>
  );
}

// Downloads an uploaded photo with the disclaimer drawn across the bottom.
export function DownloadWithDisclaimer({ src, fileName, disclaimer }: { src: string; fileName: string; disclaimer: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const img = new Image();
          img.src = src;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          const band = Math.round(c.height * 0.08);
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(0, c.height - band, c.width, band);
          ctx.fillStyle = "#fff";
          ctx.font = `${Math.round(band * 0.4)}px Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(disclaimer, c.width / 2, c.height - band / 2, c.width * 0.95);
          const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
          if (!blob) return;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${fileName}-representative.jpg`;
          a.click();
          URL.revokeObjectURL(a.href);
        } finally {
          setBusy(false);
        }
      }}
      className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white hover:brightness-110 disabled:opacity-60"
    >
      {busy ? "Preparing…" : "Download with disclaimer"}
    </button>
  );
}
