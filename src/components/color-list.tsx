"use client";

import { useState } from "react";

type Color = { name: string; hex: string };

// Any number of named brand colors. Submits them as JSON in one hidden field.
export function ColorList({ name = "colors", initial, disabled }: { name?: string; initial: Color[]; disabled?: boolean }) {
  const [colors, setColors] = useState<Color[]>(initial.length ? initial : []);
  const set = (i: number, patch: Partial<Color>) => setColors((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, by: number) =>
    setColors((cs) => {
      const next = [...cs];
      const [c] = next.splice(i, 1);
      next.splice(Math.max(0, Math.min(next.length, i + by)), 0, c);
      return next;
    });

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(colors)} />
      {colors.length === 0 && <p className="text-sm text-muted">No colors yet.</p>}
      <ul className="space-y-2">
        {colors.map((c, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "#000000"}
              onChange={(e) => set(i, { hex: e.target.value })}
              disabled={disabled}
              className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-white p-1"
              aria-label={`Color ${i + 1}`}
            />
            <input
              value={c.hex}
              onChange={(e) => set(i, { hex: e.target.value.trim().startsWith("#") ? e.target.value.trim() : `#${e.target.value.trim()}` })}
              disabled={disabled}
              maxLength={7}
              className="field-input w-28 py-1.5 font-mono text-sm"
              aria-label="Hex code"
            />
            <input
              value={c.name}
              onChange={(e) => set(i, { name: e.target.value })}
              disabled={disabled}
              maxLength={40}
              placeholder={i === 0 ? "Main color" : "Name, e.g. Accent gold"}
              className="field-input min-w-[140px] flex-1 py-1.5 text-sm"
              aria-label="Color name"
            />
            {!disabled && (
              <span className="flex items-center gap-1 text-sm">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded-lg px-2 py-1 hover:bg-soft disabled:opacity-30" aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === colors.length - 1} className="rounded-lg px-2 py-1 hover:bg-soft disabled:opacity-30" aria-label="Move down">↓</button>
                <button type="button" onClick={() => setColors((cs) => cs.filter((_, j) => j !== i))} className="rounded-lg px-2 py-1 text-red-700 hover:bg-red-50">Remove</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {!disabled && colors.length < 16 && (
        <button type="button" onClick={() => setColors((cs) => [...cs, { name: "", hex: "#3452c7" }])} className="mt-2 rounded-xl border border-dashed border-line px-4 py-2 text-sm font-semibold hover:border-foreground">
          + Add a color
        </button>
      )}
      <p className="mt-2 text-xs text-muted">The first color is the main one. Use the arrows to reorder.</p>
    </div>
  );
}
