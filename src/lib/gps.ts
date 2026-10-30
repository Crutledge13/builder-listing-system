// GPS coordinates for a home (owners, 29 Oct 2026): new lots often aren't on
// the maps yet. People paste "32.7767, -96.7970" (right-click > copy in Google
// Maps), a Google Maps link, or tap "Use my location" standing on the lot.

export type Gps = { latitude: number; longitude: number };

// null = left blank; "bad" = something we couldn't read.
export function parseGps(text: string): Gps | null | "bad" {
  const t = text.trim();
  if (!t) return null;
  // A Google Maps link: ...@32.7767,-96.7970,17z or ?q=32.7767,-96.7970
  const fromLink = t.match(/[@=](-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
  const pair = fromLink ?? t.match(/^\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?$/);
  if (!pair) return "bad";
  const latitude = Number(pair[1]);
  const longitude = Number(pair[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return "bad";
  return { latitude: Math.round(latitude * 1e6) / 1e6, longitude: Math.round(longitude * 1e6) / 1e6 };
}

export function gpsText(lat: number | string | null | undefined, lng: number | string | null | undefined) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return "";
  return `${Number(lat)}, ${Number(lng)}`;
}

// Texas runs from about 25.8 to 36.5 north and 93.5 to 106.7 west. Outside that
// is probably a typo (a missing minus sign puts the lot in China).
export function looksLikeTexas(g: Gps) {
  return g.latitude >= 25.5 && g.latitude <= 36.7 && g.longitude >= -107 && g.longitude <= -93.3;
}

export function mapsLink(g: Gps) {
  return `https://www.google.com/maps/search/?api=1&query=${g.latitude},${g.longitude}`;
}
