"use client";

import { useEffect } from "react";

// Opens a folded section when the page is opened or clicked to with its
// #anchor (the tiles at the top of a home, links from tasks and notices).
export function OpenSectionOnHash() {
  useEffect(() => {
    const open = (hash: string, scroll: boolean) => {
      if (!hash || hash.length < 2) return;
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (!el) return;
      let node: HTMLElement | null = el;
      while (node) {
        if (node instanceof HTMLDetailsElement) node.open = true;
        node = node.parentElement;
      }
      if (scroll) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    open(window.location.hash, true);
    const onHash = () => open(window.location.hash, true);
    // Clicking the same #link twice doesn't change the hash, so catch clicks too.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href*='#']") as HTMLAnchorElement | null;
      if (!a || a.pathname !== window.location.pathname) return;
      open(a.hash, false);
    };
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
