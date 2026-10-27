import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { builderFocus } from "@/lib/builder-focus";
import { canUseBuilderBoard, isStaff } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { Notice } from "@/components/notice";
import { addTodo, updateTodo } from "./actions";

export default function TodoPage(props: PageProps<"/todo">) {
  return (
    <Suspense fallback={<div className="mt-16 h-64 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Board searchParams={props.searchParams} />
    </Suspense>
  );
}

const KINDS: Record<string, { label: string; style: string }> = {
  photo_review: { label: "Photos to review", style: "bg-emerald-50 text-emerald-800" },
  change_request: { label: "Change request", style: "bg-amber-50 text-amber-900" },
  incentive: { label: "Incentive ending", style: "bg-violet-50 text-violet-800" },
  other: { label: "To-do", style: "bg-soft text-muted" },
};

type Todo = {
  id: string; builder_id: string; kind: string; title: string; details: string | null; status: string; priority: string;
  due_at: string | null; assignee_id: string | null; home_id: string | null; source_table: string | null; source_id: string | null;
  created_at: string; completed_at: string | null; homes: { unparsed_address: string } | null; builders: { name: string } | null;
};

// Where an automatic to-do came from, one click away.
function sourceLink(t: Todo) {
  if (t.source_table === "media_requests") return { href: t.home_id ? `/homes/${t.home_id}#photo-requests` : "/media/requests", label: "Review the photos" };
  if (t.source_table === "change_requests" && t.home_id) return { href: `/homes/${t.home_id}#requests`, label: "Open the change request" };
  if (t.source_table === "incentives") return { href: `/incentives#i-${t.source_id}`, label: "Extend or end it" };
  if (t.home_id) return { href: `/homes/${t.home_id}`, label: "Open the home" };
  return null;
}

async function Board({ searchParams }: { searchParams: PageProps<"/todo">["searchParams"] }) {
  const me = await requireProfile();
  if (!canUseBuilderBoard(me.role) && !isStaff(me.role)) redirect("/communities");
  const sp = await searchParams;
  const view = sp.view === "mine" || sp.view === "done" ? sp.view : "open";
  const kind = typeof sp.kind === "string" && KINDS[sp.kind] ? sp.kind : null;
  const staff = isStaff(me.role);
  const focus = await builderFocus(me.role);
  const supabase = await createClient();

  let q = supabase.from("builder_tasks").select("id, builder_id, kind, title, details, status, priority, due_at, assignee_id, home_id, source_table, source_id, created_at, completed_at, homes(unparsed_address), builders(name)");
  q = view === "done" ? q.in("status", ["done", "cancelled"]).order("completed_at", { ascending: false }).limit(60) : q.in("status", ["todo", "in_progress"]).order("due_at", { ascending: true, nullsFirst: false });
  if (view === "mine") q = q.eq("assignee_id", me.id);
  if (kind) q = q.eq("kind", kind);
  if (focus) q = q.eq("builder_id", focus);
  const [{ data: rows }, { data: people }, { data: homes }, { data: openRows }] = await Promise.all([
    q,
    supabase.from("profiles").select("id, full_name, builder_id, role").in("role", ["builder_owner", "manager", "marketing"]).eq("is_active", true).order("full_name"),
    supabase.from("homes").select("id, unparsed_address, builder_id").is("deleted_at", null).order("unparsed_address"),
    supabase.from("builder_tasks").select("kind, assignee_id").in("status", ["todo", "in_progress"]),
  ]);
  const todos = (rows ?? []) as unknown as Todo[];
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const counts = new Map<string, number>();
  (openRows ?? []).forEach((t) => counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1));
  const mine = (openRows ?? []).filter((t) => t.assignee_id === me.id).length;
  const now = Date.now();
  const back = `/todo?${new URLSearchParams({ ...(view !== "open" ? { view } : {}), ...(kind ? { kind } : {}) }).toString()}`;
  const tab = (v: string, label: string, n?: number) => (
    <Link href={`/todo${v === "open" ? "" : `?view=${v}`}`} className={cx("rounded-full border px-3.5 py-1.5 text-sm", view === v ? "border-foreground bg-foreground font-semibold text-white" : "border-line hover:border-foreground")}>
      {label}{n ? ` ${n}` : ""}
    </Link>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">To-do</h1>
      <p className="mt-1 text-muted">
        {staff ? "Each builder’s own to-do board (their owners, managers and marketing work it)." : "Your team’s to-do list. Photos to review and change requests show up on their own; add anything else here."}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {tab("open", "Open", (openRows ?? []).length)}
        {tab("mine", "Mine", mine)}
        {tab("done", "Done")}
        <span className="mx-1 w-px bg-line" aria-hidden />
        {Object.entries(KINDS).map(([k, v]) => (
          <Link key={k} href={kind === k ? `/todo${view !== "open" ? `?view=${view}` : ""}` : `/todo?${new URLSearchParams({ ...(view !== "open" ? { view } : {}), kind: k })}`} className={cx("rounded-full px-3 py-1.5 text-sm", kind === k ? "ring-2 ring-foreground" : "", v.style)}>
            {v.label} {counts.get(k) ?? 0}
          </Link>
        ))}
      </div>

      {!staff && (
        <details className="mt-6 rounded-2xl border border-line">
          <summary className="cursor-pointer list-none px-4 py-3 font-semibold">+ Add a to-do</summary>
          <form action={addTodo} className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
            <input type="hidden" name="back" value={back} />
            <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium">What needs doing</span><input name="title" required maxLength={200} placeholder="e.g. New brochure for Oak Creek" className="field-input" /></label>
            <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium">Details (optional)</span><textarea name="details" rows={2} maxLength={4000} className="field-input" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium">For</span>
              <select name="assignee_id" defaultValue={me.id} className="field-input">
                <option value="">Anyone on the team</option>
                {(people ?? []).filter((p) => p.builder_id === me.builder_id).map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.id === me.id ? " (me)" : ""}</option>)}
              </select>
            </label>
            <label className="block"><span className="mb-1 block text-sm font-medium">Due (optional)</span><input name="due" type="date" className="field-input" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium">Home (optional)</span>
              <select name="home_id" defaultValue="" className="field-input">
                <option value="">None</option>
                {(homes ?? []).filter((h) => h.builder_id === me.builder_id).map((h) => <option key={h.id} value={h.id}>{h.unparsed_address}</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="priority" value="high" className="h-4 w-4 accent-[#3452c7]" /> Urgent</label>
            <div className="sm:col-span-2"><button className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:brightness-110">Add</button></div>
          </form>
        </details>
      )}

      <ul className="mt-6 space-y-3">
        {todos.map((t) => {
          const late = t.due_at && new Date(t.due_at).getTime() < now && (t.status === "todo" || t.status === "in_progress");
          const link = sourceLink(t);
          const team = (people ?? []).filter((p) => p.builder_id === t.builder_id);
          const closed = t.status === "done" || t.status === "cancelled";
          return (
            <li key={t.id} className={cx("rounded-2xl border p-4", t.priority === "high" && !closed ? "border-red-300" : "border-line", closed && "opacity-70")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", KINDS[t.kind]?.style)}>{KINDS[t.kind]?.label ?? "To-do"}</span>
                    {t.priority === "high" && !closed && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">Urgent</span>}
                    {staff && t.builders && <span className="text-xs text-muted">{t.builders.name.replace(" (demo)", "")}</span>}
                  </div>
                  <p className="mt-1 font-semibold">{t.title}</p>
                  {t.details && <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{t.details}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {t.homes && <><Link href={`/homes/${t.home_id}`} className="underline">{t.homes.unparsed_address}</Link> · </>}
                    {t.due_at ? <span className={late ? "font-semibold text-red-700" : ""}>{late ? "Overdue, was due " : "Due "}{dateTime(t.due_at)}</span> : "No due date"}
                    {closed && t.completed_at ? ` · finished ${dateTime(t.completed_at)}` : ""}
                  </p>
                </div>
                {link && <Link href={link.href} className="shrink-0 rounded-full border border-foreground px-3 py-1.5 text-sm font-semibold hover:bg-soft">{link.label} →</Link>}
              </div>
              {!staff && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <form action={updateTodo} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="back" value={back} />
                    <select name="assignee_id" defaultValue={t.assignee_id ?? ""} className="field-input w-auto py-1.5 text-sm" aria-label="Who’s on it">
                      <option value="">Anyone</option>
                      {team.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                    <button className="text-sm font-semibold underline">Assign</button>
                  </form>
                  <span className="flex-1" />
                  {!closed ? (
                    <>
                      {t.status === "todo" && <StatusButton id={t.id} back={back} status="in_progress" label="Start" />}
                      <StatusButton id={t.id} back={back} status="done" label="Done" primary />
                    </>
                  ) : (
                    <StatusButton id={t.id} back={back} status="todo" label="Reopen" />
                  )}
                </div>
              )}
              {staff && t.assignee_id && <p className="mt-2 text-xs text-muted">On it: {nameOf.get(t.assignee_id) ?? "someone"}</p>}
            </li>
          );
        })}
        {todos.length === 0 && <li className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">{view === "done" ? "Nothing finished yet." : "All clear."}</li>}
      </ul>
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
