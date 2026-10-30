import Link from "next/link";
import { cx } from "@/lib/format";
import { buildMlsPackage, leftBlank, missingRequired, roomKey, toEnter, type MlsLine, type MlsTab } from "@/lib/mls-package";
import { SheetChecks, SheetCopy, SheetLineShell, SheetTabs, SheetTick, type SheetTabInfo } from "@/components/mls-sheet-client";
import type { MlsSheet } from "@/lib/mls-sheet";
import { CopyButton } from "@/components/mls-client";
import { IncentiveSheet } from "@/components/mls-sheet";
import { MediaPicture } from "@/components/media-tile";
import { TOUR_PROVIDERS } from "@/lib/listing-media";
import { PhotoPackButton } from "@/components/photo-pack-button";
import type { MediaRow } from "@/lib/demo-media";

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

// The whole MLS entry, laid out like Matrix: its tabs in its order, each tab
// showing only the boxes that get something, in Matrix's own wording. Pick-list
// answers show as the boxes to tick; typed values have a Copy button that also
// ticks the line. Empty optional boxes are listed once at the bottom of each
// tab ("leave blank"). The values come from the listing package
// (src/lib/mls-package.ts), the same record a future automatic upload would send.
//
// Used only on the broker's work sheets (owners, 29 Oct 2026); our team and
// builders keep the original MlsSheetView. broker: photos and videos come through the
// broker's own checked file links (fileBase), and nothing links into the main app.
export function BrokerMlsSheet({
  sheet,
  check,
  fileBase = "/api/media/",
  broker = false,
  stickyClass,
}: {
  sheet: MlsSheet;
  check?: { taskId: string; checked: string[]; action: (taskId: string, item: string, on: boolean) => Promise<void>; disabled?: boolean };
  fileBase?: string;
  broker?: boolean;
  stickyClass?: string;
}) {
  const pkg = buildMlsPackage(sheet);
  const roomsAt = pkg.tabs.findIndex((t) => /rooms/i.test(t.title));
  const remarksAt = pkg.tabs.findIndex((t) => /remarks/i.test(t.title));
  const roomItems = sheet.rooms.map((r, i) => (r.RoomLength && r.RoomWidth ? roomKey(i) : null)).filter((x): x is string => !!x);
  const photoItems = [...(sheet.mlsPhotos.length ? ["photos"] : []), ...(sheet.videos.length || sheet.tours.length ? ["tours"] : [])];

  const tabs: SheetTabInfo[] = pkg.tabs.map((t, i) => ({
    id: `tab-${i}`,
    title: t.title,
    items: [...toEnter(t).map((l) => l.key), ...(i === roomsAt ? roomItems : [])],
    missing: missingRequired(t).length,
  }));
  const panels = pkg.tabs.map((t, i) => (
    <div key={t.title} className="space-y-4">
      <TabFields tab={t} broker={broker} homeId={sheet.home.id} />
      {i === roomsAt && <RoomRows sheet={sheet} broker={broker} />}
      {i === remarksAt && <IncentiveSheet sheet={sheet} />}
    </div>
  ));
  if (roomsAt < 0 && sheet.rooms.length) {
    tabs.push({ id: "rooms", title: "Rooms", items: roomItems, missing: 0 });
    panels.push(<RoomRows key="rooms" sheet={sheet} broker={broker} />);
  }
  if (remarksAt < 0 && sheet.incentives.length) panels[panels.length - 1] = <div key="last" className="space-y-4">{panels[panels.length - 1]}<IncentiveSheet sheet={sheet} /></div>;
  tabs.push({ id: "photos", title: "Photos and tours", items: photoItems, missing: sheet.mlsPhotos.length ? 0 : 1 });
  panels.push(<PhotoList key="photos" sheet={sheet} fileBase={fileBase} broker={broker} />);

  return (
    <SheetChecks taskId={check?.taskId} initial={check?.checked ?? []} action={check?.action} disabled={check?.disabled}>
      <SheetTabs tabs={tabs} panels={panels} total={tabs.flatMap((t) => t.items)} stickyClass={stickyClass} />
    </SheetChecks>
  );
}

const FROM_CHIP: Record<string, string> = { home: "Builder", builder: "Builder", "this home": "Our team", community: "Community", derived: "Automatic" };

function TabFields({ tab, broker, homeId }: { tab: MlsTab; broker: boolean; homeId: string }) {
  const lines = toEnter(tab);
  const missing = missingRequired(tab);
  const agentMissing = missing.filter((l) => l.agentSets);
  const builderMissing = missing.filter((l) => !l.agentSets);
  const blank = leftBlank(tab);
  return (
    <section className="overflow-hidden rounded-2xl border border-line">
      {agentMissing.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>You set {agentMissing.length === 1 ? "this one" : "these"} in the MLS yourself:</b> {agentMissing.map((l) => l.label).join(", ")}.{" "}
          {!broker && <Link href={`/homes/${homeId}/mls`} className="font-semibold underline">Save {agentMissing.length === 1 ? "it" : "them"} on the MLS sheet</Link>}
        </div>
      )}
      {builderMissing.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>The MLS needs {builderMissing.length === 1 ? "this" : "these"} from the builder, still blank:</b> {builderMissing.map((l) => l.label).join(", ")}.{" "}
          {broker ? "Ask the builder in a note below." : <Link href={`/homes/${homeId}/mls`} className="font-semibold underline">Fill {builderMissing.length === 1 ? "it" : "them"} in</Link>}
        </div>
      )}
      {lines.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">Nothing to enter on this tab.</p>
      ) : (
        <div className="divide-y divide-line">
          {lines.map((l) => <Line key={l.key} l={l} broker={broker} />)}
        </div>
      )}
      {blank.length > 0 && (
        <details className="border-t border-line bg-soft/40 px-4 py-2.5 text-sm">
          <summary className="cursor-pointer text-muted">Leave blank in the MLS ({blank.length})</summary>
          <p className="mt-1.5 text-muted">{blank.map((l) => l.label).join(" · ")}</p>
        </details>
      )}
    </section>
  );
}

function Line({ l, broker }: { l: MlsLine; broker: boolean }) {
  const pick = l.choices.length > 0;
  return (
    <SheetLineShell item={l.key} className="flex items-start gap-3 px-4 py-3">
      <SheetTick item={l.key} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold">{l.label}</span>
          {!broker && <span className="rounded bg-soft px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted">{FROM_CHIP[l.from]}</span>}
        </div>
        {pick ? (
          <div className="sheet-value mt-1.5 flex flex-wrap gap-1.5">
            {l.type === "multi" && <span className="self-center text-xs text-muted">Tick:</span>}
            {l.type !== "multi" && <span className="self-center text-xs text-muted">Pick:</span>}
            {l.choices.map((c) => (
              <span key={c} className="rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 text-[15px] font-semibold text-accent">
                {l.type === "multi" ? "☑ " : ""}{c}
              </span>
            ))}
          </div>
        ) : (
          <div className={cx("sheet-value mt-0.5 whitespace-pre-line break-words", l.type === "longtext" ? "text-[15px]" : "text-lg font-semibold tabular-nums")}>{l.text}</div>
        )}
        {l.hint && <p className="mt-1 text-xs text-muted">{l.hint}</p>}
      </div>
      {!pick && <SheetCopy value={l.paste} item={l.key} />}
    </SheetLineShell>
  );
}

// Matrix's room rows: type, level, length and width, one line each.
function RoomRows({ sheet, broker }: { sheet: MlsSheet; broker: boolean }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line">
      <h3 className="bg-soft px-4 py-2.5 font-semibold">Room list <span className="text-xs font-normal text-muted">add one row per room in the MLS</span></h3>
      {sheet.rooms.length === 0 ? (
        <p className="bg-amber-50/60 px-4 py-3 text-sm text-amber-900">{broker ? "No room sizes yet. Leave the builder a note below if the MLS needs them." : <>No room sizes yet. The builder pulls them from the floor plan on the home page (or our team adds the plan&rsquo;s rooms under Floor plans).</>}</p>
      ) : (
        <div className="divide-y divide-line">
          <div className="grid grid-cols-[1.25rem_1fr_4.5rem_3.5rem_3.5rem] gap-x-3 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span /><span>Type</span><span>Level</span><span>Length</span><span>Width</span>
          </div>
          {sheet.rooms.map((r, i) => {
            const has = !!(r.RoomLength && r.RoomWidth);
            return (
              <SheetLineShell key={i} item={roomKey(i)} className="grid grid-cols-[1.25rem_1fr_4.5rem_3.5rem_3.5rem] items-center gap-x-3 px-4 py-2">
                {has ? <SheetTick item={roomKey(i)} /> : <span />}
                <span className="sheet-value font-medium">{r.RoomType}</span>
                <span className="sheet-value text-sm">{r.RoomLevel ?? "—"}</span>
                <span className={cx("sheet-value tabular-nums", !has && "text-amber-900")}>{r.RoomLength ? Number(r.RoomLength) : "?"}</span>
                <span className={cx("sheet-value tabular-nums", !has && "text-amber-900")}>{r.RoomWidth ? Number(r.RoomWidth) : "?"}</span>
              </SheetLineShell>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PhotoList({ sheet, fileBase, broker }: { sheet: MlsSheet; fileBase: string; broker: boolean }) {
  const list = sheet.mlsPhotos;
  return (
    <section className="overflow-hidden rounded-2xl border border-line">
      <h3 className="flex flex-wrap items-baseline justify-between gap-2 bg-soft px-4 py-2.5 font-semibold">
        <span className="flex items-center gap-3">
          <SheetTick item="photos" />
          Photos, in MLS order ({list.length})
        </span>
        <span className="flex flex-wrap gap-3 text-sm">
          {list.length > 0 && (
            <PhotoPackButton name={`mls-photos-${slug(sheet.home.unparsed_address)}`} photos={packPhotos(list)} readme={packReadme(sheet)} size={{ long_edge: 2048, format: "jpeg", quality: 85 }} fileBase={fileBase} />
          )}
          {!broker && <Link href={`/homes/${sheet.home.id}#listing-media`} className="font-semibold text-accent underline">Change what&rsquo;s on the listing</Link>}
        </span>
      </h3>
      {list.length === 0 ? (
        <p className="px-4 py-4 text-sm text-amber-900">No photos are marked ready for the MLS yet.{sheet.photos.length > list.length ? ` ${sheet.photos.length - list.length} on the listing still need checking.` : ""}</p>
      ) : (
        <ol className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-5 lg:grid-cols-6">
          {list.map((m, i) => (
            <li key={m.id}>
              <Link href={broker ? `${fileBase}${m.id}?size=web` : `/media/${m.id}`} target={broker ? "_blank" : undefined} prefetch={broker ? false : undefined} className="relative block aspect-[3/2] overflow-hidden rounded-lg bg-soft">
                <MediaPicture m={m} className="h-full w-full" fileBase={fileBase} />
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
            <SheetTick item="tours" />
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
                <a href={`${fileBase}${v.id}?download=1`} className="text-accent underline">Download</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
