"use client";

import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { cx } from "@/lib/format";

// The MLS work sheet's ticks (owners, 31 Oct 2026: "too many little steps").
// People no longer tick every line: each MLS tab gets one "Done" that saves a
// `tab:<title>` key on the task. Older tasks whose lines were ticked one by one
// still count a tab as done when every line on it was ticked.
type Checks = {
  has: (item: string) => boolean;
  set: (item: string, on: boolean) => void;
  can: boolean; // false on a reference copy or a closed task
};

const ChecksContext = createContext<Checks>({ has: () => false, set: () => {}, can: false });

export function SheetChecks({
  taskId,
  initial,
  action,
  disabled,
  children,
}: {
  taskId?: string;
  initial: string[];
  action?: (taskId: string, item: string, on: boolean) => Promise<void>;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [checked, setChecked] = useState(() => new Set(initial));
  const [, start] = useTransition();
  const can = !!(taskId && action && !disabled);
  const set = (item: string, on: boolean) => {
    if (!can || checked.has(item) === on) return;
    const flip = (v: boolean) =>
      setChecked((prev) => {
        const next = new Set(prev);
        if (v) next.add(item);
        else next.delete(item);
        return next;
      });
    flip(on);
    start(async () => {
      try {
        await action!(taskId!, item, on);
      } catch {
        flip(!on);
      }
    });
  };
  return <ChecksContext.Provider value={{ has: (i) => checked.has(i), set, can }}>{children}</ChecksContext.Provider>;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false; // clipboard blocked; nothing to do
  }
}

// One line of the sheet: the whole row is the copy button. Click anywhere on
// it and the value is on the clipboard, ready to paste into the MLS.
// before: on an update, what the MLS has now (shown crossed out above the new value).
export function CopyRow({ label, sub, value, paste, long, before, className }: { label: string; sub?: string; value: ReactNode; paste: string; long?: boolean; before?: string; className?: string }) {
  const [done, setDone] = useState(false);
  if (!paste) {
    return (
      <div className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[13rem_minmax(0,1fr)_4.5rem]", className)}>
        <span className="col-span-2 text-sm text-muted sm:col-span-1">{label}{sub && <span className="block text-xs">{sub}</span>}</span>
        <span className="min-w-0 break-words">
          {before !== undefined && <span className="block text-sm text-muted">Now: <span className="line-through decoration-red-400">{before || "—"}</span></span>}
          <span className="text-[15px] font-semibold">{value}</span>
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(paste)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
      aria-label={`Copy ${label}`}
      className={cx(
        "group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 text-left transition-colors sm:grid-cols-[13rem_minmax(0,1fr)_4.5rem]",
        done ? "bg-emerald-50" : "hover:bg-accent-soft/60",
        className,
      )}
    >
      <span className="col-span-2 text-sm text-muted sm:col-span-1">
        {label}
        {sub && <span className="block text-xs">{sub}</span>}
      </span>
      <span className="min-w-0 break-words">
        {before !== undefined && <span className="block text-sm text-muted">Now: <span className="line-through decoration-red-400">{before || "—"}</span></span>}
        <span className={cx("block whitespace-pre-line", long ? "text-[15px] leading-relaxed" : "text-lg font-bold tabular-nums")}>{value}</span>
      </span>
      <span className={cx("justify-self-end text-sm font-bold", done ? "text-emerald-700" : "text-accent sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100")}>
        {done ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

export type SheetTabInfo = { id: string; title: string; items: string[]; count: number };

export const tabKey = (title: string) => `tab:${title}`;

// Matrix's tabs down the side (a pick-list on phones), one tab's boxes at a
// time, and one big "Done with … · Next" button per tab. The last tab is the
// finish (photos, MLS number, send), so it has no Done button.
export function SheetTabs({ tabs, panels }: { tabs: SheetTabInfo[]; panels: ReactNode[] }) {
  const c = useContext(ChecksContext);
  const [open, setOpen] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const isDone = (t: SheetTabInfo) => c.has(tabKey(t.title)) || (t.items.length > 0 && t.items.every((i) => c.has(i)));
  const work = tabs.slice(0, -1); // every tab but the finish
  const doneCount = work.filter(isDone).length;
  const go = (i: number) => {
    setOpen(i);
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const last = open === tabs.length - 1;
  const next = tabs[open + 1];
  const prev = tabs[open - 1];

  return (
    <div ref={top} className="scroll-mt-24">
      {c.can && (
        <div className="mb-4 flex items-center gap-3">
          <div className="h-1.5 max-w-xs flex-1 overflow-hidden rounded-full bg-soft">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${work.length ? Math.round((doneCount / work.length) * 100) : 0}%` }} />
          </div>
          <span className="shrink-0 text-sm font-semibold">{doneCount} of {work.length} tabs done</span>
        </div>
      )}

      {/* Phones: the tabs as one pick-list */}
      <label className="mb-4 block text-xs font-semibold text-muted lg:hidden">
        MLS tab
        <select value={open} onChange={(e) => go(Number(e.target.value))} className="mt-1 block h-11 w-full rounded-xl border border-line bg-white px-3 text-base font-bold text-foreground">
          {tabs.map((t, i) => (
            <option key={t.id} value={i}>{i + 1}. {t.title}{isDone(t) ? " ✓" : ""}</option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav aria-label="MLS tabs" className="hidden w-56 shrink-0 lg:sticky lg:top-24 lg:block">
          <ol className="space-y-0.5">
            {tabs.map((t, i) => {
              const done = isDone(t);
              const cur = i === open;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={cur ? "step" : undefined}
                    className={cx("flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left", cur ? "bg-foreground text-white" : "hover:bg-soft")}
                  >
                    <span
                      className={cx(
                        "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold",
                        done ? "bg-emerald-700 text-white" : cur ? "bg-white text-foreground" : "border-[1.5px] border-[#9aa0aa]",
                      )}
                    >
                      {done ? <Tick /> : i + 1}
                    </span>
                    <span className={cx("flex-1 text-[15px]", cur ? "font-bold" : "font-medium")}>{t.title}</span>
                    {t.count > 0 && <span className={cx("text-xs", cur ? "text-white/70" : "text-muted")}>{t.count}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[22px] font-extrabold tracking-tight">{tabs[open].title}</h2>
            <span className="text-sm text-muted">{last ? "Upload the photos in this order, then finish." : "Click a value to copy it. Blue boxes: tick or pick these."}</span>
          </div>
          {panels[open]}

          {!last && (
            <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex items-center justify-between gap-3 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
              <button type="button" onClick={() => go(open - 1)} className={cx("hidden h-11 rounded-xl border border-line px-4 text-sm font-semibold hover:border-foreground sm:block", !prev && "invisible")}>
                ← {prev?.title ?? ""}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (c.can) c.set(tabKey(tabs[open].title), true);
                  go(open + 1);
                }}
                className="h-12 w-full rounded-xl bg-accent px-6 text-base font-bold text-white hover:brightness-110 sm:w-auto"
              >
                {c.can ? `Done · Next: ${next.title} →` : `Next: ${next.title} →`}
              </button>
            </div>
          )}
          {last && prev && (
            <button type="button" onClick={() => go(open - 1)} className="mt-5 h-11 rounded-xl border border-line px-4 text-sm font-semibold hover:border-foreground">← {prev.title}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Opens this same sheet in a narrow window to sit next to Matrix.
export function OpenBesideMatrix() {
  return (
    <button
      type="button"
      onClick={() => {
        const w = 560;
        const left = Math.max(0, window.screen.availWidth - w);
        window.open(window.location.href, "mls-sheet", `popup,width=${w},height=${window.screen.availHeight},left=${left},top=0`);
      }}
      className="h-10 rounded-xl border border-line px-3 text-sm font-semibold hover:border-foreground"
    >
      Open beside the MLS ↗
    </button>
  );
}
