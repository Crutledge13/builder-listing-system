import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireBrokerWithTerms } from "@/lib/broker";
import { cx } from "@/lib/format";
import { Notice } from "@/components/notice";
import { OrderList, ListingList, type BrokerListing as Listing, type BrokerOrderRow as Row } from "@/components/broker-lists";

// The broker's dashboard, in four views (Matt's write-up, 30 Oct 2026): new
// listing requests, change requests, live listings and closed listings. Each
// shows a count; open work orders are oldest first so nothing sits unnoticed.
export default function BrokerHome(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Dashboard searchParams={props.searchParams} />
    </Suspense>
  );
}

const VIEWS = [
  { key: "new", label: "New listing requests" },
  { key: "changes", label: "Change requests" },
  { key: "live", label: "Live listings" },
  { key: "closed", label: "Closed listings" },
] as const;
type View = (typeof VIEWS)[number]["key"];

async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { info } = await requireBrokerWithTerms();
  const supabase = await createClient();
  const [{ data: taskData }, { data: listingData }] = await Promise.all([supabase.rpc("broker_tasks"), supabase.rpc("broker_listings")]);
  const rows = (taskData ?? []) as Row[];
  const listings = (listingData ?? []) as Listing[];

  const isNew = (r: Row) => r.kind === "mls_entry";
  const open = (r: Row) => r.status === "todo" || r.status === "in_progress";
  const lists = {
    new: rows.filter((r) => isNew(r)),
    changes: rows.filter((r) => !isNew(r)),
  };
  const live = listings.filter((l) => !["sold", "withdrawn"].includes(l.market_status));
  const closed = listings.filter((l) => ["sold", "withdrawn"].includes(l.market_status));
  const counts: Record<View, number> = {
    new: lists.new.filter(open).length,
    changes: lists.changes.filter(open).length,
    live: live.length,
    closed: closed.length,
  };
  const requested = typeof sp.view === "string" && VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : null;
  const view: View = requested ?? (counts.new ? "new" : counts.changes ? "changes" : "new");
  const waitingTotal = counts.new + counts.changes;

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Your MLS work</h1>
      <p className="mt-1 text-muted">
        {waitingTotal === 0 ? "Nothing waiting. You’ll get an email when a builder sends you something." : `${waitingTotal} work order${waitingTotal === 1 ? "" : "s"} waiting, oldest first.`}
      </p>
      {info.builders.length === 0 && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">No builder has you set up as their listing broker right now.</p>
      )}

      <nav className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" aria-label="Views">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/broker?view=${v.key}`}
            className={cx(
              "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-semibold sm:justify-start",
              view === v.key ? "border-foreground bg-foreground text-white" : "border-line hover:border-foreground",
            )}
          >
            <span>{v.label}</span>
            <span className={cx("rounded-full px-2 py-0.5 text-xs", view === v.key ? "bg-white/20" : "bg-soft")}>{counts[v.key]}</span>
          </Link>
        ))}
      </nav>

      {(view === "new" || view === "changes") && <OrderList rows={lists[view]} empty={view === "new" ? "No new listings waiting." : "No changes waiting."} />}
      {(view === "live" || view === "closed") && <ListingList rows={view === "live" ? live : closed} empty={view === "live" ? "No live listings yet." : "No sold or withdrawn listings yet."} />}
    </div>
  );
}

