import { Suspense } from "react";
import Link from "next/link";
import { requireProfile, DEMO_USERS, demoModeOn } from "@/lib/auth";
import { ROLE_LABELS, isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { menuLinks, primaryTabs } from "@/lib/menu";
import { signOut } from "../login/actions";
import { switchDemoUser } from "./demo-actions";
import { NavLinks } from "./nav-links";
import { Logo } from "@/components/logo";
import { PopoverCloser } from "@/components/popover-closer";
import { BuilderFocusPicker } from "@/components/builder-focus-picker";
import { builderFocus } from "@/lib/builder-focus";
import { setBuilderFocus } from "./focus-actions";
import { Avatar, BuilderLogo, initials } from "@/components/avatar";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense fallback={<div className="h-[73px] border-b border-line" />}>
        <Header />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-6 sm:px-8">{children}</main>
      <Suspense>
        <PopoverCloser />
      </Suspense>
    </>
  );
}

async function Header() {
  const me = await requireProfile();
  const showDemo = demoModeOn() && me.email.endsWith("@demo.test");
  const company = me.role === "photographer" ? "Contractor" : isStaff(me.role) ? "Our team" : me.builder_name?.replace(" (demo)", "");

  // Open task count on the Tasks tab for our team, and the builder picker.
  let badges: Record<string, number> | undefined;
  let focusBuilders: { id: string; name: string }[] = [];
  const focus = await builderFocus(me.role);
  if (isStaff(me.role)) {
    const supabase = await createClient();
    let tq = supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["todo", "in_progress"]);
    if (focus) tq = tq.eq("builder_id", focus);
    const [{ count }, { data: bs }] = await Promise.all([tq, supabase.from("builders").select("id, name").order("name")]);
    badges = { "/tasks": count ?? 0 };
    focusBuilders = bs ?? [];
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur print:hidden">
      {showDemo && (
        <div className="bg-[#fff7e6] px-4 py-1.5 text-center text-xs text-[#7a5200]">
          You’re in the demo. Every builder, home and person here is made up.
        </div>
      )}
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-8">
        <Link href={me.role === "photographer" ? "/jobs" : isStaff(me.role) ? "/tasks" : "/communities"} className="shrink-0">
          <Logo compact />
        </Link>
        {me.builder_id && me.builder_logo_at && (
          <span className="hidden shrink-0 items-center gap-3 lg:flex">
            <span className="h-6 w-px bg-line" aria-hidden />
            <BuilderLogo builderId={me.builder_id} name={me.builder_name ?? ""} version={me.builder_logo_at} className="h-7 max-w-[120px]" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 justify-start md:justify-center">
          <NavLinks links={primaryTabs(me.role)} badges={badges} />
        </div>
        {isStaff(me.role) && focusBuilders.length > 1 && <BuilderFocusPicker builders={focusBuilders} current={focus} action={setBuilderFocus} />}

        <details data-popover className="relative shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-line py-1 pl-3 pr-1 transition-shadow hover:shadow-md">
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-foreground" aria-hidden>
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <Avatar id={me.id} name={me.full_name} version={me.avatar_updated_at} />
            <span className="sr-only">Menu</span>
          </summary>
          <div className="card-lift absolute right-0 z-40 mt-2 max-h-[80vh] w-80 overflow-y-auto rounded-2xl border border-line bg-white">
            <Link href="/account" className="flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-soft">
              <Avatar id={me.id} name={me.full_name} version={me.avatar_updated_at} className="h-10 w-10 text-sm" />
              <span className="min-w-0">
                <span className="block font-semibold">{me.full_name}</span>
                <span className="block text-sm text-muted">{ROLE_LABELS[me.role]}, {company}</span>
                <span className="block text-xs font-semibold text-accent">My profile and sign-in</span>
              </span>
            </Link>

            <nav className="border-b border-line p-2" aria-label="More">
              {menuLinks(me.role).map((l) => (
                <Link key={l.href} href={l.href} className="block rounded-xl px-3 py-2 hover:bg-soft">
                  <span className="block text-[15px] font-medium">{l.label}</span>
                  {l.hint && <span className="block text-xs text-muted">{l.hint}</span>}
                </Link>
              ))}
              <Link href="/help" className="block rounded-xl px-3 py-2 hover:bg-soft">
                <span className="block text-[15px] font-medium">Help and report an issue</span>
                <span className="block text-xs text-muted">Something broken or confusing? Tell us.</span>
              </Link>
            </nav>

            {showDemo && (
              <details className="border-b border-line">
                <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold hover:bg-soft">See the demo as someone else…</summary>
                <div className="p-2 pt-0">
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
              </details>
            )}

            <form action={signOut} className="p-2">
              <button className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-soft">Sign out</button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
