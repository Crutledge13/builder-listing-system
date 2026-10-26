import Link from "next/link";
import { cx } from "@/lib/format";
import { formatMls, MLS_SECTIONS, resolveField, type MlsField } from "@/lib/mls-fields";
import type { MlsSheet } from "@/lib/mls-sheet";
import { CheckOff, CopyButton } from "@/components/mls-client";
import { MediaPicture } from "@/components/media-tile";

const FROM_TEXT: Record<string, string> = {
  home: "Builder",
  "this home": "Our team",
  community: "Community",
  derived: "Automatic",
};

// Progress toward a complete MLS entry.
export function MlsScore({ sheet, homeId, edit = true }: { sheet: MlsSheet; homeId: string; edit?: boolean }) {
  const { filled, required, missing } = sheet.score;
  const pct = Math.round((filled / required) * 100);
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
    </div>
  );
}

// The whole MLS entry, in MLS order, ready to copy field by field.
export function MlsSheetView({
  sheet,
  check,
}: {
  sheet: MlsSheet;
  check?: { taskId: string; checked: string[]; action: (taskId: string, item: string, on: boolean) => Promise<void>; disabled?: boolean };
}) {
  return (
    <div className="space-y-6">
      {MLS_SECTIONS.map((section) => {
        const done = check ? section.fields.filter((f) => check.checked.includes(f.key)).length : 0;
        return (
          <section key={section.title} className="overflow-hidden rounded-2xl border border-line">
            <h3 className="flex items-baseline justify-between bg-soft px-4 py-2.5 font-semibold">
              {section.title}
              {check && <span className="text-xs font-normal text-muted">{done} of {section.fields.length} entered</span>}
            </h3>
            <dl className="divide-y divide-line">
              {section.fields.map((f) => (
                <SheetRow key={f.key} f={f} sheet={sheet} check={check} />
              ))}
            </dl>
          </section>
        );
      })}
      <PhotoList sheet={sheet} check={check} />
    </div>
  );
}

function SheetRow({ f, sheet, check }: { f: MlsField; sheet: MlsSheet; check?: Parameters<typeof MlsSheetView>[0]["check"] }) {
  const r = resolveField(f, sheet.home, sheet.homeDetails, sheet.communityDetails);
  const text = formatMls(f, r.value);
  const missing = r.from === "missing";
  return (
    <div className={cx("grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[auto_220px_1fr_auto]", missing && f.required && "bg-amber-50/60")}>
      {check ? (
        <CheckOff taskId={check.taskId} item={f.key} initial={check.checked.includes(f.key)} action={check.action} disabled={check.disabled} />
      ) : (
        <span className="w-0" />
      )}
      <dt className="text-sm">
        <span className="font-medium">{f.label}</span>
        {f.required && <span className="text-red-700"> *</span>}
        <span className="block text-[11px] text-muted">{f.key}</span>
      </dt>
      <dd className={cx("col-start-2 min-w-0 whitespace-pre-line break-words text-[15px] sm:col-start-auto", missing && "text-amber-900")}>
        {missing ? (f.required ? "Missing" : "—") : text}
        {!missing && <span className="ml-2 rounded bg-soft px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted">{FROM_TEXT[r.from]}</span>}
      </dd>
      <div className="col-start-2 sm:col-start-auto">{!missing && <CopyButton value={text} />}</div>
    </div>
  );
}

function PhotoList({ sheet, check }: { sheet: MlsSheet; check?: Parameters<typeof MlsSheetView>[0]["check"] }) {
  const list = sheet.mlsPhotos;
  return (
    <section className="overflow-hidden rounded-2xl border border-line">
      <h3 className="flex flex-wrap items-baseline justify-between gap-2 bg-soft px-4 py-2.5 font-semibold">
        <span className="flex items-center gap-3">
          {check && <CheckOff taskId={check.taskId} item="photos" initial={check.checked.includes("photos")} action={check.action} disabled={check.disabled} />}
          Photos, in MLS order ({list.length})
        </span>
        <Link href={`/media?home=${sheet.home.id}`} className="text-sm font-semibold text-accent underline">Open media</Link>
      </h3>
      {list.length === 0 ? (
        <p className="px-4 py-4 text-sm text-amber-900">No photos are marked ready for the MLS yet.{sheet.photos.length ? ` ${sheet.photos.length} need checking in the media library.` : ""}</p>
      ) : (
        <ol className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-5 lg:grid-cols-6">
          {list.map((m, i) => (
            <li key={m.id}>
              <Link href={`/media/${m.id}`} className="relative block aspect-[3/2] overflow-hidden rounded-lg bg-soft">
                <MediaPicture m={m} className="h-full w-full" />
                <span className="absolute left-1 top-1 rounded bg-white/95 px-1.5 text-[11px] font-bold">{i + 1}</span>
              </Link>
              <span className="mt-1 block truncate text-[11px] text-muted">{m.caption ?? m.title}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
