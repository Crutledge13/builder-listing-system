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
export function DownloadDrawn({ targetId, fileName }: { targetId: string; fileName: string }) {
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
        const blob = new Blob([clone.outerHTML], { type: "image/svg+xml" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${fileName}.svg`;
        a.click();
        URL.revokeObjectURL(a.href);
      }}
      className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white hover:brightness-110"
    >
      Download
    </button>
  );
}
