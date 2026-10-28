import { Suspense } from "react";
import { isPlatformAdmin } from "@/lib/auth";
import Link from "next/link";
import { BuilderLogo } from "@/components/avatar";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { ProgressBar } from "@/components/progress-bar";
import { cx } from "@/lib/format";
import { loadOnboarding, STAGES, STAGE_LABELS, type Onboarding, type Stage } from "@/lib/onboarding";
import { addBuilder, invitePerson, saveOnboarding } from "../actions";
import { pendingInvites } from "@/lib/invite-links";
import { InviteLink } from "@/components/invite-link";

export default function OnboardingAdmin(props: PageProps<"/admin/onboarding">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <OnboardingList />
    </Suspense>
  );
}

type Details = {
  builder_id: string;
  billing_contact_name: string | null;
  billing_contact_email: string | null;
  billing_contact_phone: string | null;
  pricing: string | null;
  agreement_signed_on: string | null;
  listing_authorization_on: string | null;
  notes: string | null;
};

const STAGE_STYLES: Record<Stage, string> = {
  getting_ready: "bg-amber-100 text-amber-900",
  invited: "bg-soft text-foreground",
  setting_up: "bg-accent-soft text-accent",
  community_ready: "bg-accent-soft text-accent",
  first_approved: "bg-emerald-50 text-emerald-800",
  live: "bg-emerald-600 text-white",
};

async function OnboardingList() {
  if (!(await isPlatformAdmin())) return null;
  const supabase = await createClient();
  const [{ data: builders }, { data: details }, { data: boards }, { data: branding }, { data: titles }] = await Promise.all([
    supabase.from("builders").select("id, name, legal_name").order("name"),
    supabase.from("builder_onboarding").select("builder_id, billing_contact_name, billing_contact_email, billing_contact_phone, pricing, agreement_signed_on, listing_authorization_on, notes"),
    supabase.from("mls_boards").select("code, short_name").eq("active", true).order("code"),
    supabase.from("builder_branding").select("builder_id, logo_updated_at, website_url"),
    supabase.from("builder_settings").select("builder_id, title_company_name, main_contact_name, main_contact_email, main_contact_phone"),
  ]);
  // Owners who haven't opened their invite yet get a copyable invite link on their card.
  const { data: owners } = await supabase.from("profiles").select("id, full_name, email, builder_id").eq("role", "builder_owner").eq("is_active", true).order("created_at");
  const pending = await pendingInvites((owners ?? []).map((o) => o.id));
  const pendingOwners = (owners ?? []).filter((o) => pending.has(o.id));
  const list = await loadOnboarding(supabase, (builders ?? []).map((b) => b.id), { staff: true });
  // Builders still onboarding first, earliest stage first; finished ones last.
  const sorted = [...list].sort((a, b) =>
    Number(!!a.finishedAt) - Number(!!b.finishedAt) || STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || a.builderName.localeCompare(b.builderName));
  const canInvite = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Each builder&rsquo;s path: we record the agreement and invite the owner, then their checklist ticks itself off as they add their team, communities and homes.
        </p>
        {sorted.map((ob) => (
          <BuilderCard
            key={ob.builderId}
            ob={ob}
            legalName={(builders ?? []).find((b) => b.id === ob.builderId)?.legal_name ?? ""}
            d={(details ?? []).find((x) => x.builder_id === ob.builderId) as Details | undefined}
            logoAt={(branding ?? []).find((x) => x.builder_id === ob.builderId)?.logo_updated_at ?? null}
            pendingOwners={pendingOwners.filter((o) => o.builder_id === ob.builderId)}
            fromBuilder={{
              settings: (titles ?? []).find((x) => x.builder_id === ob.builderId),
              website: (branding ?? []).find((x) => x.builder_id === ob.builderId)?.website_url ?? null,
              owner: (owners ?? []).find((o) => o.builder_id === ob.builderId),
            }}
            canInvite={canInvite}
          />
        ))}
        {sorted.length === 0 && <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-muted">No builders yet. Add the first one on the right.</p>}
      </div>

      <form id="add" action={addBuilder} className="h-fit scroll-mt-28 rounded-2xl border border-line p-5">
        <input type="hidden" name="back" value="/admin/onboarding" />
        <h2 className="font-semibold">Add a builder</h2>
        <p className="mt-1 text-sm text-muted">Their data stays completely separate from every other builder. Only the company name is needed now; fill in the rest as you get it.</p>
        <Field label="Company name (what they go by)" name="name" required placeholder="Lone Star Homes" />
        <Field label="Legal company name" name="legal_name" placeholder="Lone Star Homes, LLC" hint="Goes in the MLS Owner Name box. Must match their deeds." />
        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-medium">Where they build (MLS)</legend>
          <div className="space-y-1.5">
            {(boards ?? []).map((m) => (
              <label key={m.code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="mls" value={m.code} defaultChecked={m.code === "NTREIS"} className="h-4 w-4 accent-[#3452c7]" /> {m.short_name}
              </label>
            ))}
          </div>
        </fieldset>
        <h3 className="mt-6 text-sm font-semibold">Owner</h3>
        <p className="text-xs text-muted">{canInvite ? "You get an invite link on their card to send them. It opens a page where they choose a password, then their setup checklist." : "Invites are off until SUPABASE_SERVICE_ROLE_KEY is set in Vercel. You can add the owner later."}</p>
        <Field label="Owner’s name" name="owner_name" />
        <Field label="Owner’s email" name="owner_email" type="email" />
        <DetailFields />
        <button className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Add builder</button>
      </form>
    </div>
  );
}

type FromBuilder = {
  settings?: { title_company_name: string | null; main_contact_name: string | null; main_contact_email: string | null; main_contact_phone: string | null };
  website: string | null;
  owner?: { full_name: string; email: string };
};

function BuilderCard({ ob, legalName, d, logoAt, canInvite, fromBuilder, pendingOwners }: {
  ob: Onboarding; legalName: string; d?: Details; logoAt: string | null; canInvite: boolean; fromBuilder: FromBuilder;
  pendingOwners: { id: string; full_name: string }[];
}) {
  const ourOpen = ob.ourSteps.filter((s) => !s.done);
  const ownerMissing = ob.ourSteps.find((s) => s.key === "owner" && !s.done);
  const nextForThem = ob.steps.find((s) => !s.done);
  return (
    <section id={`b-${ob.builderId}`} className="scroll-mt-28 rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-center gap-4">
        <BuilderLogo builderId={ob.builderId} name={ob.builderName} version={logoAt} className="h-10 max-w-[100px]" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{ob.builderName}</h2>
          <p className="text-sm text-muted">
            {ob.finishedAt ? "Setup marked done" : nextForThem ? `Their next step: ${nextForThem.title.toLowerCase()}` : "Every step done"}
          </p>
        </div>
        <span className={cx("rounded-full px-3 py-1 text-xs font-semibold", STAGE_STYLES[ob.stage])}>{STAGE_LABELS[ob.stage]}</span>
      </div>

      <ProgressBar className="mt-4" done={ob.done} total={ob.total} label="Their checklist" />

      {ourOpen.length > 0 && (
        <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span className="font-semibold">Waiting on us:</span> {ourOpen.map((s) => s.title.toLowerCase()).join(", ")}.
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/setup?builder=${ob.builderId}`} className="rounded-lg border border-foreground px-3 py-1.5 text-sm font-semibold hover:bg-soft">Open their checklist</Link>
        <Link href="/admin/builders" className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-foreground">Markets and features</Link>
        <Link href={`/admin/people#${ob.builderId}`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-foreground">People</Link>
        <Link href={`/admin/billing/builders/${ob.builderId}`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-foreground">Billing plan</Link>
      </div>

      <FromBuilderSummary builderId={ob.builderId} f={fromBuilder} d={d} />

      {pendingOwners.map((o) => <div key={o.id} className="mt-4"><InviteLink profileId={o.id} name={o.full_name} /></div>)}

      {ownerMissing && (
        <form action={invitePerson} className="mt-4 grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="role" value="builder_owner" />
          <input type="hidden" name="builder_id" value={ob.builderId} />
          <input type="hidden" name="back" value="/admin/onboarding" />
          <label className="block text-sm"><span className="mb-1 block font-medium">Owner&rsquo;s name</span><input name="full_name" required className="field-input" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Owner&rsquo;s email</span><input name="email" type="email" required className="field-input" /></label>
          <button disabled={!canInvite} className="rounded-lg bg-foreground px-3 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">Add owner</button>
          {!canInvite && <p className="text-xs text-muted sm:col-span-3">Invites need SUPABASE_SERVICE_ROLE_KEY set in Vercel.</p>}
        </form>
      )}

      <details className="mt-4 rounded-xl border border-line" open={ourOpen.some((s) => s.key === "agreement" || s.key === "legal_name")}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Onboarding details (our team only)</summary>
        <form action={saveOnboarding} className="px-4 pb-4">
          <input type="hidden" name="builder_id" value={ob.builderId} />
          <Field label="Legal company name" name="legal_name" defaultValue={legalName} hint="Goes in the MLS Owner Name box. Must match their deeds." />
          <DetailFields d={d} />
          <button className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white hover:bg-black">Save details</button>
        </form>
      </details>
    </section>
  );
}

// What our team records (shared by Add a builder and each card). Billing
// contact, website, title company and main contact are the builder's to add on
// Company details; listing feed questions wait for the website feed step.
function DetailFields({ d }: { d?: Details }) {
  return (
    <>
      <h3 className="mt-6 text-sm font-semibold">Agreement</h3>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Service agreement signed" name="agreement_signed_on" type="date" defaultValue={d?.agreement_signed_on ?? ""} />
        <Field label="Listing authorization signed" name="listing_authorization_on" type="date" defaultValue={d?.listing_authorization_on ?? ""} hint="If our attorney requires one." />
      </div>
      <Field label="What we agreed (notes)" name="pricing" defaultValue={d?.pricing ?? ""} placeholder="e.g. Listing Service+, $350 per listing for year one" hint="The actual plan and prices that get invoiced are set on Admin > Billing." />
      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-medium">Notes</span>
        <textarea name="notes" rows={3} defaultValue={d?.notes ?? ""} className="field-input" />
      </label>
    </>
  );
}

// What the builder has added themselves, read-only here.
function FromBuilderSummary({ builderId, f, d }: { builderId: string; f: FromBuilder; d?: Details }) {
  const contact = f.settings?.main_contact_name
    ? [f.settings.main_contact_name, f.settings.main_contact_email, f.settings.main_contact_phone].filter(Boolean).join(" · ")
    : f.owner ? `${f.owner.full_name} (owner) · ${f.owner.email}` : null;
  const billing = d?.billing_contact_name ? [d.billing_contact_name, d.billing_contact_email, d.billing_contact_phone].filter(Boolean).join(" · ") : null;
  const rows: [string, string | null][] = [
    ["Main point of contact", contact],
    ["Billing contact", billing],
    ["Website", f.website?.replace(/^https?:\/\//, "") ?? null],
    ["Default title company", f.settings?.title_company_name ?? null],
  ];
  return (
    <div className="mt-4 rounded-xl bg-soft px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">From the builder</p>
        <Link href={`/company?builder=${builderId}`} className="text-xs font-semibold text-accent underline">Company details</Link>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[170px_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className={v ? "min-w-0 truncate" : "text-muted"}>{v ?? "Not added yet"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Field({ label, name, type = "text", required, placeholder, defaultValue, hint }: {
  label: string; name: string; type?: string; required?: boolean; placeholder?: string; defaultValue?: string; hint?: string;
}) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue} className="field-input" />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
