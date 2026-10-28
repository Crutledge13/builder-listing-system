import { Suspense } from "react";
import { isPlatformAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { cx, dateTime } from "@/lib/format";
import { cents, PAYMENT_STATUS } from "@/lib/payments";
import { saveRates, setPaymentStatus } from "../actions";

export default function PaymentsAdmin(props: PageProps<"/admin/payments">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Payments />
    </Suspense>
  );
}

async function Payments() {
  if (!(await isPlatformAdmin())) return null;
  const supabase = await createClient();
  const [{ data: payments }, { data: rates }, { data: people }] = await Promise.all([
    supabase.from("photographer_payments").select("id, photographer_id, address, line_items, amount_cents, status, approved_at, paid_at, created_at").order("created_at", { ascending: false }),
    supabase.from("photographer_rates").select("need, label, amount_cents").order("amount_cents", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("role", "photographer"),
  ]);
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const pay = payments ?? [];
  const sum = (st: string) => pay.filter((p) => p.status === st).reduce((n, p) => n + p.amount_cents, 0);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <div>
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Demo: this tracks what each photographer is owed. Marking a job paid doesn’t send money. Paying out (for example through Stripe) comes later.
        </p>
        <dl className="mt-4 grid grid-cols-3 gap-3">
          {[["To approve", sum("pending")], ["Approved, unpaid", sum("approved")], ["Paid", sum("paid")]].map(([l, v]) => (
            <div key={l as string} className="rounded-2xl border border-line p-4">
              <dt className="text-sm text-muted">{l}</dt>
              <dd className="text-2xl font-bold tabular-nums">{cents(v as number)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 divide-y divide-line rounded-2xl border border-line">
          {pay.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{name.get(p.photographer_id) ?? "Photographer"}: {p.address}</div>
                <div className="text-sm text-muted">
                  {(p.line_items as { label: string; amount_cents: number }[]).map((l) => `${l.label} ${cents(l.amount_cents)}`).join(", ")}. Completed {dateTime(p.created_at)}
                  {p.paid_at ? `, paid ${dateTime(p.paid_at)}` : ""}
                </div>
              </div>
              <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", PAYMENT_STATUS[p.status].style)}>{PAYMENT_STATUS[p.status].label}</span>
              <span className="w-20 text-right font-semibold tabular-nums">{cents(p.amount_cents)}</span>
              {p.status !== "paid" && (
                <form action={setPaymentStatus}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="status" value={p.status === "pending" ? "approved" : "paid"} />
                  <button className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black">{p.status === "pending" ? "Approve" : "Mark paid"}</button>
                </form>
              )}
            </div>
          ))}
          {pay.length === 0 && <p className="p-4 text-sm text-muted">No completed jobs yet. A payment appears here when a builder marks a photo request complete.</p>}
        </div>
      </div>

      <form action={saveRates} className="h-fit rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Rate card</h2>
        <p className="mt-1 text-sm text-muted">What we pay per item on a request.</p>
        <div className="mt-4 space-y-3">
          {(rates ?? []).map((r) => (
            <label key={r.need} className="flex items-center justify-between gap-3 text-sm">
              <input type="hidden" name="need" value={r.need} />
              <span>{r.label}</span>
              <span className="flex items-center gap-1">$<input name={`rate_${r.need}`} defaultValue={r.amount_cents / 100} inputMode="decimal" className="field-input w-24 py-1.5" /></span>
            </label>
          ))}
        </div>
        <button className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Save rates</button>
      </form>
    </div>
  );
}
