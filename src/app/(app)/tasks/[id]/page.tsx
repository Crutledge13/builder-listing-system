import { Suspense } from "react";
import { BackButton } from "@/components/back-button";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { enterOwnMls } from "@/lib/mls-entry";
import { isStaff, TASK_KIND_LABELS, TASK_STATUS_LABELS } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { openHouseWhen, whenCentral } from "@/lib/time";
import { loadMlsSheet, type MlsSheet } from "@/lib/mls-sheet";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";
import { Notice } from "@/components/notice";
import { MlsWorkSheet } from "@/components/mls-work-sheet";
import { CopyRow, OpenBesideMatrix } from "@/components/mls-sheet-client";
import { CopyButton } from "@/components/mls-client";
import { ChangeRows, FinishCard, Lead, type Change as SheetChange } from "@/components/mls-change-work";
import { MediaPicture } from "@/components/media-tile";
import { addTaskNote, assignTask, markListingLive, setTaskStatus, toggleTaskCheck } from "../actions";

export default function TaskPage(props: PageProps<"/tasks/[id]">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Work params={props.params} />
    </Suspense>
  );
}

type Change = { label: string; from: unknown; to: unknown; added?: string[]; removed?: string[] };

type Task = {
  id: string;
  kind: string;
  title: string;
  details: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  home_id: string | null;
  assignee_id: string | null;
  source_table: string | null;
  source_id: string | null;
  created_at: string;
  completed_at: string | null;
  changes: Record<string, Change>;
  checked: string[];
  builders: { name: string } | null;
};

async function Work({ params }: { params: PageProps<"/tasks/[id]">["params"] }) {
  const { id } = await params;
  const me = await requireProfile();
  const ownMls = !isStaff(me.role) && (await enterOwnMls(me.role, me.builder_id));
  if (!isStaff(me.role) && !ownMls) redirect("/communities");
  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("id, kind, title, details, status, priority, due_at, home_id, assignee_id, source_table, source_id, created_at, completed_at, changes, checked, builders(name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const t = data as unknown as Task;
  const closed = t.status === "done" || t.status === "cancelled";
  const back = `/tasks/${t.id}`;

  const [sheet, { data: staff }, { data: notes }, { data: feed }] = await Promise.all([
    t.home_id ? loadMlsSheet(supabase, t.home_id) : Promise.resolve(null),
    ownMls
      ? supabase.from("profiles").select("id, full_name").eq("builder_id", me.builder_id!).in("role", ["builder_owner", "manager", "marketing"]).eq("is_active", true).order("full_name")
      : supabase.from("profiles").select("id, full_name").in("role", ["platform_admin", "listing_coordinator"]).eq("is_active", true).order("full_name"),
    supabase.from("task_notes").select("id, author_id, body, created_at").eq("task_id", t.id).order("created_at"),
    t.home_id ? supabase.from("mls_listings").select("listing_id, standard_status, modification_timestamp").eq("home_id", t.home_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const nameOf = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const check = { taskId: t.id, checked: t.checked ?? [], action: toggleTaskCheck, disabled: closed };
  const mlsNumber = sheet?.home.mls_number;

  return (
    <div className="mx-auto max-w-5xl">
      <BackButton variant="text" href="/tasks" label={ownMls ? "MLS work" : "Task board"} />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent">{TASK_KIND_LABELS[t.kind]}</span>
        {t.priority === "high" && <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-800">High</span>}
        <span className="rounded-full bg-soft px-2.5 py-1 font-semibold">{TASK_STATUS_LABELS[t.status]}</span>
        {t.builders && <span className="text-muted">{t.builders.name.replace(" (demo)", "")}</span>}
      </div>
      <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-tight">{t.title}</h1>
      <p className="mt-1 text-sm text-muted">
        Added {dateTime(t.created_at)}{t.due_at ? `. Due ${whenCentral(t.due_at)}` : ""}
        {closed && t.completed_at ? `. Finished ${dateTime(t.completed_at)}` : ""}
        {sheet && <>. <Link href={`/homes/${sheet.home.id}`} className="font-medium text-foreground underline">{sheet.home.unparsed_address}</Link></>}
        {mlsNumber && <>, MLS #{mlsNumber} <CopyButton value={mlsNumber} /></>}
      </p>

      {/* Who's on it and where it stands */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line p-3">
        <form action={assignTask} className="flex items-center gap-1">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="id" value={t.id} />
          <select name="assignee_id" defaultValue={t.assignee_id ?? ""} className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm" aria-label="Assigned to">
            <option value="">Unassigned</option>
            {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
          <button className="rounded-lg px-2 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">Assign</button>
        </form>
        <span className="ml-auto" />
        {t.kind === "mls_entry" && sheet && !closed && <span className="hidden sm:block"><OpenBesideMatrix /></span>}
        {t.kind === "mls_entry" && sheet && <Link href={`/homes/${sheet.home.id}/mls`} className="flex h-10 items-center rounded-xl border border-line px-3 text-sm font-semibold hover:border-foreground">Edit MLS sheet</Link>}
        {!closed && t.status === "todo" && !isMlsKind(t.kind) && <StatusButton id={t.id} back={back} status="in_progress" label="Start" />}
        {!closed && !isMlsKind(t.kind) && <StatusButton id={t.id} back={back} status="done" label="Mark done" primary />}
        {closed && <StatusButton id={t.id} back={back} status="todo" label="Reopen" />}
      </div>

      <div className="mt-8">
        {t.kind === "mls_entry" && sheet && <EntryWork t={t} sheet={sheet} check={check} closed={closed} />}
        {t.kind === "mls_update" && sheet && <UpdateWork t={t} sheet={sheet} feedStatus={feed?.standard_status ?? null} />}
        {t.kind === "listing_status" && sheet && <StatusWork t={t} sheet={sheet} />}
        {t.kind === "open_house_mls" && <OpenHouseWork t={t} />}
        {isMlsKind(t.kind) && t.kind !== "mls_entry" && !closed && <DoneBox t={t} back={back} />}
        {!["mls_entry", "mls_update", "listing_status", "open_house_mls"].includes(t.kind) && <OtherWork t={t} />}
      </div>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-semibold">Notes</h2>
        <ul className="mt-3 space-y-2">
          {(notes ?? []).map((n) => (
            <li key={n.id} className="rounded-lg bg-soft px-3 py-2 text-sm">
              <span className="font-medium">{nameOf.get(n.author_id) ?? (ownMls ? "Builder Listings team" : "Team")}</span> <span className="text-muted">{dateTime(n.created_at)}</span>
              <p className="whitespace-pre-line">{n.body}</p>
            </li>
          ))}
        </ul>
        <form action={addTaskNote} className="mt-3 flex gap-2">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="id" value={t.id} />
          <input name="body" placeholder="Add a note, e.g. waiting on legal description from the title company" className="field-input py-2" />
          <button className="rounded-lg border border-line px-3 text-sm font-semibold hover:border-foreground">Add</button>
        </form>
      </section>
    </div>
  );
}

function StatusButton({ id, back, status, label, primary }: { id: string; back: string; status: string; label: string; primary?: boolean }) {
  return (
    <form action={setTaskStatus}>
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold", primary ? "bg-foreground text-white hover:bg-black" : "border border-line hover:border-foreground")}>{label}</button>
    </form>
  );
}

type Check = { taskId: string; checked: string[]; action: typeof toggleTaskCheck; disabled: boolean };

const isMlsKind = (k: string) => ["mls_entry", "mls_update", "listing_status", "open_house_mls"].includes(k);

// The one button that finishes an update, status change or open house task.
function DoneBox({ t, back }: { t: Task; back: string }) {
  const n = t.kind === "mls_update" ? Object.keys(t.changes ?? {}).length : 0;
  return (
    <FinishCard className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <span className="text-[15px]"><b>{n > 1 ? `Made all ${n} changes in the MLS?` : "Done in the MLS?"}</b> This closes the task.</span>
      <form action={setTaskStatus}>
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="status" value="done" />
        <button className="h-12 rounded-xl bg-accent px-6 text-base font-bold text-white hover:brightness-110">All done · Mark done</button>
      </form>
    </FinishCard>
  );
}

// A brand-new listing: the whole MLS entry, tab by tab; the last tab ends
// with the MLS number.
function EntryWork({ t, sheet, check, closed }: { t: Task; sheet: MlsSheet; check: Check; closed: boolean }) {
  const finish = sheet.home.workflow_status === "approved_for_mls" && !closed ? (
    <FinishCard>
      <form action={markListingLive} className="space-y-3">
        <input type="hidden" name="back" value={`/tasks/${t.id}`} />
        <input type="hidden" name="home_id" value={sheet.home.id} />
        <h3 className="text-lg font-extrabold">Submitted it in the MLS? Mark it live</h3>
        <label className="block max-w-xs text-sm font-semibold">MLS number
          <input name="mls_number" required placeholder="e.g. 20841177" className="field-input mt-1" />
        </label>
        <button className="h-12 w-full rounded-xl bg-accent px-6 text-base font-bold text-white hover:brightness-110 sm:w-auto">Mark live on the MLS</button>
        <p className="text-sm text-muted">The home shows its MLS number and this task closes.</p>
      </form>
    </FinishCard>
  ) : (
    <p className="rounded-2xl bg-soft p-4 text-sm">
      {sheet.home.workflow_status === "live_on_mls" ? `Live on the MLS as #${sheet.home.mls_number}.` : "This home isn’t approved for the MLS right now."}
    </p>
  );
  return <MlsWorkSheet sheet={sheet} check={check} editHref={`/homes/${sheet.home.id}/mls`} finish={finish} />;
}

// A live listing changed: exactly what to change, old and new.
async function UpdateWork({ t, sheet, feedStatus }: { t: Task; sheet: MlsSheet; feedStatus: string | null }) {
  const entries = Object.entries(t.changes ?? {}).filter(([k]) => k !== "photos") as [string, SheetChange][];
  const photos = t.changes?.photos;
  const ids = [...(photos?.added ?? []), ...(photos?.removed ?? [])];
  const supabase = await createClient();
  const { data: rows } = ids.length ? await supabase.from("media").select(MEDIA_SELECT).in("id", ids) : { data: [] };
  const media = new Map(((rows ?? []) as unknown as MediaRow[]).map((m) => [m.id, m]));
  const n = entries.length + (photos ? 1 : 0);

  return (
    <div className="space-y-5">
      <Lead>
        Open <b>MLS #{sheet.home.mls_number ?? "?"}</b> and choose <b>Change listing</b>.{" "}
        {n ? <>Make {n === 1 ? "this change" : `these ${n} changes`}, then mark it done.</> : null}
        {feedStatus && <span className="text-muted"> The MLS feed shows it as {feedStatus}.</span>}
      </Lead>
      {n === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">Nothing left to change: the builder put everything back the way the MLS has it. You can mark this done.</p>
      ) : (
        <>
          {entries.length > 0 && <ChangeRows entries={entries} />}
          {photos && (
            <div className="space-y-4 rounded-2xl border border-line p-4">
              <p className="text-sm text-muted">Photos</p>
              {(photos.added ?? []).length > 0 && <PhotoStrip title={`Add ${photos.added!.length} photo${photos.added!.length > 1 ? "s" : ""}`} ids={photos.added!} media={media} />}
              {(photos.removed ?? []).length > 0 && <PhotoStrip title={`Remove ${photos.removed!.length} photo${photos.removed!.length > 1 ? "s" : ""}`} ids={photos.removed!} media={media} faded />}
            </div>
          )}
        </>
      )}
      {t.details && <p className="text-sm text-muted">{t.details}</p>}
      <details className="rounded-2xl border border-line">
        <summary className="cursor-pointer px-4 py-3 font-semibold">See the whole listing</summary>
        <div className="p-4 pt-0"><MlsWorkSheet sheet={sheet} editHref={`/homes/${sheet.home.id}/mls`} /></div>
      </details>
    </div>
  );
}

function PhotoStrip({ title, ids, media, faded }: { title: string; ids: string[]; media: Map<string, MediaRow>; faded?: boolean }) {
  return (
    <div>
      <p className={cx("text-sm font-bold", faded ? "text-red-800" : "text-emerald-800")}>{title}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {ids.map((id) => {
          const m = media.get(id);
          return m ? (
            <Link key={id} href={`/media/${id}`} className={cx("relative block aspect-[3/2] overflow-hidden rounded-lg bg-soft", faded && "opacity-60")}>
              <MediaPicture m={m} className="h-full w-full" />
            </Link>
          ) : null;
        })}
      </div>
    </div>
  );
}

// Status change (pending, closed, hold, withdrawn) with the details the MLS requires,
// in the order the MLS form asks for them.
const STATUS_ORDER = ["standard_status", "purchase_contract_date", "close_date", "close_price", "buyer_agent_full_name", "buyer_agent_mls_id",
  "buyer_agent_state_license", "buyer_office_name", "co_buyer_agent_full_name", "co_buyer_office_name"];

function StatusWork({ t, sheet }: { t: Task; sheet: MlsSheet }) {
  const rank = (k: string) => (STATUS_ORDER.indexOf(k) + 1 || 99);
  const entries = (Object.entries(t.changes ?? {}) as [string, SheetChange][]).sort(([a], [b]) => rank(a) - rank(b));
  const status = t.changes?.standard_status;
  return (
    <div className="space-y-5">
      <Lead>
        Open <b>MLS #{sheet.home.mls_number ?? "?"}</b> and choose <b>Change status</b>. Set it to <b>{String(status?.to ?? "the new status")}</b> and fill in each detail below.
      </Lead>
      <ChangeRows entries={entries} showBefore={false} missingText="Not given. Ask the builder before changing the MLS." />
      {t.details && <p className="text-sm text-muted">{t.details}</p>}
    </div>
  );
}

// Open houses to add to (or take off) the MLS.
async function OpenHouseWork({ t }: { t: Task }) {
  const supabase = await createClient();
  const removing = t.source_table === "open_houses_cancel" || t.source_table === "open_house_series_end";
  let q = supabase.from("open_houses").select("id, starts_at, ends_at, remarks, cancelled_at").order("starts_at");
  if (t.source_table === "open_houses" || t.source_table === "open_houses_cancel") q = q.eq("id", t.source_id!);
  else if (t.source_table === "open_house_series") q = q.eq("series_id", t.source_id!).is("cancelled_at", null).gte("ends_at", t.created_at);
  else if (t.source_table === "open_house_series_end") q = q.eq("series_id", t.source_id!).not("cancelled_at", "is", null).gte("starts_at", t.created_at);
  const { data } = t.source_id ? await q : { data: [] };
  const list = data ?? [];
  return (
    <div className="space-y-5">
      <Lead>Open the listing in the MLS and go to <b>Open houses</b>. {removing ? "Delete each one below." : "Add each one below (times are Central)."}</Lead>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {list.map((o) => {
          const text = openHouseWhen(o.starts_at, o.ends_at);
          const skip = !removing && !!o.cancelled_at;
          return (
            <CopyRow
              key={o.id}
              label={removing ? "Delete" : skip ? "Skip: cancelled since" : "Add"}
              sub={o.remarks ? `Remarks: ${o.remarks}` : undefined}
              value={<span className={cx(removing && "text-red-800", skip && "text-muted line-through")}>{text}</span>}
              paste={skip ? "" : text}
            />
          );
        })}
        {list.length === 0 && <p className="px-4 py-6 text-sm text-muted">{t.details ?? "No dates."}</p>}
      </div>
    </div>
  );
}

function OtherWork({ t }: { t: Task }) {
  const link =
    t.source_table === "media_requests" ? { href: "/media/requests", label: "Open the photo request" }
    : t.source_table === "comp_requests" && t.source_id ? { href: `/comps/${t.source_id}`, label: "Open the comp request" }
    : t.source_table === "change_requests" && t.home_id ? { href: `/homes/${t.home_id}#requests`, label: "Open the change request" }
    : t.source_table === "reverse_prospect_requests" && t.home_id ? { href: `/homes/${t.home_id}#reverse-prospecting`, label: "Open the request" }
    : t.home_id ? { href: `/homes/${t.home_id}`, label: "Open the home" } : null;
  return (
    <div className="rounded-2xl border border-line p-5">
      {t.details ? <p className="whitespace-pre-line">{t.details}</p> : <p className="text-muted">No details.</p>}
      {link && <Link href={link.href} className="mt-4 inline-block font-semibold text-accent hover:underline">{link.label} →</Link>}
    </div>
  );
}
