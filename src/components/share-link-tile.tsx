"use client";

import { useState } from "react";
import { cx } from "@/lib/format";

// "Share link" in the row of buttons at the top of a home: one click copies
// your own standing realtor link for this home and says so. Each person has
// their own, so the page shows who to call: a salesperson's link shows them;
// anyone else's shows the community's sales team.
export function ShareLinkTile({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          // Clipboard blocked (some browsers): show the link so it can be copied by hand.
          window.prompt("Copy this link and send it to the realtor:", url);
        }
      }}
      className={cx(
        "rounded-2xl border p-4 text-left transition-shadow hover:shadow-md",
        copied ? "border-emerald-300 bg-emerald-50" : "border-line",
      )}
    >
      <div className="font-semibold">Share link</div>
      <div className={cx("mt-0.5 text-sm", copied ? "font-semibold text-emerald-800" : "text-muted")} aria-live="polite">
        {copied ? "Link copied ✓" : "Copy your realtor link"}
      </div>
    </button>
  );
}
