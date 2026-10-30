import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireBrokerWithTerms } from "@/lib/broker";
import { TASK_KIND_LABELS } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { whenCentral } from "@/lib/time";
import { Notice } from "@/components/notice";

// The broker's to-do list: MLS work from the builders who invited them.
export default function BrokerHome(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <List />
    </Suspense>
  );
}

type Row = {
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
};

const KIND_STYLE: Record<string, string> = {
  mls_entry: "bg-accent-soft text-accent",
  mls_update: "bg-amber-50 text-amber-900",
  listing_status: "bg-red-50 text-red-900",
  open_house_mls: "bg-emerald-50 text-emerald-900",
};

async function List() {
  const { info } = await requireBrokerWithTerms();
  const supabase = await createClient();
  const { data } = await supabase.rpc("broker_tasks");
  const rows = (data ?? []) as Row[];
  const open = rows.filter((r) => r.status === "todo" || r.status === "in_progress");
  const done = rows.filter((r) => r.status === "done").slice(0, 30);

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Your MLS work</h1>
      <p className="mt-1 text-muted">
        {open.length === 0 ? "Nothing waiting. You’ll get an email when a builder sends you something." : `${open.length} waiting. Open one for every field to copy into the MLS.`}
      </p>
      {info.builders.length === 0 && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">No builder has you set up as their listing broker right now.</p>
      )}

      <ul className="mt-6 space-y-2">
        {open.map((r) => <TaskRow key={r.id} r={r} />)}
      </ul>

      {done.length > 0 && (
        <details className="mt-10">
          <summary className="cursor-pointer font-semibold">Done ({done.length}{done.length === 30 ? "+" : ""})</summary>
          <ul className="mt-3 space-y-2">
            {done.map((r) => <TaskRow key={r.id} r={r} />)}
          </ul>
        </details>
      )}
    </div>
  );
}

function TaskRow({ r }: { r: Row }) {
  const finished = r.status === "done";
  const late = !finished && r.due_at && new Date(r.due_at) < new Date();
  return (
    <li>
      <Link href={`/broker/tasks/${r.id}`} className={cx("flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-line px-4 py-3 hover:border-foreground", finished && "opacity-70")}>
        <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", KIND_STYLE[r.kind] ?? "bg-soft")}>{TASK_KIND_LABELS[r.kind] ?? r.kind}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{r.address ?? r.title}</span>
          <span className="block text-sm text-muted">
            {r.builder_name}
            {r.mls_number ? ` · MLS #${r.mls_number}` : ""}
            {r.status === "in_progress" ? " · Started" : ""}
          </span>
        </span>
        <span className={cx("text-sm", late ? "font-semibold text-red-800" : "text-muted")}>
          {finished ? `Done ${dateTime(r.completed_at ?? r.created_at)}` : r.due_at ? `${late ? "Overdue: " : "Due "}${whenCentral(r.due_at)}` : `Sent ${dateTime(r.created_at)}`}
        </span>
        {r.priority === "high" && !finished && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Urgent</span>}
      </Link>
    </li>
  );
}
