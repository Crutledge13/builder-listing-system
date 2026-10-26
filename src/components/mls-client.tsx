"use client";

import { useState, useTransition } from "react";
import { cx } from "@/lib/format";

// Copies one value, so our team can paste it straight into the MLS form.
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
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
        } catch {
          /* clipboard blocked; nothing to do */
        }
      }}
      className={cx("shrink-0 rounded-md border px-2 py-1 text-xs font-semibold", done ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-line hover:border-foreground")}
    >
      {done ? "Copied" : label}
    </button>
  );
}

// Ticks a line off as entered in the MLS (saved on the task).
export function CheckOff({
  taskId,
  item,
  initial,
  action,
  disabled,
}: {
  taskId: string;
  item: string;
  initial: boolean;
  action: (taskId: string, item: string, on: boolean) => Promise<void>;
  disabled?: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <input
      type="checkbox"
      checked={on}
      disabled={disabled || pending}
      aria-label="Entered in the MLS"
      onChange={(e) => {
        const next = e.target.checked;
        setOn(next);
        start(async () => {
          try {
            await action(taskId, item, next);
          } catch {
            setOn(!next);
          }
        });
      }}
      className="h-5 w-5 shrink-0 cursor-pointer accent-[#3452c7]"
    />
  );
}
