import type { ReactNode } from "react";
import { cx } from "@/lib/format";
import { SourceBadge } from "@/components/badges";
import { RequiredPill } from "@/components/required-pill";
import { builderLabel, type MlsField } from "@/lib/mls-fields";
import { ChoiceBox } from "@/components/choice-box";
import { NTREIS_SECTIONS } from "@/lib/ntreis-fields";

// The NTREIS questions a builder answers, in Matrix's order, with NTREIS's
// exact choices, a plain-English question as each name (NTREIS's own label in
// small type under it when they differ) and a short note under anything
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
  return (
    <>
      {questionSections(mode).map((s) => (
        <section key={s.title} className="py-8" data-ntreis-section={s.ntreisOnly && !extra[s.title] ? "" : undefined}>
          <h3 className="text-lg font-semibold">{s.title}</h3>
          <SectionFields title={s.title} mode={mode} values={values} sources={sources} canEdit={canEdit} extra={extra[s.title]} />
        </section>
      ))}
    </>
  );
}

// The NTREIS sections that have questions for this screen, in Matrix's order.
// ntreisOnly: every question is an NTREIS answer (nothing to ask for another MLS).
export function questionSections(mode: "new" | "edit") {
  return NTREIS_SECTIONS.map((s) => {
    const fields = s.fields.filter((f) => f.ask && (mode === "new" || f.source === "builder"));
    return { title: s.title, fields, ntreisOnly: fields.every((f) => f.source === "builder") };
  }).filter((s) => s.fields.length > 0);
}

// One section's questions (used one per step on Add a home).
export function SectionFields({
  title,
  mode,
  values = {},
  sources = {},
  canEdit = true,
  extra,
}: {
  title: string;
  mode: "new" | "edit";
  values?: Record<string, unknown>;
  sources?: Record<string, string>;
  canEdit?: boolean;
  extra?: ReactNode;
}) {
  const section = questionSections(mode).find((s) => s.title === title);
  if (!section) return null;
  return (
    <div className={cx("mt-4 grid gap-x-4 gap-y-6", mode === "new" ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
      {section.fields.map((f) => (
        <Question key={f.key} f={f} mode={mode} value={values[f.key]} source={sources[`mls_fields.${f.key}`]} canEdit={canEdit} />
      ))}
      {extra}
    </div>
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
          {builderLabel(f)}
          {f.required && <RequiredPill />}
        </span>
        {mode === "edit" && <SourceBadge source={source} />}
      </span>
      {builderLabel(f) !== f.label && <span className="block text-[11px] text-muted">On NTREIS: {f.label}</span>}
      {f.help && <span className="mt-0.5 block text-xs leading-snug text-muted">{f.help}</span>}
      <span className="mt-1.5 block">
        <MlsInput f={f} name={name} start={start} disabled={!canEdit} />
      </span>
    </>
  );

  const span = wide ? (mode === "new" ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-3") : undefined;
  // data-required: the step bar counts what NTREIS still needs.
  const req = f.required ? { "data-required": builderLabel(f) } : {};
  if (!isAnswer) return <label {...req} className={cx("block", span)}>{body}</label>;
  // NTREIS answers: a fieldset, so hiding it for another MLS also stops it posting.
  return (
    <fieldset {...req} data-ntreis="" disabled={!canEdit} className={cx("min-w-0", span)}>
      <input type="hidden" name="mls_key" value={f.key} />
      {f.type === "multi" ? <div>{body}</div> : <label className="block">{body}</label>}
    </fieldset>
  );
}

// One MLS answer's input, by type (also used by community setup).
export function MlsInput({ f, name, start, disabled }: { f: MlsField; name: string; start: unknown; disabled: boolean }) {
  const text = start === null || start === undefined ? "" : String(start);
  if (f.type === "multi") {
    const on = new Set(Array.isArray(start) ? (start as string[]).map(String) : []);
    const long = (f.options?.length ?? 0) > 12;
    return (
      <ChoiceBox noneValue={f.options!.includes("None") ? "None" : undefined} className={cx("choice-box grid gap-x-4 gap-y-1.5 rounded-xl border border-line p-3 sm:grid-cols-2 lg:grid-cols-3", long && "max-h-64 overflow-y-auto")}>
        {f.options!.map((o) => (
          <label key={o} className="flex items-start gap-2 text-sm leading-snug">
            <input type="checkbox" name={name} value={o} defaultChecked={on.has(o)} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-[#3452c7]" />
            {o}
          </label>
        ))}
      </ChoiceBox>
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
