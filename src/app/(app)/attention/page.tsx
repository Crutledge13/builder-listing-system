import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { cx } from "@/lib/format";
import { Notice } from "@/components/notice";
import { AlertCard, ALERT_TITLES, loadAlerts } from "@/components/alerts";

// Every open issue for the builder's homes, most pressing first.
export default function AttentionPage(props: PageProps<"/attention">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Attention searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Attention({ searchParams }: { searchParams: PageProps<"/attention">["searchParams"] }) {
  const me = await requireProfile();
  if (isStaff(me.role)) redirect("/compliance");
  if (me.role === "photographer") redirect("/jobs");
  const sp = await searchParams;
  const kind = typeof sp.kind === "string" ? sp.kind : null;
  const all = await loadAlerts();
  const alerts = kind ? all.filter((a) => a.kind === kind) : all;
  const counts = new Map<string, number>();
  all.forEach((a) => counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1));
  const back = kind ? `/attention?kind=${kind}` : "/attention";
  const canAnswer = ["builder_owner", "manager", "marketing", "sales"].includes(me.role);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Needs your attention</h1>
      <p className="mt-1 max-w-2xl text-muted">
        Everything waiting on your team, most urgent first. Answering keeps the MLS accurate and avoids fines; sold or under contract goes to our team right away.
      </p>
      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        <Link href="/attention" className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold", !kind ? "bg-accent text-white" : "bg-soft")}>All {all.length}</Link>
        {[...counts.entries()].map(([k, n]) => (
          <Link key={k} href={`/attention?kind=${k}`} className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold", kind === k ? "bg-accent text-white" : "bg-soft")}>
            {ALERT_TITLES[k] ?? k} {n}
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {alerts.map((a) => <AlertCard key={a.id} a={a} back={back} canAnswer={canAnswer} staff={false} />)}
      </div>
      {alerts.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
          <p className="font-semibold">Nothing needs you right now</p>
          <p className="mt-1 text-muted">We’ll show it here (and email you) when a home needs an answer.</p>
        </div>
      )}
    </div>
  );
}
