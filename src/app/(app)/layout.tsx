import { Suspense } from "react";
import Link from "next/link";
import { requireProfile, DEMO_USERS, demoModeOn } from "@/lib/auth";
import { ROLE_LABELS, isStaff } from "@/lib/permissions";
import { signOut } from "../login/actions";
import { switchDemoUser } from "./demo-actions";
import { NavLinks } from "./nav-links";
import { Logo } from "@/components/logo";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense fallback={<div className="h-[73px] border-b border-line" />}>
        <Header />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-6 sm:px-8">{children}</main>
    </>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

async function Header() {
  const me = await requireProfile();
  const showDemo = demoModeOn() && me.email.endsWith("@demo.test");
  const company = me.role === "photographer" ? "Contractor" : isStaff(me.role) ? "Our team" : me.builder_name?.replace(" (demo)", "");

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      {showDemo && (
        <div className="bg-[#fff7e6] px-4 py-1.5 text-center text-xs text-[#7a5200]">
          You’re in the demo. Every builder, home and person here is made up.
        </div>
      )}
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-8">
        <Link href={me.role === "photographer" ? "/jobs" : "/communities"} className="shrink-0">
          <Logo compact />
        </Link>
        <div className="flex min-w-0 flex-1 justify-start md:justify-center">
          <NavLinks showAdmin={me.role === "platform_admin"} photographer={me.role === "photographer"} />
        </div>

        <details className="relative shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-line py-1 pl-3 pr-1 transition-shadow hover:shadow-md">
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-foreground" aria-hidden>
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-white">
              {initials(me.full_name)}
            </span>
            <span className="sr-only">Account menu</span>
          </summary>
          <div className="card-lift absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <div className="font-semibold">{me.full_name}</div>
              <div className="text-sm text-muted">
                {ROLE_LABELS[me.role]}, {company}
              </div>
            </div>

            {showDemo && (
              <div className="max-h-[60vh] overflow-y-auto border-b border-line p-2">
                <p className="px-2 pb-1 pt-1 text-sm font-semibold">See the system as…</p>
                {DEMO_USERS.map((u) => (
                  <form key={u.email} action={switchDemoUser}>
                    <input type="hidden" name="email" value={u.email} />
                    <button
                      disabled={u.email === me.email}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-soft disabled:bg-accent-soft"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-[11px] font-semibold">
                        {initials(u.label)}
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{u.label}</span>
                        <span className="block text-xs text-muted">{u.detail}</span>
                      </span>
                    </button>
                  </form>
                ))}
              </div>
            )}

            <form action={signOut} className="p-2">
              <button className="w-full rounded-xl px-2 py-2 text-left text-sm hover:bg-soft">Sign out</button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
