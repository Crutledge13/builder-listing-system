"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { nameCurrentPage, recordPage, rememberSection } from "@/lib/nav-trail";

// Keeps the tab's trail of pages (src/lib/nav-trail.ts) up to date, so every
// BackButton can go to the page the person came from. In the root layout.
export function NavTrail() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    recordPage(pathname, search);
    // The page's heading may still be streaming in: name the page once it's there.
    nameCurrentPage();
    const watch = new MutationObserver(() => nameCurrentPage());
    watch.observe(document.body, { childList: true, subtree: true });
    const stop = window.setTimeout(() => watch.disconnect(), 8000);
    return () => {
      watch.disconnect();
      window.clearTimeout(stop);
    };
  }, [pathname, search]);

  useEffect(() => {
    // Leaving by a link: note the section it was in, so Back reopens it.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.origin !== window.location.origin || a.pathname === window.location.pathname) return;
      rememberSection(a);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
