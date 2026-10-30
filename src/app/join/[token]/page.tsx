import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { roleLabel, type Role } from "@/lib/permissions";
import { HomeArt } from "@/components/home-art";
import { Logo } from "@/components/logo";
import { PendingButton } from "@/components/pending-button";
import { joinWithLink } from "./actions";

// Join with a link our team sent: set up your own login. Signed out (allowed in
// src/proxy.ts); the link's code is checked by the database
// (public.join_link_info), which shows only the role and builder.

export const metadata: Metadata = {
  title: "Join Builder Listing Services",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default function JoinPage(props: PageProps<"/join/[token]">) {
  return (
    <main className="grid flex-1 lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center">
          <div className="w-full max-w-sm py-12">
            <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-soft" />}>
              <Join params={props.params} searchParams={props.searchParams} />
            </Suspense>
          </div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden lg:block">
        <HomeArt seed="welcome-home" stories={2} scene="twilight" className="absolute inset-0 h-full w-full" />
      </div>
    </main>
  );
}

type Info = { ok: boolean; reason: string | null; role: Role; builder_name: string | null; online_sales: boolean | null };

async function Join({ params, searchParams }: { params: PageProps<"/join/[token]">["params"]; searchParams: PageProps<"/join/[token]">["searchParams"] }) {
  const { token } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: { user } }] = await Promise.all([
    supabase.rpc("join_link_info", { p_token: token }).maybeSingle(),
    supabase.auth.getUser(),
  ]);
  const info = data as Info | null;

  if (!info || !info.ok) {
    return (
      <>
        <h1 className="text-[32px] font-bold leading-tight tracking-tight">This link isn’t working</h1>
        <p className="mt-2 text-muted">
          {info?.reason === "expired" ? "It has expired." : info?.reason === "used" ? "It’s been used as many times as allowed." : info?.reason === "off" ? "It’s been turned off." : "It may be mistyped or no longer in use."}{" "}
          Ask whoever sent it for a new one.
        </p>
        <Link href="/login" className="mt-6 inline-block font-semibold text-accent underline">Already have a login? Sign in</Link>
      </>
    );
  }

  const joiningAs = `${roleLabel(info.role, info.online_sales)}${info.builder_name ? ` at ${info.builder_name}` : " on our team"}`;

  if (user) {
    return (
      <>
        <h1 className="text-[32px] font-bold leading-tight tracking-tight">You’re already signed in</h1>
        <p className="mt-2 text-muted">This link sets up a new login ({joiningAs}). To use it for someone new, sign out first, or send them the link.</p>
        <Link href="/communities" className="mt-6 inline-block font-semibold text-accent underline">Go to the app</Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-[32px] font-bold leading-tight tracking-tight">Set up your login</h1>
      <p className="mt-2 text-muted">You’re joining Builder Listing Services as <b className="text-foreground">{joiningAs}</b>.</p>
      {typeof error === "string" && <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      <form action={joinWithLink} className="mt-8 space-y-4">
        <input type="hidden" name="token" value={token} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Your full name</span>
          <input name="full_name" required maxLength={120} autoComplete="name" className="field-input" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Email</span>
          <input name="email" type="email" required maxLength={200} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" className="field-input" />
          <span className="mt-1 block text-xs text-muted">You’ll sign in with this.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Mobile phone (optional)</span>
          <input name="phone" type="tel" maxLength={40} autoComplete="tel" inputMode="tel" className="field-input" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Password</span>
          <input name="password" type="password" required minLength={10} autoComplete="new-password" className="field-input" />
          <span className="mt-1 block text-xs text-muted">At least 10 characters.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Password again</span>
          <input name="password2" type="password" required minLength={10} autoComplete="new-password" className="field-input" />
        </label>
        <PendingButton pending="Setting up your login…" className="w-full justify-center rounded-xl bg-accent px-4 py-3.5 font-semibold text-white hover:brightness-110">
          Create my login
        </PendingButton>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have a login? <Link href="/login" className="font-semibold text-accent underline">Sign in</Link>
      </p>
    </>
  );
}
