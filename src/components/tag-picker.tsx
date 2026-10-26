"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/lib/format";
import { TAG_CATEGORIES, type ListTag } from "@/lib/tags";

// Pick photo tags from the shared list. No free typing: the search box only
// filters the list. Submits one hidden "tag" input per picked tag, or reports
// changes through onChange for client-side forms.
export function TagPicker({
  list,
  defaultValue = [],
  name = "tag",
  onChange,
  requestHref,
}: {
  list: ListTag[];
  defaultValue?: string[];
  name?: string;
  onChange?: (tags: string[]) => void;
  requestHref?: string;
}) {
  const [picked, setPicked] = useState<string[]>(defaultValue);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const update = (next: string[]) => {
    setPicked(next);
    onChange?.(next);
  };
  const toggle = (label: string) => update(picked.includes(label) ? picked.filter((t) => t !== label) : [...picked, label]);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = (t: ListTag) => !s || t.label.toLowerCase().includes(s) || t.aliases.some((a) => a.includes(s));
    return TAG_CATEGORIES.map((c) => ({ ...c, tags: list.filter((t) => t.category === c.key && hit(t)) })).filter((g) => g.tags.length);
  }, [q, list]);

  return (
    <div ref={box} className="relative">
      {picked.map((t) => <input key={t} type="hidden" name={name} value={t} />)}
      <div className="flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-1.5 focus-within:border-accent">
        {picked.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-1 pl-2.5 pr-1 text-sm font-medium text-accent">
            {t}
            <button type="button" onClick={() => toggle(t)} aria-label={`Remove ${t}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-white/70">×</button>
          </span>
        ))}
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = groups[0]?.tags.find((t) => !picked.includes(t.label));
              if (first) { toggle(first.label); setQ(""); }
            }
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Backspace" && !q && picked.length) update(picked.slice(0, -1));
          }}
          placeholder={picked.length ? "Add another…" : "Search the tag list…"}
          className="min-w-[140px] flex-1 border-0 bg-transparent px-1 py-1 text-[15px] outline-none"
        />
      </div>

      {open && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-white p-2 shadow-xl">
          {groups.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted">
              No tag matches “{q}”.{" "}
              {requestHref && <a href={requestHref} onClick={() => openRequest(requestHref, setOpen)} className="font-semibold text-accent underline">Ask for a new tag</a>}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.key} className="mb-2 last:mb-0">
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.label}</p>
              <div className="flex flex-wrap gap-1.5 px-1">
                {g.tags.map((t) => {
                  const on = picked.includes(t.label);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { toggle(t.label); setQ(""); }}
                      className={cx("rounded-full border px-2.5 py-1 text-sm", on ? "border-accent bg-accent text-white" : "border-line hover:border-foreground")}
                    >
                      {on ? "✓ " : ""}{t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {requestHref && groups.length > 0 && (
            <p className="mt-1 border-t border-line px-2 pt-2 text-xs text-muted">
              Not on the list? <a href={requestHref} onClick={() => openRequest(requestHref, setOpen)} className="font-semibold text-accent underline">Ask for a new tag</a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Close the list and open the "ask for a tag" panel if it's a <details> on the page.
function openRequest(href: string, setOpen: (v: boolean) => void) {
  setOpen(false);
  if (!href.startsWith("#")) return;
  const el = document.getElementById(href.slice(1));
  if (el instanceof HTMLDetailsElement) el.open = true;
}
