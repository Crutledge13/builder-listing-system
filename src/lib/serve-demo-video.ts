import "server-only";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { demoVideoFile } from "@/lib/demo-media";

// Streams one of the demo videos shipped with the app (phones ask for videos
// in pieces, so byte ranges are supported). Null if the key isn't a demo video.
export async function serveDemoVideo(demoKey: string | null, request: Request, downloadName: string | null) {
  const videoFile = demoVideoFile(demoKey ?? "");
  if (!videoFile) return null;
  const full = path.join(process.cwd(), "demo-media", "videos", videoFile);
  const size = (await stat(full)).size;
  const bytes = await readFile(full);
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (downloadName) headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;
  const match = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    return new Response(bytes.subarray(start, end + 1), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(bytes, { headers: { ...headers, "Content-Length": String(size) } });
}
