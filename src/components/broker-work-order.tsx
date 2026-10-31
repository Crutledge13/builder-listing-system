import Link from "next/link";
import type { BrokerOpenHouse, BrokerRequest, BrokerTask, BrokerWork } from "@/lib/broker";
import { workOrder } from "@/lib/broker";
import type { MlsSheet } from "@/lib/mls-sheet";
import type { MediaRow } from "@/lib/demo-media";
import { TASK_KIND_LABELS } from "@/lib/permissions";
import { cx, dateTime, money } from "@/lib/format";
import { openHouseWhen, whenCentral } from "@/lib/time";
import { CONDITION, formatMls, MLS_FIELD_FOR_COLUMN } from "@/lib/mls-fields";
import { buildMlsPackage } from "@/lib/mls-package";
import { MlsScore } from "@/components/mls-sheet";
import { BrokerMlsSheet } from "@/components/broker-mls-sheet";
import { OpenBesideMatrix } from "@/components/mls-sheet-client";
import { CheckOff, CopyButton } from "@/components/mls-client";
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
      <h1 className="mt-2 break-words text-[26px] font-bold leading-tight tracking-tight">{sheet?.home.unparsed_address ?? t.title}</h1>
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

      {actions.setStatus && t.status === "todo" && (
        <form action={actions.setStatus} className="mt-4">
          {hidden}
          <input type="hidden" name="status" value="in_progress" />
          <button className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-foreground">Mark started</button>
        </form>
      )}

      <div className="mt-8">
        {t.kind === "mls_entry" && sheet && <EntryWork t={t} sheet={sheet} check={check} closed={closed} waiting={waiting.length > 0} fileBase={fileBase} actions={actions} hidden={hidden} />}
        {t.kind === "mls_update" && sheet && <UpdateWork t={t} sheet={sheet} check={check} fileBase={fileBase} media={work.changeMedia} />}
        {t.kind === "listing_status" && sheet && <StatusWork t={t} sheet={sheet} check={check} />}
        {t.kind === "open_house_mls" && <OpenHouseWork t={t} check={check} list={work.openHouses} />}
        {!sheet && t.kind !== "open_house_mls" && <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">This home is no longer available.</p>}
        {t.kind !== "mls_entry" && !closed && <FinishBox actions={actions} hidden={hidden} waiting={waiting.length > 0} />}
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

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1.5 rounded-2xl bg-accent-soft/50 p-4 text-sm">
      {items.map((s, i) => (
        <li key={i} className="flex gap-2"><span className="font-bold text-accent">{i + 1}.</span> {s}</li>
      ))}
    </ol>
  );
}

function FinishBox({ actions, hidden, waiting }: { actions: WorkActions; hidden: React.ReactNode; waiting: boolean }) {
  if (waiting) return null;
  return (
    <form action={actions.submit} className="mt-6 rounded-2xl border border-line p-4">
      {hidden}
      <h3 className="font-semibold">Made every change in the MLS?</h3>
      <p className="mt-1 text-sm text-muted">Send it to the builder. They check it and accept it, and that closes the work order.</p>
      <input name="mls_url" type="url" maxLength={500} placeholder="Link to the listing (optional)" className="field-input mt-3" />
      <button className="mt-3 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110 sm:w-auto">Send to the builder</button>
    </form>
  );
}

// A brand-new listing: the full MLS input, then the MLS number and link.
function EntryWork({ t, sheet, check, closed, waiting, fileBase, actions, hidden }: {
  t: BrokerTask; sheet: MlsSheet; check: Check; closed: boolean; waiting: boolean; fileBase: string; actions: WorkActions; hidden: React.ReactNode;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-6">
        <Steps
          items={[
            `Start a new listing in ${sheet.board?.short_name ?? "the MLS"} (Residential, For Sale).`,
            "Go tab by tab, same as the MLS. Copy each value (it ticks itself) or tick the boxes shown.",
            "On the last tab, download the photo pack and upload the photos in that order.",
            "Submit it in the MLS, then send the MLS number and the listing link to the builder.",
          ]}
        />
        <MlsScore sheet={sheet} homeId={sheet.home.id} edit={false} />
        <div className="hidden justify-end sm:flex"><OpenBesideMatrix /></div>
        <BrokerMlsSheet sheet={sheet} check={check} fileBase={fileBase} broker />
      </div>
      <aside>
        <div className="space-y-4 lg:sticky lg:top-24">
          {!closed && !waiting && sheet.home.workflow_status === "approved_for_mls" ? (
            <form action={actions.submit} className="rounded-2xl border border-line p-4">
              {hidden}
              <h3 className="font-semibold">Entered it in the MLS?</h3>
              <p className="mt-1 text-sm text-muted">Send the builder the MLS number and the link to the live listing. They check it and accept it.</p>
              <input name="mls_number" required maxLength={40} placeholder="MLS number" className="field-input mt-3" />
              <input name="mls_url" type="url" required maxLength={500} placeholder="Link to the live listing (https://…)" className="field-input mt-2" />
              <button className="mt-3 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Send to the builder</button>
            </form>
          ) : (
            <p className="rounded-2xl bg-soft p-4 text-sm">
              {t.status === "submitted" ? "Sent to the builder to check and accept."
                : t.status === "done" ? `Accepted. Live on the MLS${sheet.home.mls_number ? ` as #${sheet.home.mls_number}` : ""}.`
                : waiting ? "Waiting on the builder’s answers to what you sent back."
                : "The builder took this back for changes. You’ll get an email when it’s ready again."}
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
    <div className="space-y-6">
      <Steps items={[`Open MLS #${sheet.home.mls_number ?? "?"} and choose Change listing.`, "Make each change below. Tick it once it’s saved in the MLS.", "Send it to the builder to accept."]} />
      {lines === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">Nothing left to change: the builder put everything back the way the MLS has it. You can send it to the builder.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="divide-y divide-line">
            {entries.map(([key, c]) => {
              const f = MLS_FIELD_FOR_COLUMN[key];
              const to = showValue(key, c.to);
              return (
                <div key={key} className="flex items-start gap-3 px-4 py-3">
                  <CheckOff taskId={check.taskId} item={key} initial={check.checked.includes(key)} action={check.action} disabled={check.disabled} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{f?.label ?? c.label}</div>
                    {key.startsWith("incentive:") && <div className="text-[11px] text-muted">In the remarks (no agent pay)</div>}
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      <div className="whitespace-pre-line break-words text-[15px] text-muted"><span className="text-xs">Now: </span><span className="line-through decoration-red-400">{showValue(key, c.from) || "—"}</span></div>
                      <div className="whitespace-pre-line break-words text-[15px] font-semibold"><span className="text-xs font-normal text-muted">Change to: </span>{to || (key.startsWith("incentive:") ? "(take it out: it ended)" : "(clear it)")}</div>
                    </div>
                  </div>
                  <CopyButton value={to} />
                </div>
              );
            })}
            {photos && (
              <div className="flex items-start gap-3 px-4 py-3">
                <CheckOff taskId={check.taskId} item="photos" initial={check.checked.includes("photos")} action={check.action} disabled={check.disabled} />
                <div className="min-w-0 flex-1 space-y-3">
                  <span className="text-sm font-semibold">Photos</span>
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
        <div className="p-4 pt-0"><BrokerMlsSheet sheet={sheet} fileBase={fileBase} broker /></div>
      </details>
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

function StatusWork({ t, sheet, check }: { t: BrokerTask; sheet: MlsSheet; check: Check }) {
  const rank = (k: string) => (STATUS_ORDER.indexOf(k) + 1 || 99);
  const entries = Object.entries(t.changes ?? {}).sort(([a], [b]) => rank(a) - rank(b));
  const status = t.changes?.standard_status;
  return (
    <div className="space-y-6">
      <Steps items={[`Open MLS #${sheet.home.mls_number ?? "?"} and choose Change status.`, `Set the status to ${String(status?.to ?? "the new status")} and fill in each detail below.`, "Send it to the builder to accept."]} />
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {entries.map(([key, c]) => {
          const to = showValue(key, c.to);
          return (
            <div key={key} className="flex items-start gap-3 px-4 py-3">
              <CheckOff taskId={check.taskId} item={key} initial={check.checked.includes(key)} action={check.action} disabled={check.disabled} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{c.label}</div>
                <div className="break-words text-[15px]">
                  {key === "standard_status" && <><span className="text-muted line-through">{String(c.from)}</span> → </>}
                  {to ? <b>{to}</b> : <span className="font-semibold text-amber-900">Not given. Send it back or ask the builder in a note.</span>}
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

function OpenHouseWork({ t, check, list }: { t: BrokerTask; check: Check; list: BrokerOpenHouse[] }) {
  const removing = t.source_table === "open_houses_cancel" || t.source_table === "open_house_series_end";
  return (
    <div className="space-y-6">
      <Steps items={["Open the listing in the MLS and go to Open houses.", removing ? "Delete each open house below." : "Add each open house below (times are Central).", "Tick each one, then send it to the builder."]} />
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {list.map((o) => {
          const text = openHouseWhen(o.starts_at, o.ends_at);
          return (
            <div key={o.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <CheckOff taskId={check.taskId} item={o.id} initial={check.checked.includes(o.id)} action={check.action} disabled={check.disabled} />
              <div className="min-w-0 flex-1">
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
