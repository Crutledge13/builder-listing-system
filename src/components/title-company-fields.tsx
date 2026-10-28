import type { TitleCompany } from "@/lib/mls-fields";

// The builder's default title company: the first three fill NTREIS's
// "Title Company Preferred / Location / Phone"; the contact is for our team.
export function TitleCompanyFields({ t, disabled }: { t?: Partial<TitleCompany> | null; disabled?: boolean }) {
  const field = (label: string, name: keyof TitleCompany, opts: { type?: string; placeholder?: string; max: number }) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input name={name} type={opts.type ?? "text"} maxLength={opts.max} placeholder={opts.placeholder} defaultValue={t?.[name] ?? ""} disabled={disabled} className="field-input" />
    </label>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">{field("Title company", "title_company_name", { placeholder: "e.g. Republic Title", max: 120 })}</div>
      <div className="sm:col-span-2">{field("Office location", "title_company_location", { placeholder: "Branch or street address", max: 200 })}</div>
      {field("Office phone", "title_company_phone", { type: "tel", max: 30 })}
      {field("Escrow officer (optional)", "title_company_contact", { max: 80 })}
      <div className="sm:col-span-2">{field("Escrow officer email (optional)", "title_company_email", { type: "email", max: 200 })}</div>
    </div>
  );
}
