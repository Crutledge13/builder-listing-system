// Where sign-in links land: invite links (a new person's first visit), the
// sign-in links we make for people who haven't chosen a password yet, and
// email-change confirmations. Handles both link styles Supabase can send,
// signs the person in, then sends them on to a page inside the app.

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safePath } from "@/lib/safe-path";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const isInvite = type === "invite" || type === "magiclink";
  const fallback = isInvite ? "/welcome" : "/account";
  // Only ever send people to a page on this site.
  const next = safePath(url.searchParams.get("next") ?? fallback, fallback);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const supabase = await createClient();

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;

  if (isInvite) {
    if (ok) return NextResponse.redirect(new URL(next, url.origin));
    // Expired or already used: the login page explains, and whoever invited them can make a new link.
    const to = new URL("/login", url.origin);
    to.searchParams.set("error", "invite-expired");
    return NextResponse.redirect(to);
  }

  const to = new URL(next, url.origin);
  if (ok) to.searchParams.set("saved", "Confirmed. Use your new email next time you sign in.");
  else to.searchParams.set("error", "That link has expired or was already used. Try the change again.");
  return NextResponse.redirect(to);
}
