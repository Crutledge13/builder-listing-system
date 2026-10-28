import type { createClient } from "@/lib/supabase/server";
import { CHARGE_SELECT, INVOICE_SELECT, type Charge, type Invoice } from "@/lib/billing";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Everything an invoice page shows, read as the signed-in person (the
// database decides: our admins any invoice, a builder owner their sent ones).
export async function loadInvoice(supabase: Supabase, id: string) {
  const { data: invoice } = await supabase.from("invoices").select(INVOICE_SELECT).eq("id", id).maybeSingle();
  if (!invoice) return null;
  const [{ data: charges }, { data: builder }, { data: contact }, { data: settings }] = await Promise.all([
    supabase.from("billing_charges").select(CHARGE_SELECT).eq("invoice_id", id).order("occurred_on").order("created_at"),
    supabase.from("builders").select("name, legal_name").eq("id", invoice.builder_id).maybeSingle(),
    // Staff only (owners get nothing back, and the invoice shows just the company).
    supabase.from("builder_onboarding").select("billing_contact_name, billing_contact_email, billing_contact_phone").eq("builder_id", invoice.builder_id).maybeSingle(),
    supabase.from("app_settings").select("key, value").in("key", ["team_email", "team_phone"]),
  ]);
  const setting = (k: string) => {
    const v = settings?.find((s) => s.key === k)?.value;
    return typeof v === "string" && v ? v : null;
  };
  return {
    invoice: invoice as Invoice,
    charges: (charges ?? []) as Charge[],
    builderName: builder?.name ?? "Builder",
    billTo: {
      name: builder?.legal_name || builder?.name || "Builder",
      contactName: contact?.billing_contact_name,
      contactEmail: contact?.billing_contact_email,
      contactPhone: contact?.billing_contact_phone,
    },
    from: { name: "Builder Listing Services", email: setting("team_email"), phone: setting("team_phone") },
  };
}
