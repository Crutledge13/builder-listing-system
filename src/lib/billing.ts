// Billing builders: labels and formatting shared by Admin > Billing, the
// invoice page and the builder owner's Billing page. The rules (what gets
// charged when, who sees what) live in the database: migration
// 20261028000052_billing.sql.

export type Plan = "software" | "listing_service";
export type ChargeKind = "software" | "listing" | "relist" | "photos" | "onboarding" | "adjustment";
export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export type Charge = {
  id: string;
  builder_id: string;
  kind: ChargeKind;
  home_id: string | null;
  description: string;
  details: { need: string; label: string; amount_cents: number }[];
  amount_cents: number;
  occurred_on: string;
  invoice_month: string;
  invoice_id: string | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
};
export const CHARGE_SELECT =
  "id, builder_id, kind, home_id, description, details, amount_cents, occurred_on, invoice_month, invoice_id, created_at, voided_at, void_reason";

export type Invoice = {
  id: string;
  builder_id: string;
  period_month: string;
  status: InvoiceStatus;
  number: string | null;
  total_cents: number;
  issued_on: string | null;
  due_on: string | null;
  sent_at: string | null;
  paid_at: string | null;
  paid_note: string | null;
  voided_at: string | null;
  void_reason: string | null;
  notes: string | null;
  quickbooks_invoice_id: string | null;
};
export const INVOICE_SELECT =
  "id, builder_id, period_month, status, number, total_cents, issued_on, due_on, sent_at, paid_at, paid_note, voided_at, void_reason, notes, quickbooks_invoice_id";

export type BillingDefaults = {
  software_fee_cents: number;
  listing_fee_cents: number;
  relist_fee_cents: number;
  onboarding_fee_cents: number;
  net_days: number;
  photo_prices: Record<string, number>;
};

export function planLabel(plan: string | null | undefined, photos?: boolean | null) {
  if (!plan) return "Not set up";
  const base = plan === "software" ? "Software" : "Listing Service+";
  return photos ? `${base} + Photos` : base;
}

export const PLAN_HELP: Record<Plan, string> = {
  software: "A monthly software fee, billed at the start of each month. No per-listing fees.",
  listing_service:
    "Software included. A fee per listing when the builder approves it for the MLS, and a relist fee when a paused or withdrawn listing goes back on the market.",
};

// In the order they print on an invoice.
export const KIND_LABELS: Record<ChargeKind, string> = {
  software: "Software",
  onboarding: "Onboarding",
  listing: "Listings",
  relist: "Relists",
  photos: "Photo shoots",
  adjustment: "Adjustments and credits",
};
export const KIND_ORDER = Object.keys(KIND_LABELS) as ChargeKind[];

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; style: string }> = {
  draft: { label: "Draft, not sent", style: "bg-amber-100 text-amber-900" },
  sent: { label: "Sent, unpaid", style: "bg-accent-soft text-accent" },
  paid: { label: "Paid", style: "bg-emerald-100 text-emerald-800" },
  void: { label: "Voided", style: "bg-soft text-muted line-through" },
};

// Dollars with cents ($4,000.00), negative as -$50.00.
export function usd(cents: number | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents ?? 0) / 100);
}

// "123.45" or "$1,200" → cents, or null if it isn't an amount.
export function parseDollars(v: FormDataEntryValue | null, { allowNegative = false } = {}) {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const n = Math.round(Number(s) * 100);
  if (!allowNegative && n < 0) return NaN;
  return n;
}

// Dates in the database are plain YYYY-MM-DD; show them without time zone shifts.
export function dayLabel(d: string | null | undefined) {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
export function monthLabel(d: string) {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// The 1st of this month and next month in Central time, as YYYY-MM-DD.
export function centralMonths() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return { today, thisMonth: `${y}-${pad(m)}-01`, nextMonth: next };
}

// Group an invoice's charges by kind, in print order.
export function groupCharges(charges: Charge[]) {
  return KIND_ORDER.map((k) => ({ kind: k, label: KIND_LABELS[k], items: charges.filter((c) => c.kind === k) }))
    .filter((g) => g.items.length > 0)
    .map((g) => ({ ...g, total: g.items.reduce((n, c) => n + c.amount_cents, 0) }));
}

export function isOverdue(inv: Pick<Invoice, "status" | "due_on">, today: string) {
  return inv.status === "sent" && !!inv.due_on && inv.due_on < today;
}
