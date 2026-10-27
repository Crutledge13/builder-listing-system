// One file from a realtor share link. The database checks the link is live and
// the file belongs to that home (public.share_file), then we hand out an
// hour-long storage link, or stream a demo video. ?download=1 saves it and
// counts the download for the builder. ?size=thumb|web serves the small copy
// (grids, the photo viewer), falling back to the original; downloads always
// get the original.

import { createClient } from "@/lib/supabase/server";
import { serveDemoVideo } from "@/lib/serve-demo-video";

const fileName = (title: string, ext: string) =>
  `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "media"}.${ext}`;

export async function GET(request: Request, { params }: { params: Promise<{ token: string; mediaId: string }> }) {
  const { token, mediaId } = await params;
  const url = new URL(request.url);
  const download = url.searchParams.has("download");
  const size = download ? null : url.searchParams.get("size");
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.rpc("share_file", { p_token: token, p_media: mediaId, p_download: download });
  const m = (data as { storage_path: string | null; title: string; source: string; demo_key: string | null; kind: string; thumb_path: string | null; web_path: string | null }[] | null)?.[0];
  if (!m) return new Response("This link has expired or was turned off.", { status: 404 });

  if (m.source === "upload" && m.storage_path) {
    const ext = m.storage_path.split(".").pop() ?? "bin";
    if (size === "thumb" && m.kind === "video" && !m.thumb_path) return new Response("No preview", { status: 404 });
    const filePath = (size === "thumb" && m.thumb_path) || ((size === "thumb" || size === "web") && m.kind !== "video" && m.web_path) || m.storage_path;
    const { data: link } = await supabase.storage.from("media").createSignedUrl(filePath, 3600, download ? { download: fileName(m.title, ext) } : undefined);
    if (!link) return new Response("File not available", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: link.signedUrl, "Cache-Control": download ? "private, no-store" : "private, max-age=3000", "Referrer-Policy": "no-referrer" } });
  }
  const video = await serveDemoVideo(m.demo_key, request, download ? fileName(m.title, "mp4") : null);
  return video ?? new Response("This item has no file to download", { status: 404 });
}
