import Link from "next/link";
import { cx } from "@/lib/format";
import { dayLabel, INVOICE_STATUS, isOverdue, monthLabel, usd, type Invoice, type InvoiceStatus } from "@/lib/billing";

// A list of invoices: drafts first, then unpaid, paid and voided, newest first.
export function InvoiceList({ invoices, name, today, hrefBase = "/admin/billing/invoices" }: {
  invoices: Invoice[];
  name?: Map<string, string>;
  today: string;
  hrefBase?: string;
}) {
  const order: InvoiceStatus[] = ["draft", "sent", "paid", "void"];
  const sorted = [...invoices].sort((a, b) =>
    order.indexOf(a.status) - order.indexOf(b.status) || b.period_month.localeCompare(a.period_month));
  if (sorted.length === 0) return <p className="mt-3 rounded-2xl border border-line p-4 text-sm text-muted">No invoices yet.</p>;
  return (
    <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
      {sorted.map((i) => {
        const late = isOverdue(i, today);
        return (
          <Link key={i.id} href={`${hrefBase}/${i.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-soft">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {name ? `${name.get(i.builder_id) ?? "Builder"}: ` : ""}{monthLabel(i.period_month)}
              </div>
              <div className="text-sm text-muted">
                {i.number ?? "Draft"}
                {i.due_on && i.status === "sent" ? ` · due ${dayLabel(i.due_on)}` : ""}
                {i.paid_at ? ` · paid ${dayLabel(i.paid_at.slice(0, 10))}` : ""}
              </div>
            </div>
            <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", late ? "bg-red-100 text-red-800" : INVOICE_STATUS[i.status].style)}>
              {late ? "Overdue" : INVOICE_STATUS[i.status].label}
            </span>
            <span className="w-28 text-right font-semibold tabular-nums">{usd(i.total_cents)}</span>
          </Link>
        );
      })}
    </div>
  );
}
