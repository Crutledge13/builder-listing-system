"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { brandScanAvailable, scanBrandGuide, type BrandScan } from "@/lib/brand-scan";

const HEX = /^#[0-9a-fA-F]{6}$/;
type Color = { name: string; hex: string };

function go(builderId: string, params: Record<string, string>, hash = ""): never {
  redirect(`/branding?${new URLSearchParams({ builder: builderId, ...params }).toString()}${hash}`);
}

function readColors(raw: FormDataEntryValue | null): Color[] {
  try {
    const list = JSON.parse(String(raw ?? "[]"));
    return (Array.isArray(list) ? list : [])
      .map((c) => ({ name: String(c?.name ?? "").trim().slice(0, 40), hex: String(c?.hex ?? "").trim().toLowerCase() }))
      .filter((c) => HEX.test(c.hex))
      .slice(0, 16);
  } catch {
    return [];
  }
}

const readFonts = (raw: FormDataEntryValue | null) =>
  String(raw ?? "").split(",").map((f) => f.trim()).filter(Boolean).slice(0, 8);

function cleanWebsite(builderId: string, raw: string) {
  let website = raw.trim();
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(website)) go(builderId, { error: "That website address doesn’t look right." });
  return website || null;
}

export async function saveBranding(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("builder_branding")
    .update({
      colors: readColors(formData.get("colors")),
      fonts: readFonts(formData.get("fonts")),
      website_url: cleanWebsite(builderId, String(formData.get("website_url") ?? "")),
      tagline: String(formData.get("tagline") ?? "").trim().slice(0, 120) || null,
      brand_notes: String(formData.get("brand_notes") ?? "").trim().slice(0, 2000) || null,
    })
    .eq("builder_id", builderId)
    .select("builder_id");
  if (error) go(builderId, { error: `Couldn’t save: ${error.message}` });
  if (!data?.length) go(builderId, { error: "Your role can’t change this builder’s branding." });
  revalidatePath("/", "layout");
  go(builderId, { saved: "Branding saved." });
}

async function setFile(builderId: string, column: "logo_path" | "brand_guide_path", path: string | null, extra: Record<string, unknown> = {}) {
  await requireProfile();
  const supabase = await createClient();
  const { data: before } = await supabase.from("builder_branding").select(column).eq("builder_id", builderId).maybeSingle();
  const old = (before as Record<string, string | null> | null)?.[column];
  const { data, error } = await supabase.from("builder_branding").update({ [column]: path, ...extra }).eq("builder_id", builderId).select("builder_id");
  if (error || !data?.length) return { error: "Your role can’t change this builder’s branding." };
  if (old && old !== path) await supabase.storage.from("branding").remove([old]);
  revalidatePath("/", "layout");
  return {};
}

export async function saveLogo(builderId: string, path: string) {
  return setFile(builderId, "logo_path", path);
}

export async function removeLogo(builderId: string) {
  return setFile(builderId, "logo_path", null);
}

// Read the guide with AI and keep what it found as a suggestion.
async function runScan(builderId: string): Promise<{ error?: string }> {
  if (!brandScanAvailable()) return { error: "Reading brand guides needs the AI key (ANTHROPIC_API_KEY) set up on the server." };
  const supabase = await createClient();
  const { data: b } = await supabase.from("builder_branding").select("brand_guide_path").eq("builder_id", builderId).maybeSingle();
  if (!b?.brand_guide_path) return { error: "Upload a brand guide first." };
  const { data: link } = await supabase.storage.from("branding").createSignedUrl(b.brand_guide_path, 600);
  if (!link) return { error: "Couldn’t open the brand guide." };
  const ext = b.brand_guide_path.split(".").pop()?.toLowerCase();
  const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  let scan: BrandScan | null = null;
  try {
    scan = await scanBrandGuide(link.signedUrl, mime);
  } catch {
    return { error: "The AI couldn’t read that file. Very large or scanned-image PDFs sometimes fail; try a smaller export." };
  }
  if (!scan) return { error: "The AI couldn’t find branding in that file." };
  const { data, error } = await supabase
    .from("builder_branding")
    .update({ brand_guide_scan: scan, brand_guide_scanned_at: new Date().toISOString() })
    .eq("builder_id", builderId)
    .select("builder_id");
  if (error || !data?.length) return { error: "Your role can’t change this builder’s branding." };
  revalidatePath("/branding");
  return {};
}

export async function saveGuide(builderId: string, path: string, fileName: string) {
  const saved = await setFile(builderId, "brand_guide_path", path, { brand_guide_name: fileName.slice(0, 200) });
  if (saved.error) return saved;
  const scanned = await runScan(builderId);
  // The file is saved either way; a failed read just means filling it in by hand.
  return scanned.error ? { error: `Saved the guide. ${scanned.error}` } : {};
}

export async function removeGuide(builderId: string) {
  return setFile(builderId, "brand_guide_path", null, { brand_guide_name: null });
}

export async function rescanGuide(formData: FormData) {
  const builderId = String(formData.get("builder_id"));
  const r = await runScan(builderId);
  if (r.error) go(builderId, { error: r.error }, "#guide");
  go(builderId, { saved: "Read the guide again. Check what it found below." }, "#guide");
}

// Add the parts of the AI's findings the person ticked. Adds to what's there;
// it only replaces the website or tagline if they ticked those.
export async function applyScan(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const supabase = await createClient();
  const { data: b } = await supabase
    .from("builder_branding")
    .select("colors, fonts, website_url, tagline, brand_notes, brand_guide_scan")
    .eq("builder_id", builderId)
    .maybeSingle();
  const scan = b?.brand_guide_scan as BrandScan | null;
  if (!b || !scan) go(builderId, { error: "Nothing to add. Read the guide first." }, "#guide");

  const picked = new Set(formData.getAll("color").map(String));
  const colors = [...((b.colors as Color[]) ?? [])];
  for (const c of scan.colors) if (picked.has(c.hex) && !colors.some((x) => x.hex === c.hex)) colors.push(c);
  const fonts = formData.get("use_fonts") === "on" ? [...(b.fonts as string[]), ...scan.fonts] : (b.fonts as string[]);
  const notes =
    formData.get("use_notes") === "on" && scan.notes
      ? [b.brand_notes, `From the brand guide:\n${scan.notes}`].filter(Boolean).join("\n\n").slice(0, 2000)
      : b.brand_notes;

  const { data, error } = await supabase
    .from("builder_branding")
    .update({
      colors: colors.slice(0, 16),
      fonts,
      brand_notes: notes,
      website_url: formData.get("use_website") === "on" && scan.website_url ? scan.website_url : b.website_url,
      tagline: formData.get("use_tagline") === "on" && scan.tagline ? scan.tagline : b.tagline,
      brand_guide_scan: null,
    })
    .eq("builder_id", builderId)
    .select("builder_id");
  if (error || !data?.length) go(builderId, { error: "Your role can’t change this builder’s branding." }, "#guide");
  revalidatePath("/", "layout");
  go(builderId, { saved: "Added from the brand guide. Look it over and adjust anything below." });
}

export async function dismissScan(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const supabase = await createClient();
  await supabase.from("builder_branding").update({ brand_guide_scan: null }).eq("builder_id", builderId);
  go(builderId, { saved: "Dismissed." }, "#guide");
}
