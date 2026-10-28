import { cx } from "@/lib/format";
import { dayLabel, groupCharges, INVOICE_STATUS, monthLabel, usd, type Charge, type Invoice } from "@/lib/billing";

// One invoice, laid out to print (or save as PDF from the print dialog).
// Used by Admin > Billing and by the builder owner's Billing page.
export function InvoiceDocument({
  invoice,
  charges,
  billTo,
  from,
}: {
  invoice: Invoice;
  charges: Charge[];
  billTo: { name: string; contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null };
  from: { name: string; email?: string | null; phone?: string | null };
}) {
  const live = charges.filter((c) => !c.voided_at);
  const groups = groupCharges(live);
  const total = live.reduce((n, c) => n + c.amount_cents, 0);
  const st = INVOICE_STATUS[invoice.status];
  const usageMonth = (() => {
    const [y, m] = invoice.period_month.split("-").map(Number);
    return monthLabel(m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`);
  })();

  return (
    <article className="rounded-2xl border border-line bg-white p-6 sm:p-10 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="text-xl font-bold tracking-tight">{from.name}</div>
          <div className="mt-1 text-sm text-muted">
            {[from.email, from.phone].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[28px] font-bold leading-none tracking-tight">Invoice</div>
          <div className="mt-2 text-sm tabular-nums">{invoice.number ?? "Not numbered yet (draft)"}</div>
          <span className={cx("mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-semibold print:hidden", st.style)}>{st.label}</span>
        </div>
      </header>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Bill to</div>
          <div className="mt-1 font-semibold">{billTo.name}</div>
          {billTo.contactName && <div className="text-sm">{billTo.contactName}</div>}
          {(billTo.contactEmail || billTo.contactPhone) && (
            <div className="text-sm text-muted">{[billTo.contactEmail, billTo.contactPhone].filter(Boolean).join(" · ")}</div>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:justify-self-end">
          <dt className="text-muted">For</dt>
          <dd className="text-right">{monthLabel(invoice.period_month)}</dd>
          <dt className="text-muted">Issued</dt>
          <dd className="text-right">{dayLabel(invoice.issued_on)}</dd>
          <dt className="text-muted">Due</dt>
          <dd className="text-right font-semibold">{dayLabel(invoice.due_on)}</dd>
          {invoice.status === "paid" && (
            <>
              <dt className="text-muted">Paid</dt>
              <dd className="text-right">{invoice.paid_at ? dayLabel(invoice.paid_at.slice(0, 10)) : "Yes"}</dd>
            </>
          )}
        </dl>
      </div>

      <p className="mt-6 text-sm text-muted">
        Software is billed for {monthLabel(invoice.period_month)}. Listings, relists and photo shoots are from {usageMonth} and earlier.
      </p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-foreground text-left">
            <th className="py-2 font-semibold">Description</th>
            <th className="w-28 py-2 font-semibold">Date</th>
            <th className="w-32 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.kind} className="break-inside-avoid">
            <tr>
              <td colSpan={3} className="pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-muted">
                {g.label} {g.items.length > 1 && <span className="normal-case">({g.items.length})</span>}
              </td>
            </tr>
            {g.items.map((c) => (
              <tr key={c.id} className="border-b border-line align-top">
                <td className="py-2 pr-4">
                  {c.description}
                  {c.kind === "photos" && c.details.length > 1 && (
                    <div className="text-xs text-muted">{c.details.map((d) => `${d.label} ${usd(d.amount_cents)}`).join(", ")}</div>
                  )}
                </td>
                <td className="py-2 text-muted">{dayLabel(c.occurred_on)}</td>
                <td className="py-2 text-right tabular-nums">{usd(c.amount_cents)}</td>
              </tr>
            ))}
            {groups.length > 1 && (
              <tr>
                <td colSpan={2} className="py-2 text-right text-muted">{g.label} subtotal</td>
                <td className="py-2 text-right tabular-nums">{usd(g.total)}</td>
              </tr>
            )}
          </tbody>
        ))}
        <tfoot>
          <tr className="border-t-2 border-foreground">
            <td colSpan={2} className="py-3 text-right text-base font-semibold">Total due</td>
            <td className="py-3 text-right text-base font-bold tabular-nums">{usd(total)}</td>
          </tr>
        </tfoot>
      </table>
      {live.length === 0 && <p className="mt-4 text-sm text-muted">Nothing on this invoice.</p>}

      {invoice.notes && <p className="mt-6 whitespace-pre-line text-sm">{invoice.notes}</p>}
      {invoice.status === "void" && (
        <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">Voided{invoice.void_reason ? `: ${invoice.void_reason}` : ""}. Nothing is owed on this invoice.</p>
      )}
    </article>
  );
}
