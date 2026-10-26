// Serves a builder's logo to signed-in people who can see that builder
// (row-level security on builder_branding decides), and to photographers
// with a job for that builder. Private bucket, hour-long link.

import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ builderId: string }> }) {
  const { builderId } = await params;
  const supabase = await createClient();
  const { data: b } = await supabase.from("builder_branding").select("logo_path").eq("builder_id", builderId).maybeSingle();
  // Photographers can't read branding, but may see the logo of a builder they shoot for.
  const path = b?.logo_path ?? ((await supabase.rpc("job_logo_path", { p_builder: builderId })).data as string | null);
  if (!path) return new Response("Not found", { status: 404 });
  const { data: link } = await supabase.storage.from("branding").createSignedUrl(path, 3600);
  if (!link) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: link.signedUrl, "Cache-Control": "private, max-age=3000" } });
}
