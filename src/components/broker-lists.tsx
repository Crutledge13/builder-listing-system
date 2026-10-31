import Link from "next/link";
import { workOrder } from "@/lib/broker";
import { TASK_KIND_LABELS } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { whenCentral } from "@/lib/time";

// The broker dashboard's lists (/broker): work orders, and live or closed listings.

export type BrokerOrderRow = {
  id: string;
  kind: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  created_at: string;
  completed_at: string | null;
  builder_name: string;
  address: string | null;
  mls_number: string | null;
  work_order_no: number;
  home_id: string | null;
  waiting_on_builder: number;
  submitted_at: string | null;
};
type Row = BrokerOrderRow;

export type BrokerListing = {
  home_id: string;
  address: string;
  builder_name: string;
  mls_number: string | null;
  mls_listing_url: string | null;
  workflow_status: string;
  market_status: string;
  last_work_at: string | null;
  open_orders: number;
};
type Listing = BrokerListing;

const KIND_STYLE: Record<string, string> = {
  mls_entry: "bg-accent-soft text-accent",
  mls_update: "bg-amber-50 text-amber-900",
  listing_status: "bg-red-50 text-red-900",
  open_house_mls: "bg-emerald-50 text-emerald-900",
};
const MARKET: Record<string, string> = { active: "Active", paused: "On hold", under_contract: "Pending", sold: "Sold", withdrawn: "Withdrawn" };

export function OrderList({ rows, empty }: { rows: Row[]; empty: string }) {
  const open = rows.filter((r) => r.status === "todo" || r.status === "in_progress");
  const submitted = rows.filter((r) => r.status === "submitted");
  const done = rows.filter((r) => r.status === "done").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")).slice(0, 30);
  return (
    <div className="mt-6">
      {open.length === 0 && <p className="rounded-2xl border border-dashed border-line px-6 py-8 text-center text-muted">{empty}</p>}
      <ul className="space-y-2">{open.map((r) => <OrderRow key={r.id} r={r} />)}</ul>
      {submitted.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-muted">Sent to the builder to accept ({submitted.length})</h2>
          <ul className="mt-2 space-y-2">{submitted.map((r) => <OrderRow key={r.id} r={r} />)}</ul>
        </>
      )}
      {done.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-semibold text-muted">Closed ({done.length}{done.length === 30 ? "+" : ""})</summary>
          <ul className="mt-2 space-y-2">{done.map((r) => <OrderRow key={r.id} r={r} />)}</ul>
        </details>
      )}
    </div>
  );
}

// One work order. Stacks on a phone: number and kind, then the address in
// full, then the builder and where it stands.
function OrderRow({ r }: { r: Row }) {
  const finished = r.status === "done";
  const late = !finished && r.status !== "submitted" && r.due_at && new Date(r.due_at) < new Date();
  const where = r.waiting_on_builder > 0 ? "Sent back, waiting on the builder"
    : r.status === "submitted" ? `Sent ${dateTime(r.submitted_at ?? r.created_at)}, waiting for the builder to accept`
    : r.status === "in_progress" ? "Started" : null;
  return (
    <li>
      <Link href={`/broker/tasks/${r.id}`} className={cx("block rounded-2xl border px-4 py-3 hover:border-foreground", late ? "border-red-200" : "border-line", finished && "opacity-70")}>
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold tabular-nums">{workOrder(r.work_order_no)}</span>
          <span className={cx("rounded-full px-2 py-0.5 font-semibold", KIND_STYLE[r.kind] ?? "bg-soft")}>{TASK_KIND_LABELS[r.kind] ?? r.kind}</span>
          {r.priority === "high" && !finished && r.status !== "submitted" && <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800">Urgent</span>}
        </span>
        <span className="mt-1 block break-words text-[17px] font-semibold leading-snug">{r.address ?? r.title}</span>
        <span className="mt-0.5 block text-sm text-muted">
          {r.builder_name}
          {r.mls_number ? ` · MLS #${r.mls_number}` : ""}
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 text-sm">
          {where && <span className={r.waiting_on_builder > 0 ? "font-semibold text-amber-800" : "text-muted"}>{where}</span>}
          <span className={late ? "font-semibold text-red-800" : "text-muted"}>
            {finished ? `Closed ${dateTime(r.completed_at ?? r.created_at)}` : r.status === "submitted" ? "" : r.due_at ? `${late ? "Overdue since" : "Due"} ${whenCentral(r.due_at)}` : `Sent ${dateTime(r.created_at)}`}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function ListingList({ rows, empty }: { rows: Listing[]; empty: string }) {
  if (!rows.length) return <p className="mt-6 rounded-2xl border border-dashed border-line px-6 py-8 text-center text-muted">{empty}</p>;
  return (
    <ul className="mt-6 space-y-2">
      {rows.map((l) => (
        <li key={l.home_id}>
          <Link href={`/broker/listings/${l.home_id}`} className="block rounded-2xl border border-line px-4 py-3 hover:border-foreground">
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-soft px-2 py-0.5 font-semibold">{MARKET[l.market_status] ?? l.market_status}</span>
              {l.mls_number && <span className="font-semibold tabular-nums">MLS #{l.mls_number}</span>}
              {l.open_orders > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-900">{l.open_orders} open</span>}
            </span>
            <span className="mt-1 block break-words text-[17px] font-semibold leading-snug">{l.address}</span>
            <span className="mt-0.5 block text-sm text-muted">{l.builder_name}{l.last_work_at ? ` · Last work order ${dateTime(l.last_work_at)}` : ""}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
