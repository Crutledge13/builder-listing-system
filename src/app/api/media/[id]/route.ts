// Serves one media item to a signed-in user, after checking access.
//
// The access check is the database's own: we read the media record as the
// signed-in user, and row-level security only returns it if they may see it.
// - Uploaded files: redirect to a private storage link that expires in an hour.
// - Demo videos: streamed from the app bundle. (Demo pictures are drawn on the
//   page itself, so they never come through here.)
//
// Query option: ?download=1 to save the file instead of viewing it.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { demoVideoFile } from "@/lib/demo-media";

const LINK_SECONDS = 60 * 60;

function fileName(title: string, ext: string) {
  return `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "media"}.${ext}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const download = url.searchParams.has("download");

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("media")
    .select(
      "id, title, kind, source, storage_path, demo_key",
    )
    .eq("id", id)
    .maybeSingle();
  if (!m) return new Response("Not found", { status: 404 });

  const privateCache = { "Cache-Control": "private, max-age=3600" };

  if (m.source === "upload" && m.storage_path) {
    const ext = m.storage_path.split(".").pop() ?? "bin";
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(m.storage_path, LINK_SECONDS, download ? { download: fileName(m.title, ext) } : undefined);
    if (error || !data) return new Response("File not available", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store" } });
  }

  // Demo video.
  const videoFile = demoVideoFile(m.demo_key ?? "");
  if (videoFile) {
    const full = path.join(process.cwd(), "demo-media", "videos", videoFile);
    const size = (await stat(full)).size;
    const bytes = await readFile(full);
    const range = request.headers.get("range");
    const headers: Record<string, string> = {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      ...privateCache,
    };
    if (download) headers["Content-Disposition"] = `attachment; filename="${fileName(m.title, "mp4")}"`;
    // Phones (Safari especially) ask for videos in pieces.
    const match = range?.match(/bytes=(\d*)-(\d*)/);
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

  return new Response("This item has no file to download", { status: 404 });
}
