// Open houses are entered and shown in Central time, wherever the server runs.
export const TZ = "America/Chicago";

// Turn a Central-time date ("2026-11-07") and time ("13:00") into a UTC ISO string.
export function centralToUtc(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Find Central's offset at that moment (handles daylight saving).
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" })
    .formatToParts(new Date(asUtc))
    .find((p) => p.type === "timeZoneName")?.value; // e.g. "GMT-5"
  const m = parts?.match(/GMT([+-]\d+)(?::(\d+))?/);
  const offsetMin = m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : -360;
  return new Date(asUtc - offsetMin * 60_000).toISOString();
}

// "Sat, Nov 7, 1:00 – 4:00 PM"
export function openHouseWhen(startIso: string, endIso: string) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(new Date(startIso));
  const t = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return `${day}, ${t(startIso)} to ${t(endIso)}`;
}
