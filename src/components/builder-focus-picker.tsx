"use client";

import { useRef } from "react";
import { cx } from "@/lib/format";

// The "Showing: All builders ▾" picker in the top bar for our team.
export function BuilderFocusPicker({
  builders,
  current,
  action,
}: {
  builders: { id: string; name: string }[];
  current: string | null;
  action: (fd: FormData) => Promise<void>;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action} className="shrink-0">
      <label className="sr-only" htmlFor="builder-focus">Show one builder</label>
      <select
        id="builder-focus"
        name="builder"
        defaultValue={current ?? ""}
        onChange={() => form.current?.requestSubmit()}
        className={cx(
          "max-w-[180px] cursor-pointer truncate rounded-full border py-1.5 pl-3 pr-7 text-sm font-semibold",
          current ? "border-accent bg-accent-soft text-accent" : "border-line bg-white",
        )}
        title="Show one builder on every page"
      >
        <option value="">All builders</option>
        {builders.map((b) => <option key={b.id} value={b.id}>{b.name.replace(" (demo)", "")}</option>)}
      </select>
    </form>
  );
}
