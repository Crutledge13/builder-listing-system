import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canEditBranding, isStaff } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { BuilderLogo } from "@/components/avatar";
import { ImageUpload } from "@/components/image-upload";
import { removeLogo, saveBranding, saveLogo } from "./actions";

export default function BrandingPage(props: PageProps<"/branding">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-soft" />}>
        <Branding searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

type BrandingRow = {
  builder_id: string;
  logo_path: string | null;
  logo_updated_at: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  website_url: string | null;
  tagline: string | null;
  brand_notes: string | null;
  updated_at: string;
  builders: { name: string } | null;
};

async function Branding({ searchParams }: { searchParams: PageProps<"/branding">["searchParams"] }) {
  const sp = await searchParams;
  const me = await requireProfile();
  const staff = isStaff(me.role);
  const supabase = await createClient();

  // Our team picks a builder; everyone else sees their own.
  const { data: rows } = await supabase
    .from("builder_branding")
    .select("builder_id, logo_path, logo_updated_at, primary_color, secondary_color, website_url, tagline, brand_notes, updated_at, builders(name)");
  const all = ((rows ?? []) as unknown as BrandingRow[]).sort((a, b) => (a.builders?.name ?? "").localeCompare(b.builders?.name ?? ""));
  const wanted = typeof sp.builder === "string" ? sp.builder : me.builder_id;
  const b = all.find((r) => r.builder_id === wanted) ?? (staff ? all[0] : null);
  if (!b) return <p className="mt-16 text-center text-muted">There’s no builder branding to show for your login.</p>;

  const name = (b.builders?.name ?? "Builder").replace(" (demo)", "");
  const edit = canEditBranding(me.role) && (me.role === "platform_admin" || me.builder_id === b.builder_id);
  const primary = b.primary_color ?? "#3452c7";

  return (
    <>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">{name} branding</h1>
      <p className="mt-1 text-muted">
        The logo shows on your team’s screens, community pages and reports. Colors, website and notes guide our team.
      </p>
      {staff && all.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {all.map((r) => (
            <Link key={r.builder_id} href={`/branding?builder=${r.builder_id}`} className={`rounded-full border px-3.5 py-1.5 text-sm ${r.builder_id === b.builder_id ? "border-foreground bg-foreground font-semibold text-white" : "border-line hover:border-foreground"}`}>
              {(r.builders?.name ?? "").replace(" (demo)", "")}
            </Link>
          ))}
        </div>
      )}
      <div className="mt-6"><Notice searchParams={searchParams} /></div>

      <section className="rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Logo</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex h-28 items-center justify-center rounded-xl border border-line bg-white p-4">
            <BuilderLogo builderId={b.builder_id} name={name} version={b.logo_updated_at} className="h-16 max-w-full" />
          </div>
          <div className="flex h-28 items-center justify-center rounded-xl p-4" style={{ background: primary }}>
            <BuilderLogo builderId={b.builder_id} name={name} version={b.logo_updated_at} className="h-16 max-w-full" />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">How it looks on white and on your main color. A logo with a see-through background (PNG or SVG) works best.</p>
        {edit && (
          <div className="mt-4">
            <ImageUpload
              bucket="branding"
              folder={b.builder_id}
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              label="logo"
              hasImage={!!b.logo_path}
              save={saveLogo.bind(null, b.builder_id)}
              remove={removeLogo.bind(null, b.builder_id)}
            />
          </div>
        )}
      </section>

      <form action={saveBranding} className="mt-6 rounded-2xl border border-line p-5">
        <input type="hidden" name="builder_id" value={b.builder_id} />
        <h2 className="font-semibold">Colors, website and notes</h2>
        <fieldset disabled={!edit} className="mt-4 grid gap-4 sm:grid-cols-2">
          <ColorField name="primary_color" label="Main color" value={b.primary_color} />
          <ColorField name="secondary_color" label="Second color" value={b.secondary_color} />
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Company website</span>
            <input name="website_url" defaultValue={b.website_url ?? ""} placeholder="https://www.yourbuilder.com" className="field-input" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Tagline (optional)</span>
            <input name="tagline" defaultValue={b.tagline ?? ""} maxLength={120} placeholder="e.g. Homes built for Texas living" className="field-input" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Brand notes for our team (optional)</span>
            <textarea name="brand_notes" defaultValue={b.brand_notes ?? ""} rows={4} maxLength={2000} placeholder="Fonts, how to use the logo, photo style (bright and airy, twilight exteriors), things to avoid…" className="field-input leading-relaxed" />
          </label>
        </fieldset>
        {edit ? (
          <button className="mt-4 rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Save branding</button>
        ) : (
          <p className="mt-4 text-sm text-muted">Your company’s owner, managers and marketing can change the branding.</p>
        )}
        {b.website_url && (
          <p className="mt-3 text-sm">
            Website: <a href={b.website_url} target="_blank" rel="noreferrer" className="text-accent underline">{b.website_url.replace(/^https?:\/\//, "")}</a>
          </p>
        )}
      </form>
    </>
  );
}

function ColorField({ name, label, value }: { name: string; label: string; value: string | null }) {
  const key = name === "primary_color" ? "use_primary" : "use_secondary";
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <input type="color" name={name} defaultValue={value ?? "#3452c7"} className="h-11 w-16 cursor-pointer rounded-lg border border-line bg-white p-1" aria-label={label} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name={key} defaultChecked={!!value} className="h-4 w-4 accent-[#3452c7]" /> Use this color
        </label>
      </div>
    </div>
  );
}
