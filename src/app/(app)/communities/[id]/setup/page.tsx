import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { cx } from "@/lib/format";
import { Notice } from "@/components/notice";
import { ProgressBar } from "@/components/progress-bar";
import { RequiredPill } from "@/components/required-pill";
import { MlsInput } from "@/components/ntreis-questions";
import { canEditCommunitySetup } from "@/lib/onboarding";
import {
  communityCompleteness, communitySections, formatMls, mergeCommunityDetails, MLS_BOARD_SELECT, TITLE_COMPANY_SELECT, titleDefaults,
  type MlsBoard, type MlsField, type TitleCompany,
} from "@/lib/mls-fields";
import { saveCommunitySetup } from "./actions";

export default function CommunitySetupPage(props: PageProps<"/communities/[id]/setup">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <CommunitySetup params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

// Plain-English notes for the builder, by field. The MLS's own wording stays
// as the label so our team can match it to the MLS screen.
const HELP: Record<string, string> = {
  SubdivisionName: "The legal plat name on the deed. Leave blank if it’s the same as the community name.",
  MLSAreaMajor: "Our team can fill this in if you don’t know it.",
  SeniorCommunityYN: "Yes only for 55+ or other age-restricted communities.",
  HighSchoolDistrict: "The school district (ISD) the homes are zoned to.",
  MiddleOrJuniorSchool: "Some districts call it middle school; enter it here either way.",
  AssociationAmenities: "What the whole community shares: pool, playground, trails and so on.",
  Utilities: "Tick what applies, like city water and sewer, MUD water, underground utilities, curbs and sidewalks.",
  SpecialDistrict: "Texas requires disclosing a MUD or PID. Check the community’s tax records if you’re not sure.",
  SpecialTaxingAuthorityYN: "Any other special taxing authority besides a MUD or PID.",
  AssociationYN: "Whether homeowners pay into an HOA.",
  AssociationType: "Filled in from “Has an HOA” unless you pick one.",
  AssociationFee: "Dues per billing period, in dollars.",
  ConsentToRecord: "Whether visitors may record audio or video during showings.",
  LockBoxType: "The lockbox agents use at your homes.",
  AccessCode: "Gate code agents need to get in. Only agents see it.",
  ShowingRequirements: "How agents get in: appointment only, go and show, call first, and so on.",
  ShowingContactType: "Who agents contact to set up a showing.",
  ShowingContactName: "The person or office agents call.",
  ShowingInstructions: "Anything agents should know before a showing, like where to park or which homes are models.",
  Directions: "Real turn-by-turn directions from a main road. NTREIS fines listings that only say “use GPS”.",
  TitleCompanyPreferred: "The title company buyers close with here.",
  TitleCompanyLocation: "The title office’s address or branch.",
  Heating: "What most homes here use. A single home can still differ.",
  Cooling: "What most homes here use. A single home can still differ.",
  TaxRate: "Combined property tax rate, as a percent.",
};

async function CommunitySetup({
  params,
  searchParams,
}: {
  params: PageProps<"/communities/[id]/setup">["params"];
  searchParams: PageProps<"/communities/[id]/setup">["searchParams"];
}) {
  const { id } = await params;
  const me = await requireProfile();
  sendPhotographersToJobs(me);
  if (me.role === "sales" || me.role === "photographer") redirect(`/communities/${id}`);
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("communities")
    .select("id, name, city, county, builder_id, mls_board, mls_fields, field_sources, builders(name)")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  const [{ data: board }, { data: staffRow }, { data: settings }] = await Promise.all([
    c.mls_board ? supabase.from("mls_boards").select(MLS_BOARD_SELECT).eq("code", c.mls_board).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("mls_details").select("data").eq("community_id", id).maybeSingle(),
    supabase.from("builder_settings").select(TITLE_COMPANY_SELECT).eq("builder_id", c.builder_id).maybeSingle(),
  ]);
  // The builder's default title company, used when this community leaves those boxes blank.
  const defaults = titleDefaults(settings as TitleCompany | null);
  const sections = communitySections(board as MlsBoard | null);
  const answers = (c.mls_fields ?? {}) as Record<string, unknown>;
  const staff = (staffRow?.data ?? {}) as Record<string, unknown>;
  const score = communityCompleteness(c, mergeCommunityDetails(answers, staff, defaults), sections);
  const missing = new Set(score.missing.map((f) => f.key));
  const canEdit = canEditCommunitySetup(me.role);
  const builderName = (c.builders as unknown as { name: string } | null)?.name.replace(" (demo)", "");
  const boardName = (board as MlsBoard | null)?.short_name;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/communities/${id}`} className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground">
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {c.name}
      </Link>
      <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight">Set up {c.name}</h1>
      <p className="mt-1 max-w-2xl text-muted">
        Answer these once and every home in {c.name} uses them on the MLS{boardName ? ` (${boardName})` : ""}.
        {isStaff(me.role) && builderName ? ` ${builderName}.` : ""}
      </p>

      <div className="mt-6"><Notice searchParams={searchParams} /></div>

      <div className="sticky top-24 z-10 -mx-4 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:border-line sm:px-5">
        <ProgressBar done={score.filled} total={score.required} label={score.filled === score.required ? "Ready for the MLS" : "MLS-required answers"} />
        {score.missing.length > 0 && (
          <p className="mt-1.5 text-xs text-muted">Still needed: {score.missing.map((f) => f.label).join(", ")}</p>
        )}
      </div>

      {!canEdit && (
        <p className="mt-6 rounded-xl bg-soft px-4 py-3 text-sm text-muted">
          {me.role === "listing_coordinator"
            ? "Read only here. Our team’s own entries go on a home’s MLS sheet and win over these answers."
            : "Read only. Your company’s owner or a manager can change these."}
        </p>
      )}

      <form action={saveCommunitySetup} className="mt-6">
        <input type="hidden" name="community_id" value={id} />
        <fieldset disabled={!canEdit} className="divide-y divide-line">
          <section className="pb-8">
            <h2 className="text-lg font-semibold">The basics</h2>
            <div className="mt-4 grid gap-x-4 gap-y-6 sm:grid-cols-3">
              <label className="block">
                <span className="text-sm font-medium">Community name</span>
                <input name="name" required defaultValue={c.name} className="field-input mt-1.5" />
              </label>
              <label className="block">
                <span className="text-sm font-medium">City</span>
                <input name="city" required defaultValue={c.city} className="field-input mt-1.5" />
              </label>
              <label className="block">
                <span className="text-sm font-medium">County</span>
                <input name="county" defaultValue={c.county ?? ""} className="field-input mt-1.5" />
                <span className="mt-1 block text-xs text-muted">Decides which MLS the community goes to.</span>
              </label>
            </div>
          </section>

          {sections.map((s) => (
            <section key={s.title} className="py-8">
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <div className="mt-4 grid gap-x-4 gap-y-6 sm:grid-cols-2">
                {s.fields.map((f) => (
                  <Question key={f.key} f={f} value={answers[f.key]} staffValue={staff[f.key]} needed={missing.has(f.key)} disabled={!canEdit} placeholder={f.key === "SubdivisionName" ? c.name : typeof defaults[f.key] === "string" ? String(defaults[f.key]) : undefined} usesDefault={f.key in defaults} />
                ))}
              </div>
            </section>
          ))}
        </fieldset>
        {canEdit && (
          <div className="sticky bottom-4 mt-4 flex justify-end">
            <button className="rounded-xl bg-accent px-6 py-3 font-semibold text-white shadow-lg hover:brightness-110">Save community setup</button>
          </div>
        )}
      </form>
    </div>
  );
}

function Question({ f, value, staffValue, needed, disabled, placeholder, usesDefault }: {
  f: MlsField; value: unknown; staffValue: unknown; needed: boolean; disabled: boolean; placeholder?: string; usesDefault?: boolean;
}) {
  const wide = f.type === "multi" || f.type === "longtext";
  const hasStaff = staffValue !== undefined && staffValue !== null && staffValue !== "";
  const body = (
    <>
      <span className="text-sm font-medium">
        {f.label}
        {((f.required && !f.derive) || needed) && <RequiredPill />}
      </span>
      {HELP[f.key] && <span className="mt-0.5 block text-xs leading-snug text-muted">{HELP[f.key]}</span>}
      <span className="mt-1.5 block">
        {placeholder && f.type === "text" ? (
          <input name={`cf__${f.key}`} defaultValue={value == null ? "" : String(value)} placeholder={placeholder} disabled={disabled} className="field-input" />
        ) : (
          <MlsInput f={f} name={`cf__${f.key}`} start={value} disabled={disabled} />
        )}
      </span>
      {usesDefault && (value === undefined || value === null || value === "") && (
        <span className="mt-1 block text-xs text-muted">Blank uses your company’s default title company. Type here only if this community uses a different one.</span>
      )}
      {hasStaff && (
        <span className="mt-1 block text-xs text-muted">Our team has this on the MLS as: <b className="font-medium text-foreground">{formatMls(f, staffValue)}</b></span>
      )}
    </>
  );
  return (
    <div data-required={needed ? f.label : undefined} data-empty={needed ? "" : undefined} className={cx("min-w-0", wide && "sm:col-span-2")}>
      <input type="hidden" name="cf_key" value={f.key} />
      {f.type === "multi" ? <div>{body}</div> : <label className="block">{body}</label>}
    </div>
  );
}
