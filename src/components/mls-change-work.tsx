import type { ReactNode } from "react";
import { CONDITION, formatMls, MLS_FIELD_FOR_COLUMN } from "@/lib/mls-fields";
import { money } from "@/lib/format";
import { CopyRow } from "@/components/mls-sheet-client";

// Pieces shared by the smaller MLS work orders (updates, status changes, open
// houses) on our team's task page and the broker's work order: one plain
// sentence saying what to do, the lines to change (click to copy), and one
// finish box at the bottom. No tick per line (owners, 31 Oct 2026).

export function showValue(key: string, v: unknown) {
  if (v === null || v === undefined || v === "") return "";
  if (key === "build_stage") return CONDITION[String(v)] ?? String(v);
  if (key === "close_price") return money(v as number);
  if (key === "close_date" || key === "purchase_contract_date") return formatMls({ type: "date" }, v);
  const f = MLS_FIELD_FOR_COLUMN[key];
  return f ? formatMls(f, v) : String(v);
}

// What to paste: plain digits for money and numbers (Matrix refuses $ and commas).
function pasteValue(key: string, v: unknown, text: string) {
  const f = MLS_FIELD_FOR_COLUMN[key];
  if (key === "close_price" || f?.type === "money" || f?.type === "number") {
    const n = Number(v);
    if (Number.isFinite(n)) return String(Math.round(n * 100) / 100);
  }
  return text;
}

export type Change = { label: string; from: unknown; to: unknown };

// missingText: what an empty new value means. Updates leave it out ("clear
// it"); status changes say the detail wasn't given.
export function ChangeRows({ entries, showBefore = true, missingText }: { entries: [string, Change][]; showBefore?: boolean; missingText?: string }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
      {entries.map(([key, c]) => {
        const f = MLS_FIELD_FOR_COLUMN[key];
        const to = showValue(key, c.to);
        const incentive = key.startsWith("incentive:");
        const label = f?.label ?? c.label;
        const sub = incentive ? "In the description (no agent pay)" : undefined;
        if (!to && missingText && !incentive) {
          return <CopyRow key={key} label={label} value={<span className="text-amber-900">{missingText}</span>} paste="" />;
        }
        const value = to || (incentive ? "Take it out: it ended" : "(clear it)");
        return (
          <CopyRow
            key={key}
            label={label}
            sub={sub}
            before={showBefore ? showValue(key, c.from) : undefined}
            value={value}
            paste={to ? pasteValue(key, c.to, to) : ""}
            long={to.length > 60}
          />
        );
      })}
    </div>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-base leading-relaxed">{children}</p>;
}

// The one box at the bottom that finishes the work order.
export function FinishCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border-2 border-accent p-5 ${className ?? ""}`}>{children}</div>;
}
