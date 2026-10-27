// Opens a floor plan's file for people who can see the plan (the database decides).
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: p } = await supabase.from("floor_plans").select("plan_file_path").eq("id", id).maybeSingle();
  if (!p?.plan_file_path) return new Response("Not found", { status: 404 });
  const { data: link } = await supabase.storage.from("plan-files").createSignedUrl(p.plan_file_path, 600);
  if (!link) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: link.signedUrl, "Cache-Control": "private, no-store" } });
}
