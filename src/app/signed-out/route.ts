import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Signs the person out and shows a reason on the login page. Used when an
// account has been turned off (a page can't clear the login cookie itself).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const reason = request.nextUrl.searchParams.get("reason") === "inactive" ? "inactive" : "signed-out";
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = reason === "inactive" ? "?error=inactive" : "";
  return NextResponse.redirect(url);
}
