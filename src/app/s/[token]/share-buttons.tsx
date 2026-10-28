"use client";

import { useState } from "react";

// "Share" in the realtor page's header: the phone's share sheet when there is
// one, otherwise copies the page's address.
export function SharePageButton({ color }: { color: string }) {
  const [done, setDone] = useState(false);
  async function share() {
    const url = window.location.href.split("#")[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      // Closed the share sheet; nothing to do.
    }
  }
  return (
    <button type="button" onClick={share} className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-soft" style={{ color }} aria-live="polite">
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
      </svg>
      {done ? "Link copied" : "Share"}
    </button>
  );
}

// Copy one social post idea.
export function CopyPost({ text, color }: { text: string; color: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          // Clipboard blocked; the text is on screen to select by hand.
        }
      }}
      className="rounded-full border-2 px-4 py-1.5 text-sm font-semibold hover:bg-soft"
      style={{ borderColor: color, color }}
      aria-live="polite"
    >
      {done ? "Copied" : "Copy post"}
    </button>
  );
}
