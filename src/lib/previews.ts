// Makes small preview copies of a photo or video in the browser, before upload.
//
// Grids and cards show the small copy; a photo's own page shows the screen-size
// copy; downloads and the MLS photo pack always use the original. Making the
// copies here (instead of on our server) keeps uploads going straight from the
// browser to storage, and works the same on Supabase Storage today and on
// Cloudflare R2 later.
//
// Everything here is best effort: if the browser can't read a file (for
// example HEIC outside Safari), we skip the copies and the app shows the
// original instead.

export const THUMB_EDGE = 640; // grid tiles are ~320 px wide; 2x for sharp phone screens
export const WEB_EDGE = 1600; // fills a laptop screen; also the size the AI reads

export type Preview = { blob: Blob; suffix: "thumb" | "web" };

function scaled(w: number, h: number, edge: number) {
  const s = Math.min(1, edge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function toWebp(source: CanvasImageSource, w: number, h: number, edge: number, quality: number): Promise<Blob | null> {
  const size = scaled(w, h, edge);
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, size.w, size.h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b && b.type === "image/webp" ? b : null), "image/webp", quality));
}

async function photoPreviews(file: File): Promise<Preview[]> {
  // createImageBitmap reads the photo's rotation, so phone photos stay upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const out: Preview[] = [];
    const thumb = await toWebp(bitmap, bitmap.width, bitmap.height, THUMB_EDGE, 0.78);
    if (thumb) out.push({ blob: thumb, suffix: "thumb" });
    // Only make a screen-size copy when it's actually smaller than the original.
    if (Math.max(bitmap.width, bitmap.height) > WEB_EDGE || file.size > 1_500_000) {
      const web = await toWebp(bitmap, bitmap.width, bitmap.height, WEB_EDGE, 0.85);
      if (web && web.size < file.size) out.push({ blob: web, suffix: "web" });
    }
    return out;
  } finally {
    bitmap.close();
  }
}

// A still frame from about one second in (or the middle of a very short clip).
function videoStill(file: File): Promise<Preview[]> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (out: Preview[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(out);
    };
    const timer = setTimeout(() => finish([]), 15_000);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = () => finish([]);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 0) / 2);
    };
    video.onseeked = async () => {
      if (!video.videoWidth) return finish([]);
      const thumb = await toWebp(video, video.videoWidth, video.videoHeight, THUMB_EDGE, 0.78);
      finish(thumb ? [{ blob: thumb, suffix: "thumb" }] : []);
    };
    video.src = url;
  });
}

export async function makePreviews(file: File): Promise<Preview[]> {
  try {
    if (file.type.startsWith("video/")) return await videoStill(file);
    if (file.type.startsWith("image/") || /\.heic$/i.test(file.name)) return await photoPreviews(file);
  } catch {
    // The browser couldn't read it; the original is used everywhere instead.
  }
  return [];
}
