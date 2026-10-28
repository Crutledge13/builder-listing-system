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
import { TitleCompanyFields } from "@/components/title-company-fields";
import { TITLE_COMPANY_SELECT, type TitleCompany } from "@/lib/mls-fields";

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
  website_platform: string | null;
  sends_listing_feed: string;
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
    supabase.from("builder_onboarding").select("builder_id, billing_contact_name, billing_contact_email, billing_contact_phone, pricing, agreement_signed_on, listing_authorization_on, website_platform, sends_listing_feed, notes"),
    supabase.from("mls_boards").select("code, short_name").eq("active", true).order("code"),
    supabase.from("builder_branding").select("builder_id, logo_updated_at"),
    supabase.from("builder_settings").select(`builder_id, ${TITLE_COMPANY_SELECT}`),
  ]);
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
            title={(titles ?? []).find((x) => (x as { builder_id: string }).builder_id === ob.builderId) as TitleCompany | undefined}
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
        <p className="text-xs text-muted">{canInvite ? "They get an email to set a password, then see their setup checklist." : "Invites are off until SUPABASE_SERVICE_ROLE_KEY is set in Vercel. You can invite them later."}</p>
        <Field label="Owner’s name" name="owner_name" />
        <Field label="Owner’s email" name="owner_email" type="email" />
        <DetailFields />
        <button className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Add builder</button>
      </form>
    </div>
  );
}

function BuilderCard({ ob, legalName, d, logoAt, canInvite, title }: { ob: Onboarding; legalName: string; d?: Details; logoAt: string | null; canInvite: boolean; title?: TitleCompany }) {
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
      </div>

      {ownerMissing && (
        <form action={invitePerson} className="mt-4 grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <input type="hidden" name="role" value="builder_owner" />
          <input type="hidden" name="builder_id" value={ob.builderId} />
          <input type="hidden" name="back" value="/admin/onboarding" />
          <label className="block text-sm"><span className="mb-1 block font-medium">Owner&rsquo;s name</span><input name="full_name" required className="field-input" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Owner&rsquo;s email</span><input name="email" type="email" required className="field-input" /></label>
          <button disabled={!canInvite} className="rounded-lg bg-foreground px-3 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">Invite owner</button>
          {!canInvite && <p className="text-xs text-muted sm:col-span-3">Invites need SUPABASE_SERVICE_ROLE_KEY set in Vercel.</p>}
        </form>
      )}

      <details className="mt-4 rounded-xl border border-line" open={ourOpen.some((s) => s.key === "agreement" || s.key === "legal_name")}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Onboarding details (our team only)</summary>
        <form action={saveOnboarding} className="px-4 pb-4">
          <input type="hidden" name="builder_id" value={ob.builderId} />
          <Field label="Legal company name" name="legal_name" defaultValue={legalName} hint="Goes in the MLS Owner Name box. Must match their deeds." />
          <DetailFields d={d} t={title} />
          <button className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white hover:bg-black">Save details</button>
        </form>
      </details>
    </section>
  );
}

// The details we collect before the invite (shared by Add a builder and each card).
function DetailFields({ d, t }: { d?: Details; t?: TitleCompany }) {
  return (
    <>
      <h3 className="mt-6 text-sm font-semibold">Default title company</h3>
      <p className="mb-2 text-xs text-muted">Goes on every listing; a community can use a different one. The builder can change it on Company branding.</p>
      <TitleCompanyFields t={t} />
      <h3 className="mt-6 text-sm font-semibold">Agreement</h3>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Service agreement signed" name="agreement_signed_on" type="date" defaultValue={d?.agreement_signed_on ?? ""} />
        <Field label="Listing authorization signed" name="listing_authorization_on" type="date" defaultValue={d?.listing_authorization_on ?? ""} hint="If our attorney requires one." />
      </div>
      <Field label="What we charge" name="pricing" defaultValue={d?.pricing ?? ""} placeholder="e.g. monthly plus per listing" />
      <h3 className="mt-6 text-sm font-semibold">Billing contact</h3>
      <Field label="Name" name="billing_contact_name" defaultValue={d?.billing_contact_name ?? ""} />
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Email" name="billing_contact_email" type="email" defaultValue={d?.billing_contact_email ?? ""} />
        <Field label="Phone" name="billing_contact_phone" defaultValue={d?.billing_contact_phone ?? ""} />
      </div>
      <h3 className="mt-6 text-sm font-semibold">Their website</h3>
      {!d && <Field label="Website address" name="website_url" placeholder="https://" />}
      <Field label="What runs it" name="website_platform" defaultValue={d?.website_platform ?? ""} placeholder="e.g. WordPress, a custom site" />
      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-medium">Already sends a listing feed to Zillow or new-home sites?</span>
        <select name="sends_listing_feed" defaultValue={d?.sends_listing_feed ?? "unknown"} className="field-input">
          <option value="unknown">Not sure yet</option>
          <option value="yes">Yes: ask for a copy of that feed</option>
          <option value="no">No</option>
        </select>
      </label>
      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-medium">Notes</span>
        <textarea name="notes" rows={3} defaultValue={d?.notes ?? ""} className="field-input" />
      </label>
    </>
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
