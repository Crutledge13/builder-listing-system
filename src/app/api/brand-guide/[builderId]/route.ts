// Downloads a builder's brand guide for signed-in people who can see that
// builder (row-level security decides). Private bucket, hour-long link.

import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ builderId: string }> }) {
  const { builderId } = await params;
  const supabase = await createClient();
  const { data: b } = await supabase.from("builder_branding").select("brand_guide_path, brand_guide_name").eq("builder_id", builderId).maybeSingle();
  if (!b?.brand_guide_path) return new Response("Not found", { status: 404 });
  const { data: link } = await supabase.storage.from("branding").createSignedUrl(b.brand_guide_path, 3600, { download: b.brand_guide_name ?? "brand-guide" });
  if (!link) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: link.signedUrl, "Cache-Control": "private, no-store" } });
}
