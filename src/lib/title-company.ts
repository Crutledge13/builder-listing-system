import type { TitleCompany } from "@/lib/mls-fields";

// The same fields read back from a form submission.
export function readTitleCompany(formData: FormData): TitleCompany {
  const text = (k: string, max: number) => String(formData.get(k) ?? "").trim().slice(0, max) || null;
  return {
    title_company_name: text("title_company_name", 120),
    title_company_location: text("title_company_location", 200),
    title_company_phone: text("title_company_phone", 30),
    title_company_contact: text("title_company_contact", 80),
    title_company_email: text("title_company_email", 200)?.toLowerCase() ?? null,
  };
}
