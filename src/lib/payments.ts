// Photographer payments (demo: tracked here, not actually sent).
export function cents(n: number | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format((n ?? 0) / 100);
}

export const PAYMENT_STATUS: Record<string, { label: string; style: string }> = {
  pending: { label: "Waiting for approval", style: "bg-amber-100 text-amber-900" },
  approved: { label: "Approved", style: "bg-accent-soft text-accent" },
  paid: { label: "Paid", style: "bg-emerald-100 text-emerald-800" },
};
