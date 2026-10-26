"use client";

import { useState } from "react";

// Open an address in Google or Apple Maps, or copy it.
export function AddressActions({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const q = encodeURIComponent(address);
  return (
    <details data-popover className="relative inline-block">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-foreground px-3.5 py-1.5 text-sm font-semibold hover:bg-soft">
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
          <path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="6.5" r="1.8" fill="currentColor" />
        </svg>
        Directions
      </summary>
      <div className="absolute left-0 z-30 mt-2 w-60 rounded-2xl border border-line bg-white p-2 shadow-xl">
        <p className="px-3 pb-2 pt-1 text-xs text-muted">{address}</p>
        <a href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer" className="block rounded-xl px-3 py-2.5 text-[15px] font-medium hover:bg-soft">
          Open in Google Maps
        </a>
        <a href={`https://maps.apple.com/?q=${q}`} target="_blank" rel="noreferrer" className="block rounded-xl px-3 py-2.5 text-[15px] font-medium hover:bg-soft">
          Open in Apple Maps
        </a>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(address);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
          className="block w-full rounded-xl px-3 py-2.5 text-left text-[15px] font-medium hover:bg-soft"
        >
          {copied ? "Copied ✓" : "Copy address"}
        </button>
      </div>
    </details>
  );
}
