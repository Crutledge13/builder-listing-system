import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { workOrder } from "@/lib/broker";
import { TASK_KIND_LABELS } from "@/lib/permissions";
import { cx, dateTime } from "@/lib/format";
import { HomeSection } from "@/components/home-section";
import { CopyButton } from "@/components/mls-client";
import { MediaPicture } from "@/components/media-tile";
import { MEDIA_SELECT, type MediaRow } from "@/lib/demo-media";
import {
  acceptBrokerWork, answerBrokerRequest, makeBrokerLink, resendToBroker, returnBrokerWork, setHomeBroker, turnOffBrokerLink,
} from "@/app/(app)/homes/[id]/broker-work-actions";

// "Your broker" on a home (broker mode only; owner, managers, marketing and
// our staff for the builder). Where the builder answers the broker: accept or
// send back finished work, answer what the broker flagged, pick which broker
// lists this home, make one-off links, and see what the broker looked at.
// The broker's own screens never show here.

export type Order = {
  id: string; work_order_no: number; kind: string; title: string; status: string; created_at: string; completed_at: string | null;
  submitted_at: string | null; submitted_by_name: string | null; submitted_mls_number: string | null; submitted_mls_url: string | null;
  changes: Record<string, { label?: string; from?: unknown; to?: unknown }> | null; open_requests: number; waiting_requests: number;
};
export type Request = {
  id: string; task_id: string; kind: "field" | "photo"; field_key: string | null; field_label: string | null; current_text: string | null;
  proposed_text: string | null; media_id: string | null; note: string | null; status: string; decision_note: string | null;
  created_at: string; created_by_name: string; resent_at: string | null;
};
export type LinkRow = { id: string; token: string; task_id: string; name: string; created_at: string; revoked_at: string | null; opened_count: number; last_opened_at: string | null };
export type Activity = { id: number; task_id: string | null; who: string; action: string; detail: Record<string, unknown>; created_at: string };
export type Broker = { broker_id: string; full_name: string; email: string; removed_at: string | null; is_active: boolean };

const DID: Record<string, string> = {
  viewed: "opened", sent_back: "sent it back", submitted: "sent it as done", note: "left a note", took_back: "took it back",
  accepted: "accepted it", returned: "sent it back to the broker", answered: "answered", resent: "resent it", assigned: "picked the broker",
  link_made: "made a one-off link", link_off: "turned off a one-off link",
};
const STATUS: Record<string, string> = { todo: "With your broker", in_progress: "Your broker started it", submitted: "Check and accept", done: "Closed" };

export async function BrokerHomeSection({ homeId, builderId, brokerId, origin, open, notice }: {
  homeId: string; builderId: string; brokerId: string | null; origin: string; open: boolean; notice: ReactNode;
}) {
  const supabase = await createClient();
  const [{ data: orderData }, { data: reqData }, { data: linkData }, { data: actData }, { data: brokerData }] = await Promise.all([
    supabase.rpc("home_work_orders", { p_home: homeId }),
    supabase.from("broker_requests").select("id, task_id, kind, field_key, field_label, current_text, proposed_text, media_id, note, status, decision_note, created_at, created_by_name, resent_at").eq("home_id", homeId).is("resent_at", null).order("created_at"),
    supabase.from("broker_links").select("id, token, task_id, name, created_at, revoked_at, opened_count, last_opened_at").eq("home_id", homeId).order("created_at", { ascending: false }),
    supabase.from("broker_activity").select("id, task_id, who, action, detail, created_at").eq("home_id", homeId).order("created_at", { ascending: false }).limit(25),
    supabase.rpc("builder_brokers", { p_builder: builderId }),
  ]);
  const orders = (orderData ?? []) as Order[];
  const requests = (reqData ?? []) as Request[];
  const mediaIds = [...new Set(requests.map((r) => r.media_id).filter((x): x is string => !!x))];
  const { data: mediaRows } = mediaIds.length ? await supabase.from("media").select(MEDIA_SELECT).in("id", mediaIds) : { data: [] };
  return (
    <BrokerHomeView homeId={homeId} brokerId={brokerId} origin={origin} open={open} notice={notice}
      orders={orders} requests={requests} links={(linkData ?? []) as LinkRow[]} activity={(actData ?? []) as Activity[]}
      brokers={((brokerData ?? []) as Broker[]).filter((b) => !b.removed_at && b.is_active)}
      media={new Map(((mediaRows ?? []) as unknown as MediaRow[]).map((m) => [m.id, m]))} />
  );
}

// The section itself, from data already loaded.
export function BrokerHomeView({ homeId, brokerId, origin, open, notice, orders, requests, links, activity, brokers, media }: {
  homeId: string; brokerId: string | null; origin: string; open: boolean; notice: ReactNode;
  orders: Order[]; requests: Request[]; links: LinkRow[]; activity: Activity[]; brokers: Broker[]; media: Map<string, MediaRow>;
}) {
  const wo = new Map(orders.map((o) => [o.id, o]));

  const toAccept = orders.filter((o) => o.status === "submitted");
  const toAnswer = orders.filter((o) => o.waiting_requests > 0);
  const openOrders = orders.filter((o) => o.status !== "done");
  const needs = toAccept.length + toAnswer.length;
  const hidden = <input type="hidden" name="home_id" value={homeId} />;

  return (
    <HomeSection id="broker" title="Your broker" open={open || needs > 0} tone={needs ? "attention" : undefined}
      badge={needs ? `${needs} need${needs === 1 ? "s" : ""} you` : openOrders.length ? `${openOrders.length} open` : null}
      hint={needs ? "Your broker is waiting on you" : openOrders.length ? "With your broker" : "Work orders, one-off links and what your broker looked at"}>
      {notice}

      {/* Finished by the broker: check it on the MLS, then accept. */}
      {toAccept.map((o) => (
        <div key={o.id} className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50/60 p-4">
          <p className="text-xs font-semibold text-emerald-900">{workOrder(o.work_order_no)} · {TASK_KIND_LABELS[o.kind]}</p>
          <p className="mt-1 font-semibold">{o.submitted_by_name ?? "Your broker"} says it’s done{o.submitted_at ? ` (${dateTime(o.submitted_at)})` : ""}.</p>
          {o.kind === "mls_entry" ? (
            <p className="mt-1 text-sm">MLS #<b>{o.submitted_mls_number}</b>{o.submitted_mls_url && <> · <a href={o.submitted_mls_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">Check the live listing ↗</a></>}</p>
          ) : (
            <p className="mt-1 text-sm text-muted">{o.title}{o.submitted_mls_url && <> · <a href={o.submitted_mls_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">Check it ↗</a></>}</p>
          )}
          <p className="mt-2 text-sm text-muted">{o.kind === "mls_entry" ? "Accepting marks the home live on the MLS with this number and link." : "Accepting closes the work order."}</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
            <form action={acceptBrokerWork}>
              {hidden}<input type="hidden" name="task_id" value={o.id} />
              <button className="w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110 sm:w-auto">Looks right: accept</button>
            </form>
            <form action={returnBrokerWork} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
              {hidden}<input type="hidden" name="task_id" value={o.id} />
              <input name="note" required maxLength={2000} placeholder="What still needs fixing" className="field-input py-2" />
              <button className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold hover:border-foreground">Send back</button>
            </form>
          </div>
        </div>
      ))}

      {/* The broker flagged things before entering: answer each, then resend. */}
      {toAnswer.map((o) => {
        const items = requests.filter((r) => r.task_id === o.id);
        const allAnswered = items.every((r) => r.status !== "open");
        return (
          <div key={o.id} className="mt-4 rounded-2xl border border-amber-300 bg-amber-50/60 p-4">
            <p className="text-xs font-semibold text-amber-900">{workOrder(o.work_order_no)} · {TASK_KIND_LABELS[o.kind]}</p>
            <p className="mt-1 font-semibold">{items[0]?.created_by_name ?? "Your broker"} sent {items.length === 1 ? "one thing" : `${items.length} things`} back to check</p>
            <ul className="mt-3 space-y-3">
              {items.map((r) => {
                const m = r.media_id ? media.get(r.media_id) : undefined;
                return (
                  <li key={r.id} className="rounded-xl border border-line bg-white p-3">
                    <div className="flex gap-3">
                      {m && <span className="relative block h-14 w-20 shrink-0 overflow-hidden rounded bg-soft"><MediaPicture m={m} className="h-full w-full" /></span>}
                      <div className="min-w-0 text-sm">
                        <b>{r.kind === "photo" ? "A photo" : r.field_label}</b>
                        {r.kind === "field" && <div className="text-muted">Now: {r.current_text || "blank"}{r.proposed_text && <> · <span className="font-semibold text-foreground">Broker says: {r.proposed_text}</span></>}</div>}
                        {r.note && <div className="break-words">“{r.note}”</div>}
                        {r.status !== "open" && <div className="mt-1 font-semibold text-emerald-800">{r.status === "accepted" ? "Changed to the broker’s value" : r.status === "changed" ? "You changed it" : "Left as it is"}{r.decision_note ? `: ${r.decision_note}` : ""}</div>}
                      </div>
                    </div>
                    {r.status === "open" && (
                      <form action={answerBrokerRequest} className="mt-3 flex flex-col gap-2">
                        {hidden}<input type="hidden" name="request_id" value={r.id} />
                        <input name="note" maxLength={1000} placeholder="Note (needed if it stays as is)" className="field-input py-2" />
                        <div className="flex flex-wrap gap-2 text-sm">
                          {r.kind === "field" && r.proposed_text && <button name="answer" value="use" className="rounded-lg bg-foreground px-3 py-1.5 font-semibold text-white hover:bg-black">Use “{r.proposed_text.slice(0, 30)}”</button>}
                          <button name="answer" value="changed" className="rounded-lg border border-line px-3 py-1.5 font-semibold hover:border-foreground">{r.kind === "photo" ? "I fixed it" : "I changed it"}</button>
                          <button name="answer" value="declined" className="rounded-lg border border-line px-3 py-1.5 font-semibold hover:border-foreground">It’s right as it is</button>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
            <form action={resendToBroker} className="mt-3 flex flex-col gap-2 sm:flex-row">
              {hidden}<input type="hidden" name="task_id" value={o.id} />
              <input name="note" maxLength={2000} placeholder="Note with your answers (optional)" className="field-input py-2" disabled={!allAnswered} />
              <button disabled={!allAnswered} className={cx("rounded-xl px-4 py-2 text-sm font-semibold", allAnswered ? "bg-accent text-white hover:brightness-110" : "cursor-not-allowed bg-soft text-muted")}>
                {allAnswered ? "Send back to your broker" : "Answer each one first"}
              </button>
            </form>
          </div>
        );
      })}

      {/* Which broker lists this home. */}
      {brokers.length > 1 && (
        <form action={setHomeBroker} className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
          {hidden}
          <label htmlFor="broker_id" className="text-sm font-semibold">Who lists this home</label>
          <select id="broker_id" name="broker_id" defaultValue={brokerId ?? ""} className="field-input py-2 sm:max-w-xs">
            <option value="">Any of your brokers</option>
            {brokers.map((b) => <option key={b.broker_id} value={b.broker_id}>{b.full_name}</option>)}
          </select>
          <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">Save</button>
        </form>
      )}
      {brokers.length === 1 && <p className="mt-6 text-sm text-muted">Listed by {brokers[0].full_name}, your broker.</p>}
      {brokers.length === 0 && <p className="mt-6 text-sm text-muted">You haven’t added a broker yet (Team page). You can still send a one-off link for an open work order below.</p>}

      {/* Work orders on this home, with one-off links for the open ones. */}
      <h4 className="mt-6 text-sm font-semibold">Work orders</h4>
      {orders.length === 0 && <p className="mt-2 text-sm text-muted">None yet. Approving the home sends the first one to your broker.</p>}
      <ul className="mt-2 space-y-2">
        {orders.map((o) => {
          const myLinks = links.filter((l) => l.task_id === o.id);
          const live = o.status !== "done" && o.status !== "submitted";
          return (
            <li key={o.id} className="rounded-xl border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b className="tabular-nums">{workOrder(o.work_order_no)}</b>
                <span className="rounded-full bg-soft px-2 py-0.5 text-xs font-semibold">{TASK_KIND_LABELS[o.kind]}</span>
                <span className={cx("text-xs", o.status === "submitted" ? "font-semibold text-emerald-800" : "text-muted")}>{o.waiting_requests ? "Waiting on your answers" : STATUS[o.status] ?? o.status}</span>
                <span className="text-xs text-muted">· {dateTime(o.created_at)}</span>
              </div>
              <div className="mt-0.5 break-words">{o.title}</div>
              {myLinks.filter((l) => !l.revoked_at && live).map((l) => {
                const url = `${origin}/w/${l.token}`;
                return (
                  <div key={l.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-soft px-2 py-1.5 text-xs">
                    <span>One-off link for <b>{l.name}</b>{l.opened_count ? ` · opened ${l.opened_count}×` : " · not opened yet"}</span>
                    <CopyButton value={url} label="Copy link" />
                    <form action={turnOffBrokerLink}>{hidden}<input type="hidden" name="link_id" value={l.id} /><button className="font-semibold text-red-800 hover:underline">Turn off</button></form>
                  </div>
                );
              })}
              {live && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-accent">Send to a broker without an account (one-off link)</summary>
                  <form action={makeBrokerLink} className="mt-2 flex flex-col gap-2 sm:flex-row">
                    {hidden}<input type="hidden" name="task_id" value={o.id} />
                    <input name="name" required maxLength={120} placeholder="Who it’s for, e.g. Pat Jones, Lone Star Realty" className="field-input py-2" />
                    <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">Make link</button>
                  </form>
                  <p className="mt-1 text-xs text-muted">Anyone with the link can open this one work order, until you accept it or turn the link off.</p>
                </details>
              )}
            </li>
          );
        })}
      </ul>

      {/* What the broker looked at and did. */}
      {activity.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold">Broker activity ({activity.length})</summary>
          <ul className="mt-2 space-y-1.5 text-sm">
            {activity.map((a) => (
              <li key={a.id}>
                <b>{a.who}</b> {DID[a.action] ?? a.action}
                {a.task_id && wo.get(a.task_id) ? ` ${workOrder(wo.get(a.task_id)!.work_order_no)}` : ""}
                {a.action === "assigned" && a.detail?.broker ? `: ${String(a.detail.broker)}` : a.action === "assigned" ? ": any broker" : ""}
                {(a.action === "link_made" || a.action === "link_off") && a.detail?.for ? ` for ${String(a.detail.for)}` : ""}
                <span className="text-muted"> · {dateTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </HomeSection>
  );
}
