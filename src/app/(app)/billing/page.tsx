import { Suspense } from "react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InvoiceList } from "@/components/invoice-list";
import { cx } from "@/lib/format";
import {
  centralMonths, CHARGE_SELECT, dayLabel, INVOICE_SELECT, KIND_LABELS, monthLabel, PLAN_HELP, planLabel, usd,
  type Charge, type Invoice, type Plan,
} from "@/lib/billing";

// The builder owner's billing: their plan and prices, what's adding up for
// the next invoice, and every invoice we've sent. Read-only. Nobody else at
// the builder sees billing.
export default function BillingPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-soft" />}>
      <Billing />
    </Suspense>
  );
}

type Mine = {
  plan: Plan | null; includes_photos?: boolean; starts_on?: string | null;
  software_fee_cents?: number | null; listing_fee_cents?: number | null; relist_fee_cents?: number | null;
  net_days?: number; photo_prices?: { need: string; label: string; amount_cents: number }[];
};

async function Billing() {
  const me = await requireProfile();
  if (me.role !== "builder_owner") {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-[28px] font-bold tracking-tight">Billing is for your company’s owner</h1>
        <p className="mt-3 text-muted">Ask your owner if you need a copy of an invoice.</p>
      </div>
    );
  }
  const supabase = await createClient();
  const [{ data: mine }, { data: invoices }, { data: charges }] = await Promise.all([
    supabase.rpc("my_billing"),
    supabase.from("invoices").select(INVOICE_SELECT).order("period_month", { ascending: false }),
    supabase.from("billing_charges").select(CHARGE_SELECT).order("occurred_on", { ascending: false }).limit(500),
  ]);
  const plan = (mine ?? { plan: null }) as Mine;
  const inv = (invoices ?? []) as Invoice[];
  const sentIds = new Set(inv.map((i) => i.id));
  const waiting = ((charges ?? []) as Charge[]).filter((c) => !c.invoice_id || !sentIds.has(c.invoice_id));
  const { today, nextMonth } = centralMonths();
  const unpaid = inv.filter((i) => i.status === "sent").reduce((n, i) => n + i.total_cents, 0);
  const waitingTotal = waiting.reduce((n, c) => n + c.amount_cents, 0)
    + (plan.plan === "software" && !waiting.some((c) => c.kind === "software" && c.invoice_month === nextMonth) ? plan.software_fee_cents ?? 0 : 0);

  return (
    <div>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Billing</h1>
      <p className="mt-1 text-muted">Your plan, what’s adding up for the next invoice, and past invoices. Invoices go out on the 1st of each month.</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-10">
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-line p-4">
              <dt className="text-sm text-muted">Next invoice so far</dt>
              <dd className="text-xl font-bold tabular-nums">{usd(waitingTotal)}</dd>
              <dd className="text-xs text-muted">Goes out around {dayLabel(nextMonth)}</dd>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <dt className="text-sm text-muted">Unpaid</dt>
              <dd className={cx("text-xl font-bold tabular-nums", unpaid > 0 && "text-foreground")}>{usd(unpaid)}</dd>
            </div>
          </dl>

          <section>
            <h2 className="text-lg font-semibold">Adding up for the next invoice</h2>
            <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
              {plan.plan === "software" && (
                <div className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">Software, {monthLabel(nextMonth)}</div>
                    <div className="text-sm text-muted">Monthly fee, billed at the start of the month</div>
                  </div>
                  <span className="font-semibold tabular-nums">{usd(plan.software_fee_cents)}</span>
                </div>
              )}
              {waiting.filter((c) => !(c.kind === "software" && c.invoice_month === nextMonth)).map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.description}</div>
                    <div className="text-sm text-muted">{KIND_LABELS[c.kind]} · {dayLabel(c.occurred_on)}</div>
                  </div>
                  <span className={cx("font-semibold tabular-nums", c.amount_cents < 0 && "text-emerald-700")}>{usd(c.amount_cents)}</span>
                </div>
              ))}
              {waiting.length === 0 && plan.plan !== "software" && <p className="p-4 text-sm text-muted">Nothing yet this month.</p>}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Invoices</h2>
            <InvoiceList invoices={inv} today={today} hrefBase="/billing/invoices" />
          </section>
        </div>

        <aside className="h-fit rounded-2xl border border-line p-5">
          <h2 className="font-semibold">Your plan</h2>
          {!plan.plan ? (
            <p className="mt-2 text-sm text-muted">We haven’t set up billing for your company yet.</p>
          ) : (
            <>
              <p className="mt-2 text-lg font-semibold">{planLabel(plan.plan, plan.includes_photos)}</p>
              <p className="mt-1 text-sm text-muted">{PLAN_HELP[plan.plan]}</p>
              <dl className="mt-4 space-y-2 text-sm">
                {plan.software_fee_cents != null && <Line k="Software, per month" v={usd(plan.software_fee_cents)} />}
                {plan.listing_fee_cents != null && <Line k="Per listing (when approved for the MLS)" v={usd(plan.listing_fee_cents)} />}
                {plan.relist_fee_cents != null && <Line k="Relist after a pause or withdrawal" v={usd(plan.relist_fee_cents)} />}
                {plan.listing_fee_cents != null && <Line k="Pausing a listing" v="Free" />}
                <Line k="Payment due" v={`${plan.net_days} days after the invoice`} />
              </dl>
              <h3 className="mt-5 text-sm font-semibold">{plan.includes_photos ? "Our photographer" : "If you book our photographer"}</h3>
              <p className="text-xs text-muted">
                {plan.includes_photos ? "Charged when you mark a photo request complete." : "Only if you ask us for a shoot; charged when you mark the request complete."}
              </p>
              <dl className="mt-2 space-y-2 text-sm">
                {(plan.photo_prices ?? []).filter((p) => p.amount_cents > 0).map((p) => <Line key={p.need} k={p.label} v={usd(p.amount_cents)} />)}
              </dl>
              {plan.starts_on && <p className="mt-4 text-xs text-muted">Billing since {dayLabel(plan.starts_on)}.</p>}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-semibold tabular-nums">{v}</dd>
    </div>
  );
}
