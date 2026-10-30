import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { brokerFileBase, loadBrokerTask, requireBrokerWithTerms, type BrokerOpenHouse, type BrokerTask } from "@/lib/broker";
import type { MlsSheet } from "@/lib/mls-sheet";
import type { MediaRow } from "@/lib/demo-media";
import { TASK_KIND_LABELS, TASK_STATUS_LABELS } from "@/lib/permissions";
import { cx, dateTime, money } from "@/lib/format";
import { openHouseWhen, whenCentral } from "@/lib/time";
import { CONDITION, formatMls, MLS_FIELD_FOR_COLUMN } from "@/lib/mls-fields";
import { Notice } from "@/components/notice";
import { MlsScore, MlsSheetView } from "@/components/mls-sheet";
import { OpenBesideMatrix } from "@/components/mls-sheet-client";
import { CheckOff, CopyButton } from "@/components/mls-client";
import { MediaPicture } from "@/components/media-tile";
import { brokerAddNote, brokerMarkLive, brokerSetStatus, brokerToggleCheck } from "../../actions";

// One piece of MLS work for an outside broker: the same copy-ready sheet our
// team uses, without anything from the rest of the system.
export default function BrokerTaskPage(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Work params={props.params} />
    </Suspense>
  );
}

type Check = { taskId: string; checked: string[]; action: typeof brokerToggleCheck; disabled: boolean };

async function Work({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireBrokerWithTerms();
  const data = await loadBrokerTask(id);
  if (!data) notFound();
  const { task: t, sheet, builderName, notes } = data;
  const closed = t.status === "done";
  const check: Check = { taskId: t.id, checked: t.checked ?? [], action: brokerToggleCheck, disabled: closed };
  const fileBase = brokerFileBase(t.id);

  return (
    <div>
      <Link href="/broker" className="text-sm font-semibold text-muted hover:text-foreground">← Your MLS work</Link>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent">{TASK_KIND_LABELS[t.kind]}</span>
        {t.priority === "high" && <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-800">Urgent</span>}
        <span className="rounded-full bg-soft px-2.5 py-1 font-semibold">{TASK_STATUS_LABELS[t.status]}</span>
        <span className="text-muted">{builderName}</span>
      </div>
      <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-tight">{sheet?.home.unparsed_address ?? t.title}</h1>
      <p className="mt-1 text-sm text-muted">
        {t.title}. Sent {dateTime(t.created_at)}
        {t.due_at && !closed ? `. Due ${whenCentral(t.due_at)}` : ""}
        {closed && t.completed_at ? `. Finished ${dateTime(t.completed_at)}` : ""}
        {sheet?.home.mls_number && <>. MLS #{sheet.home.mls_number} <CopyButton value={sheet.home.mls_number} /></>}
      </p>

      {t.kind !== "mls_entry" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line p-3">
          <span className="text-sm text-muted">{closed ? "Finished." : "Made every change? Mark it done and the builder is told."}</span>
          <span className="ml-auto" />
          {!closed && t.status === "todo" && <StatusButton id={t.id} status="in_progress" label="Start" />}
          {!closed && <StatusButton id={t.id} status="done" label="Mark done" primary />}
          {closed && <StatusButton id={t.id} status="todo" label="Reopen" />}
        </div>
      )}

      <div className="mt-8">
        {t.kind === "mls_entry" && sheet && <EntryWork t={t} sheet={sheet} check={check} closed={closed} fileBase={fileBase} />}
        {t.kind === "mls_update" && sheet && <UpdateWork t={t} sheet={sheet} check={check} fileBase={fileBase} media={data.changeMedia} />}
        {t.kind === "listing_status" && sheet && <StatusWork t={t} sheet={sheet} check={check} />}
        {t.kind === "open_house_mls" && <OpenHouseWork t={t} check={check} list={data.openHouses} />}
        {!sheet && t.kind !== "open_house_mls" && <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">This home is no longer available.</p>}
      </div>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-semibold">Notes to the builder</h2>
        <p className="text-sm text-muted">Missing something the MLS needs? Ask here. The builder gets it by email.</p>
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-soft px-3 py-2 text-sm">
              <span className="font-medium">{n.author}</span> <span className="text-muted">{dateTime(n.created_at)}</span>
              <p className="whitespace-pre-line">{n.body}</p>
            </li>
          ))}
        </ul>
        <form action={brokerAddNote} className="mt-3 flex gap-2">
          <input type="hidden" name="id" value={t.id} />
          <input name="body" maxLength={2000} placeholder="e.g. Need the legal description for this lot" className="field-input py-2" />
          <button className="rounded-lg border border-line px-3 text-sm font-semibold hover:border-foreground">Send</button>
        </form>
      </section>
    </div>
  );
}

function StatusButton({ id, status, label, primary }: { id: string; status: string; label: string; primary?: boolean }) {
  return (
    <form action={brokerSetStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold", primary ? "bg-foreground text-white hover:bg-black" : "border border-line hover:border-foreground")}>{label}</button>
    </form>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1.5 rounded-2xl bg-accent-soft/50 p-4 text-sm">
      {items.map((s, i) => (
        <li key={i} className="flex gap-2"><span className="font-bold text-accent">{i + 1}.</span> {s}</li>
      ))}
    </ol>
  );
}

function Progress({ checked, total }: { checked: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((checked / total) * 100)) : 0;
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex justify-between text-sm"><span className="font-semibold">Entered in the MLS</span><span className="text-muted">{checked} of {total}</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-soft"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// A brand-new listing: the full MLS input, then the MLS number.
function EntryWork({ t, sheet, check, closed, fileBase }: { t: BrokerTask; sheet: MlsSheet; check: Check; closed: boolean; fileBase: string }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-6">
        <Steps
          items={[
            `Start a new listing in ${sheet.board?.short_name ?? "the MLS"} (Residential, For Sale).`,
            "Go tab by tab, same as the MLS. Copy each value (it ticks itself) or tick the boxes shown.",
            "On the last tab, download the photo pack and upload the photos in that order.",
            "Submit the listing, then enter the MLS number on the right.",
          ]}
        />
        <MlsScore sheet={sheet} homeId={sheet.home.id} edit={false} />
        <div className="flex justify-end"><OpenBesideMatrix /></div>
        <MlsSheetView sheet={sheet} check={check} fileBase={fileBase} broker />
      </div>
      <aside>
        <div className="sticky top-24 space-y-4">
          {sheet.home.workflow_status === "approved_for_mls" && !closed ? (
            <form action={brokerMarkLive} className="rounded-2xl border border-line p-4">
              <input type="hidden" name="id" value={t.id} />
              <h3 className="font-semibold">Listing submitted?</h3>
              <p className="mt-1 text-sm text-muted">Enter the MLS number. The builder is told it’s live and this comes off your list.</p>
              <input name="mls_number" required maxLength={40} placeholder="MLS number" className="field-input mt-3" />
              <button className="mt-3 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Mark live on the MLS</button>
            </form>
          ) : (
            <p className="rounded-2xl bg-soft p-4 text-sm">
              {sheet.home.workflow_status === "live_on_mls" ? `Live on the MLS as #${sheet.home.mls_number}.` : "The builder took this back for changes. You’ll get an email when it’s ready again."}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function showValue(key: string, v: unknown) {
  if (v === null || v === undefined || v === "") return "";
  if (key === "build_stage") return CONDITION[String(v)] ?? String(v);
  if (key === "close_price") return money(v as number);
  if (key === "close_date" || key === "purchase_contract_date") return formatMls({ type: "date" }, v);
  const f = MLS_FIELD_FOR_COLUMN[key];
  return f ? formatMls(f, v) : String(v);
}

// A live listing changed: exactly what to change, old and new.
function UpdateWork({ t, sheet, check, fileBase, media }: { t: BrokerTask; sheet: MlsSheet; check: Check; fileBase: string; media: Map<string, MediaRow> }) {
  const entries = Object.entries(t.changes ?? {}).filter(([k]) => k !== "photos");
  const photos = t.changes?.photos;
  const lines = entries.length + (photos ? 1 : 0);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-6">
        <Steps items={[`Open MLS #${sheet.home.mls_number ?? "?"} and choose Change listing.`, "Make each change below. Tick it once it’s saved in the MLS.", "Mark this done."]} />
        {lines === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">Nothing left to change: the builder put everything back the way the MLS has it. You can mark this done.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 bg-soft px-4 py-2 text-xs font-semibold text-muted sm:grid-cols-[auto_200px_1fr_1fr_auto]">
              <span className="w-5" /><span>MLS field</span><span className="hidden sm:block">On the MLS now</span><span className="hidden sm:block">Change it to</span><span className="hidden sm:block" />
            </div>
            <div className="divide-y divide-line">
              {entries.map(([key, c]) => {
                const f = MLS_FIELD_FOR_COLUMN[key];
                const to = showValue(key, c.to);
                return (
                  <div key={key} className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[auto_200px_1fr_1fr_auto]">
                    <CheckOff taskId={t.id} item={key} initial={check.checked.includes(key)} action={check.action} disabled={check.disabled} />
                    <div className="text-sm">
                      <span className="font-medium">{f?.label ?? c.label}</span>
                      {f && <span className="block text-[11px] text-muted">{f.key}</span>}
                      {key.startsWith("incentive:") && <span className="block text-[11px] text-muted">In the remarks (no agent pay)</span>}
                    </div>
                    <div className="col-start-2 whitespace-pre-line text-[15px] text-muted line-through decoration-red-400 sm:col-start-auto">{showValue(key, c.from) || "—"}</div>
                    <div className="col-start-2 whitespace-pre-line text-[15px] font-semibold sm:col-start-auto">{to || (key.startsWith("incentive:") ? "(take it out: it ended)" : "(clear it)")}</div>
                    <div className="col-start-2 sm:col-start-auto"><CopyButton value={to} /></div>
                  </div>
                );
              })}
              {photos && (
                <div className="grid grid-cols-[auto_1fr] items-start gap-x-3 px-4 py-3">
                  <CheckOff taskId={t.id} item="photos" initial={check.checked.includes("photos")} action={check.action} disabled={check.disabled} />
                  <div className="space-y-3">
                    <span className="text-sm font-medium">Photos</span>
                    {(photos.added ?? []).length > 0 && <PhotoStrip title={`Add ${photos.added!.length} photo${photos.added!.length > 1 ? "s" : ""}`} ids={photos.added!} media={media} fileBase={fileBase} />}
                    {(photos.removed ?? []).length > 0 && <PhotoStrip title={`Remove ${photos.removed!.length} photo${photos.removed!.length > 1 ? "s" : ""}`} ids={photos.removed!} media={media} fileBase={fileBase} faded />}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {t.details && <p className="text-sm text-muted">{t.details}</p>}
        <details className="rounded-2xl border border-line">
          <summary className="cursor-pointer px-4 py-3 font-semibold">Full MLS sheet for reference</summary>
          <div className="p-4 pt-0"><MlsSheetView sheet={sheet} fileBase={fileBase} broker /></div>
        </details>
      </div>
      <aside>
        <div className="sticky top-24">
          <Progress checked={check.checked.filter((k) => k === "photos" || entries.some(([e]) => e === k)).length} total={lines} />
        </div>
      </aside>
    </div>
  );
}

function PhotoStrip({ title, ids, media, fileBase, faded }: { title: string; ids: string[]; media: Map<string, MediaRow>; fileBase: string; faded?: boolean }) {
  return (
    <div>
      <p className={cx("text-sm font-semibold", faded ? "text-red-800" : "text-emerald-800")}>{title}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {ids.map((id) => {
          const m = media.get(id);
          return m ? (
            <a key={id} href={`${fileBase}${id}?download=1`} title="Download" className={cx("relative block aspect-[3/2] overflow-hidden rounded-lg bg-soft", faded && "opacity-60")}>
              <MediaPicture m={m} className="h-full w-full" fileBase={fileBase} />
            </a>
          ) : null;
        })}
      </div>
    </div>
  );
}

const STATUS_ORDER = ["standard_status", "purchase_contract_date", "close_date", "close_price", "buyer_agent_full_name", "buyer_agent_mls_id",
  "buyer_agent_state_license", "buyer_office_name", "co_buyer_agent_full_name", "co_buyer_office_name"];

// Status change (pending, closed, hold, withdrawn) with the details the MLS requires.
function StatusWork({ t, sheet, check }: { t: BrokerTask; sheet: MlsSheet; check: Check }) {
  const rank = (k: string) => (STATUS_ORDER.indexOf(k) + 1 || 99);
  const entries = Object.entries(t.changes ?? {}).sort(([a], [b]) => rank(a) - rank(b));
  const status = t.changes?.standard_status;
  return (
    <div className="space-y-6">
      <Steps items={[`Open MLS #${sheet.home.mls_number ?? "?"} and choose Change status.`, `Set the status to ${String(status?.to ?? "the new status")} and fill in each detail below.`, "Mark this done."]} />
      <div className="overflow-hidden rounded-2xl border border-line divide-y divide-line">
        {entries.map(([key, c]) => {
          const to = showValue(key, c.to);
          return (
            <div key={key} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3">
              <CheckOff taskId={t.id} item={key} initial={check.checked.includes(key)} action={check.action} disabled={check.disabled} />
              <div>
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-[15px]">
                  {key === "standard_status" && <><span className="text-muted line-through">{String(c.from)}</span> → </>}
                  {to ? <b>{to}</b> : <span className="font-semibold text-amber-900">Not given. Ask the builder in a note before changing the MLS.</span>}
                </div>
              </div>
              <CopyButton value={to} />
            </div>
          );
        })}
      </div>
      {t.details && <p className="text-sm text-muted">{t.details}</p>}
    </div>
  );
}

// Open houses to add to (or take off) the MLS.
function OpenHouseWork({ t, check, list }: { t: BrokerTask; check: Check; list: BrokerOpenHouse[] }) {
  const removing = t.source_table === "open_houses_cancel" || t.source_table === "open_house_series_end";
  return (
    <div className="space-y-6">
      <Steps items={["Open the listing in the MLS and go to Open houses.", removing ? "Delete each open house below." : "Add each open house below (times are Central).", "Tick each one, then mark this done."]} />
      <div className="overflow-hidden rounded-2xl border border-line divide-y divide-line">
        {list.map((o) => {
          const text = openHouseWhen(o.starts_at, o.ends_at);
          return (
            <div key={o.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3">
              <CheckOff taskId={t.id} item={o.id} initial={check.checked.includes(o.id)} action={check.action} disabled={check.disabled} />
              <div>
                <div className={cx("font-semibold", removing && "text-red-800")}>{removing ? "Remove: " : ""}{text}</div>
                {o.remarks && <div className="text-sm text-muted">Remarks: {o.remarks}</div>}
                {!removing && o.cancelled_at && <div className="text-sm text-red-800">Cancelled since this was sent. Skip it.</div>}
              </div>
              <div className="flex gap-1">
                <CopyButton value={text} label="Copy time" />
                {o.remarks && <CopyButton value={o.remarks} label="Copy remarks" />}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="px-4 py-6 text-sm text-muted">{t.details ?? "No dates."}</p>}
      </div>
    </div>
  );
}
