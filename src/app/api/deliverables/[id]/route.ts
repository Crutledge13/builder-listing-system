// Downloads a delivered file (reverse prospecting list, comps). Reading the
// file record as the signed-in user lets the database decide who may have it.
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: f } = await supabase.from("deliverable_files").select("storage_path, file_name").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!f) return new Response("Not found", { status: 404 });
  const { data: link } = await supabase.storage.from("deliverables").createSignedUrl(f.storage_path, 600, { download: f.file_name });
  if (!link) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: link.signedUrl, "Cache-Control": "private, no-store" } });
}
