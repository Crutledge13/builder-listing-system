import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canAddHomes, isStaff, ROLE_LABELS, STAGE_LABELS } from "@/lib/permissions";
import { createHome } from "./actions";
import { questionSections, SectionFields } from "@/components/ntreis-questions";
import { FormSteps } from "@/components/form-steps";
import { NtreisToggle } from "@/components/ntreis-toggle";

export default function NewHomePage(props: PageProps<"/homes/new">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <NewHomeForm searchParams={props.searchParams} />
    </Suspense>
  );
}

type Input = { name: string; label: string; type?: string; step?: string; placeholder?: string; required?: boolean; wide?: boolean; help?: string };

async function NewHomeForm({ searchParams }: { searchParams: PageProps<"/homes/new">["searchParams"] }) {
  const { error, community: preset } = await searchParams;
  const me = await requireProfile();

  if (!canAddHomes(me.role)) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-[28px] font-bold tracking-tight">Adding homes isn’t part of your role</h1>
        <p className="mt-3 text-muted">
          As {ROLE_LABELS[me.role].toLowerCase()}, you can work on homes once they’re added. Ask your
          sales team, a manager or the owner to add new ones.
        </p>
        <Link href="/homes" className="mt-6 inline-block rounded-xl border border-foreground px-5 py-2.5 font-semibold">Back to homes</Link>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: communities }, { data: boards }, { data: settings }] = await Promise.all([
    supabase.from("communities").select("id, name, city, builder_id, mls_board, builders(name)").order("name"),
    supabase.from("mls_boards").select("code, short_name, region").eq("active", true).order("code"),
    supabase.from("builder_settings").select("builder_id, mls_boards, mls_locked"),
  ]);
  const staff = isStaff(me.role);
  const canPickMls = ["platform_admin", "listing_coordinator", "builder_owner", "manager"].includes(me.role);
  const boardName = new Map((boards ?? []).map((b) => [b.code, b.short_name]));
  const mine = (settings ?? []).find((x) => x.builder_id === me.builder_id);
  const lockedBoard = !staff && mine?.mls_locked && mine.mls_boards?.length === 1 ? mine.mls_boards[0] : null;
  const communityBoards = Object.fromEntries((communities ?? []).map((c) => [c.id, c.mls_board ?? null]));

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/homes" className="text-sm font-medium text-muted hover:text-foreground">Cancel</Link>
      <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight">Add a home</h1>
      <p className="mt-1 text-muted">
        Step by step, in the same order as NTREIS. It’s saved as a draft, so fill in what you know now and finish the rest later.
      </p>

      {typeof error === "string" && <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <form id="new-home" action={createHome} className="mt-8">
        <FormSteps formId="new-home" steps={[{ title: "The home" }, ...questionSections("new").map((q) => ({ title: q.title, ntreisOnly: q.ntreisOnly }))]}>
          <div className="divide-y divide-line">
        <section className="pb-8 pt-4">
          <h3 className="text-lg font-semibold">Where is it?</h3>
          <div className="mt-4 grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <label data-required="Community" className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Community <span aria-hidden className="text-red-700">*</span></span>
              <select name="community_id" required defaultValue={typeof preset === "string" ? preset : ""} className="field-input">
                <option value="" disabled>Choose a community</option>
                {communities?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}, {c.city}
                    {staff ? ` (${(c.builders as unknown as { name: string })?.name.replace(" (demo)", "")})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <Text name="unparsed_address" label="Street address" placeholder="1214 Pecan Ridge Dr" required wide help="Number, street and type, e.g. 1214 Pecan Ridge Dr. We split it into Matrix’s separate street boxes." />
            <Text name="city" label="City" placeholder="Leave blank to use the community’s city" />
            <Text name="postal_code" label="ZIP" required />
            <Text name="lot_number" label="Your lot reference" placeholder="B3-L12" help="However your team refers to the lot. The plat's lot and block numbers for the MLS are asked further down." />
            <Text name="plan_name" label="Floor plan" placeholder="Brazos" />
          </div>
        </section>

        <section className="py-8">
          <h3 className="text-lg font-semibold">Which MLS?</h3>
          <p className="mt-1 text-sm text-muted">Each MLS asks for slightly different fields, so this decides what the home needs before it can go live.</p>
          {lockedBoard ? (
            <div className="mt-4 rounded-xl bg-soft px-4 py-3 text-sm">
              <b>{boardName.get(lockedBoard) ?? lockedBoard}</b>: every home for your company goes to this MLS.
              {canPickMls && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold underline">Override for this home</summary>
                  <select name="mls_board" defaultValue="" className="field-input mt-2">
                    <option value="">Keep {boardName.get(lockedBoard) ?? lockedBoard}</option>
                    {(boards ?? []).filter((b) => b.code !== lockedBoard).map((b) => <option key={b.code} value={b.code}>{b.short_name} ({b.region})</option>)}
                  </select>
                </details>
              )}
            </div>
          ) : canPickMls ? (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-medium">MLS</span>
              <select name="mls_board" defaultValue="" className="field-input">
                <option value="">Suggested: the community’s MLS (by county)</option>
                {(boards ?? []).map((b) => <option key={b.code} value={b.code}>{b.short_name} ({b.region})</option>)}
              </select>
            </label>
          ) : (
            <p className="mt-4 rounded-xl bg-soft px-4 py-3 text-sm">The MLS is picked from the community. A manager or owner can change it on the home.</p>
          )}
          {!lockedBoard && (
            <ul className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2">
              {(communities ?? []).map((c) => (
                <li key={c.id}>{c.name}: {c.mls_board ? boardName.get(c.mls_board) ?? c.mls_board : "not set"}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="py-8">
          <h3 className="text-lg font-semibold">Build stage</h3>
          <label className="mt-4 block max-w-sm">
            <select name="build_stage" defaultValue="under_construction" className="field-input">
              {Object.entries(STAGE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <span className="mt-1 block text-xs leading-snug text-muted">
              Sets NTREIS&rsquo;s construction status for you: To be built is Proposed, Under construction is New Construction - Incomplete, Move-in ready is New Construction - Complete.
            </span>
          </label>
        </section>

            <div className="pt-6">
              <NtreisToggle formId="new-home" communityBoards={communityBoards} lockedBoard={lockedBoard} />
            </div>
          </div>
          {questionSections("new").map((q) => (
            <SectionFields
              key={q.title}
              title={q.title}
              mode="new"
              extra={
                q.title === "Rooms" ? (
                  <div data-other-mls="" hidden>
                    <Text name="stories" label="Stories" type="number" />
                  </div>
                ) : undefined
              }
            />
          ))}
        </FormSteps>
      </form>
    </div>
  );
}

function Text({ name, label, type = "text", step, placeholder, required, wide, help }: Input) {
  return (
    <label data-required={required ? label : undefined} className={wide ? "block sm:col-span-2" : "block"}>
      <span className="block text-sm font-medium">
        {label}
        {required && <span aria-hidden className="text-red-700"> *</span>}
      </span>
      {help && <span className="mt-0.5 block text-xs leading-snug text-muted">{help}</span>}
      <input name={name} type={type} step={step} placeholder={placeholder} required={required} className="field-input mt-1.5" />
    </label>
  );
}
