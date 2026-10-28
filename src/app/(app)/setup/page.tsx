import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { builderFocus } from "@/lib/builder-focus";
import { isStaff } from "@/lib/permissions";
import { cx } from "@/lib/format";
import { Notice } from "@/components/notice";
import { ProgressBar } from "@/components/progress-bar";
import { canRunSetup, GROUP_TITLES, loadOnboarding, STAGE_LABELS, type Onboarding, type Step } from "@/lib/onboarding";
import { finishSetup, skipStep } from "./actions";

export default function SetupPage(props: PageProps<"/setup">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Setup searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Setup({ searchParams }: { searchParams: PageProps<"/setup">["searchParams"] }) {
  const me = await requireProfile();
  if (!canRunSetup(me.role)) redirect("/communities");
  const staff = isStaff(me.role);
  const sp = await searchParams;
  const supabase = await createClient();

  // Our team picks a builder (or uses the one in the top-bar focus).
  const builderId = staff ? (typeof sp.builder === "string" ? sp.builder : await builderFocus(me.role)) : me.builder_id;
  if (!builderId) return <PickBuilder />;

  const [ob] = await loadOnboarding(supabase, [builderId], { staff });
  if (!ob || (staff && !ob.builderName)) return <PickBuilder />;

  const groups = (["company", "communities", "homes"] as const).map((g) => ({ g, steps: ob.steps.filter((s) => s.group === g) }));
  const allDone = ob.done === ob.total;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">
        {staff ? `${ob.builderName}: setup checklist` : `Set up ${ob.builderName}`}
      </h1>
      <p className="mt-1 text-muted">
        {staff
          ? <>What {ob.builderName} still needs to do. Stage: <b className="font-medium text-foreground">{STAGE_LABELS[ob.stage]}</b>. <Link href={`/admin/onboarding#b-${ob.builderId}`} className="underline">Onboarding details</Link></>
          : "Work through these in order. Each one ticks itself off once it’s done, and you can stop and come back any time."}
      </p>

      <ProgressBar className="mt-6" done={ob.done} total={ob.total} label={allDone ? "Everything’s done" : "Steps done"} />

      {staff && <StepGroup title={GROUP_TITLES.ours} steps={ob.ourSteps} ob={ob} staff />}
      {groups.map(({ g, steps }) => <StepGroup key={g} title={GROUP_TITLES[g]} steps={steps} ob={ob} staff={staff} />)}

      <div className="mt-10 rounded-2xl bg-soft p-5">
        {ob.finishedAt ? (
          <form action={finishSetup} className="flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="builder_id" value={ob.builderId} />
            <input type="hidden" name="done" value="false" />
            <p className="text-sm">Setup was marked done on {new Date(ob.finishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Chicago" })}.</p>
            <button className="rounded-lg border border-foreground px-3 py-1.5 text-sm font-semibold hover:bg-white">Reopen the checklist</button>
          </form>
        ) : (
          <form action={finishSetup} className="flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="builder_id" value={ob.builderId} />
            <input type="hidden" name="done" value="true" />
            <p className="text-sm">
              {allDone ? "That’s everything. Mark setup done to take the checklist off your start page." : "Done for now? You can hide the checklist and finish the rest later from the menu."}
            </p>
            <button className={cx("rounded-lg px-4 py-2 text-sm font-semibold", allDone ? "bg-accent text-white hover:brightness-110" : "border border-foreground hover:bg-white")}>
              {allDone ? "We’re all set" : "Hide the checklist"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function StepGroup({ title, steps, ob, staff }: { title: string; steps: Step[]; ob: Onboarding; staff: boolean }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ol className="mt-3 divide-y divide-line rounded-2xl border border-line">
        {steps.map((s) => (
          <li key={s.key} id={`step-${s.key}`} className="flex gap-4 p-4">
            <StatusDot done={s.done} skipped={s.skipped} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={cx("font-semibold", s.done && !s.skipped && "text-muted line-through decoration-1")}>{s.title}</span>
                {s.optional && <span className="rounded-full bg-soft px-2 py-px text-[11px] font-medium text-muted">Optional</span>}
                {s.ourTeam && <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] font-semibold text-accent">Our team does this</span>}
                {s.skipped && <span className="text-xs text-muted">Skipped</span>}
              </div>
              <p className="mt-0.5 text-sm text-muted">{s.why}</p>
              {s.detail && <p className="mt-1 text-sm">{s.detail}</p>}
              {s.key === "community_setup" && ob.communities.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {ob.communities.map((c) => (
                    <li key={c.id}>
                      <Link href={`/communities/${c.id}/setup`} className="group block rounded-xl border border-line px-3 py-2.5 hover:border-foreground">
                        <ProgressBar done={c.filled} total={c.required} label={c.name} />
                        {c.missing.length > 0 && <p className="mt-1 truncate text-xs text-muted group-hover:text-foreground">Needs: {c.missing.join(", ")}</p>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {(!s.done || s.key === "community_setup" || s.key === "team") && (
                <Link href={staff ? staffHref(s.href, ob.builderId) : s.href} className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold", s.done ? "border border-line hover:border-foreground" : "bg-foreground text-white hover:bg-black")}>
                  {s.done ? "Open" : s.cta}
                </Link>
              )}
              {s.optional && !s.done && (
                <SkipButton builderId={ob.builderId} step={s.key} skip label={s.skipLabel ?? "Skip"} />
              )}
              {s.skipped && <SkipButton builderId={ob.builderId} step={s.key} skip={false} label="Put it back" />}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Our team opens the same screens for a given builder.
function staffHref(href: string, builderId: string) {
  if (href === "/team") return `/admin/people#${builderId}`;
  if (href.startsWith("/branding")) return href.replace("/branding", `/branding?builder=${builderId}`);
  return href;
}

function SkipButton({ builderId, step, skip, label }: { builderId: string; step: string; skip: boolean; label: string }) {
  return (
    <form action={skipStep}>
      <input type="hidden" name="builder_id" value={builderId} />
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="skip" value={String(skip)} />
      <button className="text-xs font-medium text-muted underline hover:text-foreground">{label}</button>
    </form>
  );
}

function StatusDot({ done, skipped }: { done: boolean; skipped?: boolean }) {
  if (skipped) {
    return <span aria-label="Skipped" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line" />;
  }
  return done ? (
    <span aria-label="Done" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden><path d="m4 8.5 2.5 2.5L12 5.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  ) : (
    <span aria-label="Not done yet" className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 border-line" />
  );
}

async function PickBuilder() {
  const supabase = await createClient();
  const { data: builders } = await supabase.from("builders").select("id, name").order("name");
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Builder setup checklists</h1>
      <p className="mt-1 text-muted">Pick a builder to see what they still need to do. Admin &gt; Onboarding shows every builder at once.</p>
      <ul className="mt-6 divide-y divide-line rounded-2xl border border-line">
        {(builders ?? []).map((b) => (
          <li key={b.id}>
            <Link href={`/setup?builder=${b.id}`} className="block px-4 py-3 font-medium hover:bg-soft">{b.name.replace(" (demo)", "")}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
