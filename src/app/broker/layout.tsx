import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { requireBroker } from "@/lib/broker";
import { DEMO_ADMIN, demoModeOn } from "@/lib/auth";
import { signOut } from "../login/actions";
import { switchDemoUser } from "../(app)/demo-actions";

// The broker's whole world: a plain bar and their MLS work. Deliberately none
// of the main app's header, tabs, menu or pages; brokers are kept here by the
// sign-in router (src/proxy.ts) before any page loads.
export const metadata: Metadata = { title: "MLS work · Builder Listing Services", robots: { index: false, follow: false } };

export default function BrokerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<div className="h-[61px] border-b border-line" />}>
        <BrokerBar />
      </Suspense>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-6 sm:px-8">{children}</main>
    </>
  );
}

async function BrokerBar() {
  const { me, info } = await requireBroker();
  const demo = demoModeOn() && me.email.endsWith("@demo.test");
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur print:hidden">
      {demo && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[#fff7e6] px-4 py-1.5 text-center text-xs text-[#7a5200]">
          <span>Demo: viewing as <b>{me.full_name}</b> (outside listing broker). This is everything a broker sees.</span>
          <form action={switchDemoUser}>
            <input type="hidden" name="email" value={DEMO_ADMIN.email} />
            <button className="rounded-full bg-[#7a5200] px-3 py-0.5 font-semibold text-white hover:bg-black">Back to {DEMO_ADMIN.label} (admin)</button>
          </form>
        </div>
      )}
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-8">
        <Link href="/broker" className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
            <rect width="32" height="32" rx="9" fill="var(--accent)" />
            <path d="M8 16.5 16 9l8 7.5V24a1 1 0 0 1-1 1h-4.5v-5h-5v5H9a1 1 0 0 1-1-1z" fill="#fff" />
          </svg>
          <span className="text-[17px] font-bold tracking-tight">MLS work</span>
        </Link>
        <span className="ml-auto hidden text-right text-sm sm:block">
          <span className="block font-semibold leading-tight">{me.full_name}</span>
          <span className="block text-xs text-muted">{info.builders.length ? `Listing for ${info.builders.join(", ")}` : "No builders yet"}</span>
        </span>
        <form action={signOut} className="ml-auto sm:ml-0">
          <button className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold hover:border-foreground">Sign out</button>
        </form>
      </div>
    </header>
  );
}
