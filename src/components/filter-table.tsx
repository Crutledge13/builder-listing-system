"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cx } from "@/lib/format";

// A report list with its own search, filters and sorting. Shows 10 rows and
// folds the rest; printing shows everything that matches.

export type FCell = { text: string; href?: string; sort?: number | string; tone?: "warn" | "bad" | "good" };
export type FRow = { cells: FCell[]; tags?: Record<string, string> };
export type FColumn = { label: string; numeric?: boolean };

const SHOW = 10;
const TAG_LABELS: Record<string, string> = { community: "Community", plan: "Plan", status: "Status" };
const ALL_LABELS: Record<string, string> = { community: "All communities", plan: "All plans", status: "All statuses" };

export function FilterTable({
  columns,
  rows,
  empty,
  filters = [],
  noun = "homes",
  defaultSort,
}: {
  columns: FColumn[];
  rows: FRow[];
  empty: string;
  filters?: string[]; // which tags get a dropdown: community, plan, status
  noun?: string;
  defaultSort?: { col: number; desc: boolean };
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(defaultSort ?? null);
  const [all, setAll] = useState(false);

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

  if (!rows.length) return <p className="px-4 py-4 text-sm text-muted">{empty}</p>;
  const visibleFilters = filters.filter((f) => (options[f]?.length ?? 0) > 1);
  const filtering = !!q.trim() || Object.values(picked).some(Boolean);

  return (
    <div>
      {(rows.length > 3 || visibleFilters.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 print:hidden">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this list" aria-label="Search this list" className="field-input w-48 py-1.5 text-sm" />
          {visibleFilters.map((f) => (
            <select key={f} value={picked[f] ?? ""} onChange={(e) => setPicked({ ...picked, [f]: e.target.value })} className="field-input w-auto py-1.5 text-sm" aria-label={TAG_LABELS[f] ?? f}>
              <option value="">{ALL_LABELS[f] ?? "All"}</option>
              {options[f].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
          {filtering && <button type="button" onClick={() => { setQ(""); setPicked({}); }} className="text-sm font-semibold underline">Clear</button>}
          <span className="ml-auto text-xs text-muted">{shown.length === rows.length ? `${rows.length} ${noun}` : `${shown.length} of ${rows.length} ${noun}`}</span>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">Nothing matches. <button type="button" onClick={() => { setQ(""); setPicked({}); }} className="underline">Clear the filters</button></p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                {columns.map((c, i) => (
                  <th key={c.label} className={cx("px-4 py-2 font-medium", c.numeric && "text-right")}>
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
                <tr key={i} className={cx(!all && i >= SHOW && "hidden print:table-row")}>
                  {r.cells.map((c, j) => (
                    <td key={j} className={cx("px-4 py-2", columns[j]?.numeric && "text-right tabular-nums", c.tone === "warn" && "font-semibold text-amber-900", c.tone === "bad" && "font-semibold text-red-800", c.tone === "good" && "font-semibold text-emerald-800")}>
                      {c.href ? <Link href={c.href} className="font-medium hover:underline">{c.text}</Link> : c.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > SHOW && (
        <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-line px-4 py-2.5 text-left text-sm font-semibold text-accent print:hidden">
          {all ? "Show fewer" : `Show all ${shown.length} ${noun}`}
        </button>
      )}
    </div>
  );
}
