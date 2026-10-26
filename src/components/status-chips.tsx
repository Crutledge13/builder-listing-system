import Link from "next/link";
import { STATUS_LABELS, type WorkflowStatus } from "@/lib/permissions";
import { cx } from "@/lib/format";

const STATUSES = Object.keys(STATUS_LABELS) as WorkflowStatus[];

// Pill filters for listing status, with a count on each.
export function StatusChips({
  active,
  counts,
  total,
  hrefFor,
}: {
  active: WorkflowStatus | null;
  counts: Map<string, number>;
  total: number;
  hrefFor: (s: WorkflowStatus | null) => string;
}) {
  return (
    <div className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {[null, ...STATUSES].map((s) => {
        const on = active === s;
        return (
          <Link
            key={s ?? "all"}
            href={hrefFor(s)}
            className={cx(
              "shrink-0 rounded-full border px-4 py-2 text-sm transition-colors",
              on ? "border-foreground bg-foreground font-semibold text-white" : "border-line hover:border-foreground",
            )}
          >
            {s ? STATUS_LABELS[s] : "All"}
            <span className={cx("ml-2", on ? "text-white/70" : "text-muted")}>{s ? (counts.get(s) ?? 0) : total}</span>
          </Link>
        );
      })}
    </div>
  );
}
