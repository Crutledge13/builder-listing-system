import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, DEMO_ADMIN, DEMO_USERS, demoModeOn } from "@/lib/auth";
import { isStaff, roleLabel } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { menuLinks, primaryTabs } from "@/lib/menu";
import { enterOwnMls } from "@/lib/mls-entry";
import { featuresOff } from "@/lib/features";
import { setupOpen } from "@/lib/onboarding";
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
  // A broker only reaches this layout on /welcome (choosing their password; the
  // sign-in router keeps them out of everything else): a plain bar, no menus.
  // Backup to the sign-in router: a broker who has already chosen a password has
  // no reason to be here at all.
  if (me.role === "broker") {
    const { data: auth } = await (await createClient()).auth.getClaims();
    if (!(auth?.claims?.user_metadata as Record<string, unknown> | undefined)?.needs_password) redirect("/broker");
    return <div className="border-b border-line px-4 py-4 sm:px-8"><Logo /></div>;
  }
  const showDemo = demoModeOn() && me.email.endsWith("@demo.test");
  const company = me.role === "photographer" ? "Contractor" : isStaff(me.role) ? "Our team" : me.builder_name?.replace(" (demo)", "");

  // Open task count on the Tasks tab for our team, and the builder picker.
  // Everything the header needs is asked for at the same time, not one after another.
  let badges: Record<string, number> | undefined;
  const supabase = await createClient();
  const [ownMls, off, openSetup, focus, { count: unread }] = await Promise.all([
    enterOwnMls(me.role, me.builder_id),
    featuresOff(me.role, me.builder_id),
    setupOpen(supabase, me.role, me.builder_id),
    builderFocus(me.role),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  let focusBuilders: { id: string; name: string }[] = [];
  if (isStaff(me.role)) {
    let tq = supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["todo", "in_progress"]);
    if (focus) tq = tq.eq("builder_id", focus);
    const [{ count }, { data: bs }] = await Promise.all([tq, supabase.from("builders").select("id, name").order("name")]);
    badges = { "/tasks": count ?? 0 };
    focusBuilders = bs ?? [];
  } else if (["builder_owner", "manager", "marketing"].includes(me.role)) {
    const [{ count }, { count: mls }] = await Promise.all([
      off.has("builder_tasks")
        ? Promise.resolve({ count: 0 })
        : supabase.from("builder_tasks").select("id", { count: "exact", head: true }).in("status", ["todo", "in_progress"]),
      ownMls ? supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["todo", "in_progress"]) : Promise.resolve({ count: 0 }),
    ]);
    badges = { "/todo": count ?? 0, "/tasks": mls ?? 0 };
  }


  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur print:hidden">
      {showDemo && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[#fff7e6] px-4 py-1.5 text-center text-xs text-[#7a5200]">
          {me.email === DEMO_ADMIN.email ? (
            <span>You’re in the demo as {DEMO_ADMIN.label} (admin), seeing everything. Every builder, home and person here is made up.</span>
          ) : (
            <>
              <span>
                Demo: viewing as <b>{me.full_name}</b> ({roleLabel(me.role, me.online_sales).toLowerCase()}{me.builder_name ? `, ${me.builder_name.replace(" (demo)", "")}` : ""}).
              </span>
              {/* One click back to the admin view, from any role. */}
              <form action={switchDemoUser}>
                <input type="hidden" name="email" value={DEMO_ADMIN.email} />
                <button className="rounded-full bg-[#7a5200] px-3 py-0.5 font-semibold text-white hover:bg-black">Back to {DEMO_ADMIN.label} (admin)</button>
              </form>
            </>
          )}
        </div>
      )}
      {/* Phones and upright tablets: logo, picker, bell and menu on one row; the tabs get their own row below (swipe sideways if there are many). */}
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-8 sm:py-3">
        <Link href={me.role === "photographer" ? "/jobs" : isStaff(me.role) ? "/tasks" : "/communities"} className="shrink-0">
          <Logo compact />
        </Link>
        {me.builder_id && me.builder_logo_at && (
          <span className="hidden shrink-0 items-center gap-3 lg:flex">
            <span className="h-6 w-px bg-line" aria-hidden />
            <BuilderLogo builderId={me.builder_id} name={me.builder_name ?? ""} version={me.builder_logo_at} className="h-7 max-w-[120px]" />
          </span>
        )}
        <div className="hidden min-w-0 flex-1 justify-center lg:flex">
          <NavLinks links={primaryTabs(me.role, ownMls, off, openSetup)} badges={badges} />
        </div>
        <div className="flex-1 lg:hidden" aria-hidden />
        {isStaff(me.role) && focusBuilders.length > 1 && <BuilderFocusPicker builders={focusBuilders} current={focus} action={setBuilderFocus} />}

        <Link href="/inbox" className="relative shrink-0 rounded-full p-2 hover:bg-soft" aria-label={unread ? `Inbox, ${unread} new` : "Inbox"} title="Inbox">
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
            <path d="M10 2.5a5 5 0 0 0-5 5v3l-1.5 3h13L15 10.5v-3a5 5 0 0 0-5-5zM8 15.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          {!!unread && (
            <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-[18px] text-white">{unread > 99 ? "99+" : unread}</span>
          )}
        </Link>
        <details data-popover className="relative shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-line py-1 pl-3 pr-1 transition-shadow hover:shadow-md">
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-foreground" aria-hidden>
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <Avatar id={me.id} name={me.full_name} version={me.avatar_updated_at} />
            <span className="sr-only">Menu</span>
          </summary>
          <div className="card-lift absolute right-0 z-40 mt-2 max-h-[80vh] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-line bg-white">
            <Link href="/account" className="flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-soft">
              <Avatar id={me.id} name={me.full_name} version={me.avatar_updated_at} className="h-10 w-10 text-sm" />
              <span className="min-w-0">
                <span className="block font-semibold">{me.full_name}</span>
                <span className="block text-sm text-muted">{roleLabel(me.role, me.online_sales)}, {company}</span>
                <span className="block text-xs font-semibold text-accent">My profile and sign-in</span>
              </span>
            </Link>

            <nav className="border-b border-line p-2" aria-label="More">
              {menuLinks(me.role, off).map((l) => (
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
      <div className="mx-auto max-w-7xl border-t border-line px-2 py-1 sm:px-6 lg:hidden">
        <NavLinks links={primaryTabs(me.role, ownMls, off, openSetup)} badges={badges} />
      </div>
    </header>
  );
}
