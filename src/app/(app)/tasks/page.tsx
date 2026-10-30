import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { builderFocus } from "@/lib/builder-focus";
import { requireProfile } from "@/lib/auth";
import { enterOwnMls } from "@/lib/mls-entry";

const MLS_KINDS = ["mls_entry", "mls_update", "listing_status", "open_house_mls"];
import { isStaff, TASK_KIND_LABELS, TASK_STATUS_LABELS } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { TZ, whenCentral } from "@/lib/time";
import { Notice } from "@/components/notice";
import { addTaskNote, assignTask, createTask, setTaskStatus } from "./actions";

export default function TasksPage(props: PageProps<"/tasks">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Board searchParams={props.searchParams} />
    </Suspense>
  );
}

type Task = {
  id: string;
  kind: string;
  title: string;
  details: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  home_id: string | null;
  builder_id: string | null;
  assignee_id: string | null;
  source_table: string | null;
  source_id: string | null;
  created_at: string;
  completed_at: string | null;
  changes: Record<string, { label: string }>;
  homes: { unparsed_address: string } | null;
  builders: { name: string } | null;
};

const KIND_STYLE: Record<string, string> = {
  mls_entry: "bg-accent-soft text-accent",
  mls_update: "bg-accent-soft text-accent",
  open_house_mls: "bg-sky-50 text-sky-800",
  listing_status: "bg-violet-50 text-violet-800",
  change_request: "bg-amber-50 text-amber-900",
  photo_request: "bg-emerald-50 text-emerald-800",
  reverse_prospecting: "bg-rose-50 text-rose-800",
  comps: "bg-teal-50 text-teal-800",
  issue: "bg-red-50 text-red-800",
  other: "bg-soft text-muted",
};

function centralDay(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Where a task came from, so one click takes our team to the right screen.
function sourceLink(t: Task) {
  if (t.source_table === "media_requests") return { href: "/media/requests", label: "Open photo request" };
  if (t.source_table === "comp_requests" && t.source_id) return { href: `/comps/${t.source_id}`, label: "Open comp request" };
  if (t.source_table === "change_requests" && t.home_id) return { href: `/homes/${t.home_id}#change-requests`, label: "Open change request" };
  if (t.source_table === "reverse_prospect_requests" && t.home_id) return { href: `/homes/${t.home_id}#reverse-prospecting`, label: "Open request" };
  if (t.source_table?.startsWith("open_house")) return t.home_id ? { href: `/homes/${t.home_id}#open-houses`, label: "Open houses" } : null;
  if (t.kind === "issue") return null; // the report itself is in the task details
  if (t.home_id) return { href: `/homes/${t.home_id}`, label: "Open home" };
  return null;
}

async function Board({ searchParams }: { searchParams: PageProps<"/tasks">["searchParams"] }) {
  const me = await requireProfile();
  // Builders who enter their own listings work their MLS tasks here too.
  const ownMls = !isStaff(me.role) && (await enterOwnMls(me.role, me.builder_id));
  if (!isStaff(me.role) && !ownMls) redirect("/communities");
  const sp = await searchParams;
  const view = sp.view === "mine" || sp.view === "done" ? sp.view : "open";
  const kind = typeof sp.kind === "string" && TASK_KIND_LABELS[sp.kind] ? sp.kind : null;
  const supabase = await createClient();

  let q = supabase
    .from("tasks")
    .select("id, kind, title, details, status, priority, due_at, home_id, builder_id, assignee_id, source_table, source_id, created_at, completed_at, changes, homes(unparsed_address), builders(name)");
  q = view === "done" ? q.in("status", ["done", "cancelled"]).order("completed_at", { ascending: false, nullsFirst: false }).limit(60) : q.in("status", ["todo", "in_progress"]);
  if (view === "mine") q = q.eq("assignee_id", me.id);
  // One builder picked in the top bar: that builder's tasks plus general ones (like help reports).
  const focus = await builderFocus(me.role);
  if (focus) q = q.or(`builder_id.eq.${focus},builder_id.is.null`);
  if (kind) q = q.eq("kind", kind);

  const [{ data: rows }, { data: staff }, { data: openCounts }, { data: homes }, { data: builders }] = await Promise.all([
    q,
    ownMls
      ? supabase.from("profiles").select("id, full_name").eq("builder_id", me.builder_id!).in("role", ["builder_owner", "manager", "marketing"]).eq("is_active", true).order("full_name")
      : supabase.from("profiles").select("id, full_name").in("role", ["platform_admin", "listing_coordinator"]).eq("is_active", true).order("full_name"),
    focus
      ? supabase.from("tasks").select("kind, assignee_id").in("status", ["todo", "in_progress"]).or(`builder_id.eq.${focus},builder_id.is.null`)
      : supabase.from("tasks").select("kind, assignee_id").in("status", ["todo", "in_progress"]),
    supabase.from("homes").select("id, unparsed_address").is("deleted_at", null).order("unparsed_address"),
    supabase.from("builders").select("id, name").order("name"),
  ]);
  const tasks = (rows ?? []) as unknown as Task[];
  // Builders who enter their own listings: our team can see that work but doesn't need to do it.
  const { data: selfRows } = ownMls ? { data: [] } : await supabase.from("builder_settings").select("builder_id, mls_entry").in("mls_entry", ["builder", "broker"]);
  const selfBuilders = new Set((selfRows ?? []).filter((r) => r.mls_entry === "builder").map((r) => r.builder_id));
  // Broker mode: the builder's own outside broker does this MLS work.
  const brokerBuilders = new Set((selfRows ?? []).filter((r) => r.mls_entry === "broker").map((r) => r.builder_id));
  let uq = supabase.from("home_alerts").select("id", { count: "exact", head: true }).is("resolved_at", null).eq("severity", "urgent");
  if (focus) uq = uq.eq("builder_id", focus);
  const { count: urgentAlerts } = await uq;
  const ids = tasks.map((t) => t.id);
  const { data: notes } = ids.length
    ? await supabase.from("task_notes").select("id, task_id, author_id, body, created_at").in("task_id", ids).order("created_at")
    : { data: [] as { id: number; task_id: string; author_id: string; body: string; created_at: string }[] };
  const nameOf = new Map((staff ?? []).map((s) => [s.id, s.full_name]));

  const kindCounts = new Map<string, number>();
  (openCounts ?? []).forEach((t) => kindCounts.set(t.kind, (kindCounts.get(t.kind) ?? 0) + 1));
  const mineCount = (openCounts ?? []).filter((t) => t.assignee_id === me.id).length;

  // Group open tasks by when they're due (Central time).
  const now = new Date();
  const today = centralDay(now);
  const weekOut = centralDay(new Date(now.getTime() + 7 * 86_400_000));
  const groups: { key: string; title: string; list: Task[] }[] = [
    { key: "overdue", title: "Overdue", list: [] },
    { key: "today", title: "Due today", list: [] },
    { key: "week", title: "This week", list: [] },
    { key: "later", title: "Later", list: [] },
    { key: "none", title: "No due date", list: [] },
  ];
  const sorted = [...tasks].sort((a, b) =>
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
    return str ? `/tasks?${str}` : "/tasks";
  };
  const backTo = link({});

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{ownMls ? "MLS work" : "Team tasks"}</h1>
          <p className="mt-1 text-muted">
            {ownMls
              ? "Everything to enter or change in your MLS. Approved homes, edits to live listings, status changes and open houses land here on their own, with a work sheet to copy from. You also get a notice and an email for each."
              : "Everything our team needs to do. New requests, approvals and open houses add tasks here on their own."}
          </p>
        </div>
        {!ownMls && (
        <details data-popover className="relative">
          <summary className="cursor-pointer list-none rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110">+ New task</summary>
          <form action={createTask} className="card-lift absolute right-0 z-20 mt-2 w-[min(92vw,380px)] space-y-3 rounded-2xl border border-line bg-white p-4">
            <input type="hidden" name="back" value={backTo} />
            <input name="title" required placeholder="What needs doing?" className="field-input" />
            <textarea name="details" rows={3} placeholder="Details (optional)" className="field-input" />
            <select name="home_id" defaultValue="" className="field-input">
              <option value="">No home</option>
              {(homes ?? []).map((h) => <option key={h.id} value={h.id}>{h.unparsed_address}</option>)}
            </select>
            <select name="builder_id" defaultValue="" className="field-input">
              <option value="">No builder (or use the home’s)</option>
              {(builders ?? []).map((b) => <option key={b.id} value={b.id}>{b.name.replace(" (demo)", "")}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Due</span>
                <input name="due" type="date" className="field-input" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Who</span>
                <select name="assignee_id" defaultValue={me.id} className="field-input">
                  {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
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

      {(urgentAlerts ?? 0) > 0 && (
        <Link href={ownMls ? "/attention" : "/compliance"} className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-red-900 hover:shadow-md">
          <span><b>{urgentAlerts} urgent MLS compliance {urgentAlerts === 1 ? "alert" : "alerts"}</b>: sold signals, deadlines or rule problems.</span>
          <span className="font-semibold">Open →</span>
        </Link>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {[
          { v: "open", label: `Open (${(openCounts ?? []).length})` },
          { v: "mine", label: `Assigned to me (${mineCount})` },
          { v: "done", label: "Done" },
        ].map((t) => (
          <Link
            key={t.v}
            href={link({ view: t.v })}
            className={cx("rounded-full px-4 py-2 text-sm font-semibold", view === t.v ? "bg-foreground text-white" : "border border-line hover:border-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        <Link href={link({ kind: null })} className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold", !kind ? "bg-accent text-white" : "bg-soft")}>
          All kinds
        </Link>
        {Object.entries(TASK_KIND_LABELS).filter(([k]) => !ownMls || MLS_KINDS.includes(k)).map(([k, label]) => (
          <Link key={k} href={link({ kind: k })} className={cx("shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold", kind === k ? "bg-accent text-white" : "bg-soft")}>
            {label}
            {kindCounts.get(k) ? ` ${kindCounts.get(k)}` : ""}
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
                const taskNotes = (notes ?? []).filter((n) => n.task_id === t.id);
                const closed = t.status === "done" || t.status === "cancelled";
                return (
                  <article key={t.id} className={cx("rounded-2xl border p-4", t.priority === "high" && !closed ? "border-red-200 bg-red-50/30" : "border-line", closed && "opacity-75")}>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={cx("rounded-full px-2.5 py-1 font-semibold", KIND_STYLE[t.kind])}>{TASK_KIND_LABELS[t.kind]}</span>
                      {t.priority === "high" && <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-800">High</span>}
                      {t.status === "in_progress" && <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-900">In progress</span>}
                      {closed && <span className="rounded-full bg-soft px-2.5 py-1 font-semibold">{TASK_STATUS_LABELS[t.status]}</span>}
                      {t.builders && <span className="text-muted">{t.builders.name.replace(" (demo)", "")}</span>}
                      {!ownMls && t.builder_id && selfBuilders.has(t.builder_id) && MLS_KINDS.includes(t.kind) && (
                        <span className="rounded-full bg-soft px-2.5 py-1 font-semibold text-muted" title="This builder enters its own listings in the MLS">Builder enters this</span>
                      )}
                      {!ownMls && t.builder_id && brokerBuilders.has(t.builder_id) && MLS_KINDS.includes(t.kind) && (
                        <span className="rounded-full bg-soft px-2.5 py-1 font-semibold text-muted" title="This builder lists through its own outside broker">Builder’s broker enters this</span>
                      )}
                    </div>
                    <h3 className="mt-2 font-semibold leading-snug">
                      <Link href={`/tasks/${t.id}`} className="hover:underline">{t.title}</Link>
                    </h3>
                    {Object.keys(t.changes ?? {}).length > 0 && (
                      <p className="mt-1 text-sm">
                        {Object.values(t.changes).map((c) => c.label).join(", ")}
                        <span className="text-muted"> to change</span>
                      </p>
                    )}
                    {t.details && <p className="mt-1 whitespace-pre-line text-sm text-muted">{t.details}</p>}
                    <p className="mt-2 text-sm">
                      {t.due_at && <span className={cx(new Date(t.due_at) < now && !closed && "font-semibold text-red-700")}>Due {whenCentral(t.due_at)}. </span>}
                      {closed && t.completed_at ? <span className="text-muted">Finished {dateTime(t.completed_at)}. </span> : <span className="text-muted">Added {dateTime(t.created_at)}. </span>}
                      <Link href={`/tasks/${t.id}`} className="font-semibold text-accent hover:underline">
                        {MLS_KINDS.includes(t.kind) ? "Open work sheet →" : "Open →"}
                      </Link>
                      {src && <> <Link href={src.href} className="text-muted hover:underline">{src.label}</Link></>}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {!closed && t.status === "todo" && (
                        <form action={setTaskStatus}>
                          <input type="hidden" name="back" value={backTo} />
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="status" value="in_progress" />
                          <button className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-foreground">Start</button>
                        </form>
                      )}
                      {!closed && (
                        <form action={setTaskStatus}>
                          <input type="hidden" name="back" value={backTo} />
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="status" value="done" />
                          <button className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black">Mark done</button>
                        </form>
                      )}
                      {closed && (
                        <form action={setTaskStatus}>
                          <input type="hidden" name="back" value={backTo} />
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="status" value="todo" />
                          <button className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-foreground">Reopen</button>
                        </form>
                      )}
                      <form action={assignTask} className="ml-auto flex items-center gap-1">
                        <input type="hidden" name="back" value={backTo} />
                        <input type="hidden" name="id" value={t.id} />
                        <select name="assignee_id" defaultValue={t.assignee_id ?? ""} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm" aria-label="Assigned to">
                          <option value="">Unassigned</option>
                          {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                        </select>
                        <button className="rounded-lg px-2 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">Set</button>
                      </form>
                    </div>

                    <details className="mt-3 border-t border-line pt-2">
                      <summary className="cursor-pointer text-sm text-muted">Notes{taskNotes.length ? ` (${taskNotes.length})` : ""}</summary>
                      <ul className="mt-2 space-y-2">
                        {taskNotes.map((n) => (
                          <li key={n.id} className="rounded-lg bg-soft px-3 py-2 text-sm">
                            <span className="font-medium">{nameOf.get(n.author_id) ?? (ownMls ? "Builder Listings team" : "Team")}</span>{" "}
                            <span className="text-muted">{dateTime(n.created_at)}</span>
                            <p className="whitespace-pre-line">{n.body}</p>
                          </li>
                        ))}
                      </ul>
                      <form action={addTaskNote} className="mt-2 flex gap-2">
                        <input type="hidden" name="back" value={backTo} />
                        <input type="hidden" name="id" value={t.id} />
                        <input name="body" placeholder="Add a note" className="field-input py-2" />
                        <button className="rounded-lg border border-line px-3 text-sm font-semibold hover:border-foreground">Add</button>
                      </form>
                    </details>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        {tasks.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
            <p className="font-semibold">{view === "done" ? "Nothing finished yet" : "All caught up"}</p>
            <p className="mt-1 text-muted">New requests from builders will show up here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
