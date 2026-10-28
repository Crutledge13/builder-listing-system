// The builder's square icon on a realtor share page (falls back to the main
// logo; only while the link is live). Used for the footer mark and the tab icon.
import { createClient } from "@/lib/supabase/server";
import { demoLogoResponse } from "@/lib/demo-logo";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: path } = await supabase.rpc("share_icon", { p_token: token });
  if (!path) return new Response("Not found", { status: 404 });
  const drawn = demoLogoResponse(path as string);
  if (drawn) return drawn;
  const { data: link } = await supabase.storage.from("branding").createSignedUrl(path as string, 3600);
  if (!link) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: link.signedUrl, "Cache-Control": "private, no-store" } });
}
