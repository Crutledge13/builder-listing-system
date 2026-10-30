// One photo or video on a broker's work sheet. The database checks the task
// belongs to a builder that invited this broker and the file is on that
// task's listing (public.broker_file); storage's own rule checks the same
// (private.broker_sees_file). Then: an hour-long private link, or a demo video.
// ?download=1 saves the original; ?size=thumb|web serves the small copies.

import { createClient } from "@/lib/supabase/server";
import { serveDemoVideo } from "@/lib/serve-demo-video";

const fileName = (title: string, ext: string) =>
  `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "media"}.${ext}`;

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string; mediaId: string }> }) {
  const { taskId, mediaId } = await params;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(taskId) || !uuid.test(mediaId)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const download = url.searchParams.has("download");
  const size = download ? null : url.searchParams.get("size");

  const supabase = await createClient();
  const { data } = await supabase.rpc("broker_file", { p_task: taskId, p_media: mediaId });
  const m = (data as { storage_path: string | null; title: string; source: string; demo_key: string | null; kind: string; thumb_path: string | null; web_path: string | null }[] | null)?.[0];
  if (!m) return new Response("Not found", { status: 404 });

  if (m.source === "upload" && m.storage_path) {
    const ext = m.storage_path.split(".").pop() ?? "bin";
    if (size === "thumb" && m.kind === "video" && !m.thumb_path) return new Response("No preview", { status: 404 });
    const filePath = (size === "thumb" && m.thumb_path) || ((size === "thumb" || size === "web") && m.kind !== "video" && m.web_path) || m.storage_path;
    const { data: link } = await supabase.storage.from("media").createSignedUrl(filePath, 3600, download ? { download: fileName(m.title, ext) } : undefined);
    if (!link) return new Response("File not available", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: link.signedUrl, "Cache-Control": download ? "private, no-store" : "private, max-age=3000" } });
  }
  const video = await serveDemoVideo(m.demo_key, request, download ? fileName(m.title, "mp4") : null);
  return video ?? new Response("This item has no file to download", { status: 404 });
}
