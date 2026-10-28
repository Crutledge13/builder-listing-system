"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameListingPhoto } from "@/app/(app)/homes/[id]/listing-actions";

// A photo's name under its picture, with a pencil to rename it right there
// (tester notes, 28 Oct 2026: no need to open each photo). Enter saves,
// Escape cancels.
export function RenameInline({ mediaId, name, canEdit }: { mediaId: string; name: string; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  // Enter saves and then the box loses focus, which would save a second time.
  const sent = useRef(false);

  if (!canEdit) return <span className="mt-1 block truncate text-xs text-muted">{name}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(name);
          setError(null);
          sent.current = false;
          setEditing(true);
        }}
        title="Rename this photo"
        className="group mt-1 flex w-full min-w-0 items-center gap-1 text-left text-xs text-muted hover:text-foreground"
      >
        <span className="truncate">{name}</span>
        <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100" aria-hidden>
          <path d="M11.5 2.5l2 2L6 12H4v-2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">Rename</span>
      </button>
    );
  }

  const save = () => {
    if (sent.current) return;
    const next = value.trim();
    if (!next || next === name) {
      setEditing(false);
      return;
    }
    sent.current = true;
    start(async () => {
      const r = await renameListingPhoto(mediaId, next);
      if (r.error) {
        sent.current = false;
        setError(r.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  return (
    <span className="mt-1 block">
      <input
        autoFocus
        value={value}
        maxLength={140}
        disabled={saving}
        aria-label="Photo name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full rounded-md border border-accent px-1.5 py-0.5 text-xs outline-none"
      />
      {error && <span className="mt-0.5 block text-[11px] text-red-700">{error}</span>}
    </span>
  );
}
