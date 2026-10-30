"use client";

import { useEffect } from "react";
import { withCommas } from "@/lib/money-input";

// Adds thousands commas to price boxes while people type (owners, 29 Oct 2026:
// "389990" is easy to misread). Any <input data-money> anywhere in the app gets
// it; nothing to add per page. Servers already strip "$" and "," when saving.
// Mounted once in the root layout.
function format(input: HTMLInputElement) {
  const before = input.value;
  const next = withCommas(before);
  if (next === before) return;
  // Keep the cursor after the same digit it was after.
  const caret = input.selectionStart ?? before.length;
  const digitsBefore = before.slice(0, caret).replace(/[^\d.]/g, "").length;
  input.value = next;
  if (document.activeElement !== input) return;
  let pos = 0;
  for (let seen = 0; pos < next.length && seen < digitsBefore; pos++) if (/[\d.]/.test(next[pos])) seen++;
  input.setSelectionRange(pos, pos);
}

export function MoneyCommas() {
  useEffect(() => {
    const onInput = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.matches("input[data-money]")) format(t);
      // "Start from something" fills a whole form at once and then sends one
      // input event from the form itself.
      else if (t instanceof HTMLFormElement) t.querySelectorAll<HTMLInputElement>("input[data-money]").forEach(format);
    };
    document.addEventListener("input", onInput, true);
    document.querySelectorAll<HTMLInputElement>("input[data-money]").forEach(format);
    return () => document.removeEventListener("input", onInput, true);
  }, []);
  return null;
}
