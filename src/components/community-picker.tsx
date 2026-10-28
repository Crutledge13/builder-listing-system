"use client";

import { useId, useMemo, useRef, useState } from "react";

type Community = { id: string; name: string; city?: string | null };

// Picks communities for a person without listing every one on the page:
// the chosen ones show as small tags (× to remove), and a search box adds
// more from a short dropdown. Works the same with 2 communities or 50.
// Sends one `name` value per chosen community (default "community_id"), and,
// with `scope`, a hidden "scope" value for every community so the server
// knows which ones the form covered.
export function CommunityPicker({
  communities,
  defaultSelected = [],
  name = "community_id",
  scope = false,
  label,
}: {
  communities: Community[];
  defaultSelected?: string[];
  name?: string;
  scope?: boolean;
  label?: string;
}) {
  const [selected, setSelected] = useState<string[]>(() => defaultSelected.filter((id) => communities.some((c) => c.id === id)));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const byId = useMemo(() => new Map(communities.map((c) => [c.id, c])), [communities]);
  const sorted = useMemo(() => [...communities].sort((a, b) => a.name.localeCompare(b.name)), [communities]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted
      .filter((c) => !selected.includes(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.city ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [sorted, selected, query]);
  const remaining = communities.length - selected.length;

  const add = (id: string) => {
    setSelected((s) => (s.includes(id) ? s : [...s, id]));
    setQuery("");
    setActive(0);
    input.current?.focus();
  };
  const remove = (id: string) => setSelected((s) => s.filter((x) => x !== id));

  if (communities.length === 0) return <p className="text-sm text-muted">No communities yet.</p>;

  return (
    <div>
      {label && <p className="text-sm font-medium">{label}</p>}
      {scope && communities.map((c) => <input key={c.id} type="hidden" name="scope" value={c.id} />)}
      {selected.map((id) => <input key={id} type="hidden" name={name} value={id} />)}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {selected.length === 0 && <span className="text-sm text-muted">None yet.</span>}
        {selected
          .map((id) => byId.get(id))
          .filter((c): c is Community => !!c)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-white py-1 pl-3 pr-1 text-sm">
              {c.name}
              <button
                type="button"
                onClick={() => remove(c.id)}
                aria-label={`Remove ${c.name}`}
                className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-soft hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
      </div>

      {remaining > 0 && (
        <div className="relative mt-2 max-w-sm">
          <input
            ref={input}
            type="search"
            value={query}
            placeholder={`Add a community (${remaining} more)`}
            aria-label="Add a community"
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, matches.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter") {
                e.preventDefault(); // never send the form from the search box
                if (open && matches[active]) add(matches[active].id);
              }
              if (e.key === "Escape") setOpen(false);
            }}
            className="field-input py-2 text-sm"
          />
          {open && matches.length > 0 && (
            <ul id={listId} role="listbox" className="card-lift absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-white py-1">
              {matches.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(c.id)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm ${i === active ? "bg-soft" : ""}`}
                  >
                    <span>{c.name}</span>
                    {c.city && <span className="text-xs text-muted">{c.city}</span>}
                  </button>
                </li>
              ))}
              {remaining > matches.length && (
                <li className="px-3 py-1.5 text-xs text-muted">Type to find the other {remaining - matches.length}.</li>
              )}
            </ul>
          )}
          {open && matches.length === 0 && query && (
            <p className="absolute left-0 right-0 z-20 mt-1 rounded-xl border border-line bg-white px-3 py-2 text-sm text-muted">No community matches “{query}”.</p>
          )}
        </div>
      )}

      {communities.length > 1 && (
        <div className="mt-2 flex gap-3 text-xs">
          {remaining > 0 && (
            <button type="button" onClick={() => setSelected(communities.map((c) => c.id))} className="font-semibold text-accent hover:underline">
              Add all {communities.length}
            </button>
          )}
          {selected.length > 0 && (
            <button type="button" onClick={() => setSelected([])} className="font-semibold text-muted hover:text-foreground">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
