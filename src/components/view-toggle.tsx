"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cx } from "@/lib/format";

// Remembered for a year in this browser.
function remember(name: string, v: string) {
  document.cookie = `${name}_view=${v}; path=/; max-age=31536000; samesite=lax`;
}

// Cards or a list (owners, 29 Oct 2026: some builders want every home or
// community on one screen with the key facts). The choice is remembered in
// this browser for that page (a cookie the server reads), so it sticks.
export function ViewToggle({ name, view }: { name: "homes" | "communities"; view: "cards" | "list" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (v: "cards" | "list") => {
    if (v === view) return;
    remember(name, v);
    start(() => router.refresh());
  };
  return (
    <div className={cx("inline-flex rounded-full border border-line bg-white p-1 shadow-sm", pending && "opacity-60")} role="group" aria-label="Show as">
      {(["cards", "list"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => pick(v)}
          aria-pressed={view === v}
          className={cx("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold", view === v ? "bg-foreground text-white" : "text-muted hover:text-foreground")}
        >
          {v === "cards" ? (
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M2 3h12M2 8h12M2 13h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          )}
          {v === "cards" ? "Cards" : "List"}
        </button>
      ))}
    </div>
  );
}
