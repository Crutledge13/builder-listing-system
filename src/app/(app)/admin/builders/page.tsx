import { Suspense } from "react";
import { isPlatformAdmin } from "@/lib/auth";
import Link from "next/link";
import { BuilderLogo } from "@/components/avatar";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { renameBuilder, setBuilderMarkets } from "../actions";
import { FEATURES } from "@/lib/features";
import { planLabel } from "@/lib/billing";
import { BuilderListTools } from "@/components/builder-list-tools";
import { Chevron } from "@/components/chevron";

export default function BuildersAdmin(props: PageProps<"/admin/builders">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Builders />
    </Suspense>
  );
}

async function Builders() {
  if (!(await isPlatformAdmin())) return null;
  const supabase = await createClient();
  const [{ data: builders }, { data: communities }, { data: homes }, { data: people }, { data: boards }, { data: settings }] = await Promise.all([
    supabase.from("builders").select("id, name, created_at, builder_branding(logo_updated_at)").order("name"),
    supabase.from("communities").select("id, builder_id"),
    supabase.from("homes").select("builder_id").is("deleted_at", null),
    supabase.from("profiles").select("builder_id"),
    supabase.from("mls_boards").select("code, short_name, region").eq("active", true).order("code"),
    supabase.from("builder_settings").select("builder_id, mls_boards, mls_locked, mls_entry, features_off"),
  ]);
  const { data: billing } = await supabase.from("builder_billing").select("builder_id, plan, includes_photos");
  const planFor = (id: string) => (billing ?? []).find((x) => x.builder_id === id);
  const settingsFor = (id: string) => (settings ?? []).find((x) => x.builder_id === id);
  const tally = (rows: { builder_id: string | null }[] | null, id: string) => (rows ?? []).filter((r) => r.builder_id === id).length;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-3">
        <BuilderListTools count={(builders ?? []).length} />
        <div className="divide-y divide-line rounded-2xl border border-line">
        {(builders ?? []).map((b) => (
          <details key={b.id} id={b.id} data-builder-fold data-name={b.name} className="group scroll-mt-28">
            <summary className="flex flex-wrap items-center gap-4 p-4 hover:bg-soft">
              <BuilderLogo builderId={b.id} name={b.name} version={(b.builder_branding as unknown as { logo_updated_at: string | null } | null)?.logo_updated_at} className="h-9 max-w-[100px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{b.name}</div>
                <div className="text-sm text-muted">
                  {planLabel(planFor(b.id)?.plan, planFor(b.id)?.includes_photos)}
                  {` · ${tally(communities, b.id)} communities · ${tally(homes, b.id)} homes · ${tally(people, b.id)} people`}
                  {(settingsFor(b.id)?.mls_boards ?? []).length > 0 && ` · ${(settingsFor(b.id)?.mls_boards ?? []).join(", ")}`}
                </div>
              </div>
              <Chevron />
            </summary>
          <div className="flex flex-wrap items-center gap-4 border-t border-line p-4">
            <form action={renameBuilder} className="flex min-w-0 flex-1 items-center gap-2">
              <input type="hidden" name="id" value={b.id} />
              <label className="sr-only" htmlFor={`b-${b.id}`}>Builder name</label>
              <input id={`b-${b.id}`} name="name" defaultValue={b.name} className="field-input min-w-0 flex-1 font-semibold" />
              <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">Rename</button>
            </form>
            <div className="flex gap-4 text-sm text-muted">
              <Link href={`/admin/communities#${b.id}`} className="hover:text-foreground"><b className="text-foreground">{tally(communities, b.id)}</b> communities</Link>
              <span><b className="text-foreground">{tally(homes, b.id)}</b> homes</span>
              <Link href={`/admin/people#${b.id}`} className="hover:text-foreground"><b className="text-foreground">{tally(people, b.id)}</b> people</Link>
              <Link href={`/branding?builder=${b.id}`} className="hover:text-foreground">Branding</Link>
              <Link href={`/admin/onboarding#b-${b.id}`} className="hover:text-foreground">Onboarding</Link>
              <Link href={`/admin/billing/builders/${b.id}`} className="hover:text-foreground">Billing</Link>
            </div>
            <form action={setBuilderMarkets} className="w-full rounded-xl bg-soft p-3">
              <input type="hidden" name="builder_id" value={b.id} />
              <p className="text-sm font-medium">MLS markets this builder lists in</p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {(boards ?? []).map((m) => (
                  <label key={m.code} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="mls" value={m.code} defaultChecked={settingsFor(b.id)?.mls_boards?.includes(m.code)} className="h-4 w-4 accent-[#3452c7]" />
                    {m.short_name} <span className="text-muted">({m.region})</span>
                  </label>
                ))}
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" name="locked" defaultChecked={settingsFor(b.id)?.mls_locked ?? true} className="h-4 w-4 accent-[#3452c7]" />
                With one market, lock every home to it (owners, managers and our team can still override a home)
              </label>
              <fieldset className="mt-3 border-t border-line pt-3">
                <legend className="text-sm font-medium">Who enters listings in the MLS</legend>
                <label className="mt-1.5 flex items-start gap-2 text-sm">
                  <input type="radio" name="mls_entry" value="our_team" defaultChecked={(settingsFor(b.id)?.mls_entry ?? "our_team") === "our_team"} className="mt-0.5 h-4 w-4 accent-[#3452c7]" />
                  <span>Our team <span className="text-muted">(full service: MLS work comes to our task board)</span></span>
                </label>
                <label className="mt-1 flex items-start gap-2 text-sm">
                  <input type="radio" name="mls_entry" value="builder" defaultChecked={settingsFor(b.id)?.mls_entry === "builder"} className="mt-0.5 h-4 w-4 accent-[#3452c7]" />
                  <span>The builder&rsquo;s own team <span className="text-muted">(software only: their owners, managers and marketing get the MLS work sheets, notices and emails)</span></span>
                </label>
              </fieldset>
              <fieldset className="mt-3 border-t border-line pt-3">
                <legend className="text-sm font-medium">Features this builder has</legend>
                <p className="text-xs text-muted">Untick to hide a feature from this builder&rsquo;s team. Our team still sees everything.</p>
                <div className="mt-1.5 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                  {FEATURES.map((f) => (
                    <label key={f.key} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="feature" value={f.key} defaultChecked={!settingsFor(b.id)?.features_off?.includes(f.key)} className="mt-0.5 h-4 w-4 accent-[#3452c7]" />
                      <span>{f.label} <span className="text-muted">({f.hint})</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button className="mt-2 rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black">Save builder settings</button>
            </form>
          </div>
          </details>
        ))}
        </div>
      </div>

      <div className="h-fit rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Add a builder</h2>
        <p className="mt-1 text-sm text-muted">New builders start in Onboarding: their account, what we agreed, and the owner&rsquo;s invite in one form.</p>
        <Link href="/admin/onboarding#add" className="mt-4 block w-full rounded-xl bg-accent px-4 py-2.5 text-center font-semibold text-white hover:brightness-110">Add a builder</Link>
      </div>
    </div>
  );
}
