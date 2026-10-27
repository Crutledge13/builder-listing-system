// Serves one media item to a signed-in user, after checking access.
//
// The access check is the database's own: we read the media record as the
// signed-in user, and row-level security only returns it if they may see it.
// - Uploaded files: redirect to a private storage link that expires in an hour.
// - Demo videos: streamed from the app bundle. (Demo pictures are drawn on the
//   page itself, so they never come through here.)
//
// Query option: ?download=1 to save the file instead of viewing it.

import { createClient } from "@/lib/supabase/server";
import { serveDemoVideo } from "@/lib/serve-demo-video";

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


  if (m.source === "upload" && m.storage_path) {
    const ext = m.storage_path.split(".").pop() ?? "bin";
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(m.storage_path, LINK_SECONDS, download ? { download: fileName(m.title, ext) } : undefined);
    if (error || !data) return new Response("File not available", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store" } });
  }

  // Demo video.
  const video = await serveDemoVideo(m.demo_key, request, download ? fileName(m.title, "mp4") : null);
  if (video) return video;

  return new Response("This item has no file to download", { status: 404 });
}
