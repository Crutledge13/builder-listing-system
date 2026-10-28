import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { HomeArt } from "@/components/home-art";
import { Logo } from "@/components/logo";
import { PendingButton } from "@/components/pending-button";
import { INVITE_HOURS, lookupInvite } from "@/lib/invite-links";
import { acceptInvite } from "./actions";

// Where an invite link lands (signed out, allowed in src/proxy.ts). Opening
// the page changes nothing; only the Continue button signs the person in, so
// email scanners that open every link can't use it up. Shows only the
// person's first name and their company.

export const metadata: Metadata = {
  title: "Your invite to Builder Listing Services",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default function AcceptPage(props: PageProps<"/accept/[token]">) {
  return (
    <main className="grid flex-1 lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center">
          <div className="w-full max-w-sm py-12">
            <Suspense fallback={<div className="h-72 animate-pulse rounded-2xl bg-soft" />}>
              <Accept params={props.params} searchParams={props.searchParams} />
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

async function Accept({ params, searchParams }: { params: PageProps<"/accept/[token]">["params"]; searchParams: PageProps<"/accept/[token]">["searchParams"] }) {
  const { token } = await params;
  const { error } = await searchParams;
  const found = await lookupInvite(token);

  if ("problem" in found) {
    return (
      <>
        <h1 className="text-[32px] font-bold leading-tight tracking-tight">
          {found.problem === "used" ? "You’re already set up" : "This invite link isn’t working"}
        </h1>
        <p className="mt-2 text-muted">
          {found.problem === "used"
            ? "You’ve already chosen a password. Sign in with your email and password."
            : found.problem === "expired"
              ? `It has expired (links last ${INVITE_HOURS / 24} days) or a newer one was made. Ask whoever invited you for a new link.`
              : "It may be mistyped or no longer in use. Ask whoever invited you for a new link."}
        </p>
        <Link href="/login" className="mt-6 inline-block rounded-xl border border-foreground px-4 py-2.5 font-semibold hover:bg-soft">Go to sign in</Link>
      </>
    );
  }

  const { firstName, builderName } = found.ok;
  return (
    <>
      <h1 className="text-[32px] font-bold leading-tight tracking-tight">Welcome, {firstName}</h1>
      <p className="mt-2 text-muted">
        You’ve been invited to Builder Listing Services{builderName ? ` for ${builderName}` : ""}. Next you’ll choose a password, then we’ll walk you through getting set up.
      </p>
      {error === "signin" && (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">That didn’t go through. Try once more, or ask for a new link.</p>
      )}
      <form action={acceptInvite} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <PendingButton pending="Getting you in…" className="w-full justify-center rounded-xl bg-accent px-4 py-3.5 font-semibold text-white hover:brightness-110">
          Continue
        </PendingButton>
      </form>
      <p className="mt-4 text-xs text-muted">Not {firstName}? Close this page and let whoever sent the link know.</p>
    </>
  );
}
