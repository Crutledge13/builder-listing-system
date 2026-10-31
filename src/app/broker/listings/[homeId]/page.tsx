import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireBrokerWithTerms, workOrder } from "@/lib/broker";
import { TASK_KIND_LABELS, TASK_STATUS_LABELS } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { CopyButton } from "@/components/mls-client";

// One live or closed listing: its MLS number and link, and every work order on it.
export default function BrokerListingPage(props: { params: Promise<{ homeId: string }> }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Listing params={props.params} />
    </Suspense>
  );
}

type Data = {
  home: { id: string; address: string; city: string | null; mls_number: string | null; mls_listing_url: string | null; workflow_status: string; market_status: string; builder_name: string };
  orders: { id: string; work_order_no: number; kind: string; title: string; status: string; created_at: string; completed_at: string | null; submitted_at: string | null }[];
};
const MARKET: Record<string, string> = { active: "Active", paused: "On hold", under_contract: "Pending", sold: "Sold", withdrawn: "Withdrawn" };

async function Listing({ params }: { params: Promise<{ homeId: string }> }) {
  const { homeId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(homeId)) notFound();
  await requireBrokerWithTerms();
  const supabase = await createClient();
  const { data } = await supabase.rpc("broker_listing", { p_home: homeId });
  const d = data as Data | null;
  if (!d?.home) notFound();
  const closed = ["sold", "withdrawn"].includes(d.home.market_status);
  return (
    <div>
      <Link href={`/broker?view=${closed ? "closed" : "live"}`} className="text-sm font-semibold text-muted hover:text-foreground">← {closed ? "Closed" : "Live"} listings</Link>
      <h1 className="mt-3 break-words text-[26px] font-bold leading-tight tracking-tight">{d.home.address}</h1>
      <p className="mt-1 text-sm text-muted">{d.home.builder_name} · {MARKET[d.home.market_status] ?? d.home.market_status}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line p-4 text-sm">
        {d.home.mls_number ? <span>MLS #<b>{d.home.mls_number}</b> <CopyButton value={d.home.mls_number} /></span> : <span className="text-muted">No MLS number yet</span>}
        {d.home.mls_listing_url && <a href={d.home.mls_listing_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">Open the live listing ↗</a>}
      </div>
      <h2 className="mt-8 font-semibold">Work orders</h2>
      <ul className="mt-3 space-y-2">
        {d.orders.map((o) => (
          <li key={o.id}>
            <Link href={`/broker/tasks/${o.id}`} className={cx("block rounded-2xl border border-line px-4 py-3 hover:border-foreground", o.status === "done" && "opacity-75")}>
              <span className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold tabular-nums">{workOrder(o.work_order_no)}</span>
                <span className="rounded-full bg-soft px-2 py-0.5 font-semibold">{TASK_KIND_LABELS[o.kind] ?? o.kind}</span>
                <span className="text-muted">{TASK_STATUS_LABELS[o.status] ?? o.status}</span>
              </span>
              <span className="mt-1 block break-words font-medium">{o.title}</span>
              <span className="block text-sm text-muted">Sent {dateTime(o.created_at)}{o.completed_at ? ` · Closed ${dateTime(o.completed_at)}` : ""}</span>
            </Link>
          </li>
        ))}
        {d.orders.length === 0 && <li className="text-sm text-muted">No work orders yet.</li>}
      </ul>
    </div>
  );
}
