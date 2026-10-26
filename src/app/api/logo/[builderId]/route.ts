// Serves a builder's logo to signed-in people who can see that builder
// (row-level security on builder_branding decides). Private bucket, hour-long link.

import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ builderId: string }> }) {
  const { builderId } = await params;
  const supabase = await createClient();
  const { data: b } = await supabase.from("builder_branding").select("logo_path").eq("builder_id", builderId).maybeSingle();
  if (!b?.logo_path) return new Response("Not found", { status: 404 });
  const { data: link } = await supabase.storage.from("branding").createSignedUrl(b.logo_path, 3600);
  if (!link) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: link.signedUrl, "Cache-Control": "private, max-age=3000" } });
}
