"use client";

import { useState } from "react";
import { cx } from "@/lib/format";

export type SendBackField = { key: string; label: string; current: string };
export type SendBackPhoto = { id: string; label: string };

type Row =
  | { id: number; kind: "field"; key: string; proposed: string; note: string }
  | { id: number; kind: "photo"; media_id: string; note: string };

// "Something looks wrong": flag fields (with the value you think is right) or
// photos (with a note), then send the work order back to the builder.
export function SendBackForm({
  action,
  refName,
  refValue,
  fields,
  photos,
}: {
  action: (fd: FormData) => Promise<void>;
  refName: string;
  refValue: string;
  fields: SendBackField[];
  photos: SendBackPhoto[];
}) {
  const [rows, setRows] = useState<Row[]>([{ id: 1, kind: "field", key: "", proposed: "", note: "" }]);
  const [next, setNext] = useState(2);
  const add = (kind: "field" | "photo") => {
    setRows((r) => [...r, kind === "field" ? { id: next, kind, key: "", proposed: "", note: "" } : { id: next, kind, media_id: "", note: "" }]);
    setNext((n) => n + 1);
  };
  const update = (id: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.id === id ? ({ ...x, ...patch } as Row) : x)));
  const remove = (id: number) => setRows((r) => r.filter((x) => x.id !== id));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const items = rows
    .filter((r) => (r.kind === "field" ? r.key && (r.proposed.trim() || r.note.trim()) : r.media_id && r.note.trim()))
    .map((r) =>
      r.kind === "field"
        ? { kind: "field", key: r.key, label: byKey.get(r.key)?.label ?? r.key, current: byKey.get(r.key)?.current ?? "", proposed: r.proposed, note: r.note }
        : { kind: "photo", media_id: r.media_id, note: r.note },
    );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name={refName} value={refValue} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      {rows.map((r, i) => (
        <div key={r.id} className="rounded-xl border border-line p-3">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
            <span>{i + 1}. {r.kind === "field" ? "A field" : "A photo"}</span>
            {rows.length > 1 && <button type="button" onClick={() => remove(r.id)} className="normal-case tracking-normal text-red-800 hover:underline">Remove</button>}
          </div>
          {r.kind === "field" ? (
            <div className="mt-2 grid gap-2">
              <select value={r.key} onChange={(e) => update(r.id, { key: e.target.value })} className="field-input" aria-label="Which field">
                <option value="">Pick the field…</option>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.current ? `: ${f.current.slice(0, 40)}` : ": (blank)"}</option>)}
              </select>
              {r.key && <p className="text-xs text-muted">Now: {byKey.get(r.key)?.current || "blank"}</p>}
              <input value={r.proposed} onChange={(e) => update(r.id, { proposed: e.target.value })} placeholder="What it should be" maxLength={2000} className="field-input" />
              <input value={r.note} onChange={(e) => update(r.id, { note: e.target.value })} placeholder="Why (optional)" maxLength={1000} className="field-input" />
            </div>
          ) : (
            <div className="mt-2 grid gap-2">
              <select value={r.media_id} onChange={(e) => update(r.id, { media_id: e.target.value })} className="field-input" aria-label="Which photo">
                <option value="">Pick the photo…</option>
                {photos.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <input value={r.note} onChange={(e) => update(r.id, { note: e.target.value })} placeholder="What's wrong: wrong order, blurry, missing room…" maxLength={1000} className="field-input" />
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" onClick={() => add("field")} className="rounded-lg border border-line px-3 py-1.5 font-semibold hover:border-foreground">+ Another field</button>
        {photos.length > 0 && <button type="button" onClick={() => add("photo")} className="rounded-lg border border-line px-3 py-1.5 font-semibold hover:border-foreground">+ A photo</button>}
      </div>
      <textarea name="note" rows={2} maxLength={2000} placeholder="Anything else for the builder (optional)" className="field-input" />
      <button disabled={items.length === 0} className={cx("w-full rounded-xl px-4 py-2.5 font-semibold text-white sm:w-auto", items.length ? "bg-foreground hover:bg-black" : "cursor-not-allowed bg-soft !text-muted")}>
        Send back to the builder{items.length ? ` (${items.length})` : ""}
      </button>
    </form>
  );
}
