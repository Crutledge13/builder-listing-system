import { createClient } from "@/lib/supabase/server";
import { creditStatus, resetsOn } from "@/lib/ai-credits";
import { num } from "@/lib/format";

// "AI credits: 2,340 of 2,500 left this month". Shows for the builder's own
// people; our team's AI use never counts against a builder, so staff get a note.
export async function AiCreditMeter({ builderId, staff = false, compact = false }: { builderId: string | null; staff?: boolean; compact?: boolean }) {
  if (staff) {
    return compact ? null : <p className="text-xs text-muted">AI runs by our team are free for the builder and don’t use their credits.</p>;
  }
  if (!builderId) return null;
  const s = await creditStatus(await createClient(), builderId);
  if (!s) return null;
  const total = s.allowance + s.extra;
  const pct = total ? Math.min(100, Math.round((s.used / total) * 100)) : 100;
  const low = s.left < Math.max(s.costs.plan_read, total * 0.1);
  return (
    <div className={`rounded-2xl border p-3 text-sm ${low ? "border-amber-300 bg-amber-50" : "border-line"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p>
          <span className="font-semibold">AI credits:</span> {num(s.left)} of {num(total)} left this month
          {s.extra ? <span className="text-muted"> (includes {num(s.extra)} extra)</span> : null}
        </p>
        <p className="text-xs text-muted">Resets {resetsOn(s)}</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft" aria-hidden>
        <div className={`h-full ${low ? "bg-amber-500" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <p className="mt-2 text-xs text-muted">
          Labeling a photo uses {s.costs.photo_label} credit. Reading a floor plan uses {s.costs.plan_read}.
          {s.left === 0 ? " Uploads still work while you’re out; AI just waits until the reset. Ask our team if you need more." : ""}
        </p>
      )}
    </div>
  );
}
