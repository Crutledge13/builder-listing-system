import { Suspense } from "react";
import Link from "next/link";
import { isPlatformAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { PendingButton } from "@/components/pending-button";
import { cx } from "@/lib/format";
import {
  centralMonths, dayLabel, INVOICE_STATUS, INVOICE_SELECT, isOverdue, monthLabel, planLabel, usd,
  type BillingDefaults, type Invoice,
} from "@/lib/billing";
import { InvoiceList } from "@/components/invoice-list";
import { buildInvoices, saveBillingDefaults } from "./actions";

export default function BillingAdmin(props: PageProps<"/admin/billing">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Billing />
    </Suspense>
  );
}

type Row = { builder_id: string; plan: string | null; includes_photos: boolean; starts_on: string | null; software_fee_cents: number | null };

async function Billing() {
  if (!(await isPlatformAdmin())) return null;
  const supabase = await createClient();
  const { today, thisMonth, nextMonth } = centralMonths();
  const [{ data: builders }, { data: plans }, { data: invoices }, { data: waiting }, { data: settings }, { data: rates }] = await Promise.all([
    supabase.from("builders").select("id, name").order("name"),
    supabase.from("builder_billing").select("builder_id, plan, includes_photos, starts_on, software_fee_cents"),
    supabase.from("invoices").select(INVOICE_SELECT).order("period_month", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    supabase.from("billing_charges").select("builder_id, amount_cents, invoice_month").is("invoice_id", null).is("voided_at", null),
    supabase.from("app_settings").select("value").eq("key", "billing_defaults").maybeSingle(),
    supabase.from("photographer_rates").select("need, label").order("label"),
  ]);
  const defaults = (settings?.value ?? {}) as BillingDefaults;
  const plan = new Map(((plans ?? []) as Row[]).map((p) => [p.builder_id, p]));
  const name = new Map((builders ?? []).map((b) => [b.id, b.name]));
  const inv = (invoices ?? []) as Invoice[];

  // What the next invoice (1st of next month) holds so far, per builder:
  // charges waiting, plus next month's software fee it will add.
  const coming = new Map<string, number>();
  for (const c of waiting ?? []) if (c.invoice_month <= nextMonth) coming.set(c.builder_id, (coming.get(c.builder_id) ?? 0) + c.amount_cents);
  for (const p of plan.values()) {
    if (p.plan === "software" && p.starts_on && p.starts_on.slice(0, 7) <= nextMonth.slice(0, 7)) {
      coming.set(p.builder_id, (coming.get(p.builder_id) ?? 0) + (p.software_fee_cents ?? defaults.software_fee_cents ?? 0));
    }
  }

  const sum = (f: (i: Invoice) => boolean) => inv.filter(f).reduce((n, i) => n + i.total_cents, 0);
  const drafts = inv.filter((i) => i.status === "draft");
  const notSetUp = (builders ?? []).filter((b) => !plan.get(b.id)?.plan);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <p className="rounded-xl bg-accent-soft px-4 py-2.5 text-sm text-foreground">
          Charges add up as they happen (approvals, relists, finished photo shoots). On the 1st of each month at 6 am a draft invoice
          is built for every builder: that month’s software fee plus last month’s usage. Check them here and mark each one sent.
          No money moves and nothing is emailed from here yet.
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            ["Drafts to send", sum((i) => i.status === "draft"), `${drafts.length} invoice${drafts.length === 1 ? "" : "s"}`],
            ["Sent, unpaid", sum((i) => i.status === "sent"), ""],
            ["Overdue", sum((i) => isOverdue(i, today)), ""],
            [`Next invoice so far`, [...coming.values()].reduce((a, b) => a + b, 0), `Builds ${dayLabel(nextMonth)}`],
          ] as const).map(([l, v, sub]) => (
            <div key={l} className="rounded-2xl border border-line p-4">
              <dt className="text-sm text-muted">{l}</dt>
              <dd className={cx("text-xl font-bold tabular-nums", l === "Overdue" && v > 0 && "text-red-700")}>{usd(v)}</dd>
              {sub && <dd className="text-xs text-muted">{sub}</dd>}
            </div>
          ))}
        </dl>

        {notSetUp.length > 0 && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            Billing isn’t set up for {notSetUp.map((b) => b.name).join(", ")}. Nothing is charged for them until you pick a plan and a start date.
          </p>
        )}

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Builders</h2>
          <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {(builders ?? []).map((b) => {
              const p = plan.get(b.id);
              const last = inv.find((i) => i.builder_id === b.id && i.status !== "void");
              return (
                <Link key={b.id} href={`/admin/billing/builders/${b.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-soft">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{b.name}</div>
                    <div className="text-sm text-muted">
                      {planLabel(p?.plan, p?.includes_photos)}
                      {p?.plan && p.starts_on ? ` · billing from ${dayLabel(p.starts_on)}` : ""}
                      {last ? ` · last invoice ${monthLabel(last.period_month)}, ${INVOICE_STATUS[last.status].label.toLowerCase()}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{usd(coming.get(b.id) ?? 0)}</div>
                    <div className="text-xs text-muted">on the {dayLabel(nextMonth)} invoice so far</div>
                  </div>
                  <span className="text-sm font-semibold text-accent">Plan and charges →</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold">Invoices</h2>
            <form action={buildInvoices} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="back" value="/admin/billing" />
              <select name="month" defaultValue={thisMonth} className="field-input w-auto py-2 text-sm" aria-label="Invoice month">
                <option value={thisMonth}>{monthLabel(thisMonth)}</option>
                <option value={nextMonth}>{monthLabel(nextMonth)} (preview)</option>
              </select>
              <PendingButton pending="Building…" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:border-foreground">
                Build drafts now
              </PendingButton>
            </form>
          </div>
          <p className="mt-1 text-sm text-muted">
            Building again rebuilds any draft with the latest charges. Sent invoices are never changed; correct them with a credit on the next one.
          </p>
          <InvoiceList invoices={inv} name={name} today={today} />
        </section>
      </div>

      <form action={saveBillingDefaults} className="h-fit rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Standard prices</h2>
        <p className="mt-1 text-sm text-muted">Used for every builder that doesn’t have its own price. Changes apply to new charges only.</p>
        <div className="mt-4 space-y-3 text-sm">
          <Price label="Software, per month" name="software_fee_cents" cents={defaults.software_fee_cents} />
          <Price label="Listing Service+, per listing" name="listing_fee_cents" cents={defaults.listing_fee_cents} />
          <Price label="Relist after a pause or withdrawal" name="relist_fee_cents" cents={defaults.relist_fee_cents} />
          <Price label="Onboarding (one time)" name="onboarding_fee_cents" cents={defaults.onboarding_fee_cents} />
          <label className="flex items-center justify-between gap-3">
            <span>Payment due (days after sent)</span>
            <input name="net_days" defaultValue={defaults.net_days ?? 15} inputMode="numeric" className="field-input w-24 py-1.5" />
          </label>
        </div>
        <h3 className="mt-5 text-sm font-semibold">Our photographer, charged to the builder</h3>
        <p className="mt-1 text-xs text-muted">What builders pay per item when a shoot is completed. What we pay the photographer is on Photographer pay.</p>
        <div className="mt-3 space-y-3 text-sm">
          {(rates ?? []).map((r) => (
            <div key={r.need}>
              <input type="hidden" name="need" value={r.need} />
              <Price label={r.label} name={`photo_${r.need}`} cents={defaults.photo_prices?.[r.need]} />
            </div>
          ))}
        </div>
        <PendingButton pending="Saving…" className="mt-5 w-full justify-center rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">
          Save standard prices
        </PendingButton>
      </form>
    </div>
  );
}

function Price({ label, name, cents }: { label: string; name: string; cents: number | undefined }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        $<input name={name} defaultValue={cents !== undefined ? (cents / 100).toFixed(2).replace(/\.00$/, "") : ""} inputMode="decimal" className="field-input w-24 py-1.5" />
      </span>
    </label>
  );
}
