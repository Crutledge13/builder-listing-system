"use client";

import { useState, useTransition, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cx } from "@/lib/format";
import { dropListingItem } from "@/app/(app)/homes/[id]/listing-actions";

const TYPE = "application/x-listing-item";

// The listing's photo grid, with drag and drop to change the MLS order
// (tester notes, 28 Oct 2026). Each child <li> carries data-sort-id (its
// listing_media id). Drag a photo onto another one and it takes that place;
// the others move along. Earlier / Later links stay for phones, where
// dragging doesn't work in every browser.
export function ListingSortable({ homeId, enabled, className, children }: { homeId: string; enabled: boolean; className?: string; children: ReactNode }) {
  const router = useRouter();
  const [over, setOver] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const itemOf = (e: DragEvent) => (e.target as HTMLElement).closest<HTMLElement>("[data-sort-id]")?.dataset.sortId ?? null;
  const ours = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(TYPE);

  if (!enabled) return <ol className={className}>{children}</ol>;

  return (
    <div>
      <ol
        className={cx(className, saving && "opacity-60")}
        // Shows which spot the photo will land in.
        data-drop-target={over ?? undefined}
        onDragStart={(e) => {
          const id = itemOf(e);
          if (!id || saving) return;
          e.dataTransfer.setData(TYPE, id);
          e.dataTransfer.effectAllowed = "move";
          setDragged(id);
          setError(null);
        }}
        onDragOver={(e) => {
          if (!ours(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const id = itemOf(e);
          if (id !== over) setOver(id);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
        }}
        onDragEnd={() => {
          setOver(null);
          setDragged(null);
        }}
        onDrop={(e) => {
          if (!ours(e)) return;
          e.preventDefault();
          const id = e.dataTransfer.getData(TYPE);
          const target = itemOf(e);
          setOver(null);
          setDragged(null);
          if (!id || !target || id === target) return;
          // Dropped further down the list: it goes after the photo it was dropped on.
          const ids = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-sort-id]")).map((el) => el.dataset.sortId!);
          const from = ids.indexOf(id);
          const to = ids.indexOf(target);
          const before = to > from ? (ids[to + 1] ?? null) : target;
          start(async () => {
            const r = await dropListingItem(homeId, id, before);
            if (r.error) setError(r.error);
            router.refresh();
          });
        }}
      >
        {children}
      </ol>
      {/* Highlight the spot being dragged over, and dim the photo being moved. */}
      <style>{`${over ? `[data-sort-id="${over}"] > a { outline: 3px solid #3452c7; outline-offset: 2px; }` : ""}${dragged ? `[data-sort-id="${dragged}"] { opacity: .4; }` : ""}`}</style>
      {saving && <p className="mt-2 text-sm text-muted">Saving the new order…</p>}
      {error && <p className="mt-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800">{error}</p>}
    </div>
  );
}
