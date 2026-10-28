import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { canEditBranding, isStaff } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { BuilderLogo } from "@/components/avatar";
import { ImageUpload } from "@/components/image-upload";
import { ColorList } from "@/components/color-list";
import { brandScanAvailable, type BrandScan } from "@/lib/brand-scan";
import { dateTime } from "@/lib/format";
import { addPreset, deletePreset, savePreset, setDefaultPreset } from "./actions";
import { FORMAT_LABELS, PRESET_SELECT, type DownloadPreset } from "@/lib/image-resize";
import { applyScan, dismissScan, removeGuide, removeLogo, rescanGuide, saveBranding, saveGuide, saveLogo, saveTitleCompany } from "./actions";
import { TitleCompanyFields } from "@/components/title-company-fields";
import { TITLE_COMPANY_SELECT, type TitleCompany } from "@/lib/mls-fields";

// Reading a long brand guide with AI can take a little while.
export const maxDuration = 120;

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
  colors: { name: string; hex: string }[];
  fonts: string[];
  brand_guide_path: string | null;
  brand_guide_name: string | null;
  brand_guide_uploaded_at: string | null;
  brand_guide_scan: BrandScan | null;
  brand_guide_scanned_at: string | null;
  default_download_preset: string | null;
  updated_at: string;
  builders: { name: string } | null;
};

async function Branding({ searchParams }: { searchParams: PageProps<"/branding">["searchParams"] }) {
  const sp = await searchParams;
  const me = await requireProfile();
  sendPhotographersToJobs(me);
  const staff = isStaff(me.role);
  const supabase = await createClient();

  // Our team picks a builder; everyone else sees their own.
  const { data: rows } = await supabase
    .from("builder_branding")
    .select("builder_id, logo_path, logo_updated_at, primary_color, secondary_color, website_url, tagline, brand_notes, colors, fonts, brand_guide_path, brand_guide_name, brand_guide_uploaded_at, brand_guide_scan, brand_guide_scanned_at, default_download_preset, updated_at, builders(name)");
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

      <section id="guide" className="mb-6 scroll-mt-28 rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Brand guide</h2>
        <p className="mt-1 text-sm text-muted">
          Have a brand guide? Upload it (PDF or image) and we’ll read it for you: colors, fonts, website, tagline and logo rules.
          You check what it found before anything is added.
        </p>
        {b.brand_guide_path && (
          <p className="mt-3 text-sm">
            <a href={`/api/brand-guide/${b.builder_id}`} className="font-semibold text-accent underline">{b.brand_guide_name ?? "Brand guide"}</a>
            {b.brand_guide_uploaded_at && <span className="text-muted"> · uploaded {dateTime(b.brand_guide_uploaded_at)}</span>}
          </p>
        )}
        {edit && (
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <ImageUpload
              bucket="branding"
              folder={b.builder_id}
              accept="application/pdf,image/png,image/jpeg,image/webp"
              typesLabel="a PDF, or a PNG, JPG or WebP image"
              maxMb={25}
              label="brand guide"
              busyLabel={brandScanAvailable() ? "Uploading and reading… (up to a minute)" : "Uploading…"}
              hasImage={!!b.brand_guide_path}
              save={saveGuide.bind(null, b.builder_id)}
              remove={removeGuide.bind(null, b.builder_id)}
            />
            {b.brand_guide_path && brandScanAvailable() && !b.brand_guide_scan && (
              <form action={rescanGuide}>
                <input type="hidden" name="builder_id" value={b.builder_id} />
                <button className="rounded-xl px-3 py-2 text-sm font-semibold text-accent underline">Read it again</button>
              </form>
            )}
          </div>
        )}
        {edit && !brandScanAvailable() && <p className="mt-2 text-xs text-muted">Automatic reading turns on once the AI key is set up. You can still upload the guide and fill in the branding below.</p>}

        {edit && b.brand_guide_scan && <ScanReview b={b} />}
      </section>

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

      <TitleCompanySection builderId={b.builder_id} edit={edit} />

      <form action={saveBranding} className="mt-6 rounded-2xl border border-line p-5">
        <input type="hidden" name="builder_id" value={b.builder_id} />
        <h2 className="font-semibold">Colors, fonts, website and notes</h2>
        <fieldset disabled={!edit} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Brand colors</span>
            <ColorList key={b.updated_at} initial={b.colors ?? []} disabled={!edit} />
          </div>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Fonts, main one first, separated by commas</span>
            <input name="fonts" defaultValue={(b.fonts ?? []).join(", ")} placeholder="e.g. Montserrat, Lora" className="field-input" />
          </label>
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
            <textarea name="brand_notes" defaultValue={b.brand_notes ?? ""} rows={4} maxLength={2000} placeholder="How to use the logo, photo style (bright and airy, twilight exteriors), things to avoid…" className="field-input leading-relaxed" />
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

      <DownloadSizes b={b} edit={edit} />
    </>
  );
}

// What the AI found, with a tick box for each part. Nothing is added until "Add to branding".
function ScanReview({ b }: { b: BrandingRow }) {
  const scan = b.brand_guide_scan!;
  const have = new Set((b.colors ?? []).map((c) => c.hex));
  const empty = !scan.colors.length && !scan.fonts.length && !scan.website_url && !scan.tagline && !scan.notes;
  return (
    <div className="mt-4 rounded-2xl border border-accent bg-accent-soft/40 p-4">
      <p className="font-semibold">Here’s what we found{b.brand_guide_scanned_at ? ` (${dateTime(b.brand_guide_scanned_at)})` : ""}</p>
      {empty ? (
        <p className="mt-2 text-sm">Nothing we could use. Fill in the branding below by hand.</p>
      ) : (
        <form action={applyScan} className="mt-3 space-y-4">
          <input type="hidden" name="builder_id" value={b.builder_id} />
          {scan.colors.length > 0 && (
            <div>
              <p className="text-sm font-medium">Colors</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {scan.colors.map((c) => (
                  <label key={c.hex} className="flex items-center gap-2 rounded-xl border border-line bg-white px-2.5 py-1.5 text-sm">
                    <input type="checkbox" name="color" value={c.hex} defaultChecked={!have.has(c.hex)} disabled={have.has(c.hex)} className="h-4 w-4 accent-[#3452c7]" />
                    <span className="h-5 w-5 rounded-md border border-line" style={{ background: c.hex }} aria-hidden />
                    <span>{c.name}</span>
                    <span className="font-mono text-xs text-muted">{c.hex}</span>
                    {have.has(c.hex) && <span className="text-xs text-muted">(already added)</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          {scan.fonts.length > 0 && <Tick name="use_fonts" label="Fonts" value={scan.fonts.join(", ")} />}
          {scan.website_url && <Tick name="use_website" label="Website" value={scan.website_url} checked={!b.website_url} note={b.website_url ? "replaces the one you have" : undefined} />}
          {scan.tagline && <Tick name="use_tagline" label="Tagline" value={scan.tagline} checked={!b.tagline} note={b.tagline ? "replaces the one you have" : undefined} />}
          {scan.notes && <Tick name="use_notes" label="Logo and style notes" value={scan.notes} pre note={b.brand_notes ? "added below your notes" : undefined} />}
          <div className="flex flex-wrap gap-2">
            <button className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:brightness-110">Add to branding</button>
            <button formAction={dismissScan} className="rounded-xl px-4 py-2.5 text-sm font-semibold underline">Dismiss</button>
          </div>
        </form>
      )}
      <p className="mt-3 text-xs text-muted">Read by AI, so give it a quick check. The logo itself isn’t pulled from the guide; upload it below.</p>
    </div>
  );
}

function Tick({ name, label, value, checked = true, note, pre }: { name: string; label: string; value: string; checked?: boolean; note?: string; pre?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5 h-4 w-4 accent-[#3452c7]" />
      <span>
        <span className="font-medium">{label}</span>{note && <span className="text-muted"> ({note})</span>}
        <span className={pre ? "mt-1 block whitespace-pre-line" : "block"}>{value}</span>
      </span>
    </label>
  );
}

// The sizes people can pick when downloading, and which one is the default.
async function DownloadSizes({ b, edit }: { b: BrandingRow; edit: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("download_presets").select(PRESET_SELECT).or(`builder_id.is.null,builder_id.eq.${b.builder_id}`).order("sort").order("name");
  const all = (data ?? []) as DownloadPreset[];
  const own = all.filter((p) => p.builder_id === b.builder_id);
  const builtIn = all.filter((p) => !p.builder_id);
  const current = b.default_download_preset ?? builtIn.find((p) => p.is_default)?.id ?? "";
  const describe = (p: Pick<DownloadPreset, "long_edge" | "format" | "quality">) =>
    p.format === "original" && !p.long_edge ? "The original file, untouched" : `${p.long_edge ? `${p.long_edge} px on the longest side` : "Original size"}, ${FORMAT_LABELS[p.format]}${p.format === "png" ? "" : ` at ${p.quality}% quality`}`;

  return (
    <section id="sizes" className="mt-6 scroll-mt-28 rounded-2xl border border-line p-5">
      <h2 className="font-semibold">Download sizes</h2>
      <p className="mt-1 text-sm text-muted">
        When anyone at your company downloads a photo, they pick a size: full quality for print and marketing, MLS size, website size and so on.
        Add your own (for example, exactly what your website needs) and choose which one is picked first. Everyone can still choose a custom size.
      </p>

      <form action={setDefaultPreset} className="mt-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="builder_id" value={b.builder_id} />
        <label className="block min-w-[240px] flex-1">
          <span className="mb-1 block text-sm font-medium">Picked first when downloading</span>
          <select name="preset_id" defaultValue={current} disabled={!edit} className="field-input">
            {own.length > 0 && <optgroup label="Your sizes">{own.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
            <optgroup label="Standard sizes">{builtIn.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          </select>
        </label>
        {edit && <button className="rounded-xl bg-foreground px-4 py-2.5 font-semibold text-white hover:bg-black">Save</button>}
      </form>
      <p className="mt-1 text-xs text-muted">Each person’s last choice is remembered on their own computer, so they only need to change it once.</p>

      <h3 className="mt-6 text-sm font-semibold">Standard sizes</h3>
      <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
        {builtIn.map((p) => <li key={p.id} className="flex flex-wrap justify-between gap-2 px-3 py-2"><span className="font-medium">{p.name}</span><span className="text-muted">{describe(p)}</span></li>)}
      </ul>

      <h3 className="mt-6 text-sm font-semibold">Your sizes</h3>
      {own.length === 0 && <p className="mt-2 text-sm text-muted">None yet.</p>}
      <div className="mt-2 space-y-2">
        {own.map((p) => (
          <details key={p.id} className="rounded-xl border border-line">
            <summary className="flex cursor-pointer list-none flex-wrap justify-between gap-2 px-3 py-2 text-sm hover:bg-soft">
              <span className="font-medium">{p.name}</span>
              <span className="text-muted">{describe(p)}{edit ? " · Edit" : ""}</span>
            </summary>
            {edit && (
              <div className="border-t border-line p-3">
                <SizeFields action={savePreset} builderId={b.builder_id} p={p} submit="Save" />
                <form action={deletePreset} className="mt-2">
                  <input type="hidden" name="builder_id" value={b.builder_id} />
                  <input type="hidden" name="id" value={p.id} />
                  <button className="text-sm font-semibold text-red-700 underline">Remove this size</button>
                </form>
              </div>
            )}
          </details>
        ))}
      </div>
      {edit && (
        <details className="mt-3 rounded-xl border border-dashed border-line">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold">+ Add a size</summary>
          <div className="border-t border-line p-3">
            <SizeFields action={addPreset} builderId={b.builder_id} submit="Add size" />
          </div>
        </details>
      )}
    </section>
  );
}

function SizeFields({ action, builderId, p, submit }: { action: (fd: FormData) => Promise<void>; builderId: string; p?: DownloadPreset; submit: string }) {
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <input type="hidden" name="builder_id" value={builderId} />
      {p && <input type="hidden" name="id" value={p.id} />}
      <label className="block sm:col-span-4"><span className="mb-1 block text-xs font-medium">Name</span><input name="name" required maxLength={40} defaultValue={p?.name ?? ""} placeholder="e.g. Our website" className="field-input py-2" /></label>
      <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium">Longest side, in pixels (blank = original size)</span><input name="long_edge" type="number" min={200} max={8000} defaultValue={p?.long_edge ?? ""} placeholder="e.g. 1600" className="field-input py-2" /></label>
      <label className="block"><span className="mb-1 block text-xs font-medium">Format</span>
        <select name="format" defaultValue={p?.format ?? "jpeg"} className="field-input py-2">
          {(["jpeg", "webp", "png", "original"] as const).map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
        </select>
      </label>
      <label className="block"><span className="mb-1 block text-xs font-medium">Quality (40-100)</span><input name="quality" type="number" min={40} max={100} defaultValue={p?.quality ?? 85} className="field-input py-2" /></label>
      <div className="sm:col-span-4"><button className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white hover:bg-black">{submit}</button></div>
    </form>
  );
}

// The builder's default title company, used on every home's MLS listing
// unless a community sets its own in its community setup.
async function TitleCompanySection({ builderId, edit }: { builderId: string; edit: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("builder_settings").select(TITLE_COMPANY_SELECT).eq("builder_id", builderId).maybeSingle();
  return (
    <form id="title-company" action={saveTitleCompany} className="mt-6 scroll-mt-28 rounded-2xl border border-line p-5">
      <input type="hidden" name="builder_id" value={builderId} />
      <h2 className="font-semibold">Default title company</h2>
      <p className="mt-1 text-sm text-muted">
        Goes on every home&rsquo;s MLS listing as the preferred title company. A community that uses a different one can set its own in its community setup.
      </p>
      <fieldset disabled={!edit} className="mt-4">
        <TitleCompanyFields t={data as TitleCompany | null} />
      </fieldset>
      {edit && <button className="mt-4 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-white hover:bg-black">Save title company</button>}
    </form>
  );
}
