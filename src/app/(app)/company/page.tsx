import { Suspense } from "react";
import { SetupNav } from "@/components/setup-nav";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canEditBranding, isStaff } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { TitleCompanyFields } from "@/components/title-company-fields";
import { TITLE_COMPANY_SELECT, type TitleCompany } from "@/lib/mls-fields";
import type { SetupState } from "@/lib/onboarding";
import { saveBilling, saveMainContact, saveTitleCompany, saveWebsite } from "./actions";

export default function CompanyPage(props: PageProps<"/company">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-soft" />}>
        <Company searchParams={props.searchParams} />
      </Suspense>
      <SetupNav steps={["website", "billing", "title_company"]} path="/company" />
    </div>
  );
}

type Settings = TitleCompany & {
  main_contact_name: string | null;
  main_contact_title: string | null;
  main_contact_email: string | null;
  main_contact_phone: string | null;
};

// The company details the builder looks after themselves: who we call, who
// gets invoices, their website and their default title company.
async function Company({ searchParams }: { searchParams: PageProps<"/company">["searchParams"] }) {
  const me = await requireProfile();
  const staff = isStaff(me.role);
  if (!staff && !["builder_owner", "manager", "marketing"].includes(me.role)) redirect("/communities");
  const sp = await searchParams;
  const supabase = await createClient();

  const builderId = staff ? (typeof sp.builder === "string" ? sp.builder : null) : me.builder_id;
  if (!builderId) {
    const { data: builders } = await supabase.from("builders").select("id, name").order("name");
    return (
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">Company details</h1>
        <p className="mt-1 text-muted">Pick a builder.</p>
        <ul className="mt-6 divide-y divide-line rounded-2xl border border-line">
          {(builders ?? []).map((b) => (
            <li key={b.id}><Link href={`/company?builder=${b.id}`} className="block px-4 py-3 font-medium hover:bg-soft">{b.name.replace(" (demo)", "")}</Link></li>
          ))}
        </ul>
      </div>
    );
  }

  const [{ data: builder }, { data: settings }, { data: branding }, { data: owners }, { data: state }] = await Promise.all([
    supabase.from("builders").select("id, name").eq("id", builderId).maybeSingle(),
    supabase.from("builder_settings").select(`main_contact_name, main_contact_title, main_contact_email, main_contact_phone, ${TITLE_COMPANY_SELECT}`).eq("builder_id", builderId).maybeSingle(),
    supabase.from("builder_branding").select("website_url").eq("builder_id", builderId).maybeSingle(),
    supabase.from("profiles").select("full_name, email, phone").eq("builder_id", builderId).eq("role", "builder_owner").eq("is_active", true).order("created_at").limit(1),
    supabase.rpc("builder_setup_state", { p_builder: builderId }),
  ]);
  if (!builder) redirect("/communities");
  const s = (settings ?? {}) as Partial<Settings>;
  const st = (state ?? null) as SetupState | null;
  const owner = owners?.[0];
  const edit = me.role === "platform_admin" || (!staff && canEditBranding(me.role));
  const name = builder.name.replace(" (demo)", "");

  return (
    <>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">{name}: company details</h1>
      <p className="mt-1 text-muted">Who we work with at {name}, where invoices go, your website and your title company.</p>
      <div className="mt-6"><Notice searchParams={searchParams} /></div>

      <form id="contact" action={saveMainContact} className="scroll-mt-28 rounded-2xl border border-line p-5">
        <input type="hidden" name="builder_id" value={builderId} />
        <h2 className="font-semibold">Main point of contact</h2>
        <p className="mt-1 text-sm text-muted">
          The person our team reaches out to.{" "}
          {s.main_contact_name ? "" : owner ? <>Right now that&rsquo;s your owner, <b className="font-medium text-foreground">{owner.full_name}</b>. Fill this in only if it should be someone else.</> : "Until you name someone, it’s your company’s owner."}
        </p>
        <fieldset disabled={!edit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Name" name="main_contact_name" value={s.main_contact_name} placeholder={owner?.full_name} max={80} />
          <Field label="Job title" name="main_contact_title" value={s.main_contact_title} placeholder="e.g. Marketing Director" max={80} />
          <Field label="Email" name="main_contact_email" type="email" value={s.main_contact_email} placeholder={owner?.email} max={200} />
          <Field label="Phone" name="main_contact_phone" type="tel" value={s.main_contact_phone} placeholder={owner?.phone ?? undefined} max={30} />
        </fieldset>
        {edit && <SaveButton label="Save contact" />}
      </form>

      <section id="billing" className="mt-6 scroll-mt-28 rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Billing contact</h2>
        {st?.can_edit_billing ? (
          <form action={saveBilling}>
            <input type="hidden" name="builder_id" value={builderId} />
            <p className="mt-1 text-sm text-muted">Who we send invoices to. Only your company&rsquo;s owner sees and changes this.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Name" name="billing_contact_name" value={st.billing?.name} max={80} /></div>
              <Field label="Email" name="billing_contact_email" type="email" value={st.billing?.email} max={200} />
              <Field label="Phone" name="billing_contact_phone" type="tel" value={st.billing?.phone} max={30} />
            </div>
            <SaveButton label="Save billing contact" />
          </form>
        ) : st?.billing ? (
          <p className="mt-2 text-sm">{[st.billing.name, st.billing.email, st.billing.phone].filter(Boolean).join(" · ") || "Not added yet."}</p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            {st?.billing_set ? "Added by your company’s owner." : "Not added yet. Your company’s owner adds this."}
          </p>
        )}
      </section>

      <form id="website" action={saveWebsite} className="mt-6 scroll-mt-28 rounded-2xl border border-line p-5">
        <input type="hidden" name="builder_id" value={builderId} />
        <h2 className="font-semibold">Website</h2>
        <p className="mt-1 text-sm text-muted">Realtor share links send agents here for more info.</p>
        <fieldset disabled={!edit} className="mt-4">
          <Field label="Website address" name="website_url" value={branding?.website_url} placeholder="https://www.yourbuilder.com" max={300} />
        </fieldset>
        {edit && <SaveButton label="Save website" />}
      </form>

      <form id="title-company" action={saveTitleCompany} className="mt-6 scroll-mt-28 rounded-2xl border border-line p-5">
        <input type="hidden" name="builder_id" value={builderId} />
        <h2 className="font-semibold">Default title company</h2>
        <p className="mt-1 text-sm text-muted">
          Goes on every home&rsquo;s MLS listing as the preferred title company. A community that uses a different one can set its own in its community setup.
        </p>
        <fieldset disabled={!edit} className="mt-4">
          <TitleCompanyFields t={s as TitleCompany} />
        </fieldset>
        {edit && <SaveButton label="Save title company" />}
      </form>
    </>
  );
}

function Field({ label, name, value, type = "text", placeholder, max }: {
  label: string; name: string; value?: string | null; type?: string; placeholder?: string; max: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input name={name} type={type} maxLength={max} defaultValue={value ?? ""} placeholder={placeholder} className="field-input" />
    </label>
  );
}

function SaveButton({ label }: { label: string }) {
  return <button className="mt-4 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-white hover:bg-black">{label}</button>;
}
