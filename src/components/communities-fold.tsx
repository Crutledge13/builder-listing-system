import { Chevron } from "@/components/chevron";

// A salesperson's communities folded to one line ("Communities: Oak Creek,
// Willow Bend Ranch +3"), opening to the picker and its Save button.
export function CommunitiesFold({ names, total, children }: { names: string[]; total: number; children: React.ReactNode }) {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const shown = sorted.slice(0, 2).join(", ");
  const more = sorted.length > 2 ? ` +${sorted.length - 2}` : "";
  const summary = sorted.length === 0 ? "None yet" : sorted.length === total && total > 1 ? `All ${total}` : shown + more;
  return (
    <details className="group mt-3 rounded-xl bg-soft">
      <summary className="flex items-center gap-2 px-3 py-2.5 text-sm">
        <span className="font-medium">Communities:</span>
        <span className="min-w-0 flex-1 truncate text-muted">{summary}</span>
        <span className="text-xs font-semibold text-accent group-open:hidden">Change</span>
        <Chevron />
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}
