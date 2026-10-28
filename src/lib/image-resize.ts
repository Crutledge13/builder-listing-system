// Resizing and re-saving photos in the browser for downloads, so big files
// never pass through our server. Used by the download menu and zip packs.

export type DownloadPreset = {
  id: string;
  builder_id: string | null;
  name: string;
  long_edge: number | null; // null = keep the original size
  format: "original" | "jpeg" | "webp" | "png";
  quality: number; // 40-100
  is_default: boolean;
};

export const PRESET_SELECT = "id, builder_id, name, long_edge, format, quality, is_default, sort";

export const FORMAT_LABELS: Record<DownloadPreset["format"], string> = {
  original: "Original file",
  jpeg: "JPG",
  webp: "WebP",
  png: "PNG",
};

// The original file, untouched: no resize, no re-save, nothing drawn on it.
export const isUntouched = (p: Pick<DownloadPreset, "long_edge" | "format">) => p.format === "original" && !p.long_edge;

// The size a picture comes out at, never bigger than the original.
export function outputSize(w: number, h: number, longEdge: number | null) {
  if (!longEdge || Math.max(w, h) <= longEdge) return { w, h };
  const s = longEdge / Math.max(w, h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

const MIME = { jpeg: "image/jpeg", webp: "image/webp", png: "image/png" } as const;
export const extFor = (format: DownloadPreset["format"], originalType = "image/jpeg") =>
  format === "original" ? (originalType.includes("png") ? "png" : originalType.includes("webp") ? "webp" : "jpg") : format === "jpeg" ? "jpg" : format;

// Draw the "representative" strip across the bottom, like the downloads before.
function drawDisclaimer(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  const band = Math.round(h * 0.08);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, h - band, w, band);
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(band * 0.4)}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h - band / 2, w * 0.95);
}

// Resize and re-save one picture. `source` is something the browser can draw.
export async function renderPicture(
  source: CanvasImageSource,
  width: number,
  height: number,
  preset: Pick<DownloadPreset, "long_edge" | "format" | "quality">,
  disclaimer?: string,
  originalType = "image/jpeg",
): Promise<Blob> {
  const { w, h } = outputSize(width, height, preset.long_edge);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // JPG has no see-through parts; give it a white background.
  const format = preset.format === "original" ? (originalType.includes("png") ? "png" : originalType.includes("webp") ? "webp" : "jpeg") : preset.format;
  if (format === "jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(source, 0, 0, w, h);
  if (disclaimer) drawDisclaimer(ctx, w, h, disclaimer);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, MIME[format], preset.quality / 100));
  if (!blob) throw new Error("Couldn’t save the picture");
  return blob;
}

// An uploaded file (from the access-checked link) as a resized picture.
export async function renderFileBlob(file: Blob, preset: Pick<DownloadPreset, "long_edge" | "format" | "quality">, disclaimer?: string) {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("This browser can’t resize that kind of file (often iPhone HEIC photos). Use Full quality instead.");
  }
  try {
    return await renderPicture(bmp, bmp.width, bmp.height, preset, disclaimer, file.type);
  } finally {
    bmp.close();
  }
}

// A drawn demo picture (an <svg> on the page) as a picture file.
export async function renderSvg(svg: SVGElement, preset: Pick<DownloadPreset, "long_edge" | "format" | "quality">, disclaimer?: string) {
  const vb = (svg.getAttribute("viewBox") ?? "0 0 1440 960").split(/[ ,]+/).map(Number);
  const ratio = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[3] / vb[2] : 2 / 3;
  // Drawn pictures have no "original" size; full quality draws them at 2400 px wide.
  const width = preset.long_edge ?? 2400;
  const height = Math.round(width * ratio);
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clone.outerHTML)}`;
  await img.decode();
  return renderPicture(img, width, height, { ...preset, long_edge: null, format: preset.format === "original" ? "png" : preset.format }, disclaimer, "image/png");
}

export function saveBlob(blob: Blob, fileName: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// Which size to start on: the person's last pick, else the builder's default, else the built-in default.
export function startingPreset(presets: DownloadPreset[], builderDefault: string | null) {
  let last: string | null = null;
  try {
    last = localStorage.getItem(PRESET_KEY);
  } catch {
    // no saved choice
  }
  return pickStartingPreset(presets, builderDefault, last);
}

// The same choice, given the person's last pick (null if none). Pure, so screens
// can work it out while drawing.
export function pickStartingPreset(presets: DownloadPreset[], builderDefault: string | null, last: string | null) {
  if (last && presets.some((p) => p.id === last)) return last;
  return (
    (builderDefault && presets.some((p) => p.id === builderDefault) ? builderDefault : undefined) ??
    presets.find((p) => p.builder_id === null && p.is_default)?.id ??
    presets[0]?.id ??
    ""
  );
}

export const PRESET_KEY = "download-preset";
const PRESET_EVENT = "download-preset-change";

// The person's last download size, read from this browser after the page loads
// (null while drawing on the server). Updates when they pick a new one.
export function readRememberedPreset(): string | null {
  try {
    return localStorage.getItem(PRESET_KEY);
  } catch {
    return null;
  }
}
export function subscribeRememberedPreset(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PRESET_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PRESET_EVENT, onChange);
  };
}

export function rememberPreset(id: string) {
  try {
    localStorage.setItem(PRESET_KEY, id);
    window.dispatchEvent(new Event(PRESET_EVENT));
  } catch {
    // private window: fine, just not remembered
  }
}
