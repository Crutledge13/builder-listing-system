import { cx } from "@/lib/format";

// A simple "6 of 11 done" bar, used by the setup checklist and community setup.
export function ProgressBar({ done, total, label, className }: { done: number; total: number; label?: string; className?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={className}>
      {label !== undefined && (
        <p className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">{label}</span>
          <span className="tabular-nums text-muted">{done} of {total}</span>
        </p>
      )}
      <div
        className="h-2 overflow-hidden rounded-full bg-soft"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={label ?? `${done} of ${total} done`}
      >
        <div className={cx("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-600" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
