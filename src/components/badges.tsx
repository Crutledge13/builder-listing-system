import { STATUS_LABELS, STAGE_LABELS, type WorkflowStatus } from "@/lib/permissions";
import { cx } from "@/lib/format";

const DOT: Record<WorkflowStatus, string> = {
  draft: "bg-stone-400",
  in_review: "bg-amber-500",
  approved_for_mls: "bg-[#3452c7]",
  live_on_mls: "bg-emerald-500",
};

// A white pill with a colored dot: reads cleanly on top of a picture or on white.
export function StatusBadge({ status, floating }: { status: WorkflowStatus; floating?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold text-foreground",
        floating ? "bg-white/95 shadow-sm backdrop-blur" : "border border-line bg-white",
      )}
    >
      <span className={cx("h-2 w-2 rounded-full", DOT[status])} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function StageText({ stage }: { stage: string }) {
  return <span className="whitespace-nowrap">{STAGE_LABELS[stage] ?? stage}</span>;
}

const SOURCE_STYLES: Record<string, string> = {
  website: "bg-violet-50 text-violet-700",
  staff: "bg-soft text-muted",
  mls: "bg-emerald-50 text-emerald-700",
};

const SOURCE_LABELS: Record<string, string> = {
  website: "From website",
  staff: "Entered by staff",
  mls: "From MLS",
};

// Where a field's value came from: website, staff or MLS.
export function SourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  return (
    <span className={cx("rounded-full px-2 py-px text-[11px] font-medium", SOURCE_STYLES[source] ?? SOURCE_STYLES.staff)}>
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

const MARKET_STYLES: Record<string, string> = {
  paused: "bg-amber-100 text-amber-900",
  under_contract: "bg-violet-100 text-violet-900",
  sold: "bg-foreground text-white",
  withdrawn: "bg-stone-200 text-stone-800",
};
const MARKET_TEXT: Record<string, string> = {
  paused: "Paused",
  under_contract: "Under contract",
  sold: "Sold",
  withdrawn: "Off the market",
};

// Shown only when a live listing isn't simply active.
export function MarketBadge({ status, floating }: { status: string | null | undefined; floating?: boolean }) {
  if (!status || status === "active") return null;
  return (
    <span className={cx("inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", MARKET_STYLES[status], floating && "shadow-sm")}>
      {MARKET_TEXT[status] ?? status}
    </span>
  );
}
