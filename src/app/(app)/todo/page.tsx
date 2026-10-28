import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { requireFeature } from "@/lib/features";
import { builderFocus } from "@/lib/builder-focus";
import { canUseBuilderBoard, isStaff } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { TZ, whenCentral } from "@/lib/time";
import { Notice } from "@/components/notice";
import { addTodo, updateTodo } from "./actions";

// The builder team's own task board. Laid out like our team's task board
// (/tasks): open / mine / done, kinds, grouped by when they're due.

export default function TodoPage(props: PageProps<"/todo">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Board searchParams={props.searchParams} />
    </Suspense>
  );
}

const KINDS: Record<string, string> = {
  photo_review: "Photos to review",
  change_request: "Change request",
  incentive: "Incentive ending",
  other: "Task",
};
const KIND_STYLE: Record<string, string> = {
  photo_review: "bg-emerald-50 text-emerald-800",
  change_request: "bg-amber-50 text-amber-900",
  incentive: "bg-violet-50 text-violet-800",
  other: "bg-soft text-muted",
};
const STATUS_LABELS: Record<string, string> = { todo: "To do", in_progress: "In progress", done: "Done", cancelled: "Cancelled" };

type Todo = {
  id: string; builder_id: string; kind: string; title: string; details: string | null; status: string; priority: string;
  due_at: string | null; assignee_id: string | null; home_id: string | null; source_table: string | null; source_id: string | null;
  created_at: string; completed_at: string | null; homes: { unparsed_address: string } | null; builders: { name: string } | null;
};

function centralDay(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Where an automatic task came from, one click away.
function sourceLink(t: Todo) {
  if (t.source_table === "media_requests") return { href: t.home_id ? `/homes/${t.home_id}#photo-requests` : "/media/requests", label: "Review the photos" };
  if (t.source_table === "change_requests" && t.home_id) return { href: `/homes/${t.home_id}#requests`, label: "Open the change request" };
  if (t.source_table === "incentives") return { href: `/incentives#i-${t.source_id}`, label: "Extend or end it" };
  if (t.home_id) return { href: `/homes/${t.home_id}`, label: "Open home" };
  return null;
}

async function Board({ searchParams }: { searchParams: PageProps<"/todo">["searchParams"] }) {
  const me = await requireProfile();
  await requireFeature(me, "builder_tasks");
  if (!canUseBuilderBoard(me.role) && !isStaff(me.role)) redirect("/communities");
  const sp = await searchParams;
  const view = sp.view === "mine" || sp.view === "done" ? sp.view : "open";
  const kind = typeof sp.kind === "string" && KINDS[sp.kind] ? sp.kind : null;
  const staff = isStaff(me.role);
  const focus = await builderFocus(me.role);
  const supabase = await createClient();

  let q = supabase.from("builder_tasks").select("id, builder_id, kind, title, details, status, priority, due_at, assignee_id, home_id, source_table, source_id, created_at, completed_at, homes(unparsed_address), builders(name)");
  q = view === "done" ? q.in("status", ["done", "cancelled"]).order("completed_at", { ascending: false }).limit(60) : q.in("status", ["todo", "in_progress"]);
  if (view === "mine") q = q.eq("assignee_id", me.id);
  if (kind) q = q.eq("kind", kind);
  if (focus) q = q.eq("builder_id", focus);
  let cq = supabase.from("builder_tasks").select("kind, assignee_id").in("status", ["todo", "in_progress"]);
  if (focus) cq = cq.eq("builder_id", focus);
  const [{ data: rows }, { data: people }, { data: homes }, { data: openRows }] = await Promise.all([
    q,
    supabase.from("profiles").select("id, full_name, builder_id, role").in("role", ["builder_owner", "manager", "marketing"]).eq("is_active", true).order("full_name"),
    staff ? Promise.resolve({ data: [] as { id: string; unparsed_address: string; builder_id: string }[] }) : supabase.from("homes").select("id, unparsed_address, builder_id").is("deleted_at", null).order("unparsed_address"),
    cq,
  ]);
  const todos = (rows ?? []) as unknown as Todo[];
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const team = (people ?? []).filter((p) => p.builder_id === me.builder_id);
  const kindCounts = new Map<string, number>();
  (openRows ?? []).forEach((t) => kindCounts.set(t.kind, (kindCounts.get(t.kind) ?? 0) + 1));
  const mineCount = (openRows ?? []).filter((t) => t.assignee_id === me.id).length;

  // Group open tasks by when they're due (Central time), like our team's board.
  const now = new Date();
  const today = centralDay(now);
  const weekOut = centralDay(new Date(now.getTime() + 7 * 86_400_000));
  const groups: { key: string; title: string; list: Todo[] }[] = [
    { key: "overdue", title: "Overdue", list: [] },
    { key: "today", title: "Due today", list: [] },
    { key: "week", title: "This week", list: [] },
    { key: "later", title: "Later", list: [] },
    { key: "none", title: "No due date", list: [] },
  ];
  const sorted = [...todos].sort((a, b) =>
    (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1) ||
    (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") ||
    a.created_at.localeCompare(b.created_at),
  );
  if (view === "done") groups.splice(0, groups.length, { key: "done", title: "Recently finished", list: sorted });
  else
    sorted.forEach((t) => {
      if (!t.due_at) return groups[4].list.push(t);
      const d = centralDay(new Date(t.due_at));
      if (new Date(t.due_at) < now && d < today) groups[0].list.push(t);
      else if (d === today) groups[1].list.push(t);
      else if (d <= weekOut) groups[2].list.push(t);
      else groups[3].list.push(t);
    });

  const link = (p: Record<string, string | null>) => {
    const s = new URLSearchParams();
    const next = { view, kind, ...p };
    if (next.view && next.view !== "open") s.set("view", next.view);
    if (next.kind) s.set("kind", next.kind);
    const str = s.toString();
    return str ? `/todo?${str}` : "/todo";
  };
  const backTo = link({});

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{staff ? "Builders’ tasks" : "Tasks"}</h1>
          <p className="mt-1 text-muted">
            {staff
              ? "Each builder’s own task board (their owners, managers and marketing work it)."
              : "Everything your team needs to do. Photos to review, change requests and incentives ending add tasks here on their own."}
          </p>
        </div>
        {!staff && (
          <details data-popover className="relative">
            <summary className="cursor-pointer list-none rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110">+ New task</summary>
            <form action={addTodo} className="card-lift absolute right-0 z-20 mt-2 w-[min(92vw,380px)] space-y-3 rounded-2xl border border-line bg-white p-4">
              <input type="hidden" name="back" value={backTo} />
              <input name="title" required maxLength={200} placeholder="What needs doing?" className="field-input" />
              <textarea name="details" rows={3} maxLength={4000} placeholder="Details (optional)" className="field-input" />
              <select name="home_id" defaultValue="" className="field-input" aria-label="Home">
                <option value="">No home</option>
                {(homes ?? []).filter((h) => h.builder_id === me.builder_id).map((h) => <option key={h.id} value={h.id}>{h.unparsed_address}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Due</span>
                  <input name="due" type="date" className="field-input" />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Who</span>
                  <select name="assignee_id" defaultValue={me.id} className="field-input">
                    <option value="">Anyone</option>
                    {team.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.id === me.id ? " (me)" : ""}</option>)}
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="priority" value="high" className="h-4 w-4 accent-[#3452c7]" /> High priority
              </label>
              <button className="w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white">Add task</button>
            </form>
          </details>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {[
          { v: "open", label: `Open (${(openRows ?? []).length})` },
          { v: "mine", label: `Assigned to me (${mineCount})` },
          { v: "done", label: "Done" },
        ].map((t) => (
          <Link key={t.v} href={link({ view: t.v })} className={cx("rounded-full px-4 py-2 text-sm font-semibold", view === t.v ? "bg-foreground text-white" : "border border-line hover:border-foreground")}>
            {t.label}
          </Link>
        ))}
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        <Link href={link({ kind: null })} className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold", !kind ? "bg-accent text-white" : "bg-soft")}>All kinds</Link>
        {Object.entries(KINDS).map(([k, label]) => (
          <Link key={k} href={link({ kind: k })} className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold", kind === k ? "bg-accent text-white" : "bg-soft")}>
            {label}{kindCounts.get(k) ? ` ${kindCounts.get(k)}` : ""}
          </Link>
        ))}
      </div>

      <div className="mt-8 space-y-10">
        {groups.filter((g) => g.list.length).map((g) => (
          <section key={g.key}>
            <h2 className={cx("text-sm font-semibold uppercase tracking-wide", g.key === "overdue" ? "text-red-700" : "text-muted")}>
              {g.title} <span className="font-normal">({g.list.length})</span>
            </h2>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {g.list.map((t) => {
                const src = sourceLink(t);
                const closed = t.status === "done" || t.status === "cancelled";
                return (
                  <article key={t.id} className={cx("rounded-2xl border p-4", t.priority === "high" && !closed ? "border-red-200 bg-red-50/30" : "border-line", closed && "opacity-75")}>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={cx("rounded-full px-2.5 py-1 font-semibold", KIND_STYLE[t.kind] ?? KIND_STYLE.other)}>{KINDS[t.kind] ?? "Task"}</span>
                      {t.priority === "high" && <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-800">High</span>}
                      {t.status === "in_progress" && <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-900">In progress</span>}
                      {closed && <span className="rounded-full bg-soft px-2.5 py-1 font-semibold">{STATUS_LABELS[t.status]}</span>}
                      {staff && t.builders && <span className="text-muted">{t.builders.name.replace(" (demo)", "")}</span>}
                    </div>
                    <h3 className="mt-2 font-semibold leading-snug">
                      {src ? <Link href={src.href} className="hover:underline">{t.title}</Link> : t.title}
                    </h3>
                    {t.details && <p className="mt-1 whitespace-pre-line text-sm text-muted">{t.details}</p>}
                    <p className="mt-2 text-sm">
                      {t.due_at && <span className={cx(new Date(t.due_at) < now && !closed && "font-semibold text-red-700")}>Due {whenCentral(t.due_at)}. </span>}
                      {closed && t.completed_at ? <span className="text-muted">Finished {dateTime(t.completed_at)}. </span> : <span className="text-muted">Added {dateTime(t.created_at)}. </span>}
                      {t.homes && t.home_id && src?.href !== `/homes/${t.home_id}` && <Link href={`/homes/${t.home_id}`} className="text-muted hover:underline">{t.homes.unparsed_address} </Link>}
                      {src && <Link href={src.href} className="font-semibold text-accent hover:underline">{src.label} →</Link>}
                    </p>

                    {staff ? (
                      t.assignee_id && <p className="mt-3 text-sm text-muted">On it: {nameOf.get(t.assignee_id) ?? "someone"}</p>
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {!closed && t.status === "todo" && <StatusButton id={t.id} back={backTo} status="in_progress" label="Start" />}
                        {!closed && <StatusButton id={t.id} back={backTo} status="done" label="Mark done" primary />}
                        {closed && <StatusButton id={t.id} back={backTo} status="todo" label="Reopen" />}
                        <form action={updateTodo} className="ml-auto flex items-center gap-1">
                          <input type="hidden" name="back" value={backTo} />
                          <input type="hidden" name="id" value={t.id} />
                          <select name="assignee_id" defaultValue={t.assignee_id ?? ""} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm" aria-label="Assigned to">
                            <option value="">Unassigned</option>
                            {team.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                          </select>
                          <button className="rounded-lg px-2 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">Set</button>
                        </form>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        {todos.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-muted">{view === "done" ? "Nothing finished yet." : "All clear."}</p>
        )}
      </div>
    </div>
  );
}

function StatusButton({ id, back, status, label, primary }: { id: string; back: string; status: string; label: string; primary?: boolean }) {
  return (
    <form action={updateTodo}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="status" value={status} />
      <button className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold", primary ? "bg-foreground text-white hover:bg-black" : "border border-line hover:border-foreground")}>{label}</button>
    </form>
  );
}
