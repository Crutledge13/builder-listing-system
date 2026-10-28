import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadOnboarding } from "@/lib/onboarding";
import { ProgressBar } from "@/components/progress-bar";

// On the start page while a builder's setup checklist is open (owners and
// managers only): how far along they are and the next thing to do.
export async function SetupBanner({ builderId }: { builderId: string }) {
  const supabase = await createClient();
  const [ob] = await loadOnboarding(supabase, [builderId], { staff: false });
  if (!ob || ob.finishedAt) return null;
  const next = ob.steps.find((s) => !s.done);
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-accent/30 bg-accent-soft p-5">
      <div className="min-w-[220px] flex-1">
        <p className="font-semibold">Finish setting up {ob.builderName}</p>
        <p className="mt-0.5 text-sm text-muted">{next ? <>Next: {next.title.toLowerCase()}.</> : "Everything’s done. Mark setup done to hide this."}</p>
        <ProgressBar className="mt-3 max-w-md" done={ob.done} total={ob.total} />
      </div>
      <Link href="/setup" className="rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110">
        {ob.done === 0 ? "Start setup" : "Continue setup"}
      </Link>
    </div>
  );
}
