// The pages someone has been through in this tab, so "Back" buttons go to the
// page they actually came from (a home, a task, a search) instead of a fixed
// parent page. Kept in sessionStorage: one trail per browser tab, gone when the
// tab closes. Saves on the same page (?saved=...) don't add a step, and going
// back (our button or the browser's) takes the step off again.

export type TrailStep = {
  path: string; // pathname only, to tell pages apart
  url: string; // pathname + search, without one-time notices
  name: string; // the page's main heading, for "Back to ..."
  hash?: string; // the section they were in when they left (#listing-media)
};

const KEY = "nav-trail";
const EVENT = "nav-trail-change";
const MAX = 30;
// One-time notices and highlights: returning to the page shouldn't show them again.
const DROP = ["saved", "error", "at", "undo", "link"];

export function readTrail(): TrailStep[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as TrailStep[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeTrail(list: TrailStep[]) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Private windows can refuse storage; Back falls back to its usual page.
  }
}

export function cleanUrl(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  for (const k of DROP) params.delete(k);
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

function pageName() {
  // A page can name itself for Back buttons (data-back-name), e.g. a home's
  // media folder is "Photos of 213 Pecan Ridge Dr", not the home itself.
  const own = document.querySelector("[data-back-name]")?.getAttribute("data-back-name");
  const h = document.querySelector("main h1") ?? document.querySelector("h1");
  const text = (own ?? h?.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 48 ? `${text.slice(0, 45).trim()}…` : text;
}

// Called on every page change.
export function recordPage(pathname: string, search: string) {
  const list = readTrail();
  const url = cleanUrl(pathname, search);
  const prev = list[list.length - 2];
  const top = list[list.length - 1];
  if (prev && prev.path === pathname) {
    list.pop(); // went back a step
    prev.url = url;
  } else if (top && top.path === pathname) {
    top.url = url; // same page (a save, a filter)
  } else {
    list.push({ path: pathname, url, name: "" });
  }
  writeTrail(list);
}

// The heading appears once the page has streamed in; fill it in when it does.
export function nameCurrentPage() {
  const list = readTrail();
  const top = list[list.length - 1];
  if (!top || top.path !== window.location.pathname) return;
  const name = pageName();
  if (name && name !== top.name) {
    top.name = name;
    writeTrail(list);
  }
}

// Leaving this page by a link: remember which section it was clicked from.
export function rememberSection(from: Element) {
  const list = readTrail();
  const top = list[list.length - 1];
  if (!top || top.path !== window.location.pathname) return;
  const section = from.closest("details[id], section[id]");
  top.hash = section?.id ? `#${section.id}` : undefined;
  if (!top.name) top.name = pageName();
  writeTrail(list);
}

// Where "Back" should go from `current` (a pathname): the page before it.
// The button can ask before the new page has been recorded (it renders first),
// so this works whether or not `current` is on the trail yet.
export function backStep(current: string): TrailStep | null {
  const list = readTrail();
  const n = list.length;
  let step: TrailStep | undefined;
  if (list[n - 1]?.path === current) step = list[n - 2]; // recorded
  else if (list[n - 2]?.path === current) step = list[n - 3]; // going back, not recorded yet
  else step = list[n - 1]; // a new page, not recorded yet
  return step && step.path !== current ? step : null;
}

// Tell back buttons on the page the trail changed (a page name came in).
export function onTrailChange(fn: () => void) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
