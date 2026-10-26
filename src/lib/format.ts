export function money(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === "") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

export function num(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === "") return "—";
  return new Intl.NumberFormat("en-US").format(Number(n));
}

export function baths(full: number | null, half: number | null) {
  if (full === null && half === null) return "—";
  const total = (full ?? 0) + (half ?? 0) * 0.5;
  return String(total);
}

export function dateTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(new Date(iso));
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
