"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Every click that loads something gets feedback right away, everywhere in
// the app, so nobody wonders whether it "took" or clicks twice:
//   - a blue bar slides across the top (<html data-busy>); the pointer stays normal
//   - the link or button that was clicked dims and shows a small spinner
//     (data-pending), and further clicks on it are ignored
//   - after half a second, a "One moment…" note appears under the header
//   - a form can't be sent a second time while the first send is running
// It starts on a click of a link to another page and on any form submit, and
// stops when the new page arrives, when the page's content changes (forms
// that save in place), or after 15 seconds. Styles are in globals.css.
//
// The listeners run in the capture phase on window, before React and Next.js
// handle the event (Next.js links and server-action forms cancel the
// browser's default, so a later listener would never know they were used).
export function ClickFeedback() {
  const path = usePathname();
  const search = useSearchParams().toString();

  // New page arrived. Next.js shows the new address straight away with grey
  // loading placeholders (Suspense fallbacks, "animate-pulse"), so keep the
  // feedback up until those are replaced by the real content.
  useEffect(() => whenLoaded(stop), [path, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Already working on this one: swallow the repeat click.
      if (target?.closest?.("[data-pending]")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname.startsWith("/api/") || /\/file\/|\/logo$/.test(url.pathname)) return; // file downloads
      if (url.pathname === location.pathname && url.search === location.search) return; // same page or #anchor
      start({ el: a, watchContent: false });
    };

    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (form.method === "dialog" || (form.target && form.target !== "_self")) return;
      // A second send while the first is still running.
      if (form.hasAttribute("data-pending-form")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // Let anything that cancels the submit (a "Are you sure?" answered No)
      // run first, then show feedback only if the submit is really going ahead.
      queueMicrotask(() => {
        if (e.defaultPrevented && !isReactForm(form)) return;
        form.setAttribute("data-pending-form", "");
        const button = e.submitter instanceof HTMLElement ? e.submitter : form.querySelector<HTMLElement>("button[type=submit], button:not([type]), input[type=submit]");
        start({ el: button, watchContent: true });
      });
    };

    const onShow = () => stop(); // back button from the browser cache

    window.addEventListener("click", onClick, true);
    window.addEventListener("submit", onSubmit, true);
    window.addEventListener("pageshow", onShow);
    return () => {
      stop();
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  return (
    <>
      <div className="busy-bar print:hidden" aria-hidden />
      <div className="busy-note print:hidden" aria-hidden>
        <span className="busy-note-spinner" aria-hidden />
        One moment…
      </div>
    </>
  );
}

// Forms whose action is a server action: React cancels the browser's own
// submit and sends it itself, so a cancelled event still means "sending".
function isReactForm(form: HTMLFormElement) {
  const action = form.getAttribute("action");
  return action === null || action.startsWith("javascript:");
}

let timer: ReturnType<typeof setTimeout> | undefined;
let loadWatch: MutationObserver | undefined;

function stillLoading() {
  return !!document.querySelector("main .animate-pulse, body > .animate-pulse, header + .animate-pulse");
}

function whenLoaded(done: () => void) {
  loadWatch?.disconnect();
  if (!document.documentElement.dataset.busy || !stillLoading()) return done();
  loadWatch = new MutationObserver(() => {
    if (!stillLoading()) {
      loadWatch?.disconnect();
      loadWatch = undefined;
      done();
    }
  });
  loadWatch.observe(document.body, { childList: true, subtree: true });
}
let noteTimer: ReturnType<typeof setTimeout> | undefined;
let observer: MutationObserver | undefined;

function start({ el, watchContent }: { el: Element | null | undefined; watchContent: boolean }) {
  const html = document.documentElement;
  html.dataset.busy = "1";
  el?.setAttribute("data-pending", "");
  clearTimeout(timer);
  clearTimeout(noteTimer);
  timer = setTimeout(stop, 15000);
  noteTimer = setTimeout(() => {
    if (html.dataset.busy) html.dataset.busyNote = "1";
  }, 500);
  observer?.disconnect();
  if (watchContent) {
    // Forms that save in place: done when the page's content changes. The
    // clicked button's own "Saving…" change in the first moment doesn't count.
    const startedAt = Date.now();
    observer = new MutationObserver(() => {
      if (Date.now() - startedAt > 300 && !stillLoading()) stop();
    });
    observer.observe(document.querySelector("main") ?? document.body, { childList: true, subtree: true, characterData: true });
  }
}

function stop() {
  loadWatch?.disconnect();
  loadWatch = undefined;
  clearTimeout(timer);
  clearTimeout(noteTimer);
  observer?.disconnect();
  observer = undefined;
  const html = document.documentElement;
  delete html.dataset.busy;
  delete html.dataset.busyNote;
  document.querySelectorAll("[data-pending]").forEach((el) => el.removeAttribute("data-pending"));
  document.querySelectorAll("[data-pending-form]").forEach((el) => el.removeAttribute("data-pending-form"));
}
