"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { readTitleCompany } from "@/lib/title-company";
import { BRAND_MODEL, brandScanAvailable, scanBrandGuide, type BrandScan } from "@/lib/brand-scan";
import { creditStatus, finishCredits, outOfCreditsMessage, spendCredits } from "@/lib/ai-credits";

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
  let usageId: string | null = null;
  try {
    usageId = await spendCredits(supabase, builderId, "brand_guide_read", builderId);
  } catch {
    return { error: "Couldn’t check your AI credits. Try again in a minute." };
  }
  if (!usageId) return { error: outOfCreditsMessage(await creditStatus(supabase, builderId)) };
  const { data: link } = await supabase.storage.from("branding").createSignedUrl(b.brand_guide_path, 600);
  if (!link) {
    await finishCredits(supabase, usageId, false);
    return { error: "Couldn’t open the brand guide." };
  }
  const ext = b.brand_guide_path.split(".").pop()?.toLowerCase();
  const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  let scan: BrandScan | null = null;
  try {
    const read = await scanBrandGuide(link.signedUrl, mime);
    scan = read.scan;
    await finishCredits(supabase, usageId, true, BRAND_MODEL, read.usage);
  } catch {
    await finishCredits(supabase, usageId, false);
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
  if (!brandScanAvailable()) return {};
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

// ---------------------------------------------------------------------------
// Download sizes
// ---------------------------------------------------------------------------
const FORMATS = new Set(["original", "jpeg", "webp", "png"]);

function readSize(formData: FormData, builderId: string) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (!name) go(builderId, { error: "Give the size a name, like “Our website”." }, "#sizes");
  const edgeRaw = String(formData.get("long_edge") ?? "").trim();
  const longEdge = edgeRaw ? Math.round(Number(edgeRaw)) : null;
  if (longEdge !== null && (Number.isNaN(longEdge) || longEdge < 200 || longEdge > 8000)) go(builderId, { error: "The longest side has to be between 200 and 8000 pixels, or blank for the original size." }, "#sizes");
  const format = String(formData.get("format") ?? "jpeg");
  const quality = Math.max(40, Math.min(100, Math.round(Number(formData.get("quality") ?? 85)) || 85));
  return { name, long_edge: longEdge, format: FORMATS.has(format) ? (format === "original" && longEdge ? "jpeg" : format) : "jpeg", quality };
}

export async function addPreset(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const supabase = await createClient();
  const { error } = await supabase.from("download_presets").insert({ builder_id: builderId, ...readSize(formData, builderId) });
  if (error) go(builderId, { error: "Your role can’t add download sizes." }, "#sizes");
  revalidatePath("/branding");
  go(builderId, { saved: "Download size added." }, "#sizes");
}

export async function savePreset(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("download_presets").update(readSize(formData, builderId)).eq("id", String(formData.get("id"))).eq("builder_id", builderId).select("id");
  if (error || !data?.length) go(builderId, { error: "Your role can’t change download sizes." }, "#sizes");
  revalidatePath("/branding");
  go(builderId, { saved: "Download size saved." }, "#sizes");
}

export async function deletePreset(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const supabase = await createClient();
  const { error } = await supabase.from("download_presets").delete().eq("id", String(formData.get("id"))).eq("builder_id", builderId);
  if (error) go(builderId, { error: "Your role can’t remove download sizes." }, "#sizes");
  revalidatePath("/branding");
  go(builderId, { saved: "Download size removed." }, "#sizes");
}

export async function setDefaultPreset(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const id = String(formData.get("preset_id") ?? "") || null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("builder_branding").update({ default_download_preset: id }).eq("builder_id", builderId).select("builder_id");
  if (error || !data?.length) go(builderId, { error: "Your role can’t change the default download size." }, "#sizes");
  revalidatePath("/", "layout");
  go(builderId, { saved: "Default download size saved." }, "#sizes");
}

// The builder's default title company (fills NTREIS's title company boxes for
// every home unless a community sets its own). Stored on builder_settings,
// which owners, managers, marketing and our admins can change.
export async function saveTitleCompany(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const t = readTitleCompany(formData);
  if (t.title_company_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t.title_company_email)) go(builderId, { error: "That escrow officer email doesn’t look right." }, "#title-company");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("builder_settings")
    .upsert({ builder_id: builderId, ...t, updated_at: new Date().toISOString() })
    .select("builder_id");
  if (error) go(builderId, { error: error.message.includes("row-level security") ? "Your role can’t change this builder’s title company." : `Couldn’t save: ${error.message}` }, "#title-company");
  if (!data?.length) go(builderId, { error: "Your role can’t change this builder’s title company." }, "#title-company");
  revalidatePath("/", "layout");
  go(builderId, { saved: t.title_company_name ? `Default title company saved: ${t.title_company_name}.` : "Default title company cleared." }, "#title-company");
}
