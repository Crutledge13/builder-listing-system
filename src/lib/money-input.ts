// Price boxes show thousands commas ("389,990"). Used on the server for the
// starting value and in the browser while typing (MoneyCommas).

// "389990" -> "389,990". Keeps a decimal point and up to two cents digits as
// typed; drops anything else ("$", letters, extra commas).
export function withCommas(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "";
  // A stored amount: whole dollars show without ".00".
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return "";
    return raw.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  const s = raw.replace(/[^\d.]/g, "");
  if (!s) return "";
  const dot = s.indexOf(".");
  const whole = (dot === -1 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (dot === -1) return grouped;
  return `${grouped || "0"}.${s.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}

// What every price <input> needs: text (a number box can't show commas),
// a number keypad on phones, and the marker MoneyCommas looks for.
export const MONEY_INPUT = { type: "text", inputMode: "decimal", "data-money": "", autoComplete: "off" } as const;
