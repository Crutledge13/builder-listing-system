import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { cx, dateTime } from "@/lib/format";
import { markAllRead } from "./actions";

export default function InboxPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Inbox</h1>
      <p className="mt-1 text-muted">Notices for you: finished reverse prospecting lists and comps, reminders, and things waiting on you.</p>
      <Suspense fallback={<div className="mt-8 h-64 animate-pulse rounded-2xl bg-soft" />}>
        <Inbox />
      </Suspense>
    </div>
  );
}

const KIND_LABELS: Record<string, string> = {
  reverse_prospecting: "Reverse prospecting",
  comps: "Comps",
  incentive: "Incentive",
  mls: "MLS work",
  task: "To-do",
};

async function Inbox() {
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("id, kind, title, body, href, created_at, read_at").order("created_at", { ascending: false }).limit(100);
  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <div className="mt-6">
      {unread > 0 && (
        <form action={markAllRead} className="mb-3 flex justify-end">
          <button className="text-sm font-semibold underline">Mark all {unread} as read</button>
        </form>
      )}
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-muted">Nothing yet. When our team sends you something, it shows up here.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {items.map((n) => (
            <li key={n.id}>
              <Link href={n.href ? `/inbox-open/${n.id}` : "#"} className={cx("block px-4 py-3 hover:bg-soft", !n.read_at && "bg-accent-soft/40")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold">
                    {!n.read_at && <span className="h-2 w-2 rounded-full bg-accent" aria-label="New" />}
                    {n.title}
                  </span>
                  <span className="text-xs text-muted">{KIND_LABELS[n.kind] ?? "Notice"} · {dateTime(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-1 line-clamp-2 text-sm text-muted">{n.body}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
