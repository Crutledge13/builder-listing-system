"use client";

import { useEffect, useState } from "react";

// Above a list of folded builders (<details data-builder-fold data-name="…">):
// a name filter, "Open all" / "Close all", and opening the builder a link
// points at (#b-<id> or #<id>), so long lists stay one line per builder.
export function BuilderListTools({ count }: { count: number }) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id) ?? document.getElementById(`b-${id}`);
      const fold = el?.closest<HTMLDetailsElement>("details[data-builder-fold]") ?? (el instanceof HTMLDetailsElement ? el : null);
      if (fold) {
        fold.open = true;
        fold.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  useEffect(() => {
    const term = q.trim().toLowerCase();
    document.querySelectorAll<HTMLElement>("[data-builder-fold]").forEach((el) => {
      el.hidden = !!term && !(el.dataset.name ?? "").toLowerCase().includes(term);
    });
  }, [q]);

  const setAll = (open: boolean) =>
    document.querySelectorAll<HTMLDetailsElement>("details[data-builder-fold]").forEach((d) => {
      if (!d.hidden) d.open = open;
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Find a builder (${count})`}
        aria-label="Find a builder"
        className="field-input min-w-0 flex-1 py-2 sm:max-w-xs"
      />
      <button type="button" onClick={() => setAll(true)} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">Open all</button>
      <button type="button" onClick={() => setAll(false)} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">Close all</button>
    </div>
  );
}
