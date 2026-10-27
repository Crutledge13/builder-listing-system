// One file from a realtor share link. The database checks the link is live and
// the file belongs to that home (public.share_file), then we hand out an
// hour-long storage link, or stream a demo video. ?download=1 saves it and
// counts the download for the builder.

import { createClient } from "@/lib/supabase/server";
import { serveDemoVideo } from "@/lib/serve-demo-video";

const fileName = (title: string, ext: string) =>
  `${title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "media"}.${ext}`;

export async function GET(request: Request, { params }: { params: Promise<{ token: string; mediaId: string }> }) {
  const { token, mediaId } = await params;
  const download = new URL(request.url).searchParams.has("download");
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.rpc("share_file", { p_token: token, p_media: mediaId, p_download: download });
  const m = (data as { storage_path: string | null; title: string; source: string; demo_key: string | null }[] | null)?.[0];
  if (!m) return new Response("This link has expired or was turned off.", { status: 404 });

  if (m.source === "upload" && m.storage_path) {
    const ext = m.storage_path.split(".").pop() ?? "bin";
    const { data: link } = await supabase.storage.from("media").createSignedUrl(m.storage_path, 3600, download ? { download: fileName(m.title, ext) } : undefined);
    if (!link) return new Response("File not available", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: link.signedUrl, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  }
  const video = await serveDemoVideo(m.demo_key, request, download ? fileName(m.title, "mp4") : null);
  return video ?? new Response("This item has no file to download", { status: 404 });
}
