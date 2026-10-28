"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { readTitleCompany } from "@/lib/title-company";

// Back to Company details, at the section that was saved. Our staff keep the
// builder they were looking at.
async function back(builderId: string, section: string, p: Record<string, string>): Promise<never> {
  const me = await requireProfile();
  const q = new URLSearchParams(isStaff(me.role) ? { builder: builderId, ...p } : p);
  redirect(`/company?${q.toString()}#${section}`);
}

const text = (formData: FormData, k: string, max: number) => String(formData.get(k) ?? "").trim().slice(0, max) || null;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const denied = (msg: string) => /row-level security|42501|permission/i.test(msg);

// Who we call at the builder. Blank means "the owner".
export async function saveMainContact(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const email = text(formData, "main_contact_email", 200)?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) await back(builderId, "contact", { error: "That email doesn’t look right." });
  const row = {
    builder_id: builderId,
    main_contact_name: text(formData, "main_contact_name", 80),
    main_contact_title: text(formData, "main_contact_title", 80),
    main_contact_email: email,
    main_contact_phone: text(formData, "main_contact_phone", 30),
    updated_at: new Date().toISOString(),
  };
  const supabase = await createClient();
  const { data, error } = await supabase.from("builder_settings").upsert(row).select("builder_id");
  if (error || !data?.length) await back(builderId, "contact", { error: error && !denied(error.message) ? `Couldn’t save: ${error.message}` : "Your role can’t change the main point of contact." });
  revalidatePath("/", "layout");
  await back(builderId, "contact", { saved: row.main_contact_name ? `Main point of contact saved: ${row.main_contact_name}.` : "Main point of contact set back to the owner." });
}

// Who we send invoices to. Only the owner (and our admins) can change it.
export async function saveBilling(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_billing_contact", {
    p_builder: builderId,
    p_name: text(formData, "billing_contact_name", 80),
    p_email: text(formData, "billing_contact_email", 200),
    p_phone: text(formData, "billing_contact_phone", 30),
  });
  if (error) await back(builderId, "billing", { error: error.message.includes("owner") || error.message.includes("look right") ? error.message + "." : `Couldn’t save: ${error.message}` });
  revalidatePath("/", "layout");
  await back(builderId, "billing", { saved: "Billing contact saved." });
}

export async function saveWebsite(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  let website = String(formData.get("website_url") ?? "").trim();
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(website)) await back(builderId, "website", { error: "That website address doesn’t look right." });
  const supabase = await createClient();
  const { data, error } = await supabase.from("builder_branding").update({ website_url: website || null }).eq("builder_id", builderId).select("builder_id");
  if (error || !data?.length) await back(builderId, "website", { error: "Your role can’t change the website." });
  revalidatePath("/", "layout");
  await back(builderId, "website", { saved: website ? "Website saved." : "Website cleared." });
}

// The default title company: fills NTREIS's title company boxes for every
// home unless a community sets its own.
export async function saveTitleCompany(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const t = readTitleCompany(formData);
  if (t.title_company_email && !EMAIL.test(t.title_company_email)) await back(builderId, "title-company", { error: "That escrow officer email doesn’t look right." });
  const supabase = await createClient();
  const { data, error } = await supabase.from("builder_settings").upsert({ builder_id: builderId, ...t, updated_at: new Date().toISOString() }).select("builder_id");
  if (error || !data?.length) await back(builderId, "title-company", { error: error && !denied(error.message) ? `Couldn’t save: ${error.message}` : "Your role can’t change the title company." });
  revalidatePath("/", "layout");
  await back(builderId, "title-company", { saved: t.title_company_name ? `Default title company saved: ${t.title_company_name}.` : "Default title company cleared." });
}
