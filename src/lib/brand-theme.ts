// Turns a builder's saved branding (builder_branding: colors and fonts) into
// what a page can safely use: checked hex colors, readable text on top of them,
// and a Google Fonts address for a heading font. Used by the realtor share page.

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function cleanHex(v: unknown): string | null {
  return typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : null;
}

function rgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const INK = "#16181b";

// White or near-black, whichever reads better on the color.
export function textOn(hex: string) {
  return contrast(hex, "#ffffff") >= contrast(hex, INK) ? "#ffffff" : INK;
}

// A color dark enough to use for text and thin lines on white. Very light brand
// colors (a pale gold) fall back to ink so nothing becomes unreadable.
export function inkSafe(hex: string) {
  return contrast(hex, "#ffffff") >= 3 ? hex : INK;
}

// Fonts every computer already has, and our own (already loaded).
const BUILT_IN = new Set(["figtree", "georgia", "arial", "helvetica", "times", "times new roman", "verdana", "tahoma", "system-ui", "sans-serif", "serif"]);

// The builder's first font as a CSS font-family, plus a Google Fonts stylesheet
// to load it when it isn't built in. Names are checked to plain letters, digits
// and spaces. A name Google doesn't have simply falls back to our own font.
export function headingFont(fonts: unknown): { family: string | null; href: string | null } {
  const first = Array.isArray(fonts) ? fonts.find((f) => typeof f === "string" && f.trim()) : null;
  const name = typeof first === "string" ? first.trim() : "";
  if (!/^[A-Za-z0-9 ]{2,40}$/.test(name)) return { family: null, href: null };
  const builtIn = BUILT_IN.has(name.toLowerCase());
  const family = name.toLowerCase() === "figtree" ? null : `"${name}"`;
  const href = builtIn ? null : `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
  return { family, href };
}
