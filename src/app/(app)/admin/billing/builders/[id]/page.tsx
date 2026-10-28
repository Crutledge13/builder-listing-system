import { Suspense } from "react";
import { BackButton } from "@/components/back-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isPlatformAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { PendingButton } from "@/components/pending-button";
import { InvoiceList } from "@/components/invoice-list";
import { ChargeRow } from "@/components/charge-row";
import { cx } from "@/lib/format";
import {
  centralMonths, CHARGE_SELECT, dayLabel, INVOICE_SELECT, monthLabel, PLAN_HELP, planLabel, usd,
  type BillingDefaults, type Charge, type Invoice,
} from "@/lib/billing";
import { addAdjustment, buildInvoices, saveBuilderBilling } from "../../actions";

export default function BuilderBilling(props: PageProps<"/admin/billing/builders/[id]">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Page params={props.params} />
    </Suspense>
  );
}

type Billing = {
  plan: string | null; includes_photos: boolean; starts_on: string | null;
  software_fee_cents: number | null; listing_fee_cents: number | null; relist_fee_cents: number | null; onboarding_fee_cents: number | null;
  photo_prices: Record<string, number>; net_days: number | null; deal_notes: string | null; quickbooks_customer_id: string | null;
};

async function Page({ params }: { params: PageProps<"/admin/billing/builders/[id]">["params"] }) {
  if (!(await isPlatformAdmin())) return null;
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: builder }, { data: bb }, { data: settings }, { data: rates }, { data: charges }, { data: invoices }, { data: onboarding }] = await Promise.all([
    supabase.from("builders").select("id, name, legal_name").eq("id", id).maybeSingle(),
    supabase.from("builder_billing").select("plan, includes_photos, starts_on, software_fee_cents, listing_fee_cents, relist_fee_cents, onboarding_fee_cents, photo_prices, net_days, deal_notes, quickbooks_customer_id").eq("builder_id", id).maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "billing_defaults").maybeSingle(),
    supabase.from("photographer_rates").select("need, label").order("label"),
    supabase.from("billing_charges").select(CHARGE_SELECT).eq("builder_id", id).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(500),
    supabase.from("invoices").select(INVOICE_SELECT).eq("builder_id", id).order("period_month", { ascending: false }),
    supabase.from("builder_onboarding").select("pricing").eq("builder_id", id).maybeSingle(),
  ]);
  if (!builder || !bb) notFound();
  const b = bb as Billing;
  const d = (settings?.value ?? {}) as BillingDefaults;
  const all = (charges ?? []) as Charge[];
  const inv = (invoices ?? []) as Invoice[];
  const { today, thisMonth, nextMonth } = centralMonths();
  const back = `/admin/billing/builders/${id}`;
  const draftIds = new Set(inv.filter((i) => i.status === "draft").map((i) => i.id));
  const waiting = all.filter((c) => !c.voided_at && (c.invoice_id === null || draftIds.has(c.invoice_id)));
  const history = all.filter((c) => !waiting.includes(c));
  const dollars = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2).replace(/\.00$/, ""));
  const std = (c: number | undefined) => `Standard ${usd(c ?? 0)}`;

  return (
    <div>
      <BackButton variant="text" href="/admin/billing" label="Billing" />
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h2 className="text-2xl font-bold tracking-tight">{builder.name}</h2>
        <span className="rounded-full bg-soft px-2.5 py-1 text-xs font-semibold">{planLabel(b.plan, b.includes_photos)}</span>
      </div>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-10">
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Waiting for the next invoice</h3>
                <p className="text-sm text-muted">Charges not on a sent invoice yet. Remove one to waive it; it stays in the history.</p>
              </div>
              {b.plan && (
                <form action={buildInvoices} className="flex items-center gap-2">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="builder_id" value={id} />
                  <select name="month" defaultValue={thisMonth} className="field-input w-auto py-2 text-sm" aria-label="Invoice month">
                    <option value={thisMonth}>{monthLabel(thisMonth)}</option>
                    <option value={nextMonth}>{monthLabel(nextMonth)} (preview)</option>
                  </select>
                  <PendingButton pending="Building…" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:border-foreground">
                    Build draft
                  </PendingButton>
                </form>
              )}
            </div>
            <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
              {waiting.map((c) => <ChargeRow key={c.id} c={c} back={back} onDraft={!!c.invoice_id} />)}
              {waiting.length === 0 && <p className="p-4 text-sm text-muted">Nothing waiting.</p>}
              {waiting.length > 0 && (
                <div className="flex justify-between p-4 font-semibold">
                  <span>Total waiting</span>
                  <span className="tabular-nums">{usd(waiting.reduce((n, c) => n + c.amount_cents, 0))}</span>
                </div>
              )}
            </div>
            {b.plan === "software" && (
              <p className="mt-2 text-xs text-muted">The monthly software fee is added when each month’s invoice is built.</p>
            )}
          </section>

          <section>
            <h3 className="text-lg font-semibold">Invoices</h3>
            <InvoiceList invoices={inv} today={today} />
          </section>

          {history.length > 0 && (
            <details className="rounded-2xl border border-line">
              <summary className="p-4 font-semibold">History: invoiced and removed charges ({history.length})</summary>
              <div className="divide-y divide-line border-t border-line">
                {history.map((c) => <ChargeRow key={c.id} c={c} back={back} invoiced={!!c.invoice_id && !draftIds.has(c.invoice_id)} />)}
              </div>
            </details>
          )}
        </div>

        <div className="space-y-6">
          <form action={saveBuilderBilling} className="rounded-2xl border border-line p-5">
            <input type="hidden" name="builder_id" value={id} />
            <h3 className="font-semibold">Plan and prices</h3>
            <fieldset className="mt-3 space-y-2">
              <legend className="sr-only">Plan</legend>
              {(["software", "listing_service"] as const).map((p) => (
                <label key={p} className={cx("block rounded-xl border p-3", "has-[:checked]:border-foreground has-[:checked]:bg-soft border-line")}>
                  <span className="flex items-center gap-2 font-semibold">
                    <input type="radio" name="plan" value={p} defaultChecked={b.plan === p} /> {planLabel(p)}
                  </span>
                  <span className="mt-1 block text-xs text-muted">{PLAN_HELP[p]}</span>
                </label>
              ))}
              <label className="block rounded-xl border border-line p-3 has-[:checked]:border-foreground">
                <span className="flex items-center gap-2 font-semibold">
                  <input type="radio" name="plan" value="" defaultChecked={!b.plan} /> Not billing yet
                </span>
              </label>
            </fieldset>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" name="includes_photos" defaultChecked={b.includes_photos} /> Uses our photographer (+ Photos)
            </label>
            <p className="ml-6 text-xs text-muted">Finished photo shoots are charged either way; this labels the plan.</p>

            <label className="mt-4 block text-sm">
              <span className="mb-1 block font-medium">Billing starts</span>
              <input type="date" name="starts_on" defaultValue={b.starts_on ?? ""} className="field-input" />
              <span className="mt-1 block text-xs text-muted">Nothing that happens before this date is charged. The software fee starts with this month.</span>
            </label>

            <h4 className="mt-5 text-sm font-semibold">This builder’s prices</h4>
            <p className="text-xs text-muted">Leave empty to use the standard price. Fill one in for a negotiated deal. Only the prices for the plan above are used.</p>
            <div className="mt-3 space-y-3 text-sm">
              <Override label="Software, per month" name="software_fee_cents" value={dollars(b.software_fee_cents)} hint={std(d.software_fee_cents)} />
              <Override label="Listing Service+, per listing" name="listing_fee_cents" value={dollars(b.listing_fee_cents)} hint={std(d.listing_fee_cents)} />
              <Override label="Relist" name="relist_fee_cents" value={dollars(b.relist_fee_cents)} hint={std(d.relist_fee_cents)} />
              <Override label="Onboarding (one time)" name="onboarding_fee_cents" value={dollars(b.onboarding_fee_cents)} hint={std(d.onboarding_fee_cents)} />
              <label className="flex items-center justify-between gap-3">
                <span>Payment due (days)<span className="block text-xs text-muted">Standard {d.net_days ?? 15}</span></span>
                <input name="net_days" defaultValue={b.net_days ?? ""} placeholder={String(d.net_days ?? 15)} inputMode="numeric" className="field-input w-24 py-1.5" />
              </label>
            </div>
            <details className="mt-4">
              <summary className="text-sm font-semibold">Photo shoot prices</summary>
              <div className="mt-3 space-y-3 text-sm">
                {(rates ?? []).map((r) => (
                  <div key={r.need}>
                    <input type="hidden" name="need" value={r.need} />
                    <Override label={r.label} name={`photo_${r.need}`} value={dollars(b.photo_prices?.[r.need])} hint={std(d.photo_prices?.[r.need])} />
                  </div>
                ))}
              </div>
            </details>

            <label className="mt-4 block text-sm">
              <span className="mb-1 block font-medium">Deal notes (our team only)</span>
              <textarea name="deal_notes" rows={3} defaultValue={b.deal_notes ?? ""} placeholder="e.g. first 5 listings at $300, then $400" className="field-input" />
              {onboarding?.pricing && <span className="mt-1 block text-xs text-muted">Noted at onboarding: “{onboarding.pricing}”</span>}
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">QuickBooks customer ID</span>
              <input name="quickbooks_customer_id" defaultValue={b.quickbooks_customer_id ?? ""} placeholder="For when QuickBooks is connected" className="field-input" />
            </label>
            <PendingButton pending="Saving…" className="mt-5 w-full justify-center rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">
              Save plan
            </PendingButton>
          </form>

          <form action={addAdjustment} className="rounded-2xl border border-line p-5">
            <input type="hidden" name="builder_id" value={id} />
            <input type="hidden" name="back" value={back} />
            <h3 className="font-semibold">Add a credit or charge</h3>
            <p className="mt-1 text-xs text-muted">For deals, refunds, extras or corrections. It prints on the invoice as you write it.</p>
            <div className="mt-3 flex gap-2 text-sm">
              <label className="flex flex-1 items-center gap-2 rounded-xl border border-line p-2.5 has-[:checked]:border-foreground has-[:checked]:bg-soft">
                <input type="radio" name="direction" value="credit" defaultChecked /> Credit (take off)
              </label>
              <label className="flex flex-1 items-center gap-2 rounded-xl border border-line p-2.5 has-[:checked]:border-foreground has-[:checked]:bg-soft">
                <input type="radio" name="direction" value="charge" /> Charge (add)
              </label>
            </div>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">What it’s for</span>
              <input name="description" required maxLength={300} placeholder="e.g. Launch discount: first month half off" className="field-input" />
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Amount</span>
              <span className="flex items-center gap-1">$<input name="amount" required inputMode="decimal" className="field-input" /></span>
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Put it on</span>
              <select name="invoice_month" defaultValue="" className="field-input">
                <option value="">The next invoice</option>
                <option value={nextMonth}>The {monthLabel(nextMonth)} invoice</option>
              </select>
            </label>
            <PendingButton pending="Adding…" className="mt-4 w-full justify-center rounded-xl bg-foreground px-4 py-2.5 font-semibold text-white hover:bg-black">
              Add
            </PendingButton>
          </form>
          {b.starts_on && <p className="text-xs text-muted">Billing since {dayLabel(b.starts_on)}.</p>}
        </div>
      </div>
    </div>
  );
}

function Override({ label, name, value, hint }: { label: string; name: string; value: string; hint: string }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}<span className="block text-xs text-muted">{hint}</span></span>
      <span className="flex items-center gap-1">$<input name={name} defaultValue={value} inputMode="decimal" className="field-input w-24 py-1.5" /></span>
    </label>
  );
}
