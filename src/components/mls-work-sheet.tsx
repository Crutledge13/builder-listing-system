import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/format";
import { buildMlsPackage, leftBlank, roomKey, toEnter, type MlsLine, type MlsTab } from "@/lib/mls-package";
import { sheetRuleProblems } from "@/lib/mls-fields";
import { CopyRow, SheetChecks, SheetTabs, type SheetTabInfo } from "@/components/mls-sheet-client";
import type { MlsSheet } from "@/lib/mls-sheet";
import { MediaPicture } from "@/components/media-tile";
import { TOUR_PROVIDERS } from "@/lib/listing-media";
import { PhotoPackButton } from "@/components/photo-pack-button";
import { endsText } from "@/lib/incentives";
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

// The MLS work sheet (owners, 31 Oct 2026: "the most user-friendly and easy to
// use"). One design for our team, builders who enter their own listings and
// outside brokers. Laid out like Matrix: its tabs down the side in its order,
// one tab at a time, Matrix's exact labels, only the boxes that get a value.
// Click a value to copy it; pick-list answers show as the boxes to tick. One
// "Done" per tab instead of a tick per line. The last tab is the finish:
// photo pack, tours, and whatever `finish` the page passes (MLS number and
// send / mark live). Values come from the listing package (src/lib/mls-package.ts).
//
// broker: photos and videos come through the broker's own checked file links
// (fileBase), and nothing links into the main app. editHref: where our team
// fills in what's missing (the MLS sheet); brokers get none.
export function MlsWorkSheet({
  sheet,
  check,
  fileBase = "/api/media/",
  broker = false,
  editHref,
  finish,
}: {
  sheet: MlsSheet;
  check?: { taskId: string; checked: string[]; action: (taskId: string, item: string, on: boolean) => Promise<void>; disabled?: boolean };
  fileBase?: string;
  broker?: boolean;
  editHref?: string;
  finish?: ReactNode;
}) {
  const pkg = buildMlsPackage(sheet);
  const roomsAt = pkg.tabs.findIndex((t) => /rooms/i.test(t.title));
  const remarksAt = pkg.tabs.findIndex((t) => /remarks/i.test(t.title));
  const roomItems = sheet.rooms.map((r, i) => (r.RoomLength && r.RoomWidth ? roomKey(i) : null)).filter((x): x is string => !!x);

  const tabs: SheetTabInfo[] = pkg.tabs.map((t, i) => {
    const items = [...toEnter(t).map((l) => l.key), ...(i === roomsAt ? roomItems : [])];
    return { id: `tab-${i}`, title: t.title, items, count: items.length };
  });
  const panels: ReactNode[] = pkg.tabs.map((t, i) => (
    <div key={t.title} className="space-y-4">
      <TabFields tab={t} />
      {i === roomsAt && <RoomRows sheet={sheet} broker={broker} />}
      {i === remarksAt && <Incentives sheet={sheet} />}
    </div>
  ));
  if (roomsAt < 0 && sheet.rooms.length) {
    tabs.push({ id: "rooms", title: "Rooms", items: roomItems, count: roomItems.length });
    panels.push(<RoomRows key="rooms" sheet={sheet} broker={broker} />);
  }
  if (remarksAt < 0 && sheet.incentives.length) panels[panels.length - 1] = <div key="last" className="space-y-4">{panels[panels.length - 1]}<Incentives sheet={sheet} /></div>;
  tabs.push({ id: "finish", title: "Photos and finish", items: [], count: 0 });
  panels.push(<Finish key="finish" sheet={sheet} fileBase={fileBase} broker={broker} finish={finish} />);

  // The few things that aren't on the sheet yet, said once at the top.
  const lines = pkg.tabs.flatMap((t) => t.lines);
  const youType = lines.filter((l) => l.missing && l.agentSets);
  const needBuilder = lines.filter((l) => l.missing && l.required && !l.agentSets);
  const problems = sheetRuleProblems(sheet.sections, sheet.home, sheet.homeDetails, sheet.communityDetails);

  return (
    <SheetChecks taskId={check?.taskId} initial={check?.checked ?? []} action={check?.action} disabled={check?.disabled}>
      {(youType.length > 0 || needBuilder.length > 0 || problems.length > 0) && (
        <div className="mb-6 space-y-2 text-sm">
          {youType.length > 0 && (
            <p className="rounded-xl bg-soft px-4 py-3">
              <b>You type {youType.length === 1 ? "1 box" : `${youType.length} boxes`} yourself:</b> {youType.map((l) => l.label).join(", ")}.
              {editHref && <> Or <Link href={editHref} className="font-semibold text-accent underline">save {youType.length === 1 ? "it" : "them"} on the MLS sheet</Link>.</>}
            </p>
          )}
          {needBuilder.length > 0 && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-950">
              <b>Still blank, needs the builder:</b> {needBuilder.map((l) => l.label).join(", ")}.{" "}
              {editHref ? <Link href={editHref} className="font-semibold underline">Fill {needBuilder.length === 1 ? "it" : "them"} in</Link> : "Send it back to the builder (below) or ask in a note."}
            </p>
          )}
          {problems.map((p) => <p key={p} className="rounded-xl bg-red-50 px-4 py-3 text-red-900">{p}</p>)}
        </div>
      )}
      <SheetTabs tabs={tabs} panels={panels} />
    </SheetChecks>
  );
}

function TabFields({ tab }: { tab: MlsTab }) {
  const shown = tab.lines.filter((l) => !l.missing || l.required);
  const blank = leftBlank(tab);
  return (
    <>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-line px-4 py-5 text-[15px] text-muted">Nothing to type on this tab.</p>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {shown.map((l) => <Line key={l.key} l={l} />)}
        </div>
      )}
      {blank.length > 0 && <p className="text-sm text-muted"><b className="font-semibold text-foreground">Leave blank in the MLS:</b> {blank.map((l) => l.label).join(", ")}</p>}
    </>
  );
}

const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[13rem_minmax(0,1fr)_4.5rem]";

function Line({ l }: { l: MlsLine }) {
  if (l.missing) {
    return (
      <div className={cx(ROW, l.agentSets ? "bg-soft/60" : "bg-amber-50/70")}>
        <span className="col-span-2 text-sm text-muted sm:col-span-1">{l.label}</span>
        <span className={cx("col-span-2 text-[15px] font-semibold sm:col-span-1", l.agentSets ? "text-muted" : "text-amber-900")}>
          {l.agentSets ? "You type this" : "Missing: needs the builder"}
        </span>
      </div>
    );
  }
  if (l.choices.length > 0) {
    const multi = l.type === "multi";
    return (
      <div className={ROW}>
        <span className="col-span-2 text-sm text-muted sm:col-span-1">{l.label}</span>
        <span className="flex flex-wrap gap-1.5">
          {l.choices.map((c) => (
            <span key={c} className="inline-flex items-center gap-2 rounded-lg bg-accent-soft py-1 pl-2 pr-2.5 text-[15px] font-semibold text-[#23389a]">
              <span className={cx("inline-flex h-3.5 w-3.5 items-center justify-center bg-accent", multi ? "rounded-[3px]" : "rounded-full")}>
                {multi && <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              {c}
            </span>
          ))}
        </span>
        <span className="justify-self-end text-xs text-muted">{multi ? (l.choices.length > 1 ? "Tick these" : "Tick this") : "Pick this"}</span>
      </div>
    );
  }
  return <CopyRow label={l.label} sub={l.hint} value={l.text} paste={l.paste} long={l.type === "longtext"} />;
}

// Matrix's room rows: type, level, length and width.
function RoomRows({ sheet, broker }: { sheet: MlsSheet; broker: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] gap-4 bg-soft px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted">
        <span>Room list: one row each</span><span>Level</span><span>Length</span><span>Width</span>
      </div>
      {sheet.rooms.length === 0 ? (
        <p className="bg-amber-50/70 px-4 py-3 text-sm text-amber-900">{broker ? "No room sizes yet. Leave the builder a note if the MLS needs them." : "No room sizes yet. The builder fills them from the floor plan on the home page."}</p>
      ) : (
        <div className="divide-y divide-line">
          {sheet.rooms.map((r, i) => (
            <div key={i} className="grid min-h-11 grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] items-center gap-4 px-4 py-2 text-[15px]">
              <span className="font-semibold">{r.RoomType}</span>
              <span>{r.RoomLevel ?? "—"}</span>
              <span className={cx("tabular-nums", !r.RoomLength && "text-amber-900")}>{r.RoomLength ? Number(r.RoomLength) : "?"}</span>
              <span className={cx("tabular-nums", !r.RoomWidth && "text-amber-900")}>{r.RoomWidth ? Number(r.RoomWidth) : "?"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Current incentives, to work into the description (buyer incentives only).
function Incentives({ sheet }: { sheet: MlsSheet }) {
  if (!sheet.incentives.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <p className="bg-soft px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted">Incentives to mention in the description</p>
      <div className="divide-y divide-line">
        {sheet.incentives.map((i) => {
          const text = `${i.title}${i.details ? `: ${i.details}` : ""}`;
          return <CopyRow key={i.id} label={i.title} sub={endsText(i.ends_on)} value={i.details ?? i.title} paste={text} long />;
        })}
      </div>
    </div>
  );
}

// The last tab: photo pack, video and tours, then the page's own finish
// (MLS number and send, or mark live).
function Finish({ sheet, fileBase, broker, finish }: { sheet: MlsSheet; fileBase: string; broker: boolean; finish?: ReactNode }) {
  const list = sheet.mlsPhotos;
  const unbranded = sheet.tours.filter((t) => !t.branded);
  const tours = unbranded.length ? unbranded : sheet.tours;
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[15px]">
            {list.length ? <><b>{list.length} photos</b>, numbered in MLS order. Photo 1 is the main photo.</> : <span className="text-amber-900">No photos are marked ready for the MLS yet.</span>}
          </span>
          {list.length > 0 && <PhotoPackButton name={`mls-photos-${slug(sheet.home.unparsed_address)}`} photos={packPhotos(list)} readme={packReadme(sheet)} size={{ long_edge: 2048, format: "jpeg", quality: 85 }} fileBase={fileBase} />}
        </div>
        {list.length > 0 && (
          <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {list.slice(0, 12).map((m, i) => (
              <li key={m.id}>
                <Link href={broker ? `${fileBase}${m.id}?size=web` : `/media/${m.id}`} target={broker ? "_blank" : undefined} prefetch={broker ? false : undefined} className="relative block aspect-[3/2] overflow-hidden rounded-lg bg-soft">
                  <MediaPicture m={m} className="h-full w-full" fileBase={fileBase} />
                  <span className="absolute left-1 top-1 rounded bg-white/95 px-1.5 text-xs font-extrabold">{i + 1}</span>
                </Link>
                <span className="mt-1 block truncate text-xs text-muted">{m.room ?? m.caption ?? m.title}</span>
              </li>
            ))}
          </ol>
        )}
        {list.length > 12 && <p className="text-sm text-muted">+ {list.length - 12} more in the pack</p>}
        {sheet.photos.length > list.length && <p className="text-sm text-amber-900">{sheet.photos.length - list.length} more on the listing aren&rsquo;t MLS-ready yet, so they&rsquo;re left out.</p>}
        {!broker && <Link href={`/homes/${sheet.home.id}#listing-media`} className="inline-block text-sm font-semibold text-accent underline">Change what&rsquo;s on the listing</Link>}
      </div>

      {(tours.length > 0 || sheet.videos.length > 0) && (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {tours.map((t) => (
            <CopyRow key={t.id} label={`Virtual tour${t.branded ? " (branded)" : ""}`} sub={TOUR_PROVIDERS[t.provider]} value={<span className="text-[15px] font-semibold break-all">{t.url}</span>} paste={t.url} />
          ))}
          {sheet.videos.map((v) => (
            <div key={v.id} className={ROW}>
              <span className="col-span-2 text-sm text-muted sm:col-span-1">Video</span>
              <span className="text-[15px] font-semibold">{v.title}</span>
              <a href={`${fileBase}${v.id}?download=1`} className="justify-self-end text-sm font-bold text-accent">Download</a>
            </div>
          ))}
        </div>
      )}

      {finish}
    </div>
  );
}
