import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { builderFocus } from "@/lib/builder-focus";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { Notice } from "@/components/notice";
import { AlertCard, ALERT_TITLES, loadAlerts } from "@/components/alerts";
import { runChecksNow } from "./actions";

export default function CompliancePage(props: PageProps<"/compliance">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Compliance searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Compliance({ searchParams }: { searchParams: PageProps<"/compliance">["searchParams"] }) {
  const me = await requireProfile();
  if (!isStaff(me.role)) redirect("/communities");
  const sp = await searchParams;
  const kind = typeof sp.kind === "string" ? sp.kind : null;
  const supabase = await createClient();
  const focus = await builderFocus(me.role);
  let rq = supabase.from("home_alerts").select("id, kind, message, resolution, resolved_at, homes(unparsed_address)").not("resolved_at", "is", null).order("resolved_at", { ascending: false }).limit(10);
  if (focus) rq = rq.eq("builder_id", focus);
  const [all, { data: boards }, { data: resolved }] = await Promise.all([
    loadAlerts(focus ? { builderId: focus } : {}),
    supabase.from("mls_boards").select("code, short_name, rules").eq("active", true).order("code"),
    rq,
  ]);
  const alerts = kind ? all.filter((a) => a.kind === kind) : all;
  const counts = new Map<string, number>();
  all.forEach((a) => counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1));
  const urgent = all.filter((a) => a.severity === "urgent").length;
  const back = kind ? `/compliance?kind=${kind}` : "/compliance";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">MLS compliance</h1>
          <p className="mt-1 max-w-2xl text-muted">
            Anything that could get a listing fined or bounced: status changes near the deadline, sold signals from the builder’s website or the MLS,
            open houses not entered, descriptions with contact info, stale completion dates. Checked every hour.
          </p>
        </div>
        <form action={runChecksNow}>
          <input type="hidden" name="back" value={back} />
          <button className="rounded-full border border-foreground px-4 py-2.5 text-sm font-semibold hover:bg-soft">Run the check now</button>
        </form>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={cx("rounded-2xl border p-4", urgent ? "border-red-300 bg-red-50/60" : "border-line")}>
          <dt className="text-sm text-muted">Urgent</dt><dd className="text-2xl font-bold">{urgent}</dd>
        </div>
        <div className="rounded-2xl border border-line p-4"><dt className="text-sm text-muted">Open alerts</dt><dd className="text-2xl font-bold">{all.length}</dd></div>
        {(boards ?? []).slice(0, 2).map((b) => (
          <div key={b.code} className="rounded-2xl border border-line p-4">
            <dt className="text-sm text-muted">{b.short_name} status deadline</dt>
            <dd className="text-2xl font-bold">{(b.rules as { status_change_hours?: number }).status_change_hours ?? "?"} hrs</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        <Link href="/compliance" className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold", !kind ? "bg-accent text-white" : "bg-soft")}>All {all.length}</Link>
        {[...counts.entries()].map(([k, n]) => (
          <Link key={k} href={`/compliance?kind=${k}`} className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold", kind === k ? "bg-accent text-white" : "bg-soft")}>
            {ALERT_TITLES[k] ?? k} {n}
          </Link>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {alerts.map((a) => <AlertCard key={a.id} a={a} back={back} canAnswer staff />)}
        {alerts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
            <p className="font-semibold">Nothing at risk</p>
            <p className="mt-1 text-muted">Every listing is within its MLS’s rules right now.</p>
          </div>
        )}
      </div>

      {(resolved ?? []).length > 0 && (
        <section className="mt-10">
          <h2 className="font-semibold">Recently resolved</h2>
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line text-sm">
            {(resolved ?? []).map((r) => (
              <li key={r.id} className="px-4 py-2.5">
                <span className="font-medium">{ALERT_TITLES[r.kind] ?? r.kind}</span>, {(r.homes as unknown as { unparsed_address: string } | null)?.unparsed_address}:{" "}
                <span className="text-muted">{r.resolution} · {dateTime(r.resolved_at!)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
