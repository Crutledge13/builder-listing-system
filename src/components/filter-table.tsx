"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { cx } from "@/lib/format";

// A report list with its own search, filters and sorting. Shows 10 rows and
// folds the rest; printing shows everything that matches.
//
// On phones (owners, 30 Oct 2026): when rows carry a `summary`, the list opens
// as stacked two- or three-line rows (title and its key number, one grey line,
// small status chips), with what needs the person first. A Summary / All
// details switch shows the full table instead, scrolling sideways with the
// first column pinned. Each phone remembers its choice per list. Computers
// always get the full table.

export type FCell = { text: string; href?: string; sort?: number | string; tone?: "warn" | "bad" | "good" };
export type FChip = { text: string; tone?: "warn" | "good" | "accent" | "muted" };
export type FSummary = {
  title: string;
  href?: string;
  right?: { text: string; tone?: "warn" | "muted" };
  owner?: string; // a line of its own in dark type (our staff: the builder's name)
  sub?: string;
  chips?: FChip[];
  flag?: boolean; // needs the person: shown first until they pick a sort
};
export type FRow = { cells: FCell[]; tags?: Record<string, string>; summary?: FSummary };
export type FColumn = { label: string; numeric?: boolean };

const SHOW = 10;
const TAG_LABELS: Record<string, string> = { community: "Community", plan: "Plan", status: "Status", sale: "Sale", stage: "Stage", builder: "Builder", city: "City" };
const ALL_LABELS: Record<string, string> = { community: "All communities", plan: "All plans", status: "All statuses", sale: "Any sale status", stage: "Any stage", builder: "All builders", city: "All cities" };
const CHIP: Record<NonNullable<FChip["tone"]>, string> = {
  warn: "bg-amber-50 text-amber-900",
  good: "bg-emerald-50 text-emerald-800",
  accent: "bg-accent-soft text-accent",
  muted: "bg-soft text-muted",
};

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function readMode(key: string): "summary" | "details" | null {
  try {
    const v = localStorage.getItem(key);
    return v === "details" || v === "summary" ? v : null;
  } catch {
    return null;
  }
}

export function FilterTable({
  columns,
  rows,
  empty,
  filters = [],
  noun = "homes",
  defaultSort,
  pageSize = SHOW,
  minWidth = 640,
}: {
  columns: FColumn[];
  rows: FRow[];
  empty: string;
  filters?: string[]; // which tags get a dropdown: community, plan, status
  noun?: string;
  defaultSort?: { col: number; desc: boolean };
  pageSize?: number; // rows shown before "Show all" (list views show far more)
  minWidth?: number; // wider tables scroll sideways on phones
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(defaultSort ?? null);
  const [all, setAll] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasSummary = rows.some((r) => r.summary);
  const modeKey = `list_mode_${noun}`;
  // The phone's remembered choice; the server always draws the summary.
  const stored = useSyncExternalStore(subscribeStorage, () => readMode(modeKey), () => null);
  const [chosen, setChosen] = useState<"summary" | "details" | null>(null);
  const mode = chosen ?? stored ?? "summary";
  const pickMode = (m: "summary" | "details") => {
    setChosen(m);
    try { localStorage.setItem(modeKey, m); } catch {}
  };

  const options = useMemo(
    () => Object.fromEntries(filters.map((f) => [f, [...new Set(rows.map((r) => r.tags?.[f]).filter((v): v is string => !!v))].sort()])),
    [filters, rows],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter(
      (r) =>
        (!needle || r.cells.some((c) => c.text.toLowerCase().includes(needle))) &&
        Object.entries(picked).every(([k, v]) => !v || r.tags?.[k] === v),
    );
    if (sort) {
      const val = (r: FRow) => r.cells[sort.col]?.sort ?? r.cells[sort.col]?.text ?? "";
      out = [...out].sort((a, b) => {
        const x = val(a), y = val(b);
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return sort.desc ? -c : c;
      });
    }
    return out;
  }, [rows, q, picked, sort]);

  // The phone summary: what needs the person first, until they pick a sort.
  const summaryRows = useMemo(
    () => (sort ? shown : [...shown].sort((a, b) => Number(!!b.summary?.flag) - Number(!!a.summary?.flag))),
    [shown, sort],
  );

  if (!rows.length) return <p className="px-4 py-4 text-sm text-muted">{empty}</p>;
  const visibleFilters = filters.filter((f) => (options[f]?.length ?? 0) > 1);
  const filtering = !!q.trim() || Object.values(picked).some(Boolean);
  const pickedCount = Object.values(picked).filter(Boolean).length;
  const clear = () => { setQ(""); setPicked({}); };

  const table = (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm" style={{ minWidth }}>
        <thead>
          <tr className="text-left text-xs text-muted">
            {columns.map((c, i) => (
              <th key={c.label} className={cx("px-4 py-2 font-medium", c.numeric && "text-right", i === 0 && "max-sm:w-40 sticky left-0 z-[1] bg-white max-sm:shadow-[inset_-1px_0_0_var(--color-line)]")}>
                <button
                  type="button"
                  onClick={() => setSort(sort?.col === i ? { col: i, desc: !sort.desc } : { col: i, desc: !!c.numeric })}
                  className="inline-flex items-center gap-1 hover:text-foreground print:pointer-events-none"
                  title="Sort"
                >
                  {c.label}
                  <span aria-hidden className={sort?.col === i ? "text-foreground" : "opacity-30"}>{sort?.col === i && !sort.desc ? "▲" : "▼"}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((r, i) => (
            <tr key={i} className={cx(!all && i >= pageSize && "hidden print:table-row")}>
              {r.cells.map((c, j) => (
                <td key={j} className={cx("px-4 py-2", columns[j]?.numeric && "text-right tabular-nums", j === 0 && "sticky left-0 z-[1] bg-white max-sm:shadow-[inset_-1px_0_0_var(--color-line)]", c.tone === "warn" && "font-semibold text-amber-900", c.tone === "bad" && "font-semibold text-red-800", c.tone === "good" && "font-semibold text-emerald-800")}>
                  {c.href ? <Link href={c.href} className="font-medium hover:underline">{c.text}</Link> : c.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const summary = (
    <ul className="divide-y divide-line">
      {summaryRows.map((r, i) => {
        const s = r.summary ?? { title: r.cells[0]?.text ?? "", href: r.cells[0]?.href };
        const body = (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[15px] font-semibold">{s.title}</span>
                {s.right && (
                  <span className={cx("shrink-0 text-[13px]", s.right.tone === "warn" ? "font-semibold text-amber-900" : s.right.tone === "muted" ? "text-muted" : "font-semibold")}>
                    {s.right.text}
                  </span>
                )}
              </div>
              {s.owner && <p className="mt-0.5 truncate text-[13px] font-semibold">{s.owner}</p>}
              {s.sub && <p className="mt-0.5 truncate text-[13px] text-muted">{s.sub}</p>}
              {!!s.chips?.length && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {s.chips.map((c) => (
                    <span key={c.text} className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", CHIP[c.tone ?? "muted"])}>{c.text}</span>
                  ))}
                </div>
              )}
            </div>
            {s.href && (
              <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-muted" aria-hidden><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </>
        );
        return (
          <li key={i} className={cx(!all && i >= pageSize && "hidden")}>
            {s.href ? (
              <Link href={s.href} className="flex items-center gap-3 px-4 py-2.5 active:bg-soft">{body}</Link>
            ) : (
              <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      {(rows.length > 3 || visibleFilters.length > 0 || hasSummary) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 print:hidden">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this list" aria-label="Search this list" className="field-input min-w-0 flex-1 py-1.5 text-sm sm:w-48 sm:flex-none" />
          {visibleFilters.length > 0 && (
            <button
              type="button"
              onClick={() => setFiltersOpen(!filtersOpen)}
              aria-expanded={filtersOpen}
              className={cx("shrink-0 rounded-lg border px-3 py-1.5 text-sm font-semibold sm:hidden", pickedCount ? "border-accent text-accent" : "border-line")}
            >
              Filter{pickedCount ? ` (${pickedCount})` : ""}
            </button>
          )}
          <div className={cx("w-full flex-wrap gap-2 sm:contents", filtersOpen ? "flex" : "hidden")}>
            {visibleFilters.map((f) => (
              <select key={f} value={picked[f] ?? ""} onChange={(e) => setPicked({ ...picked, [f]: e.target.value })} className="field-input w-auto min-w-0 flex-1 py-1.5 text-sm sm:flex-none" aria-label={TAG_LABELS[f] ?? f}>
                <option value="">{ALL_LABELS[f] ?? "All"}</option>
                {options[f].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}
          </div>
          {filtering && <button type="button" onClick={clear} className="text-sm font-semibold underline">Clear</button>}
          <span className="ml-auto text-xs text-muted">{shown.length === rows.length ? `${rows.length} ${noun}` : `${shown.length} of ${rows.length} ${noun}`}</span>
          {hasSummary && (
            <div className="flex w-full items-center gap-2 sm:hidden">
              <div className="flex flex-1 rounded-lg bg-soft p-0.5" role="group" aria-label="Show">
                {(["summary", "details"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => pickMode(m)}
                    aria-pressed={mode === m}
                    className={cx("flex-1 rounded-md px-2 py-1.5 text-sm font-semibold", mode === m ? "bg-white shadow-sm" : "text-muted")}
                  >
                    {m === "summary" ? "Summary" : "All details"}
                  </button>
                ))}
              </div>
              {mode === "summary" && (
                <select
                  value={sort ? `${sort.col}:${sort.desc ? "d" : "a"}` : ""}
                  onChange={(e) => {
                    const [c, d] = e.target.value.split(":");
                    setSort(e.target.value ? { col: Number(c), desc: d === "d" } : null);
                  }}
                  className="field-input w-auto min-w-0 max-w-[45%] py-1.5 text-sm"
                  aria-label="Sort"
                >
                  <option value="">Needs attention first</option>
                  {columns.map((c, i) => (
                    <option key={c.label} value={`${i}:${c.numeric ? "d" : "a"}`}>Sort: {c.label}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">Nothing matches. <button type="button" onClick={clear} className="underline">Clear the filters</button></p>
      ) : hasSummary ? (
        <>
          <div className="sm:hidden print:hidden">
            {mode === "summary" ? summary : table}
            {mode === "details" && <p className="px-4 py-2 text-xs text-muted">Swipe sideways for more columns.</p>}
          </div>
          <div className="hidden sm:block print:block">{table}</div>
        </>
      ) : (
        table
      )}
      {shown.length > pageSize && (
        <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-line px-4 py-2.5 text-left text-sm font-semibold text-accent print:hidden">
          {all ? "Show fewer" : `Show all ${shown.length} ${noun}`}
        </button>
      )}
    </div>
  );
}
