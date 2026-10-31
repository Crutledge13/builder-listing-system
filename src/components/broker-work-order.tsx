import Link from "next/link";
import type { BrokerOpenHouse, BrokerRequest, BrokerTask, BrokerWork } from "@/lib/broker";
import { workOrder } from "@/lib/broker";
import type { MlsSheet } from "@/lib/mls-sheet";
import type { MediaRow } from "@/lib/demo-media";
import { TASK_KIND_LABELS } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { openHouseWhen, whenCentral } from "@/lib/time";
import { buildMlsPackage } from "@/lib/mls-package";
import { MlsWorkSheet } from "@/components/mls-work-sheet";
import { CopyRow, OpenBesideMatrix } from "@/components/mls-sheet-client";
import { CopyButton } from "@/components/mls-client";
import { ChangeRows, FinishCard, Lead, type Change } from "@/components/mls-change-work";
import { MediaPicture } from "@/components/media-tile";
import { SendBackForm } from "@/components/broker-send-back";

// One work order as an outside broker sees it, signed in (/broker/tasks/[id])
// or through a one-off link (/w/[token]). Only the way in differs: `by` says
// which hidden field the buttons send (the task id, or the link's token), and
// `actions` are that way's server actions. Every action is checked again in
// the database.

export type WorkActions = {
  toggle: (ref: string, item: string, on: boolean) => Promise<void>;
  submit: (fd: FormData) => Promise<void>;
  note: (fd: FormData) => Promise<void>;
  sendBack: (fd: FormData) => Promise<void>;
  setStatus?: (fd: FormData) => Promise<void>; // signed-in only: start, take back
};

type Check = { taskId: string; checked: string[]; action: (ref: string, item: string, on: boolean) => Promise<void>; disabled: boolean };

const STATUS_TEXT: Record<string, string> = {
  todo: "To do",
  in_progress: "Started",
  submitted: "Sent to the builder",
  done: "Accepted and closed",
};

export function BrokerWorkOrder({
  work,
  by,
  fileBase,
  actions,
  backHref,
}: {
  work: BrokerWork;
  by: { name: "id" | "token"; value: string };
  fileBase: string;
  actions: WorkActions;
  backHref?: string;
}) {
  const { task: t, sheet, builderName, notes, requests } = work;
  const closed = t.status === "done" || t.status === "submitted";
  const waiting = requests.filter((r) => !r.resent_at);
  const answered = requests.filter((r) => r.resent_at);
  const check: Check = { taskId: by.value, checked: t.checked ?? [], action: actions.toggle, disabled: closed };
  const hidden = <input type="hidden" name={by.name} value={by.value} />;

  return (
    <div>
      {backHref && <Link href={backHref} className="text-sm font-semibold text-muted hover:text-foreground">← Your MLS work</Link>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent">{TASK_KIND_LABELS[t.kind]}</span>
        {t.priority === "high" && t.status !== "done" && <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-800">Urgent</span>}
        <span className="rounded-full bg-soft px-2.5 py-1 font-semibold">{waiting.length ? "Waiting on the builder" : STATUS_TEXT[t.status] ?? t.status}</span>
        <span className="text-muted">{builderName}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <h1 className="break-words text-[26px] font-bold leading-tight tracking-tight">{sheet?.home.unparsed_address ?? t.title}</h1>
        {t.kind === "mls_entry" && sheet && !closed && <span className="hidden sm:block"><OpenBesideMatrix /></span>}
      </div>
      <p className="mt-1 text-sm text-muted">
        <b className="font-semibold text-foreground">{workOrder(t.work_order_no)}</b> · {t.title}. Sent {dateTime(t.created_at)}
        {t.due_at && t.status !== "done" ? `. Due ${whenCentral(t.due_at)}` : ""}
        {sheet?.home.mls_number && <>. MLS #{sheet.home.mls_number} <CopyButton value={sheet.home.mls_number} /></>}
      </p>

      {/* Where it stands */}
      {t.status === "submitted" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
          <span className="min-w-0 flex-1">
            <b>Sent to the builder {t.submitted_at ? dateTime(t.submitted_at) : ""}.</b> They’ll check it on the MLS and accept it.
            {t.submitted_mls_number && <> MLS #{t.submitted_mls_number}.</>}
            {t.submitted_mls_url && <> <a href={t.submitted_mls_url} target="_blank" rel="noopener noreferrer" className="break-all underline">Listing link</a>.</>}
          </span>
          {actions.setStatus && (
            <form action={actions.setStatus}>
              {hidden}
              <input type="hidden" name="status" value="in_progress" />
              <button className="rounded-lg border border-emerald-700 bg-white px-3 py-1.5 font-semibold text-emerald-900 hover:bg-emerald-100">Take it back</button>
            </form>
          )}
        </div>
      )}
      {t.status === "done" && <p className="mt-4 rounded-2xl bg-soft p-4 text-sm">The builder accepted this {t.completed_at ? dateTime(t.completed_at) : ""}. It’s closed.</p>}
      {waiting.length > 0 && <RequestList title="Sent back to the builder. Waiting for their answers" items={waiting} tone="amber" media={work} fileBase={fileBase} />}
      {waiting.length === 0 && answered.length > 0 && <RequestList title="The builder’s answers" items={answered.slice(-20)} tone="plain" media={work} fileBase={fileBase} />}

      <div className="mt-8">
        {t.kind === "mls_entry" && sheet && <EntryWork t={t} sheet={sheet} check={check} closed={closed} waiting={waiting.length > 0} fileBase={fileBase} actions={actions} hidden={hidden} />}
        {t.kind === "mls_update" && sheet && <UpdateWork t={t} sheet={sheet} fileBase={fileBase} media={work.changeMedia} />}
        {t.kind === "listing_status" && sheet && <StatusWork t={t} sheet={sheet} />}
        {t.kind === "open_house_mls" && <OpenHouseWork t={t} list={work.openHouses} />}
        {!sheet && t.kind !== "open_house_mls" && <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">This home is no longer available.</p>}
        {t.kind !== "mls_entry" && !closed && <FinishBox t={t} actions={actions} hidden={hidden} waiting={waiting.length > 0} />}
      </div>

      {!closed && sheet && (
        <details className="mt-8 rounded-2xl border border-line" open={false}>
          <summary className="cursor-pointer px-4 py-3 font-semibold">Something looks wrong? Send it back to the builder</summary>
          <div className="border-t border-line p-4">
            <p className="mb-3 text-sm text-muted">Flag each field with what it should be, or a photo with what’s wrong. The builder answers each one and sends this work order back to you.</p>
            <SendBackForm action={actions.sendBack} refName={by.name} refValue={by.value} fields={fieldChoices(sheet)} photos={photoChoices(sheet)} />
          </div>
        </details>
      )}

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-semibold">Notes with the builder</h2>
        <p className="text-sm text-muted">A question for the builder? Ask here. They get it by email.</p>
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-soft px-3 py-2 text-sm">
              <span className="font-medium">{n.author}</span> <span className="text-muted">{dateTime(n.created_at)}</span>
              <p className="whitespace-pre-line break-words">{n.body}</p>
            </li>
          ))}
        </ul>
        {t.status !== "done" && (
          <form action={actions.note} className="mt-3 flex flex-col gap-2 sm:flex-row">
            {hidden}
            <input name="body" maxLength={2000} placeholder="e.g. Need the legal description for this lot" className="field-input py-2" />
            <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">Send</button>
          </form>
        )}
      </section>
    </div>
  );
}

// Every field on the sheet, for "send back" (label and what it says now).
function fieldChoices(sheet: MlsSheet) {
  return buildMlsPackage(sheet).tabs.flatMap((tab) => tab.lines.map((l) => ({ key: l.key, label: `${tab.title}: ${l.label}`, current: l.text })));
}
function photoChoices(sheet: MlsSheet) {
  return sheet.photos.map((m, i) => ({ id: m.id, label: `Photo ${i + 1}: ${m.caption ?? m.room ?? m.title}` }));
}

const ANSWER: Record<string, string> = { open: "Waiting", accepted: "Changed to your value", changed: "Changed", declined: "Left as it is" };

function RequestList({ title, items, tone, media, fileBase }: { title: string; items: BrokerRequest[]; tone: "amber" | "plain"; media: BrokerWork; fileBase: string }) {
  const photo = (id: string | null) => (id ? media.sheet?.photos.find((m) => m.id === id) ?? media.changeMedia.get(id) : undefined);
  return (
    <div className={cx("mt-4 rounded-2xl p-4 text-sm", tone === "amber" ? "bg-amber-50 text-amber-950" : "border border-line")}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-2 space-y-2">
        {items.map((r) => {
          const m = photo(r.media_id);
          return (
            <li key={r.id} className="flex gap-3">
              {m && <span className="relative block h-12 w-16 shrink-0 overflow-hidden rounded bg-soft"><MediaPicture m={m} className="h-full w-full" fileBase={fileBase} /></span>}
              <span className="min-w-0">
                <b>{r.kind === "photo" ? "Photo" : r.field_label}</b>
                {r.proposed_text && <> → {r.proposed_text}</>}
                {r.note && <span className="text-muted"> ({r.note})</span>}
                {r.status !== "open" && <span className="block"><b>{ANSWER[r.status]}</b>{r.decision_note ? `: ${r.decision_note}` : ""}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FinishBox({ t, actions, hidden, waiting }: { t: BrokerTask; actions: WorkActions; hidden: React.ReactNode; waiting: boolean }) {
  if (waiting) return null;
  const n = t.kind === "mls_update" ? Object.keys(t.changes ?? {}).length : 0;
  return (
    <FinishCard className="mt-6">
      <form action={actions.submit} className="space-y-3">
        {hidden}
        <h3 className="text-lg font-extrabold">{n > 1 ? `Made all ${n} changes in the MLS?` : "Done in the MLS?"}</h3>
        <p className="text-sm text-muted">Send it to the builder. They check it and accept it, and that closes the work order.</p>
        <input name="mls_url" type="url" maxLength={500} placeholder="Link to the listing (optional)" className="field-input" />
        <button className="h-12 w-full rounded-xl bg-accent px-6 text-base font-bold text-white hover:brightness-110 sm:w-auto">All done · Send to the builder</button>
      </form>
    </FinishCard>
  );
}

// A brand-new listing: the whole MLS entry, tab by tab, finishing with the
// MLS number and the link on the last tab.
function EntryWork({ t, sheet, check, closed, waiting, fileBase, actions, hidden }: {
  t: BrokerTask; sheet: MlsSheet; check: Check; closed: boolean; waiting: boolean; fileBase: string; actions: WorkActions; hidden: React.ReactNode;
}) {
  const canSend = !closed && !waiting && sheet.home.workflow_status === "approved_for_mls";
  const finish = canSend ? (
    <FinishCard>
      <form action={actions.submit} className="space-y-3">
        {hidden}
        <h3 className="text-lg font-extrabold">Submitted it in the MLS? Send it to the builder</h3>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex-1 text-sm font-semibold">MLS number
            <input name="mls_number" required maxLength={40} placeholder="e.g. 20841177" className="field-input mt-1" />
          </label>
          <label className="flex-[2] text-sm font-semibold">Link to the live listing
            <input name="mls_url" type="url" required maxLength={500} placeholder="https://…" className="field-input mt-1" />
          </label>
        </div>
        <button className="h-12 w-full rounded-xl bg-accent px-6 text-base font-bold text-white hover:brightness-110 sm:w-auto">Send to the builder</button>
        <p className="text-sm text-muted">The builder checks it on the MLS and accepts it. That closes this work order.</p>
      </form>
    </FinishCard>
  ) : (
    <p className="rounded-2xl bg-soft p-4 text-sm">
      {t.status === "submitted" ? "Sent to the builder to check and accept."
        : t.status === "done" ? `Accepted. Live on the MLS${sheet.home.mls_number ? ` as #${sheet.home.mls_number}` : ""}.`
        : waiting ? "Waiting on the builder’s answers to what you sent back."
        : "The builder took this back for changes. You’ll get an email when it’s ready again."}
    </p>
  );
  return <MlsWorkSheet sheet={sheet} check={check} fileBase={fileBase} broker finish={finish} />;
}

// A live listing changed: exactly what to change, old and new.
function UpdateWork({ t, sheet, fileBase, media }: { t: BrokerTask; sheet: MlsSheet; fileBase: string; media: Map<string, MediaRow> }) {
  const entries = Object.entries(t.changes ?? {}).filter(([k]) => k !== "photos") as [string, Change][];
  const photos = t.changes?.photos;
  const n = entries.length + (photos ? 1 : 0);
  return (
    <div className="space-y-5">
      <Lead>
        Open <b>MLS #{sheet.home.mls_number ?? "?"}</b> in the MLS and choose <b>Change listing</b>.{" "}
        {n ? <>Make {n === 1 ? "this change" : `these ${n} changes`}, then send it.</> : null}
      </Lead>
      {n === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">Nothing left to change: the builder put everything back the way the MLS has it. You can send it to the builder.</p>
      ) : (
        <>
          {entries.length > 0 && <ChangeRows entries={entries} />}
          {photos && (
            <div className="space-y-4 rounded-2xl border border-line p-4">
              <p className="text-sm text-muted">Photos</p>
              {(photos.added ?? []).length > 0 && <PhotoStrip title={`Add ${photos.added!.length} photo${photos.added!.length > 1 ? "s" : ""}`} ids={photos.added!} media={media} fileBase={fileBase} />}
              {(photos.removed ?? []).length > 0 && <PhotoStrip title={`Remove ${photos.removed!.length} photo${photos.removed!.length > 1 ? "s" : ""}`} ids={photos.removed!} media={media} fileBase={fileBase} faded />}
            </div>
          )}
        </>
      )}
      {t.details && <p className="text-sm text-muted">{t.details}</p>}
      <details className="rounded-2xl border border-line">
        <summary className="cursor-pointer px-4 py-3 font-semibold">See the whole listing</summary>
        <div className="p-4 pt-0"><MlsWorkSheet sheet={sheet} fileBase={fileBase} broker /></div>
      </details>
    </div>
  );
}

function PhotoStrip({ title, ids, media, fileBase, faded }: { title: string; ids: string[]; media: Map<string, MediaRow>; fileBase: string; faded?: boolean }) {
  return (
    <div>
      <p className={cx("text-sm font-bold", faded ? "text-red-800" : "text-emerald-800")}>{title}{!faded && <span className="font-normal text-muted"> · click one to download it</span>}</p>
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

function StatusWork({ t, sheet }: { t: BrokerTask; sheet: MlsSheet }) {
  const rank = (k: string) => (STATUS_ORDER.indexOf(k) + 1 || 99);
  const entries = (Object.entries(t.changes ?? {}) as [string, Change][]).sort(([a], [b]) => rank(a) - rank(b));
  const status = t.changes?.standard_status;
  return (
    <div className="space-y-5">
      <Lead>
        Open <b>MLS #{sheet.home.mls_number ?? "?"}</b> and choose <b>Change status</b>. Set it to <b>{String(status?.to ?? "the new status")}</b> and fill in each detail below.
      </Lead>
      <ChangeRows entries={entries} showBefore={false} missingText="Not given. Send it back or ask the builder in a note." />
      {t.details && <p className="text-sm text-muted">{t.details}</p>}
    </div>
  );
}

function OpenHouseWork({ t, list }: { t: BrokerTask; list: BrokerOpenHouse[] }) {
  const removing = t.source_table === "open_houses_cancel" || t.source_table === "open_house_series_end";
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
