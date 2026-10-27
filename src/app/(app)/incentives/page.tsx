import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { builderFocus } from "@/lib/builder-focus";
import { canManageIncentives, isStaff } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { daysLeft, endsText, INCENTIVE_SELECT, todayCentral, type Incentive } from "@/lib/incentives";
import { Notice } from "@/components/notice";
import { IncentiveScope } from "@/components/incentive-scope";
import { addIncentive, editIncentive, endIncentive, extendIncentive } from "./actions";

export default function IncentivesPage(props: PageProps<"/incentives">) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Incentives</h1>
      <p className="mt-1 max-w-3xl text-muted">
        Buyer incentives for every community, one community, or one home. Each one has an end date. A week before it ends, your marketing team gets a
        to-do to extend it or end it, and our team keeps the MLS in step either way.
      </p>
      <Suspense fallback={<div className="mt-8 h-64 animate-pulse rounded-2xl bg-soft" />}>
        <div className="mt-6"><Notice searchParams={props.searchParams} /></div>
        <List searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

type Row = Incentive & {
  created_at: string; ended_at: string | null;
  communities: { name: string } | null; homes: { unparsed_address: string } | null; builders: { name: string } | null;
};

async function List({ searchParams }: { searchParams: PageProps<"/incentives">["searchParams"] }) {
  const me = await requireProfile();
  if (me.role === "photographer") redirect("/jobs");
  const sp = await searchParams;
  const staff = isStaff(me.role);
  const manage = canManageIncentives(me.role);
  const focus = await builderFocus(me.role);
  const view = sp.view === "past" ? "past" : "current";
  const supabase = await createClient();

  let q = supabase.from("incentives").select(`${INCENTIVE_SELECT}, created_at, ended_at, communities(name), homes(unparsed_address), builders(name)`);
  q = view === "past" ? q.neq("status", "active").order("ended_at", { ascending: false }).limit(100) : q.eq("status", "active").order("ends_on");
  if (focus) q = q.eq("builder_id", focus);
  const [{ data: rows }, { data: communities }, { data: homes }, { data: builders }] = await Promise.all([
    q,
    manage ? supabase.from("communities").select("id, name, builder_id").order("name") : Promise.resolve({ data: [] }),
    manage ? supabase.from("homes").select("id, unparsed_address, builder_id, community_id").is("deleted_at", null).order("unparsed_address") : Promise.resolve({ data: [] }),
    me.role === "platform_admin" ? supabase.from("builders").select("id, name").order("name") : Promise.resolve({ data: null }),
  ]);
  const list = (rows ?? []) as unknown as Row[];
  const homeId = typeof sp.home === "string" ? sp.home : undefined;
  const communityId = typeof sp.community === "string" ? sp.community : undefined;
  const homeRow = (homes ?? []).find((h) => h.id === homeId);
  const initial = homeRow
    ? { scope: "home" as const, builderId: homeRow.builder_id, communityId: homeRow.community_id ?? undefined, homeId }
    : communityId
      ? { scope: "community" as const, builderId: (communities ?? []).find((c) => c.id === communityId)?.builder_id, communityId }
      : { scope: "builder" as const, builderId: focus ?? undefined };
  const backHref = `/incentives${view === "past" ? "?view=past" : ""}`;
  const today = todayCentral();
  const tab = (v: string, label: string) => (
    <Link href={v === "current" ? "/incentives" : "/incentives?view=past"} className={cx("rounded-full border px-3.5 py-1.5 text-sm", view === v ? "border-foreground bg-foreground font-semibold text-white" : "border-line hover:border-foreground")}>{label}</Link>
  );

  return (
    <>
      {manage && view === "current" && (
        <details open={!!homeId || !!communityId || list.length === 0} className="rounded-2xl border border-line">
          <summary className="cursor-pointer list-none px-4 py-3 font-semibold">+ Add an incentive</summary>
          <form action={addIncentive} className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
            <input type="hidden" name="back" value="/incentives" />
            <IncentiveScope
              builders={builders ? builders.map((b) => ({ id: b.id, name: b.name.replace(" (demo)", "") })) : null}
              communities={(communities ?? []).map((c) => ({ id: c.id, label: c.name, builder_id: c.builder_id }))}
              homes={(homes ?? []).map((h) => ({ id: h.id, label: h.unparsed_address, builder_id: h.builder_id, community_id: h.community_id }))}
              initial={initial}
            />
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Incentive</span>
              <input name="title" required maxLength={120} placeholder="e.g. $10,000 toward closing costs" className="field-input" />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Details (optional)</span>
              <textarea name="details" rows={2} maxLength={2000} placeholder="e.g. With our preferred lender, on contracts written by the end date." className="field-input" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">End date</span>
              <input name="ends_on" type="date" required min={today} className="field-input" />
            </label>
            <p className="self-end pb-2 text-xs text-muted">For buyers only. Agent bonuses or commission can&rsquo;t go on the MLS, so they can&rsquo;t go here.</p>
            <div className="sm:col-span-2"><button className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:brightness-110">Add incentive</button></div>
          </form>
        </details>
      )}

      <div className="mt-6 flex gap-2">{tab("current", "Current")}{tab("past", "Ended")}</div>

      <ul className="mt-4 space-y-3">
        {list.map((i) => {
          const left = daysLeft(i.ends_on);
          const soon = i.status === "active" && left <= 7;
          const where = i.scope === "home" ? i.homes?.unparsed_address : i.scope === "community" ? i.communities?.name : "Every community";
          return (
            <li key={i.id} id={`i-${i.id}`} className={cx("scroll-mt-28 rounded-2xl border p-4 target:ring-2 target:ring-accent", soon ? "border-amber-300" : "border-line")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-violet-50 px-2.5 py-0.5 font-semibold text-violet-800">{({ builder: "All communities", community: "One community", home: "One home" } as const)[i.scope]}</span>
                    {staff && i.builders && <span className="text-muted">{i.builders.name.replace(" (demo)", "")}</span>}
                    {i.status !== "active" && <span className="rounded-full bg-soft px-2.5 py-0.5 font-semibold text-muted">{i.status === "expired" ? "Ended on its end date" : "Ended early"}</span>}
                  </div>
                  <p className="mt-1 font-semibold">{i.title}</p>
                  {i.details && <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{i.details}</p>}
                  <p className="mt-1 text-sm">
                    {i.scope === "home" && i.home_id ? <Link href={`/homes/${i.home_id}`} className="underline">{where}</Link> : i.scope === "community" && i.community_id ? <Link href={`/communities/${i.community_id}`} className="underline">{where}</Link> : where}
                    {" · "}
                    <span className={soon ? "font-semibold text-amber-900" : "text-muted"}>{i.status === "active" ? endsText(i.ends_on) : `Ended ${i.ended_at ? dateTime(i.ended_at) : ""}`}</span>
                  </p>
                </div>
              </div>
              {manage && (
                <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
                  <form action={extendIncentive} className="flex items-end gap-2">
                    <input type="hidden" name="id" value={i.id} />
                    <input type="hidden" name="back" value={backHref} />
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium">{i.status === "active" ? "New end date" : "Bring it back until"}</span>
                      <input name="ends_on" type="date" required min={today} defaultValue={i.status === "active" ? i.ends_on : ""} className="field-input py-1.5 text-sm" />
                    </label>
                    <button className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">{i.status === "active" ? "Extend" : "Bring back"}</button>
                  </form>
                  {i.status === "active" && (
                    <form action={endIncentive}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="back" value={backHref} />
                      <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">End it now</button>
                    </form>
                  )}
                  {i.status === "active" && (
                    <details className="w-full">
                      <summary className="cursor-pointer text-sm font-semibold underline">Edit the wording</summary>
                      <form action={editIncentive} className="mt-2 grid gap-2">
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="back" value={backHref} />
                        <input name="title" required maxLength={120} defaultValue={i.title} className="field-input" aria-label="Incentive" />
                        <textarea name="details" rows={2} maxLength={2000} defaultValue={i.details ?? ""} className="field-input" aria-label="Details" />
                        <div><button className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">Save wording</button></div>
                      </form>
                    </details>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {list.length === 0 && (
          <li className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">{view === "past" ? "No ended incentives yet." : "No current incentives."}</li>
        )}
      </ul>
    </>
  );
}
