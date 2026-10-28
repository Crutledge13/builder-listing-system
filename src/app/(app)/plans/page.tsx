import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { builderFocus } from "@/lib/builder-focus";
import { canEditPlans, isStaff } from "@/lib/permissions";
import { AiCreditMeter } from "@/components/ai-credit-meter";
import { num } from "@/lib/format";
import { Notice } from "@/components/notice";
import { createPlan } from "./actions";

export default function PlansPage(props: PageProps<"/plans">) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Floor plans</h1>
      <p className="mt-1 text-muted">Each plan’s specs and room sizes. Homes pull their room list from their plan, which the MLS asks for.</p>
      <Suspense fallback={<div className="mt-8 h-64 animate-pulse rounded-2xl bg-soft" />}>
        <div className="mt-6"><Notice searchParams={props.searchParams} /></div>
        <Plans />
      </Suspense>
    </div>
  );
}

async function Plans() {
  const me = await requireProfile();
  if (me.role === "photographer") redirect("/jobs");
  const staff = isStaff(me.role);
  const canEdit = canEditPlans(me.role);
  const focus = await builderFocus(me.role);
  const supabase = await createClient();
  let q = supabase.from("floor_plans").select("id, name, bedrooms_total, bathrooms_full, bathrooms_half, living_area, stories, rooms, plan_file_path, active, builder_id, builders(name)").order("name");
  if (focus) q = q.eq("builder_id", focus);
  const [{ data }, { data: builders }] = await Promise.all([q, staff ? supabase.from("builders").select("id, name").order("name") : Promise.resolve({ data: null })]);
  const plans = (data ?? []) as unknown as { id: string; name: string; bedrooms_total: number | null; bathrooms_full: number | null; bathrooms_half: number | null; living_area: number | null; stories: number | null; rooms: unknown[]; plan_file_path: string | null; active: boolean; builder_id: string; builders: { name: string } | null }[];
  const byBuilder = new Map<string, typeof plans>();
  for (const p of plans) byBuilder.set(p.builders?.name ?? "", [...(byBuilder.get(p.builders?.name ?? "") ?? []), p]);

  return (
    <>
      {canEdit && <div className="mb-6"><AiCreditMeter builderId={me.builder_id} staff={staff} /></div>}
      {plans.length === 0 && <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">No floor plans yet.{canEdit ? " Add the first one below, then upload its plan file and AI reads the room sizes off it." : " Your team’s owners, managers or marketing can add them."}</p>}
      {[...byBuilder.entries()].map(([builder, list]) => (
        <section key={builder} className="mb-8">
          {(staff || byBuilder.size > 1) && <h2 className="mb-3 text-lg font-semibold">{builder.replace(" (demo)", "")}</h2>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => (
              <Link key={p.id} href={`/plans/${p.id}`} className="rounded-2xl border border-line p-4 hover:border-foreground">
                <p className="font-semibold">{p.name} {!p.active && <span className="ml-1 rounded bg-soft px-1.5 text-xs font-normal text-muted">Retired</span>}</p>
                <p className="mt-1 text-sm text-muted">
                  {[p.bedrooms_total != null ? `${p.bedrooms_total} bd` : null, p.bathrooms_full != null ? `${p.bathrooms_full + (p.bathrooms_half ?? 0) * 0.5} ba` : null, p.living_area ? `${num(p.living_area)} sq ft` : null, p.stories ? `${p.stories} story` : null].filter(Boolean).join(" · ")}
                </p>
                <p className={p.rooms.length ? "mt-2 text-sm text-emerald-800" : "mt-2 text-sm text-amber-900"}>
                  {p.rooms.length ? `${p.rooms.length} rooms with sizes` : "No room sizes yet"}{p.plan_file_path ? " · plan file" : ""}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {canEdit && (
        <details id="new" className="mt-4 scroll-mt-28 rounded-2xl border border-line" open={plans.length === 0}>
          <summary className="cursor-pointer list-none px-4 py-3 font-semibold">+ Add a floor plan</summary>
          <form action={createPlan} className="grid gap-3 border-t border-line p-4 sm:grid-cols-3">
            {staff && (
              <label className="block"><span className="mb-1 block text-sm font-medium">Builder</span>
                <select name="builder_id" required defaultValue={focus ?? ""} className="field-input">
                  <option value="" disabled>Choose</option>
                  {(builders ?? []).map((b) => <option key={b.id} value={b.id}>{b.name.replace(" (demo)", "")}</option>)}
                </select>
              </label>
            )}
            <label className={staff ? "block sm:col-span-2" : "block sm:col-span-3"}><span className="mb-1 block text-sm font-medium">Plan name</span><input name="name" required maxLength={80} placeholder="e.g. Brazos" className="field-input" /></label>
            <input type="hidden" name="rooms_json" value="[]" />
            <div className="sm:col-span-3"><button className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:brightness-110">Add plan</button>
              <span className="ml-3 text-sm text-muted">Then upload the plan file to read the room sizes off it.</span></div>
          </form>
        </details>
      )}
    </>
  );
}

