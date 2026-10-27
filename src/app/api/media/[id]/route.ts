// Serves one media item to a signed-in user, after checking access.
//
// The access check is the database's own: we read the media record as the
// signed-in user, and row-level security only returns it if they may see it.
// - Uploaded files: redirect to a private storage link that expires in an hour.
// - Demo videos: streamed from the app bundle. (Demo pictures are drawn on the
//   page itself, so they never come through here.)
//
// Query options:
// - ?download=1 to save the original file instead of viewing it.
// - ?size=thumb for the small preview (grids, cards) or ?size=web for the
//   screen-size copy (a photo's own page). Falls back to the original when an
//   upload has no preview. Downloads always get the original.
//
// The redirect may be reused by the browser for 50 minutes (the link itself
// lasts an hour), so scrolling back through a grid doesn't ask again.

import { createClient } from "@/lib/supabase/server";
import { serveDemoVideo } from "@/lib/serve-demo-video";

const LINK_SECONDS = 60 * 60;
const REUSE_SECONDS = 50 * 60;

function fileName(title: string, ext: string) {
  return `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "media"}.${ext}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const download = url.searchParams.has("download");
  const size = download ? null : url.searchParams.get("size");

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("media")
    .select(
      "id, title, kind, source, storage_path, thumb_path, web_path, demo_key",
    )
    .eq("id", id)
    .maybeSingle();
  if (!m) return new Response("Not found", { status: 404 });


  if (m.source === "upload" && m.storage_path) {
    const ext = m.storage_path.split(".").pop() ?? "bin";
    // A video's thumb is a still image; with no still, there is nothing small to show.
    if (size === "thumb" && m.kind === "video" && !m.thumb_path) return new Response("No preview", { status: 404 });
    const filePath = (size === "thumb" && m.thumb_path) || ((size === "thumb" || size === "web") && m.kind !== "video" && m.web_path) || m.storage_path;
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(filePath, LINK_SECONDS, download ? { download: fileName(m.title, ext) } : undefined);
    if (error || !data) return new Response("File not available", { status: 404 });
    return new Response(null, {
      status: 302,
      headers: { Location: data.signedUrl, "Cache-Control": download ? "private, no-store" : `private, max-age=${REUSE_SECONDS}` },
    });
  }

  // Demo video.
  const video = await serveDemoVideo(m.demo_key, request, download ? fileName(m.title, "mp4") : null);
  if (video) return video;

  return new Response("This item has no file to download", { status: 404 });
}
