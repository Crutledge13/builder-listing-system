import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isPlatformAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { PendingButton } from "@/components/pending-button";
import { PrintButton } from "@/components/print-button";
import { InvoiceDocument } from "@/components/invoice-document";
import { ChargeRow } from "@/components/charge-row";
import { loadInvoice } from "@/lib/invoice-data";
import { centralMonths, isOverdue, monthLabel, usd } from "@/lib/billing";
import { buildInvoices, markUnpaid, saveInvoiceNotes, setInvoiceStatus } from "../../actions";

export default function InvoiceAdmin(props: PageProps<"/admin/billing/invoices/[id]">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <div className="print:hidden"><Notice searchParams={props.searchParams} /></div>
      <Page params={props.params} />
    </Suspense>
  );
}

async function Page({ params }: { params: PageProps<"/admin/billing/invoices/[id]">["params"] }) {
  if (!(await isPlatformAdmin())) return null;
  const { id } = await params;
  const supabase = await createClient();
  const data = await loadInvoice(supabase, id);
  if (!data) notFound();
  const { invoice: i, charges } = data;
  const back = `/admin/billing/invoices/${id}`;
  const { today } = centralMonths();
  const total = charges.filter((c) => !c.voided_at).reduce((n, c) => n + c.amount_cents, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="text-sm">
          <Link href="/admin/billing" className="text-muted hover:text-foreground">← Billing</Link>
          <span className="text-muted"> · </span>
          <Link href={`/admin/billing/builders/${i.builder_id}`} className="text-muted hover:text-foreground">{data.builderName}</Link>
        </div>
        <PrintButton />
      </div>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_320px] print:block">
        <InvoiceDocument invoice={i} charges={charges} billTo={data.billTo} from={data.from} />

        <aside className="space-y-4 print:hidden">
          {i.status === "draft" && (
            <div className="rounded-2xl border border-line p-5">
              <h2 className="font-semibold">Draft for {monthLabel(i.period_month)}</h2>
              <p className="mt-1 text-sm text-muted">
                Check the lines. Sending gives it a number and a due date, locks it, and shows it to the builder owner on their Billing page.
                Then send them the PDF (Print, then Save as PDF).
              </p>
              <form action={setInvoiceStatus} className="mt-4">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value="sent" />
                <PendingButton pending="Sending…" confirm={`Mark this ${usd(total)} invoice sent? It can’t be changed after.`} className="w-full justify-center rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">
                  Mark sent
                </PendingButton>
              </form>
              <form action={buildInvoices} className="mt-2">
                <input type="hidden" name="month" value={i.period_month} />
                <input type="hidden" name="builder_id" value={i.builder_id} />
                <input type="hidden" name="back" value={back} />
                <PendingButton pending="Rebuilding…" className="w-full justify-center rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:border-foreground">
                  Rebuild with latest charges
                </PendingButton>
              </form>
              <p className="mt-3 text-xs text-muted">To waive a line, remove it below. To add a credit or extra, use the builder’s billing page, then rebuild.</p>
            </div>
          )}

          {i.status === "sent" && (
            <form action={setInvoiceStatus} className="rounded-2xl border border-line p-5">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value="paid" />
              <h2 className="font-semibold">{isOverdue(i, today) ? "Overdue" : "Waiting for payment"}</h2>
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium">Payment note</span>
                <input name="paid_note" maxLength={300} placeholder="e.g. Check 1042, ACH 3/1" className="field-input" />
              </label>
              <PendingButton pending="Saving…" className="mt-3 w-full justify-center rounded-xl bg-foreground px-4 py-2.5 font-semibold text-white hover:bg-black">
                Mark paid
              </PendingButton>
            </form>
          )}

          {i.status === "paid" && (
            <div className="rounded-2xl border border-line p-5 text-sm">
              <h2 className="font-semibold">Paid</h2>
              {i.paid_note && <p className="mt-1 text-muted">{i.paid_note}</p>}
              <form action={markUnpaid} className="mt-3">
                <input type="hidden" name="id" value={id} />
                <PendingButton pending="Saving…" className="text-sm font-semibold text-accent">Move back to unpaid</PendingButton>
              </form>
            </div>
          )}

          {i.status !== "void" && (
            <form action={saveInvoiceNotes} className="rounded-2xl border border-line p-5">
              <input type="hidden" name="id" value={id} />
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Note printed on the invoice</span>
                <textarea name="notes" rows={3} defaultValue={i.notes ?? ""} placeholder="e.g. Pay by ACH to …" className="field-input" />
              </label>
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium">QuickBooks invoice number</span>
                <input name="quickbooks_invoice_id" defaultValue={i.quickbooks_invoice_id ?? ""} className="field-input" />
              </label>
              <PendingButton pending="Saving…" className="mt-3 rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:border-foreground">Save</PendingButton>
            </form>
          )}

          {i.status !== "void" && (
            <details className="rounded-2xl border border-line p-5">
              <summary className="text-sm font-semibold text-red-700">Void this invoice</summary>
              <form action={setInvoiceStatus} className="mt-3">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value="void" />
                <p className="text-xs text-muted">Its charges go back to waiting and land on the next invoice you build. Use this to reissue a wrong invoice.</p>
                <input name="void_reason" required maxLength={300} placeholder="Why?" className="field-input mt-2" />
                <PendingButton pending="Voiding…" confirm="Void this invoice? This can’t be undone." className="mt-2 rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white">Void</PendingButton>
              </form>
            </details>
          )}
        </aside>
      </div>

      {i.status === "draft" && charges.length > 0 && (
        <section className="mt-8 print:hidden">
          <h2 className="text-lg font-semibold">Lines on this draft</h2>
          <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {charges.map((c) => <ChargeRow key={c.id} c={c} back={back} onDraft />)}
          </div>
        </section>
      )}
    </div>
  );
}
