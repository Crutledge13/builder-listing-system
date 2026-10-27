import Link from "next/link";
import { cx } from "@/lib/format";
import { formatMls, resolveField, sheetRuleProblems, type MlsField } from "@/lib/mls-fields";
import type { MlsSheet } from "@/lib/mls-sheet";
import { CheckOff, CopyButton } from "@/components/mls-client";
import { MediaPicture } from "@/components/media-tile";
import { TOUR_PROVIDERS } from "@/lib/listing-media";
import { PhotoPackButton } from "@/components/photo-pack-button";
import type { MediaRow } from "@/lib/demo-media";
import { levelLabel } from "@/lib/rooms";
import { endsText } from "@/lib/incentives";

function slug(s: string) {
  return s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 40) || "photo";
}

// Photo pack file names, in MLS order: 01-exterior, 02-kitchen, ...
function packPhotos(list: MediaRow[]) {
  return list.map((m, i) => ({ id: m.id, label: `${String(i + 1).padStart(2, "0")}-${slug(m.room ?? m.caption ?? m.title)}`, file: m.source === "upload" }));
}

function packReadme(sheet: MlsSheet) {
  const lines = [
    `MLS photo pack for ${sheet.home.unparsed_address}`,
    `${sheet.mlsPhotos.length} MLS-ready photos, numbered in MLS order. Upload them in this order; the first is the main photo.`,
    "",
  ];
  if (sheet.tours.length) {
    lines.push("Virtual tours (use the unbranded links on the MLS):");
    for (const t of sheet.tours) lines.push(`- ${t.title ?? TOUR_PROVIDERS[t.provider]} (${TOUR_PROVIDERS[t.provider]}, ${t.branded ? "branded" : "unbranded"}): ${t.url}`);
    lines.push("");
  }
  if (sheet.videos.length) {
    lines.push("Videos (download each from the MLS sheet):", ...sheet.videos.map((v) => `- ${v.title}`), "");
  }
  return lines.join("\n");
}

const FROM_TEXT: Record<string, string> = {
  home: "Builder",
  builder: "Builder",
  "this home": "Our team",
  community: "Community",
  derived: "Automatic",
};

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
      {sheet.sections.map((section) => {
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
      <RoomList sheet={sheet} check={check} />
      <IncentiveSheet sheet={sheet} />
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
        <span className="flex flex-wrap gap-3 text-sm">
          {list.length > 0 && (
            <PhotoPackButton name={`mls-photos-${slug(sheet.home.unparsed_address)}`} photos={packPhotos(list)} readme={packReadme(sheet)} size={{ long_edge: 2048, format: "jpeg", quality: 85 }} />
          )}
          <Link href={`/homes/${sheet.home.id}#listing-media`} className="font-semibold text-accent underline">Change what&rsquo;s on the listing</Link>
        </span>
      </h3>
      {list.length === 0 ? (
        <p className="px-4 py-4 text-sm text-amber-900">No photos are marked ready for the MLS yet.{sheet.photos.length > list.length ? ` ${sheet.photos.length - list.length} on the listing still need checking.` : ""}</p>
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
      {sheet.photos.length > list.length && list.length > 0 && (
        <p className="border-t border-line px-4 py-2 text-xs text-amber-900">
          {sheet.photos.length - list.length} more on the listing aren&rsquo;t MLS-ready yet (AI warnings or not checked), so they&rsquo;re left out.
        </p>
      )}
      {(sheet.videos.length > 0 || sheet.tours.length > 0) && (
        <div className="border-t border-line px-4 py-3">
          <h4 className="flex items-center gap-3 text-sm font-semibold">
            {check && <CheckOff taskId={check.taskId} item="tours" initial={check.checked.includes("tours")} action={check.action} disabled={check.disabled} />}
            Video and virtual tours
          </h4>
          <p className="mt-0.5 text-xs text-muted">Enter the unbranded tour links on the MLS. Video files can be downloaded here.</p>
          <ul className="mt-2 space-y-2 text-sm">
            {sheet.tours.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.title ?? TOUR_PROVIDERS[t.provider]}</span>
                <span className="rounded bg-soft px-1.5 py-px text-[10px] font-semibold uppercase text-muted">{TOUR_PROVIDERS[t.provider]}</span>
                <span className={cx("rounded px-1.5 py-px text-[10px] font-semibold uppercase", t.branded ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700")}>{t.branded ? "Branded" : "Unbranded"}</span>
                <a href={t.url} target="_blank" rel="noopener noreferrer" className="min-w-0 max-w-[24rem] truncate text-accent underline">{t.url}</a>
                <CopyButton value={t.url} />
              </li>
            ))}
            {sheet.videos.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Video: {v.title}</span>
                <a href={`/api/media/${v.id}?download=1`} className="text-accent underline">Download</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// The home's room list (Rooms tab in Matrix): type, level, length × width.
export function RoomList({ sheet, check }: { sheet: MlsSheet; check?: Parameters<typeof MlsSheetView>[0]["check"] }) {
  if (sheet.board?.code && sheet.board.code !== "NTREIS" && !sheet.rooms.length) return null;
  const done = check ? sheet.rooms.filter((_, i) => check.checked.includes(`room-${i}`)).length : 0;
  return (
    <section className="overflow-hidden rounded-2xl border border-line">
      <h3 className="flex items-baseline justify-between bg-soft px-4 py-2.5 font-semibold">
        Room sizes
        {check && sheet.rooms.length > 0 && <span className="text-xs font-normal text-muted">{done} of {sheet.rooms.length} entered</span>}
      </h3>
      {sheet.rooms.length === 0 ? (
        <p className="bg-amber-50/60 px-4 py-3 text-sm text-amber-900">No room sizes yet. The builder pulls them from the floor plan on the home page (or our team adds the plan&rsquo;s rooms under Floor plans).</p>
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
