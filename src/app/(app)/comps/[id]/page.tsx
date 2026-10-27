import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { cx, dateTime, money, num } from "@/lib/format";
import { COMP_STATUS, COMP_TYPE } from "@/lib/comps";
import { loadDeliverables } from "@/lib/deliverables";
import { Notice } from "@/components/notice";
import { BackButton } from "@/components/back-button";
import { Deliverables } from "@/components/deliverables";
import { addComp, cancelComps, deliverComps, removeComp, startComps } from "../actions";

export default function CompRequestPage(props: PageProps<"/comps/[id]">) {
  return (
    <div className="mx-auto max-w-5xl">
      <BackButton href="/comps" label="All comp requests" />
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-soft" />}>
        <div className="mt-4"><Notice searchParams={props.searchParams} /></div>
        <Request params={props.params} />
      </Suspense>
    </div>
  );
}

type Item = {
  id: string; address: string; status: string | null; list_price: number | null; sold_price: number | null; close_date: string | null;
  living_area: number | null; bedrooms: number | null; bathrooms: number | null; year_built: number | null; days_on_market: number | null;
  distance_miles: number | null; notes: string | null;
};

async function Request({ params }: { params: PageProps<"/comps/[id]">["params"] }) {
  const { id } = await params;
  const me = await requireProfile();
  const staff = isStaff(me.role);
  const supabase = await createClient();
  const { data: r } = await supabase
    .from("comp_requests")
    .select("*, builders(name), communities(name), homes(unparsed_address)")
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();
  const [{ data: itemRows }, files] = await Promise.all([
    supabase.from("comp_request_items").select("*").eq("request_id", id).order("status").order("close_date", { ascending: false, nullsFirst: false }),
    loadDeliverables(supabase, "comp_requests", [id]),
  ]);
  const items = (itemRows ?? []) as Item[];
  const open = r.status === "requested" || r.status === "in_progress";
  const sold = items.filter((i) => i.status === "Sold" && i.sold_price);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgSold = avg(sold.map((i) => Number(i.sold_price)));
  const avgPpsf = avg(sold.filter((i) => i.living_area).map((i) => Number(i.sold_price) / Number(i.living_area)));
  const subjectPpsf = r.price_point && r.living_area ? Number(r.price_point) / Number(r.living_area) : null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">Comps</p>
          <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">{r.location}{r.city ? `, ${r.city}` : ""}</h1>
          <p className="mt-1 text-muted">
            {(r.communities as { name: string } | null)?.name ?? "Nearby area"}
            {staff ? ` · ${(r.builders as { name: string } | null)?.name.replace(" (demo)", "")}` : ""}
            {" · "}asked by {r.requester_name ?? "someone"} {dateTime(r.created_at)}
            {r.home_id && <> · <Link href={`/homes/${r.home_id}`} className="underline">open the home</Link></>}
          </p>
        </div>
        <span className={cx("rounded-full px-3 py-1 text-sm font-semibold", COMP_STATUS[r.status].style)}>{COMP_STATUS[r.status].label}</span>
      </div>

      <section className="mt-6 rounded-2xl border border-line p-5">
        <h2 className="font-semibold">What was asked for</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Fact label="Price point" value={r.price_point ? money(r.price_point) : "—"} />
          <Fact label="Size" value={r.living_area ? `${num(r.living_area)} sq ft` : "—"} />
          <Fact label="Beds / baths" value={`${r.bedrooms ?? "—"} / ${r.bathrooms ?? "—"}`} />
          <Fact label="Stories" value={r.stories ?? "—"} />
          <Fact label="Year built" value={r.year_built ?? "—"} />
          <Fact label="Comps from" value={COMP_TYPE[r.comp_type] ?? r.comp_type} />
          <Fact label="Within" value={r.radius_miles ? `${r.radius_miles} miles` : "—"} />
          <Fact label="Sold in the last" value={r.months_back ? `${r.months_back} months` : "—"} />
          <Fact label="Price per sq ft" value={subjectPpsf ? money(Math.round(subjectPpsf)) : "—"} />
        </dl>
        {r.notes && <p className="mt-3 rounded-xl bg-soft px-3 py-2 text-sm">“{r.notes}”</p>}
        {!staff && r.status === "requested" && r.requested_by === me.id && (
          <form action={cancelComps} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <button className="text-sm font-semibold text-red-700 underline">Cancel this request</button>
          </form>
        )}
      </section>

      {(r.status === "delivered" || staff) && (
        <section id="results" className="mt-6 scroll-mt-28">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[22px] font-semibold">The comps <span className="font-normal text-muted">{items.length}</span></h2>
            {sold.length > 0 && (
              <p className="text-sm">
                Sold average <b>{money(Math.round(avgSold!))}</b>
                {avgPpsf && <> · <b>{money(Math.round(avgPpsf))}</b>/sq ft{subjectPpsf && <span className={subjectPpsf > avgPpsf ? "text-amber-800" : "text-emerald-700"}> (this one: {money(Math.round(subjectPpsf))})</span>}</>}
              </p>
            )}
          </div>
          {r.result_note && <p className="mt-3 whitespace-pre-line rounded-xl bg-emerald-50 px-4 py-3 text-sm"><b>From our team:</b> {r.result_note}</p>}
          {items.length > 0 ? (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-soft text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Address</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">List</th><th className="px-3 py-2 text-right">Sold</th>
                    <th className="px-3 py-2">Closed</th><th className="px-3 py-2 text-right">Sq ft</th><th className="px-3 py-2 text-right">$/sq ft</th><th className="px-3 py-2">Bd/Ba</th>
                    <th className="px-3 py-2 text-right">DOM</th><th className="px-3 py-2 text-right">Miles</th>{staff && open && <th />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((i) => {
                    const price = i.sold_price ?? i.list_price;
                    return (
                      <tr key={i.id}>
                        <td className="px-3 py-2 font-medium">{i.address}{i.notes && <span className="block text-xs font-normal text-muted">{i.notes}</span>}</td>
                        <td className="px-3 py-2">{i.status ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{i.list_price ? money(i.list_price) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{i.sold_price ? money(i.sold_price) : "—"}</td>
                        <td className="px-3 py-2">{i.close_date ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{i.living_area ? num(i.living_area) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{price && i.living_area ? money(Math.round(Number(price) / i.living_area)) : "—"}</td>
                        <td className="px-3 py-2">{i.bedrooms ?? "—"}/{i.bathrooms ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{i.days_on_market ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{i.distance_miles ?? "—"}</td>
                        {staff && open && (
                          <td className="px-3 py-2">
                            <form action={removeComp}>
                              <input type="hidden" name="id" value={id} />
                              <input type="hidden" name="item_id" value={i.id} />
                              <button className="text-xs text-red-700 underline">Remove</button>
                            </form>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">{staff ? "No comps added yet." : "No comps in a table; see the files."}</p>
          )}
          <div className="mt-3">
            <Deliverables files={files.get(id) ?? []} table="comp_requests" requestId={id} builderId={r.builder_id} staff={staff && open} back={`/comps/${id}`} />
          </div>
        </section>
      )}

      {staff && open && (
        <>
          <section id="add" className="mt-8 scroll-mt-28 rounded-2xl border border-line p-5">
            <h2 className="font-semibold">Add a comp</h2>
            <p className="mt-1 text-sm text-muted">Type one in from the MLS, or attach the MLS export above instead.</p>
            <form action={addComp} className="mt-4 grid gap-3 sm:grid-cols-4">
              <input type="hidden" name="id" value={id} />
              <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium">Address</span><input name="address" required maxLength={200} className="field-input py-2" /></label>
              <label className="block"><span className="mb-1 block text-xs font-medium">Status</span>
                <select name="status" defaultValue="Sold" className="field-input py-2">{["Sold", "Active", "Pending", "Expired", "Withdrawn"].map((s) => <option key={s}>{s}</option>)}</select>
              </label>
              <label className="block"><span className="mb-1 block text-xs font-medium">Closed</span><input name="close_date" type="date" className="field-input py-2" /></label>
              <C name="list_price" label="List price" /><C name="sold_price" label="Sold price" /><C name="living_area" label="Sq ft" /><C name="year_built" label="Year built" />
              <C name="bedrooms" label="Beds" /><C name="bathrooms" label="Baths" step="0.5" /><C name="days_on_market" label="Days on market" /><C name="distance_miles" label="Miles away" step="0.1" />
              <label className="block sm:col-span-3"><span className="mb-1 block text-xs font-medium">Note (optional)</span><input name="notes" maxLength={500} placeholder="e.g. same builder, Brazos plan, corner lot" className="field-input py-2" /></label>
              <div className="flex items-end"><button className="w-full rounded-xl bg-foreground px-4 py-2.5 font-semibold text-white hover:bg-black">Add comp</button></div>
            </form>
          </section>

          <section id="send" className="mt-6 scroll-mt-28 rounded-2xl border border-accent/40 bg-accent-soft/40 p-5">
            <h2 className="font-semibold">Send to {r.requester_name ?? "the builder"}</h2>
            <form action={deliverComps} className="mt-3 space-y-3">
              <input type="hidden" name="id" value={id} />
              <textarea name="result_note" rows={3} maxLength={4000} placeholder="A short read for them, e.g. 3 sold in the last 6 months between $375k and $392k; yours is priced right in the middle." className="field-input leading-relaxed" />
              <div className="flex flex-wrap gap-3">
                <button className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:brightness-110">Send comps</button>
              </div>
            </form>
            {r.status === "requested" && (
              <form action={startComps} className="mt-2">
                <input type="hidden" name="id" value={id} />
                <button className="text-sm font-semibold underline">Mark as being pulled</button>
              </form>
            )}
          </section>
        </>
      )}

      {!staff && open && (
        <p className="mt-8 rounded-2xl border border-dashed border-line px-6 py-8 text-center text-muted">
          Our team is on it. You’ll get a notice in your inbox and an email when the comps are ready.
        </p>
      )}
      {r.delivered_at && <p className="mt-6 text-sm text-muted">Sent {dateTime(r.delivered_at)}.</p>}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted">{label}:</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function C({ name, label, step = "1" }: { name: string; label: string; step?: string }) {
  return (
    <label className="block"><span className="mb-1 block text-xs font-medium">{label}</span><input name={name} type="number" min="0" step={step} className="field-input py-2" /></label>
  );
}
