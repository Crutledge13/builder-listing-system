import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cx, dateTime } from "@/lib/format";
import { answerAvailability, resolveAlert } from "@/app/(app)/compliance/actions";

export type Alert = {
  id: string;
  home_id: string;
  kind: string;
  severity: "info" | "warning" | "urgent";
  audience: string;
  message: string;
  created_at: string;
  homes: { unparsed_address: string; list_price: number | null; workflow_status: string; mls_board: string | null } | null;
  builders?: { name: string } | null;
};

export const ALERT_SELECT = "id, home_id, kind, severity, audience, message, created_at, homes(unparsed_address, list_price, workflow_status, mls_board), builders(name)";

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
export async function loadAlerts(opts: { homeId?: string; limit?: number } = {}) {
  const supabase = await createClient();
  let q = supabase.from("home_alerts").select(ALERT_SELECT).is("resolved_at", null).order("created_at", { ascending: false });
  if (opts.homeId) q = q.eq("home_id", opts.homeId);
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
