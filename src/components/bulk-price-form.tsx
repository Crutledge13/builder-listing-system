"use client";

import { useMemo, useState } from "react";
import { cx, money } from "@/lib/format";
import { PendingButton } from "@/components/pending-button";

export type BulkHome = { id: string; address: string; plan: string | null; price: number | null; status: string; live: boolean; picked: boolean };

// Pick homes, say how much, see every new price before saving.
export function BulkPriceForm({ action, communityId, homes }: { action: (fd: FormData) => void; communityId: string; homes: BulkHome[] }) {
  const [picked, setPicked] = useState(() => new Set(homes.filter((h) => h.picked && h.price !== null).map((h) => h.id)));
  const [direction, setDirection] = useState<"lower" | "raise">("lower");
  const [unit, setUnit] = useState<"dollars" | "percent">("dollars");
  const [amountText, setAmountText] = useState("5,000");
  const amount = Number(amountText.replace(/[$,%\s]/g, "")) || 0;

  const next = (p: number) => {
    const change = unit === "percent" ? Math.round(p * (amount / 100)) : amount;
    return direction === "lower" ? p - change : p + change;
  };
  const chosen = homes.filter((h) => picked.has(h.id));
  const liveCount = chosen.filter((h) => h.live).length;
  const pricedIds = homes.filter((h) => h.price !== null).map((h) => h.id);
  const allOn = pricedIds.length > 0 && pricedIds.every((id) => picked.has(id));
  const summary = useMemo(() => {
    const what = unit === "percent" ? `${amount}%` : money(amount);
    return `${direction === "lower" ? "Lower" : "Raise"} ${chosen.length} ${chosen.length === 1 ? "price" : "prices"} by ${what}`;
  }, [amount, chosen.length, direction, unit]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="community_id" value={communityId} />
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-line p-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium">Change</span>
          <div className="flex rounded-xl bg-soft p-1">
            {(["lower", "raise"] as const).map((d) => (
              <label key={d} className={cx("cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold", direction === d ? "bg-white shadow-sm" : "text-muted")}>
                <input type="radio" name="direction" value={d} checked={direction === d} onChange={() => setDirection(d)} className="sr-only" />
                {d === "lower" ? "Lower" : "Raise"}
              </label>
            ))}
          </div>
        </div>
        <label className="block w-40">
          <span className="mb-1.5 block text-sm font-medium">By</span>
          <input name="amount" value={amountText} onChange={(e) => setAmountText(e.target.value)} required inputMode="decimal" data-money={unit === "dollars" ? "" : undefined} autoComplete="off" className="field-input" />
        </label>
        <div>
          <span className="mb-1.5 block text-sm font-medium">In</span>
          <div className="flex rounded-xl bg-soft p-1">
            {(["dollars", "percent"] as const).map((u) => (
              <label key={u} className={cx("cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold", unit === u ? "bg-white shadow-sm" : "text-muted")}>
                <input type="radio" name="unit" value={u} checked={unit === u} onChange={() => setUnit(u)} className="sr-only" />
                {u === "dollars" ? "$" : "%"}
              </label>
            ))}
          </div>
        </div>
        <PendingButton
          pending="Changing prices…"
          confirm={`${summary}?${liveCount ? ` ${liveCount} ${liveCount === 1 ? "is" : "are"} live, so our team gets an MLS update for each.` : ""}`}
          className="ml-auto rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black disabled:opacity-60"
        >
          {summary}
        </PendingButton>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-soft text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" aria-label="Pick every home" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(pricedIds))} className="h-4 w-4 accent-[#3452c7]" />
              </th>
              <th className="px-3 py-2">Home</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Now</th>
              <th className="px-3 py-2 text-right">New price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {homes.map((h) => {
              const on = picked.has(h.id);
              const np = h.price !== null && on && amount > 0 ? next(h.price) : null;
              return (
                <tr key={h.id} className={cx(on ? "bg-white" : "bg-white text-muted")}>
                  <td className="px-3 py-2">
                    {h.price !== null ? (
                      <input type="checkbox" name="home_id" value={h.id} checked={on} onChange={() => toggle(h.id)} aria-label={`Pick ${h.address}`} className="h-4 w-4 accent-[#3452c7]" />
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{h.address}</span>
                    {h.plan && <span className="ml-2 text-xs text-muted">{h.plan}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{h.status}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.price === null ? "No price yet" : money(h.price)}</td>
                  <td className={cx("px-3 py-2 text-right font-semibold tabular-nums", np !== null && np < 1000 ? "text-red-700" : "text-foreground")}>
                    {np === null ? "" : money(np)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Under contract and sold homes start unticked. Each change goes in the home’s price history with an undo, and live listings get an MLS update for our team.</p>
    </form>
  );
}
