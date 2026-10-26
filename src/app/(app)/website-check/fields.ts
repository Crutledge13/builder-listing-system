// The "easy" fields a builder website usually has, compared across website,
// Builder Listings and the MLS. Names are RESO standard names.
export const COMPARE_FIELDS = [
  { key: "list_price", label: "Price" },
  { key: "bedrooms_total", label: "Bedrooms" },
  { key: "bathrooms_full", label: "Full baths" },
  { key: "bathrooms_half", label: "Half baths" },
  { key: "living_area", label: "Square feet" },
] as const; // Descriptions aren't compared: websites and the MLS word them differently on purpose.

export type CompareKey = (typeof COMPARE_FIELDS)[number]["key"];

export function normalize(key: CompareKey, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(Number(v));
}
