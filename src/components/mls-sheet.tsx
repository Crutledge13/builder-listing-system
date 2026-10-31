import Link from "next/link";
import { cx } from "@/lib/format";
import { sheetRuleProblems } from "@/lib/mls-fields";
import type { MlsSheet } from "@/lib/mls-sheet";
import { CheckOff, CopyButton } from "@/components/mls-client";
import { levelLabel } from "@/lib/rooms";
import { endsText } from "@/lib/incentives";

// Progress toward a complete MLS entry.
export function MlsScore({ sheet, homeId, edit = true }: { sheet: MlsSheet; homeId: string; edit?: boolean }) {
  const { filled, required, missing } = sheet.score;
  const pct = Math.round((filled / required) * 100);
  const problems = sheetRuleProblems(sheet.sections, sheet.home, sheet.homeDetails, sheet.communityDetails);
  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{missing.length === 0 ? "Every required MLS field is filled" : `${missing.length} required MLS ${missing.length === 1 ? "field" : "fields"} missing`}</span>
        <span className="text-sm text-muted">{filled} of {required}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-soft">
        <div className={cx("h-full rounded-full", missing.length ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-sm">
          Missing: {missing.map((f) => f.label).join(", ")}.{" "}
          {edit && <Link href={`/homes/${homeId}/mls`} className="font-semibold text-accent underline">Fill them in</Link>}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-red-900">
          {problems.map((p) => <li key={p}>✕ {p}</li>)}
        </ul>
      )}
    </div>
  );
}

// The MLS sheet page's pieces (/homes/[id]/mls). Work sheets use MlsWorkSheet.

// The home's room list (Rooms tab in Matrix): type, level, length × width.
export function RoomList({ sheet, check, broker = false }: { sheet: MlsSheet; check?: { taskId: string; checked: string[]; action: (taskId: string, item: string, on: boolean) => Promise<void>; disabled?: boolean }; broker?: boolean }) {
  if (sheet.board?.code && sheet.board.code !== "NTREIS" && !sheet.rooms.length) return null;
  const done = check ? sheet.rooms.filter((_, i) => check.checked.includes(`room-${i}`)).length : 0;
  return (
    <section className="overflow-hidden rounded-2xl border border-line">
      <h3 className="flex items-baseline justify-between bg-soft px-4 py-2.5 font-semibold">
        Room sizes
        {check && sheet.rooms.length > 0 && <span className="text-xs font-normal text-muted">{done} of {sheet.rooms.length} entered</span>}
      </h3>
      {sheet.rooms.length === 0 ? (
        <p className="bg-amber-50/60 px-4 py-3 text-sm text-amber-900">{broker ? "No room sizes yet. Leave the builder a note below if the MLS needs them." : <>No room sizes yet. The builder pulls them from the floor plan on the home page (or our team adds the plan&rsquo;s rooms under Floor plans).</>}</p>
      ) : (
        <dl className="divide-y divide-line">
          {sheet.rooms.map((r, i) => {
            const size = r.RoomLength && r.RoomWidth ? `${Number(r.RoomLength)} x ${Number(r.RoomWidth)}` : "";
            return (
              <div key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 px-4 py-2 sm:grid-cols-[auto_220px_120px_1fr_auto]">
                {check ? <CheckOff taskId={check.taskId} item={`room-${i}`} initial={check.checked.includes(`room-${i}`)} action={check.action} disabled={check.disabled} /> : <span className="w-0" />}
                <dt className="text-sm font-medium">{r.RoomType}</dt>
                <dd className="text-sm text-muted">{levelLabel(r.RoomLevel)}</dd>
                <dd className={cx("text-[15px] tabular-nums", !size && "text-amber-900")}>{size ? `${size} ft` : "Size missing"}</dd>
                <div>{size && <CopyButton value={size} />}</div>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}

// Current incentives for this home, to mention in the remarks (buyer incentives only).
export function IncentiveSheet({ sheet }: { sheet: MlsSheet }) {
  if (!sheet.incentives.length) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-line">
      <h3 className="bg-soft px-4 py-2.5 font-semibold">Incentives <span className="text-xs font-normal text-muted">for the remarks</span></h3>
      <dl className="divide-y divide-line">
        {sheet.incentives.map((i) => {
          const text = `${i.title}${i.details ? `: ${i.details}` : ""}`;
          return (
            <div key={i.id} className="grid grid-cols-[1fr_auto] items-start gap-x-3 px-4 py-2.5">
              <div>
                <dt className="text-[15px] font-medium">{i.title}</dt>
                <dd className="text-sm text-muted">{i.details ? `${i.details} · ` : ""}{endsText(i.ends_on)}</dd>
              </div>
              <CopyButton value={text} />
            </div>
          );
        })}
      </dl>
    </section>
  );
}
