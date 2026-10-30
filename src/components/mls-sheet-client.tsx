"use client";

import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { cx } from "@/lib/format";

// The MLS sheet's ticks, shared by every line, tab and counter on the page so
// counts update the moment a line is ticked (or copied, which ticks it).
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

export function SheetTick({ item, label = "Entered in the MLS" }: { item: string; label?: string }) {
  const c = useContext(ChecksContext);
  if (!c.can) return null;
  return (
    <input
      type="checkbox"
      checked={c.has(item)}
      aria-label={label}
      onChange={(e) => c.set(item, e.target.checked)}
      className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[#3452c7]"
    />
  );
}

// Copies one value for pasting into the MLS, and ticks its line.
export function SheetCopy({ value, item, label = "Copy" }: { value: string; item?: string; label?: string }) {
  const c = useContext(ChecksContext);
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
          if (item) c.set(item, true);
        } catch {
          /* clipboard blocked; nothing to do */
        }
      }}
      className={cx(
        "shrink-0 rounded-lg border px-3 py-1.5 text-sm font-semibold",
        done ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-line bg-white hover:border-foreground",
      )}
    >
      {done ? "Copied" : label}
    </button>
  );
}

// A line goes grey once it's ticked, so what's left stands out.
export function SheetLineShell({ item, children, className }: { item: string; children: ReactNode; className?: string }) {
  const c = useContext(ChecksContext);
  return <div className={cx(className, c.has(item) && "bg-soft/60 [&_.sheet-value]:text-muted")}>{children}</div>;
}

export type SheetTabInfo = { id: string; title: string; items: string[]; missing: number };

// Matrix's tabs across the top, one tab's fields at a time, with how many
// lines are left on each. "Next" moves to the next tab like Matrix does.
export function SheetTabs({ tabs, panels, total, stickyClass = "top-16" }: { tabs: SheetTabInfo[]; panels: ReactNode[]; total: string[]; stickyClass?: string }) {
  const c = useContext(ChecksContext);
  const [open, setOpen] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const left = (items: string[]) => items.filter((i) => !c.has(i)).length;
  const go = (i: number) => {
    setOpen(i);
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const doneAll = total.length - left(total);
  return (
    <div ref={top} className="scroll-mt-24">
      <div className={cx("sticky z-10 -mx-1 bg-white/95 px-1 pb-2 pt-1 backdrop-blur", stickyClass)}>
        {c.can && (
          <div className="mb-2 flex items-center gap-3 text-sm">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-soft">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${total.length ? Math.round((doneAll / total.length) * 100) : 0}%` }} />
            </div>
            <span className="shrink-0 text-muted">{doneAll} of {total.length} entered</span>
          </div>
        )}
        <div role="tablist" className="flex flex-wrap gap-1.5">
          {tabs.map((t, i) => {
            const n = left(t.items);
            const finished = c.can && t.items.length > 0 && n === 0;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={open === i}
                onClick={() => go(i)}
                className={cx(
                  "shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold",
                  open === i ? "border-foreground bg-foreground text-white" : "border-line bg-white hover:border-foreground",
                )}
              >
                {finished && "✓ "}
                {t.title}
                {!finished && t.items.length > 0 && <span className={cx("ml-1.5 text-xs font-normal", open === i ? "text-white/75" : "text-muted")}>{c.can ? n : t.items.length}</span>}
                {t.missing > 0 && <span className="ml-1 text-amber-600" title={`${t.missing} required missing`}>●</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2">{panels[open]}</div>
      <div className="mt-4 flex items-center justify-between gap-2">
        {open > 0 ? (
          <button type="button" onClick={() => go(open - 1)} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">← {tabs[open - 1].title}</button>
        ) : <span />}
        {open < tabs.length - 1 && (
          <button type="button" onClick={() => go(open + 1)} className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white hover:bg-black">Next: {tabs[open + 1].title} →</button>
        )}
      </div>
    </div>
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
      className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-foreground"
    >
      Open beside the MLS ↗
    </button>
  );
}
