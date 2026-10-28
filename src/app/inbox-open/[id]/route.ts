// Opening a notice: mark it read, then go where it points.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safePath } from "@/lib/safe-path";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: n } = await supabase.from("notifications").select("href").eq("id", id).maybeSingle();
  if (n) await supabase.rpc("mark_notifications_read", { p_ids: [id] });
  const href = safePath(n?.href, "/inbox");
  return NextResponse.redirect(new URL(href, request.url));
}
