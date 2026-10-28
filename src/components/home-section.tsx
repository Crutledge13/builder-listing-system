import type { ReactNode } from "react";

// One fold-out section on a home's page: a single line (title, a short count,
// a hint) that opens to the full section. Closed by default to save space; it
// opens on its own after a save in it (`open`) or when a link points at it
// (#id, handled by OpenSectionOnHash). Forms inside still send while closed.
export function HomeSection({
  id,
  title,
  badge,
  hint,
  open,
  tone,
  children,
}: {
  id?: string;
  title: string;
  badge?: string | null;
  hint?: string | null;
  open?: boolean;
  tone?: "attention";
  children: ReactNode;
}) {
  return (
    <details id={id} open={open} className="group scroll-mt-28 border-b border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-1 py-4 hover:bg-soft/60 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{title}</span>
            {badge && (
              <span className={tone === "attention" ? "rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900" : "rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent"}>
                {badge}
              </span>
            )}
          </span>
          {hint && <span className="mt-0.5 block truncate text-sm text-muted group-open:hidden">{hint}</span>}
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-muted transition-transform group-open:rotate-180" aria-hidden>
          <svg viewBox="0 0 16 16" className="h-4 w-4"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </summary>
      <div className="pb-8 pt-1">{children}</div>
    </details>
  );
}
