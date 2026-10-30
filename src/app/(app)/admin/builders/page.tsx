import { Suspense } from "react";
import { isPlatformAdmin } from "@/lib/auth";
import Link from "next/link";
import { BuilderLogo } from "@/components/avatar";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { addApprovedEmail, removeApprovedEmail, renameBuilder, setBuilderMarkets } from "../actions";
import { FEATURES } from "@/lib/features";
import { planLabel } from "@/lib/billing";
import { BuilderListTools } from "@/components/builder-list-tools";
import { Chevron } from "@/components/chevron";
import { loadApproved, type ApprovedEmail } from "@/lib/email-domains";
import { PendingButton } from "@/components/pending-button";

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
  const [{ data: billing }, approved] = await Promise.all([
    supabase.from("builder_billing").select("builder_id, plan, includes_photos"),
    loadApproved(supabase),
  ]);
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
                  {` · ${plural(tally(communities, b.id), "community", "communities")} · ${plural(tally(homes, b.id), "home", "homes")} · ${plural(tally(people, b.id), "person", "people")}`}
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
            <ApprovedEmails builderId={b.id} rows={approved.filter((a) => a.builder_id === b.id)} />
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

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

// Who can be added to this builder: their email domains, plus anyone our team
// approved one at a time. The database refuses everyone else.
function ApprovedEmails({ builderId, rows }: { builderId: string; rows: ApprovedEmail[] }) {
  return (
    <section className="w-full rounded-xl bg-soft p-3">
      <p className="text-sm font-medium">Approved email domains</p>
      <p className="text-xs text-muted">
        {rows.length
          ? "Only people with these emails can be added to this builder (invites, their Team page and join links)."
          : "Not locked yet: anyone can be added. Add the builder’s own domain to lock it."}
      </p>
      {rows.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 rounded-full border border-line bg-white py-1 pl-3 pr-1 text-sm" title={r.reason ?? undefined}>
              <span className="font-medium">{r.kind === "domain" ? `@${r.value}` : r.value}</span>
              {r.reason && <span className="text-xs text-muted">({r.reason})</span>}
              <form action={removeApprovedEmail}>
                <input type="hidden" name="id" value={r.id} />
                <PendingButton pending="…" confirm={`Remove ${r.value}? People already set up keep their access.`} className="rounded-full px-2 py-0.5 text-muted hover:bg-soft hover:text-red-700">×</PendingButton>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={addApprovedEmail} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="builder_id" value={builderId} />
        <label className="block min-w-48 flex-1 text-xs">
          <span className="mb-1 block font-medium">Domain or exact email</span>
          <input name="value" required placeholder="acmehomes.com or jane@agency.com" autoCapitalize="none" className="field-input py-2 text-sm" />
        </label>
        <label className="block min-w-40 flex-1 text-xs">
          <span className="mb-1 block font-medium">Why (for an exception)</span>
          <input name="reason" maxLength={300} placeholder="e.g. Their outside marketing agency" className="field-input py-2 text-sm" />
        </label>
        <PendingButton pending="Approving…" className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">Approve</PendingButton>
      </form>
      <p className="mt-1 text-xs text-muted">Gmail, Yahoo, Outlook and other personal email services can only be approved one exact address at a time.</p>
    </section>
  );
}
