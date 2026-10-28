import { cx } from "@/lib/format";
import { dayLabel, KIND_LABELS, monthLabel, usd, type Charge } from "@/lib/billing";
import { PendingButton } from "@/components/pending-button";
import { restoreCharge, voidCharge } from "@/app/(app)/admin/billing/actions";

// One charge in Admin > Billing, with Remove (void, with a reason) or Put back.
export function ChargeRow({ c, back, onDraft, invoiced }: { c: Charge; back: string; onDraft?: boolean; invoiced?: boolean }) {
  const voided = !!c.voided_at;
  return (
    <div className="flex flex-wrap items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className={cx("font-medium", voided && "text-muted line-through")}>{c.description}</div>
        <div className="text-sm text-muted">
          {KIND_LABELS[c.kind]} · {dayLabel(c.occurred_on)}
          {!voided && !invoiced && ` · goes on the ${monthLabel(c.invoice_month)} invoice${onDraft ? " (on the draft now)" : ""}`}
          {invoiced && !voided && " · on a sent invoice"}
          {voided && ` · removed: ${c.void_reason ?? ""}`}
        </div>
      </div>
      <span className={cx("w-24 text-right font-semibold tabular-nums", voided && "text-muted line-through", c.amount_cents < 0 && "text-emerald-700")}>
        {usd(c.amount_cents)}
      </span>
      {!invoiced && !voided && (
        <details className="w-full sm:w-auto">
          <summary className="text-sm font-semibold text-muted hover:text-foreground">Remove</summary>
          <form action={voidCharge} className="mt-2 flex gap-2">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="back" value={back} />
            <input name="reason" required maxLength={300} placeholder="Why? e.g. Waived" className="field-input py-1.5 text-sm" />
            <PendingButton pending="Removing…" className="shrink-0 rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white">Remove</PendingButton>
          </form>
        </details>
      )}
      {voided && !invoiced && (
        <form action={restoreCharge}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="back" value={back} />
          <PendingButton pending="Putting back…" className="text-sm font-semibold text-accent">Put back</PendingButton>
        </form>
      )}
    </div>
  );
}
