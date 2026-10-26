import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Reads a builder's brand guide (PDF or image) with Claude and pulls out the
// colors, fonts, website, tagline and usage notes. The result is only a
// suggestion: a person reviews it before it's added to the branding.
//
// Needs ANTHROPIC_API_KEY on the server. Without it, nothing is sent anywhere.

const MODEL = "claude-sonnet-5-5";

export type BrandScan = {
  colors: { name: string; hex: string }[];
  fonts: string[];
  website_url: string | null;
  tagline: string | null;
  notes: string | null;
};

export function brandScanAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM = `You read brand guidelines for a home builder and pull out the facts our team needs.
Reply with only a JSON object, no other text:
{"colors": [{"name": the color's name in the guide (e.g. "Bluebonnet Navy") or a plain description, "hex": "#rrggbb"}] in the order the guide ranks them (primary first), up to 12,
 "fonts": font family names in order of importance (headline font first), up to 6,
 "website_url": the company's website if shown, else null,
 "tagline": the company's tagline or slogan if shown, else null,
 "notes": short plain-English bullet points (each line starting with "- ") on logo usage (clear space, minimum size, don'ts), photo style and tone of voice, under 900 characters, else null}
If a color is only given as RGB or CMYK or Pantone, convert it to the closest hex. Never invent colors or fonts that aren't in the guide.`;

export function parseBrandScan(text: string): BrandScan | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const seen = new Set<string>();
  const colors = (Array.isArray(raw.colors) ? raw.colors : [])
    .map((c) => {
      const o = c as Record<string, unknown>;
      let hex = String(o?.hex ?? "").trim().toLowerCase();
      if (/^[0-9a-f]{6}$/.test(hex)) hex = `#${hex}`;
      return { name: str(o?.name, 40) ?? "Color", hex };
    })
    .filter((c) => /^#[0-9a-f]{6}$/.test(c.hex) && !seen.has(c.hex) && seen.add(c.hex))
    .slice(0, 12);
  const fonts = (Array.isArray(raw.fonts) ? raw.fonts : []).map((f) => str(f, 60)).filter((f): f is string => !!f).slice(0, 6);
  let website = str(raw.website_url, 300);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(website)) website = null;
  return { colors, fonts, website_url: website, tagline: str(raw.tagline, 120), notes: str(raw.notes, 1200) };
}

// `url` is a short-lived private link to the file.
export async function scanBrandGuide(url: string, mimeType: string): Promise<BrandScan | null> {
  const client = new Anthropic();
  const file =
    mimeType === "application/pdf"
      ? ({ type: "document", source: { type: "url", url } } as const)
      : ({ type: "image", source: { type: "url", url } } as const);
  const reply = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: [file, { type: "text", text: "Pull the branding out of this guide." }] }],
  });
  return parseBrandScan(reply.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
}
