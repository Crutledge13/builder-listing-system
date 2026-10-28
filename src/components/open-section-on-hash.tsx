"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Keeps people where they were on a page of folding sections:
// - Saving any form remembers which sections were open and the scroll spot;
//   when the page comes back from the save, they're reopened and scrolled to
//   the same place (owners, 28 Oct 2026: saving shouldn't close everything
//   and jump to the top).
// - Opening the page or clicking a link with a #section opens that section.
const KEY = "section-restore";

type Saved = { path: string; ids: string[]; y: number; t: number };

function openEl(el: HTMLElement) {
  let node: HTMLElement | null = el;
  while (node) {
    if (node instanceof HTMLDetailsElement) node.open = true;
    node = node.parentElement;
  }
}

// Back from a save: put the open sections and scroll spot back. Runs when the
// page first shows and again whenever the address changes (a save returns to
// the same page with ?saved=…, sometimes without a full reload).
let restoredAt = 0;

function restoreAfterSave(): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return false;
    const s = JSON.parse(raw) as Saved;
    if (s.path !== window.location.pathname || Date.now() - s.t > 60_000) {
      sessionStorage.removeItem(KEY);
      return false;
    }
    sessionStorage.removeItem(KEY);
    s.ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) openEl(el);
    });
    // Twice: once now, once after the browser's own jump to the #section.
    window.scrollTo({ top: s.y });
    setTimeout(() => window.scrollTo({ top: s.y }), 150);
    restoredAt = Date.now();
    return true;
  } catch {
    // Private windows can refuse storage; then the page simply starts at the top.
    return false;
  }
}

export function OpenSectionOnHash() {
  const search = useSearchParams().toString();
  useEffect(() => {
    restoreAfterSave();
  }, [search]);

  useEffect(() => {
    const openHash = (hash: string, scroll: boolean) => {
      if (!hash || hash.length < 2) return;
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (!el) return;
      openEl(el);
      if (scroll) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    };

    // Just put back after a save: stay put rather than jumping to the #section.
    if (Date.now() - restoredAt > 1000) openHash(window.location.hash, true);

    const onSubmit = () => {
      try {
        const ids = [...document.querySelectorAll<HTMLDetailsElement>("details[id]")].filter((d) => d.open).map((d) => d.id);
        sessionStorage.setItem(KEY, JSON.stringify({ path: window.location.pathname, ids, y: window.scrollY, t: Date.now() } satisfies Saved));
      } catch {
        // Nothing to do: the save still works.
      }
    };
    const onHash = () => {
      if (Date.now() - restoredAt > 1000) openHash(window.location.hash, true);
    };
    // Clicking the same #link twice doesn't change the hash, so catch clicks too.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href*='#']") as HTMLAnchorElement | null;
      if (!a || a.pathname !== window.location.pathname) return;
      openHash(a.hash, false);
    };
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
