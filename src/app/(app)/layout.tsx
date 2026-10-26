import { Suspense } from "react";
import Link from "next/link";
import { requireProfile, DEMO_USERS, demoModeOn } from "@/lib/auth";
import { ROLE_LABELS, isStaff } from "@/lib/permissions";
import { signOut } from "../login/actions";
import { switchDemoUser } from "./demo-actions";
import { NavLinks } from "./nav-links";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense fallback={<div className="h-16 border-b border-line bg-surface" />}>
        <Header />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}

async function Header() {
  const me = await requireProfile();
  const showDemo = demoModeOn() && me.email.endsWith("@demo.test");

  return (
    <header className="border-b border-line bg-surface">
      {showDemo && (
        <div className="bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
          Demo system with made-up builders and homes. Nothing here is real.
        </div>
      )}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/homes" className="font-semibold tracking-tight">
          Builder Listings
        </Link>
        <NavLinks />
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right text-xs leading-tight">
            <div className="font-medium text-foreground">{me.full_name}</div>
            <div className="text-muted">
              {ROLE_LABELS[me.role]}
              {!isStaff(me.role) && me.builder_name ? ` · ${me.builder_name}` : ""}
            </div>
          </div>

          {showDemo && (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-background">
                View as…
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-line bg-surface p-2 shadow-lg">
                <p className="px-2 pb-2 pt-1 text-xs text-muted">Switch demo user to see each role’s view.</p>
                {DEMO_USERS.map((u) => (
                  <form key={u.email} action={switchDemoUser}>
                    <input type="hidden" name="email" value={u.email} />
                    <button
                      disabled={u.email === me.email}
                      className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-background disabled:bg-accent-soft"
                    >
                      <span className="font-medium">{u.label}</span>
                      <span className="block text-xs text-muted">{u.detail}</span>
                    </button>
                  </form>
                ))}
              </div>
            </details>
          )}

          <form action={signOut}>
            <button className="rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-background hover:text-foreground">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
