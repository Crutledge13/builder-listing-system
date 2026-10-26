import type { ReactNode } from "react";
import { cx } from "@/lib/format";
import { SourceBadge } from "@/components/badges";
import type { MlsField } from "@/lib/mls-fields";
import { NTREIS_SECTIONS } from "@/lib/ntreis-fields";

// The NTREIS questions a builder answers, in Matrix's order, with NTREIS's
// exact labels and choices and a short plain-English note under anything
// that's easy to get wrong.
//
// mode "new":  Add a home. Asks the home's own columns (price, beds, ...) and
//              the builder's NTREIS answers; NTREIS-only answers are wrapped in
//              <fieldset data-ntreis> so they hide for homes going to another MLS.
// mode "edit": the home page. Only the NTREIS answers (the page already shows
//              the home's columns).
export function NtreisQuestions({
  mode,
  values = {},
  sources = {},
  canEdit = true,
  extra = {},
}: {
  mode: "new" | "edit";
  values?: Record<string, unknown>;
  sources?: Record<string, string>;
  canEdit?: boolean;
  extra?: Record<string, ReactNode>; // more inputs at the end of a section, by title
}) {
  const sections = NTREIS_SECTIONS.map((s) => ({
    title: s.title,
    fields: s.fields.filter((f) => f.ask && (mode === "new" || f.source === "builder")),
  })).filter((s) => s.fields.length > 0);

  return (
    <>
      {sections.map((s) => {
        const ntreisOnly = s.fields.every((f) => f.source === "builder") && !extra[s.title];
        return (
          <section key={s.title} className="py-8" data-ntreis-section={ntreisOnly ? "" : undefined}>
            <h3 className="text-lg font-semibold">{s.title}</h3>
            <div className={cx("mt-4 grid gap-x-4 gap-y-6", mode === "new" ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
              {s.fields.map((f) => (
                <Question key={f.key} f={f} mode={mode} value={values[f.key]} source={sources[`mls_fields.${f.key}`]} canEdit={canEdit} />
              ))}
              {extra[s.title]}
            </div>
          </section>
        );
      })}
    </>
  );
}

function Question({ f, mode, value, source, canEdit }: { f: MlsField; mode: "new" | "edit"; value: unknown; source?: string; canEdit: boolean }) {
  const wide = f.type === "multi" || f.type === "longtext";
  const isAnswer = f.source === "builder";
  // A column (price, beds, ...) posts under its column name; an NTREIS answer as mls__Key.
  const name = isAnswer ? `mls__${f.key}` : f.column!;
  const start = mode === "new" ? f.preset : value;

  const body = (
    <>
      <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
        <span>
          {f.label}
          {f.required && (
            <>
              <span aria-hidden className="text-red-700"> *</span>
              <span className="sr-only"> (NTREIS requires this)</span>
            </>
          )}
        </span>
        {mode === "edit" && <SourceBadge source={source} />}
      </span>
      {f.help && <span className="mt-0.5 block text-xs leading-snug text-muted">{f.help}</span>}
      <span className="mt-1.5 block">
        <Input f={f} name={name} start={start} disabled={!canEdit} />
      </span>
    </>
  );

  const span = wide ? (mode === "new" ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-3") : undefined;
  if (!isAnswer) return <label className={cx("block", span)}>{body}</label>;
  // NTREIS answers: a fieldset, so hiding it for another MLS also stops it posting.
  return (
    <fieldset data-ntreis="" disabled={!canEdit} className={cx("min-w-0", span)}>
      <input type="hidden" name="mls_key" value={f.key} />
      {f.type === "multi" ? <div>{body}</div> : <label className="block">{body}</label>}
    </fieldset>
  );
}

function Input({ f, name, start, disabled }: { f: MlsField; name: string; start: unknown; disabled: boolean }) {
  const text = start === null || start === undefined ? "" : String(start);
  if (f.type === "multi") {
    const on = new Set(Array.isArray(start) ? (start as string[]).map(String) : []);
    const long = (f.options?.length ?? 0) > 12;
    return (
      <span className={cx("grid gap-x-4 gap-y-1.5 rounded-xl border border-line p-3 sm:grid-cols-2 lg:grid-cols-3", long && "max-h-64 overflow-y-auto")}>
        {f.options!.map((o) => (
          <label key={o} className="flex items-start gap-2 text-sm leading-snug">
            <input type="checkbox" name={name} value={o} defaultChecked={on.has(o)} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-[#3452c7]" />
            {o}
          </label>
        ))}
      </span>
    );
  }
  if (f.type === "select" || f.type === "yesno") {
    return (
      <select name={name} defaultValue={text} disabled={disabled} className="field-input">
        <option value="">Choose</option>
        {(f.options ?? ["Yes", "No"]).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (f.type === "longtext") {
    return <textarea name={name} defaultValue={text} rows={f.key === "PublicRemarks" ? 6 : 3} disabled={disabled} className="field-input leading-relaxed" />;
  }
  const isNumber = f.type === "number" || f.type === "money";
  return (
    <input
      name={name}
      defaultValue={text}
      disabled={disabled}
      type={f.type === "date" ? "date" : isNumber ? "number" : "text"}
      step={isNumber ? (f.column === "lot_size_acres" ? "0.001" : "1") : undefined}
      min={isNumber ? "0" : undefined}
      placeholder={f.type === "money" ? "389990" : undefined}
      className="field-input"
    />
  );
}
