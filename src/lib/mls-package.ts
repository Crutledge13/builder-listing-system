// One home's MLS listing, worked out once, in the MLS's own tab and field order.
//
// Today people read it on the MLS sheet and type it into Matrix by hand
// (our team, a builder who enters its own listings, or the builder's broker).
// It is also the exact listing a future automatic upload would send, if the
// MLS ever approves one for us (NTREIS has offered a listing-input API to
// vendors). Keeping both on this one package means the upload would send
// precisely what people see and check on the sheet, field for field, under
// RESO names. Nothing here sends anything anywhere: per CLAUDE.md, nothing
// may send data to the MLS until the owners change that rule.

import { formatMls, resolveField, type MlsField, type MlsType, type ResolvedValue } from "@/lib/mls-fields";
import type { MlsSheet } from "@/lib/mls-sheet";
import type { Room } from "@/lib/rooms";

export type MlsLine = {
  key: string;            // RESO name; also the tick key saved on the task
  label: string;          // the MLS's own label, as Matrix shows it
  type: MlsType;
  required: boolean;
  hint?: string;
  value: unknown;         // the stored value (RESO format)
  text: string;           // how it reads on the sheet
  paste: string;          // what the Copy button puts on the clipboard
  choices: string[];      // pick-list answers to tick or pick, in the MLS's spelling
  from: ResolvedValue["from"];
  missing: boolean;
  agentSets: boolean;     // the listing agent's own answer (list date, agreement type...), not the builder's
};

export type MlsTab = { title: string; lines: MlsLine[] };

export type MlsPackage = {
  board: string | null;
  tabs: MlsTab[];
  rooms: Room[];
  photos: { id: string; order: number; caption: string | null }[];
  videos: { id: string; title: string }[];
  tours: { url: string; branded: boolean; provider: string }[];
};

// Pick-list answers come back as a list; plain answers as one string.
const PICK: MlsType[] = ["select", "yesno", "multi"];

// What to paste: numbers without "$" or commas (Matrix's number boxes refuse them).
function pasteText(f: MlsField, v: unknown, text: string) {
  if (f.type === "money" || f.type === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : text;
  }
  return text;
}

export function buildLine(f: MlsField, sheet: Pick<MlsSheet, "home" | "homeDetails" | "communityDetails">): MlsLine {
  const r = resolveField(f, sheet.home, sheet.homeDetails, sheet.communityDetails);
  const missing = r.from === "missing";
  const text = missing ? "" : formatMls(f, r.value);
  const choices = !missing && PICK.includes(f.type) ? (Array.isArray(r.value) ? r.value.map(String) : [String(r.value)]) : [];
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    required: !!f.required,
    hint: f.hint,
    value: missing ? null : r.value,
    text,
    paste: missing ? "" : pasteText(f, r.value, text),
    choices,
    from: r.from,
    missing,
    agentSets: f.source === "detail",
  };
}

export function buildMlsPackage(sheet: MlsSheet): MlsPackage {
  return {
    board: sheet.board?.code ?? null,
    tabs: sheet.sections.map((s) => ({ title: s.title, lines: s.fields.map((f) => buildLine(f, sheet)) })),
    rooms: sheet.rooms,
    photos: sheet.mlsPhotos.map((m, i) => ({ id: m.id, order: i + 1, caption: m.caption ?? null })),
    videos: sheet.videos.map((v) => ({ id: v.id, title: v.title })),
    tours: sheet.tours.filter((t) => !t.branded).map((t) => ({ url: t.url, branded: t.branded, provider: t.provider })),
  };
}

// The listing as one flat RESO record (field name -> value, plus Rooms),
// which is the shape an MLS listing-input API takes. Not sent anywhere today.
export function asResoRecord(pkg: MlsPackage): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const tab of pkg.tabs) for (const l of tab.lines) if (!l.missing) out[l.key] = l.value;
  if (pkg.rooms.length) out.Rooms = pkg.rooms;
  return out;
}

// The lines a person actually enters: everything with a value.
// Empty optional boxes are left blank in the MLS, so they're not work.
export const toEnter = (tab: MlsTab) => tab.lines.filter((l) => !l.missing);
export const missingRequired = (tab: MlsTab) => tab.lines.filter((l) => l.missing && l.required);
export const leftBlank = (tab: MlsTab) => tab.lines.filter((l) => l.missing && !l.required);

// A room line can be ticked when it has a size to enter.
export const roomKey = (i: number) => `room-${i}`;
