import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cx, dateTime } from "@/lib/format";
import { answerAvailability, resolveAlert } from "@/app/(app)/compliance/actions";

export type Alert = {
  id: string;
  home_id: string;
  builder_id: string;
  kind: string;
  severity: "info" | "warning" | "urgent";
  audience: string;
  message: string;
  created_at: string;
  homes: { unparsed_address: string; list_price: number | null; workflow_status: string; mls_board: string | null } | null;
  builders?: { name: string } | null;
};

export const ALERT_SELECT = "id, home_id, builder_id, kind, severity, audience, message, created_at, homes(unparsed_address, list_price, workflow_status, mls_board), builders(name)";

export const ALERT_TITLES: Record<string, string> = {
  availability_check: "Still available?",
  sold_signal_website: "Website says it's under contract or sold",
  sold_signal_mls: "MLS status doesn't match",
  completion_past_due: "Completion date has passed",
  status_overdue: "Status change due on the MLS",
  open_house_not_entered: "Open house not on the MLS",
  remarks_violation: "Description breaks MLS rules",
  long_pending: "Under contract a long time",
};

const STATUS_KINDS = new Set(["availability_check", "sold_signal_website", "long_pending"]);

// Open alerts the signed-in person can see (the database decides which).
export async function loadAlerts(opts: { homeId?: string; builderId?: string; limit?: number } = {}) {
  const supabase = await createClient();
  let q = supabase.from("home_alerts").select(ALERT_SELECT).is("resolved_at", null).order("created_at", { ascending: false });
  if (opts.homeId) q = q.eq("home_id", opts.homeId);
  if (opts.builderId) q = q.eq("builder_id", opts.builderId);
  if (opts.limit) q = q.limit(opts.limit);
  const { data } = await q;
  const order = { urgent: 0, warning: 1, info: 2 };
  return ((data ?? []) as unknown as Alert[]).sort((a, b) => order[a.severity] - order[b.severity]);
}

// One alert with the quickest way to answer it.
export function AlertCard({ a, back, canAnswer, staff, showHome = true }: { a: Alert; back: string; canAnswer: boolean; staff: boolean; showHome?: boolean }) {
  const live = a.homes?.workflow_status === "live_on_mls";
  return (
    <div className={cx("rounded-2xl border p-4", a.severity === "urgent" ? "border-red-300 bg-red-50/60" : a.severity === "warning" ? "border-amber-300 bg-amber-50/50" : "border-line")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {a.severity === "urgent" && <span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">Urgent</span>}
          {ALERT_TITLES[a.kind] ?? a.kind}
          {showHome && a.homes && <> · <Link href={`/homes/${a.home_id}`} className="underline">{a.homes.unparsed_address}</Link></>}
        </span>
        <span className="text-xs text-muted">{a.builders?.name && staff ? `${a.builders.name.replace(" (demo)", "")} · ` : ""}{dateTime(a.created_at)}{staff && a.audience === "team" ? " · our team only" : ""}</span>
      </div>
      <p className="mt-1 text-sm">{a.message}</p>

      {canAnswer && live && STATUS_KINDS.has(a.kind) && (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {a.kind !== "long_pending" && (
            <form action={answerAvailability}>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="home_id" value={a.home_id} />
              <input type="hidden" name="answer" value="available" />
              <button className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">Still available</button>
            </form>
          )}
          {a.kind !== "long_pending" && (
            <details className="rounded-lg border border-line bg-white open:w-full sm:open:w-auto">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold">Under contract</summary>
              <form action={answerAvailability} className="flex flex-wrap items-end gap-2 border-t border-line p-3">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="home_id" value={a.home_id} />
                <input type="hidden" name="answer" value="under_contract" />
                <label className="text-sm"><span className="mb-1 block font-medium">Contract date</span><input type="date" name="date" required className="field-input py-1.5" /></label>
                <button className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white">Save</button>
              </form>
            </details>
          )}
          <details className="rounded-lg border border-line bg-white open:w-full sm:open:w-auto">
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold">Sold</summary>
            <form action={answerAvailability} className="flex flex-wrap items-end gap-2 border-t border-line p-3">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="home_id" value={a.home_id} />
              <input type="hidden" name="answer" value="sold" />
              <label className="text-sm"><span className="mb-1 block font-medium">Close date</span><input type="date" name="date" required className="field-input py-1.5" /></label>
              <label className="text-sm"><span className="mb-1 block font-medium">Close price</span><input name="price" required inputMode="decimal" defaultValue={a.homes?.list_price ?? ""} className="field-input w-36 py-1.5" /></label>
              <button className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white">Save</button>
            </form>
          </details>
        </div>
      )}
      {!STATUS_KINDS.has(a.kind) && (
        <Link href={a.kind === "remarks_violation" || a.kind === "completion_past_due" ? `/homes/${a.home_id}#edit` : `/homes/${a.home_id}`} className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">
          {a.kind === "completion_past_due" ? "Update the home →" : a.kind === "remarks_violation" ? "Fix the description →" : "Open the home →"}
        </Link>
      )}
      {staff && (
        <form action={resolveAlert} className="mt-2">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="id" value={a.id} />
          <button className="text-xs text-muted underline">Close this alert</button>
        </form>
      )}
    </div>
  );
}

// Collapsed by default so a page doesn't open on a wall of alerts. Shows the
// most pressing few; the full list is a click away.
export function AttentionPanel({
  alerts,
  back,
  canAnswer,
  staff,
  fullHref,
  max = 6,
}: {
  alerts: Alert[];
  back: string;
  canAnswer: boolean;
  staff: boolean;
  fullHref: string;
  max?: number;
}) {
  if (alerts.length === 0) return null;
  const urgent = alerts.filter((a) => a.severity === "urgent").length;
  return (
    <details className="group mt-6 rounded-2xl border border-line">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span className={cx("flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold text-white", urgent ? "bg-red-600" : "bg-amber-500")}>
          {alerts.length}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Needs your attention</span>
          <span className="block text-sm text-muted">
            {urgent ? `${urgent} urgent. ` : ""}Quick answers keep the MLS accurate and avoid fines.
          </span>
        </span>
        <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden>
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-line p-4">
        <div className="grid gap-3 lg:grid-cols-2">
          {alerts.slice(0, max).map((a) => <AlertCard key={a.id} a={a} back={back} canAnswer={canAnswer} staff={staff} />)}
        </div>
        <Link href={fullHref} className="mt-4 inline-flex rounded-full border border-foreground px-4 py-2 text-sm font-semibold hover:bg-soft">
          {alerts.length > max ? `See all ${alerts.length} issues` : "Open the full list"} →
        </Link>
      </div>
    </details>
  );
}
