import { STATUS_LABELS, STAGE_LABELS, type WorkflowStatus } from "@/lib/permissions";
import { cx } from "@/lib/format";

const STATUS_STYLES: Record<WorkflowStatus, string> = {
  draft: "bg-stone-100 text-stone-700",
  in_review: "bg-amber-100 text-amber-800",
  approved_for_mls: "bg-sky-100 text-sky-800",
  live_on_mls: "bg-emerald-100 text-emerald-800",
};

export function StatusBadge({ status }: { status: WorkflowStatus }) {
  return (
    <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function StageText({ stage }: { stage: string }) {
  return <span className="whitespace-nowrap">{STAGE_LABELS[stage] ?? stage}</span>;
}

const SOURCE_STYLES: Record<string, string> = {
  website: "bg-violet-50 text-violet-700",
  staff: "bg-stone-100 text-stone-600",
  mls: "bg-emerald-50 text-emerald-700",
};

// Where a field's value came from: website, staff or MLS.
export function SourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  return (
    <span className={cx("rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide", SOURCE_STYLES[source] ?? SOURCE_STYLES.staff)}>
      {source === "mls" ? "MLS" : source}
    </span>
  );
}
