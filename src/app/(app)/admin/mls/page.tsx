import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { baseSections, type MlsBoard } from "@/lib/mls-fields";
import { cx } from "@/lib/format";
import { addBoardField, removeBoardField, saveBoardFields, saveBoardRules } from "../actions";

export default function MlsRulesAdmin(props: PageProps<"/admin/mls">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Boards />
    </Suspense>
  );
}

const NUMBERS: { key: keyof MlsBoard["rules"]; label: string; unit: string }[] = [
  { key: "status_change_hours", label: "Report status changes within", unit: "hours" },
  { key: "new_listing_hours", label: "Enter new listings within", unit: "hours" },
  { key: "min_photos", label: "Minimum photos", unit: "photos" },
  { key: "min_photo_long_edge", label: "Smallest photo (long side)", unit: "pixels" },
  { key: "remarks_max_chars", label: "Description length limit", unit: "characters" },
];

async function Boards() {
  const supabase = await createClient();
  const { data } = await supabase.from("mls_boards").select("*").order("code");
  const boards = (data ?? []) as (MlsBoard & { active: boolean; updated_at: string })[];
  const builderKeys = (code: string) => new Set(baseSections(code).flatMap((s) => s.fields).filter((f) => f.source === "home" || f.source === "builder").map((f) => f.key));

  return (
    <div className="space-y-10">
      <p className="max-w-3xl text-muted">
        Each MLS has its own deadlines and asks for slightly different fields. These rules drive the readiness check builders see before
        approving, our team’s MLS sheet, and the compliance alerts. Mark an MLS “confirmed” once you’ve checked the numbers against its current rules.
      </p>
      {boards.map((b) => (
        <section key={b.code} id={b.code} className="scroll-mt-28 rounded-2xl border border-line">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">{b.short_name} <span className="font-normal text-muted">{b.name}</span></h2>
              <p className="text-sm text-muted">{b.region}</p>
            </div>
            <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", b.rules.verified ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900")}>
              {b.rules.verified ? "Rules confirmed" : "Starting values: confirm with this MLS"}
            </span>
          </div>

          <form action={saveBoardRules} className="grid gap-4 px-5 py-4 md:grid-cols-2">
            <input type="hidden" name="code" value={b.code} />
            {NUMBERS.map((n) => (
              <label key={n.key} className="flex items-center justify-between gap-3 text-sm">
                <span>{n.label}</span>
                <span className="flex items-center gap-2">
                  <input name={n.key} defaultValue={String(b.rules[n.key] ?? "")} inputMode="numeric" className="field-input w-24 py-1.5" />
                  <span className="w-20 text-muted">{n.unit}</span>
                </span>
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="verified" defaultChecked={!!b.rules.verified} className="h-4 w-4 accent-[#3452c7]" /> I’ve confirmed these against the MLS’s current rules
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium">Counties it covers (used to suggest the MLS)</span>
              <textarea name="counties" defaultValue={b.counties.join(", ")} rows={2} className="field-input" />
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium">Where these rules come from</span>
              <textarea name="source" defaultValue={b.rules.source ?? ""} rows={2} className="field-input" />
            </label>
            <div><button className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white hover:bg-black">Save rules</button></div>
          </form>

          <details className="border-t border-line">
            <summary className="cursor-pointer px-5 py-3 font-semibold">Fields for {b.short_name}</summary>
            <form action={saveBoardFields} className="px-5 pb-4">
              <input type="hidden" name="code" value={b.code} />
              <p className="mb-3 text-sm text-muted">Change what this MLS requires, hide fields it doesn’t use, or rename a field to match its form. “Builder” fields are checked before approval; the rest are filled in by our team.</p>
              {baseSections(b.code).map((sec) => (
                <div key={sec.title} className="mb-4">
                  <h3 className="text-sm font-semibold">{sec.title}</h3>
                  <div className="mt-1 divide-y divide-line rounded-xl border border-line">
                    {sec.fields.map((f) => {
                      const r = b.field_rules?.[f.key] ?? {};
                      const val = r.hidden ? "hide" : r.required === true ? "yes" : r.required === false ? "no" : "default";
                      return (
                        <div key={f.key} className="grid items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[1fr_180px_1fr]">
                          <input type="hidden" name="field" value={f.key} />
                          <span>
                            {f.label} <span className="text-[11px] text-muted">{f.key}{builderKeys(b.code).has(f.key) ? " · builder" : ""}</span>
                          </span>
                          <select name={`req_${f.key}`} defaultValue={val} className="rounded-lg border border-line bg-white px-2 py-1">
                            <option value="default">{f.required ? "Required (default)" : "Optional (default)"}</option>
                            <option value="yes">Required</option>
                            <option value="no">Optional</option>
                            <option value="hide">Not used by this MLS</option>
                          </select>
                          <input name={`label_${f.key}`} defaultValue={r.label ?? ""} placeholder="Label on this MLS (optional)" className="rounded-lg border border-line px-2 py-1" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white hover:bg-black">Save fields</button>
            </form>

            <div className="border-t border-line px-5 py-4">
              <h3 className="text-sm font-semibold">Extra fields only {b.short_name} asks for</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {(b.extra_fields ?? []).map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-2 rounded-lg bg-soft px-3 py-1.5">
                    <span>{f.label} <span className="text-muted">({f.section}, {f.source === "community" ? "shared by community" : "per home"}{f.required ? ", required" : ""})</span></span>
                    <form action={removeBoardField}>
                      <input type="hidden" name="code" value={b.code} />
                      <input type="hidden" name="key" value={f.key} />
                      <button className="text-xs font-semibold text-red-700 underline">Remove</button>
                    </form>
                  </li>
                ))}
                {(b.extra_fields ?? []).length === 0 && <li className="text-muted">None.</li>}
              </ul>
              <form action={addBoardField} className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px_160px_120px_auto] sm:items-center">
                <input type="hidden" name="code" value={b.code} />
                <input name="label" placeholder="Field name, e.g. Key Map page" className="field-input py-1.5" />
                <select name="section" className="field-input py-1.5">{baseSections(b.code).map((s) => <option key={s.title}>{s.title}</option>)}</select>
                <select name="source" className="field-input py-1.5">
                  <option value="detail">Per home</option>
                  <option value="community">Shared by community</option>
                </select>
                <select name="type" className="field-input py-1.5">
                  <option value="text">Text</option><option value="longtext">Long text</option><option value="number">Number</option>
                  <option value="money">Dollar amount</option><option value="date">Date</option><option value="yesno">Yes/No</option>
                </select>
                <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="required" className="h-4 w-4 accent-[#3452c7]" /> Required</label>
                <button className="rounded-lg border border-foreground px-3 py-1.5 text-sm font-semibold sm:col-span-5 sm:w-fit">Add field</button>
              </form>
            </div>
          </details>
        </section>
      ))}
    </div>
  );
}
