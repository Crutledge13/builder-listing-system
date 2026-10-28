import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { loadOnboarding, type Step, type StepKey } from "@/lib/onboarding";
import { skipStep } from "@/app/(app)/setup/actions";
import { PendingButton } from "@/components/pending-button";

// Back / Next for the setup checklist, shown along the bottom of each page a
// checklist step sends people to (branding, company details, team, community
// setup, floor plans, add a home…) while their builder's setup is still open.
// `steps` are the checklist steps this page covers; `path` is this page's own
// address, so Next can skip steps that live on the same page.
export function SetupNav(props: { steps: StepKey[]; path: string; sticky?: boolean }) {
  return (
    <Suspense>
      <Nav {...props} />
    </Suspense>
  );
}

const pageOf = (href: string) => href.split(/[?#]/)[0];

async function Nav({ steps: keys, path, sticky = true }: { steps: StepKey[]; path: string; sticky?: boolean }) {
  const me = await requireProfile();
  if (!me.builder_id || !["builder_owner", "manager", "marketing"].includes(me.role)) return null;
  const supabase = await createClient();
  const [ob] = await loadOnboarding(supabase, [me.builder_id], { staff: false });
  if (!ob || ob.finishedAt) return null;

  // Everything's done: take the checklist off the top tabs (it stays in the menu).
  if (ob.done === ob.total) {
    await supabase.rpc("finish_setup", { p_builder: me.builder_id, p_done: true });
    return (
      <SetupBar sticky={sticky}>
        <p className="text-sm font-semibold">That’s every setup step done. Setup is now in the menu if you need it again.</p>
        <Link href="/communities" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Go to your communities</Link>
      </SetupBar>
    );
  }

  const list = ob.steps;
  const here = list.filter((s) => keys.includes(s.key));
  if (!here.length) return null;
  const current = here.find((s) => !s.done) ?? here[0];
  const i = list.indexOf(current);
  const first = list.indexOf(here[0]);
  const last = list.indexOf(here[here.length - 1]);

  // Back: the step before this page's steps. Next: the next step still to do
  // on another page (or the same step on another page, e.g. the next community).
  const back: Step | undefined = list[first - 1];
  let next: Step | undefined;
  if (!current.done && pageOf(current.href) !== path) next = current;
  else next = list.slice(last + 1).find((s) => !s.done) ?? list.slice(0, first).find((s) => !s.done);
  const nextHref = next?.href ?? "/setup";
  const nextLabel = !next ? "Back to the checklist" : next === current ? (current.key === "community_setup" ? "Next community" : "Next") : `Next: ${next.title}`;

  return (
    <SetupBar sticky={sticky}>
      <div className="flex min-w-0 items-center gap-2">
        <Link href={back?.href ?? "/setup"} className="rounded-xl border border-line px-3 py-2 text-sm font-semibold hover:border-foreground" title={back ? `Back: ${back.title}` : "Back to the checklist"}>
          ← Back
        </Link>
        <Link href="/setup" className="min-w-0 text-sm">
          <span className="block text-xs text-muted">Setup step {i + 1} of {list.length} · {ob.done} done</span>
          <span className="block truncate font-semibold hover:underline">{current.title}</span>
        </Link>
      </div>
      <div className="flex items-center gap-3">
        {current.skipKey && !current.done && (
          <form action={skipStep}>
            <input type="hidden" name="builder_id" value={ob.builderId} />
            <input type="hidden" name="step" value={current.skipKey} />
            <input type="hidden" name="skip" value="true" />
            <input type="hidden" name="next" value={nextHref} />
            <PendingButton pending="Skipping…" className="text-sm font-medium text-muted underline hover:text-foreground">{current.skipLabel ?? "Skip this for later"}</PendingButton>
          </form>
        )}
        <Link href={nextHref} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
          {nextLabel} →
        </Link>
      </div>
    </SetupBar>
  );
}

function SetupBar({ children, sticky }: { children: React.ReactNode; sticky: boolean }) {
  return (
    <div className={`${sticky ? "sticky bottom-0 z-20" : ""} mt-10 border-t border-line bg-white/95 py-3 backdrop-blur print:hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3">{children}</div>
    </div>
  );
}
