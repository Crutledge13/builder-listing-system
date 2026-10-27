import Link from "next/link";
import { cx } from "@/lib/format";
import { daysLeft, endsText, SCOPE_LABEL, type Incentive } from "@/lib/incentives";

// Current incentives, shown wherever a home or community is.
export function IncentiveList({ items, manageHref, showScope = true, compact }: { items: Incentive[]; manageHref?: string; showScope?: boolean; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className={cx("space-y-2", compact && "space-y-1.5")}>
      {items.map((i) => {
        const soon = daysLeft(i.ends_on) <= 7;
        return (
          <li key={i.id} className={cx("rounded-xl border px-4 py-3", soon ? "border-amber-300 bg-amber-50/60" : "border-violet-200 bg-violet-50/60")}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-semibold">{i.title}</span>
              <span className={cx("text-xs", soon ? "font-semibold text-amber-900" : "text-muted")}>{endsText(i.ends_on)}</span>
            </div>
            {!compact && i.details && <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{i.details}</p>}
            {(showScope || manageHref) && (
              <p className="mt-1 text-xs text-muted">
                {showScope && SCOPE_LABEL[i.scope]}
                {showScope && manageHref && " · "}
                {manageHref && <Link href={`${manageHref}#i-${i.id}`} className="underline">Extend or end</Link>}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
