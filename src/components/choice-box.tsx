"use client";

import type { ReactNode } from "react";

// A box of checkboxes. When the choices include "None", ticking None clears
// the others and ticking anything else clears None, so an answer can't say
// "Audio" and "None" at once (tester notes, 28 Oct 2026).
export function ChoiceBox({ noneValue, className, children }: { noneValue?: string; className?: string; children: ReactNode }) {
  return (
    <span
      className={className}
      onChange={(e) => {
        const box = e.target as HTMLInputElement;
        if (!noneValue || box.type !== "checkbox" || !box.checked) return;
        const all = (e.currentTarget as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
        for (const other of all) {
          if (other === box) continue;
          if (box.value === noneValue ? other.checked : other.value === noneValue && other.checked) other.checked = false;
        }
      }}
    >
      {children}
    </span>
  );
}
