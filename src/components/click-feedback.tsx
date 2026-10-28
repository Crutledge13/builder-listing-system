"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Shows that a click "took" while the next page or a saved form loads:
// a thin blue bar across the top and a spinning cursor (CSS in globals.css,
// keyed off <html data-busy>). Starts on a click of a link to another page
// or on any form submit; stops when the new page arrives, when the page's
// content changes (forms that save in place), or after 15 seconds.
export function ClickFeedback() {
  const path = usePathname();
  const search = useSearchParams().toString();

  // New page arrived.
  useEffect(() => stop(), [path, search]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;

    const start = (watchContent: boolean) => {
      document.documentElement.dataset.busy = "1";
      clearTimeout(timer);
      timer = setTimeout(stop, 15000);
      observer?.disconnect();
      if (watchContent) {
        // Ignore the button's own "Saving…" change in the first moment.
        const startedAt = Date.now();
        observer = new MutationObserver(() => {
          if (Date.now() - startedAt > 300) {
            observer?.disconnect();
            stop();
          }
        });
        const main = document.querySelector("main") ?? document.body;
        observer.observe(main, { childList: true, subtree: true, characterData: true });
      }
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname.startsWith("/api/")) return; // file downloads
      if (url.pathname === location.pathname && url.search === location.search) return; // same page or #anchor
      start(false);
    };

    const onSubmit = (e: SubmitEvent) => {
      if (e.defaultPrevented) return;
      const form = e.target as HTMLFormElement;
      if (form.method === "dialog") return;
      start(true);
    };

    const onShow = () => stop(); // back button from the browser cache

    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onShow);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  return <div className="busy-bar print:hidden" aria-hidden />;
}

function stop() {
  delete document.documentElement.dataset.busy;
}
