"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Closes pop-up menus (<details data-popover>) when you click or tap outside
// them, press Escape, or move to another page.
export function PopoverCloser() {
  const path = usePathname();

  useEffect(() => {
    document.querySelectorAll<HTMLDetailsElement>("details[data-popover][open]").forEach((d) => (d.open = false));
  }, [path]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>("details[data-popover][open]").forEach((d) => {
        if (!d.contains(e.target as Node)) d.open = false;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      document.querySelectorAll<HTMLDetailsElement>("details[data-popover][open]").forEach((d) => {
        d.open = false;
        d.querySelector("summary")?.focus();
      });
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return null;
}
