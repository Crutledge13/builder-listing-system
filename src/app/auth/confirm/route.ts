// Where confirmation links from Supabase emails land (for now: changing your
// sign-in email). Handles both link styles Supabase can send, then sends the
// person on to a page inside the app.

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const nextParam = url.searchParams.get("next") ?? "/account";
  // Only ever send people to a page on this site.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/account";
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createClient();

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;

  const to = new URL(next, url.origin);
  if (ok) to.searchParams.set("saved", "Confirmed. Use your new email next time you sign in.");
  else to.searchParams.set("error", "That link has expired or was already used. Try the change again.");
  return NextResponse.redirect(to);
}
