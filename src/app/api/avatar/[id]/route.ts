// Serves a person's headshot to a signed-in user. Reading the profile as that
// user means row-level security decides who may see it; the file itself is in
// a private bucket and is handed out as a link that expires in an hour.

import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: p } = await supabase.from("profiles").select("avatar_path").eq("id", id).maybeSingle();
  if (!p?.avatar_path) return new Response("Not found", { status: 404 });
  const { data: link } = await supabase.storage.from("profile-photos").createSignedUrl(p.avatar_path, 3600);
  if (!link) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: link.signedUrl, "Cache-Control": "private, max-age=3000" } });
}
