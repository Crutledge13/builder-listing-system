import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabase/config";
import { NextResponse, type NextRequest } from "next/server";

// Runs before every page: refreshes the login session and sends anyone who is
// signed out to the login page. Nothing in the app is visible signed out.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Verifies the login token (and refreshes it when it's about to run out)
  // without a round trip to Supabase's login service on every click.
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  const user = claims?.sub ? { id: claims.sub, user_metadata: (claims.user_metadata ?? {}) as Record<string, unknown> } : null;
  // Outside listing brokers (broker mode) live only in /broker. Their login
  // carries role "broker" in app_metadata, which only our server can set, so
  // this check needs no database call. The broker pages check again themselves.
  const isBroker = (claims?.app_metadata as Record<string, unknown> | undefined)?.role === "broker";

  const isLogin = request.nextUrl.pathname.startsWith("/login");
  // Email confirmation links land here and sign the person in themselves.
  const isConfirm = request.nextUrl.pathname === "/auth/confirm";
  // Realtor share links: the page checks the link's code itself (see /s/[token]).
  const isShare = request.nextUrl.pathname.startsWith("/s/");
  // Join links: the page checks the link's code itself (see /join/[token]).
  const isJoin = request.nextUrl.pathname.startsWith("/join/");
  // One-off broker links: the page checks the link itself (see /w/[token]).
  const isWorkLink = request.nextUrl.pathname.startsWith("/w/");
  // Invite links: the page checks the link itself and signs in only on its Continue button (see /accept/[token]).
  const isAccept = request.nextUrl.pathname.startsWith("/accept/");

  if (!user && !isLogin && !isConfirm && !isShare && !isJoin && !isAccept && !isWorkLink) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Opened an invite link but hasn't chosen a password yet: finish that first,
  // or they'd have no way back in once this sign-in runs out.
  const path = request.nextUrl.pathname;
  if (user?.user_metadata?.needs_password && path !== "/welcome" && !isConfirm && !isAccept && !path.startsWith("/signed-out") && !path.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // A broker anywhere outside their screens (and the few sign-in pages) goes to their MLS work.
  const brokerAllowed = path === "/broker" || path.startsWith("/broker/") || isWorkLink || path === "/welcome" || isConfirm || isAccept || path.startsWith("/signed-out");
  if (user && isBroker && !brokerAllowed && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/broker";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = isBroker ? "/broker" : "/communities";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
