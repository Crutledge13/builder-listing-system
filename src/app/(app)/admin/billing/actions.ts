"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { safePath } from "@/lib/safe-path";
import { parseDollars, monthLabel } from "@/lib/billing";

// Billing is for our platform admins. The database enforces this too.
async function requireAdmin(back: string) {
  const me = await requireProfile();
  if (me.role !== "platform_admin") go(back, { error: "Only platform admins can do that." });
  return me;
}

function go(path: string, params: Record<string, string>): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(params).toString()}`);
}

function friendly(msg: string) {
  if (msg.includes("row-level security")) return "You don’t have permission to do that.";
  if (msg.includes("invoices_one_per_month")) return "There’s already an invoice for that month.";
  return msg;
}

function backFrom(formData: FormData, fallback: string) {
  return safePath(String(formData.get("back") ?? ""), fallback);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}-01$/;

function photoPriceMap(formData: FormData, prefix: string, keepBlank: boolean, back: string) {
  const out: Record<string, number> = {};
  for (const need of formData.getAll("need").map(String)) {
    const v = parseDollars(formData.get(`${prefix}${need}`));
    if (Number.isNaN(v)) go(back, { error: "Photo prices must be dollar amounts." });
    if (v !== null) out[need] = v;
    else if (!keepBlank) out[need] = 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Standard prices
// ---------------------------------------------------------------------------
export async function saveBillingDefaults(formData: FormData) {
  const back = "/admin/billing";
  await requireAdmin(back);
  const value: Record<string, unknown> = {};
  for (const k of ["software_fee_cents", "listing_fee_cents", "relist_fee_cents", "onboarding_fee_cents"]) {
    const v = parseDollars(formData.get(k));
    if (v === null || Number.isNaN(v)) go(back, { error: "Every standard price needs a dollar amount (0 is fine)." });
    value[k] = v;
  }
  const net = Number(formData.get("net_days"));
  if (!Number.isInteger(net) || net < 0 || net > 90) go(back, { error: "Payment terms are 0 to 90 days." });
  value.net_days = net;
  value.photo_prices = photoPriceMap(formData, "photo_", false, back);
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").upsert({ key: "billing_defaults", value, updated_at: new Date().toISOString() });
  if (error) go(back, { error: friendly(error.message) });
  revalidatePath("/admin/billing", "layout");
  go(back, { saved: "Standard prices saved. They apply to new charges for builders who don’t have their own price." });
}

// ---------------------------------------------------------------------------
// One builder's plan and deal
// ---------------------------------------------------------------------------
export async function saveBuilderBilling(formData: FormData) {
  const builderId = String(formData.get("builder_id"));
  const back = `/admin/billing/builders/${builderId}`;
  await requireAdmin(back);
  const plan = String(formData.get("plan") ?? "");
  const startsOn = String(formData.get("starts_on") ?? "");
  const price = (k: string) => {
    const v = parseDollars(formData.get(k));
    if (Number.isNaN(v)) go(back, { error: "Prices must be dollar amounts. Leave a box empty to use the standard price." });
    return v;
  };
  const netRaw = String(formData.get("net_days") ?? "").trim();
  const net = netRaw === "" ? null : Number(netRaw);
  if (net !== null && (!Number.isInteger(net) || net < 0 || net > 90)) go(back, { error: "Payment terms are 0 to 90 days." });
  if (plan && !DAY.test(startsOn)) go(back, { error: "Pick the date billing starts. Nothing is charged before it." });

  const supabase = await createClient();
  const { error } = await supabase
    .from("builder_billing")
    .update({
      plan: plan === "software" || plan === "listing_service" ? plan : null,
      includes_photos: formData.get("includes_photos") === "on",
      starts_on: DAY.test(startsOn) ? startsOn : null,
      software_fee_cents: price("software_fee_cents"),
      listing_fee_cents: price("listing_fee_cents"),
      relist_fee_cents: price("relist_fee_cents"),
      onboarding_fee_cents: price("onboarding_fee_cents"),
      photo_prices: photoPriceMap(formData, "photo_", true, back),
      net_days: net,
      deal_notes: String(formData.get("deal_notes") ?? "").trim().slice(0, 2000) || null,
      quickbooks_customer_id: String(formData.get("quickbooks_customer_id") ?? "").trim().slice(0, 100) || null,
    })
    .eq("builder_id", builderId);
  if (error) go(back, { error: friendly(error.message) });
  revalidatePath("/admin/billing", "layout");
  go(back, { saved: "Plan saved. New prices apply to charges from now on; earlier charges keep the price they had." });
}

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------
export async function addAdjustment(formData: FormData) {
  const builderId = String(formData.get("builder_id"));
  const back = backFrom(formData, `/admin/billing/builders/${builderId}`);
  await requireAdmin(back);
  const description = String(formData.get("description") ?? "").trim().slice(0, 300);
  const amount = parseDollars(formData.get("amount"));
  const month = String(formData.get("invoice_month") ?? "");
  if (!description) go(back, { error: "Say what the adjustment is for (it prints on the invoice)." });
  if (amount === null || Number.isNaN(amount) || amount === 0) go(back, { error: "Enter an amount above zero." });
  const signed = formData.get("direction") === "credit" ? -amount : amount;
  const supabase = await createClient();
  const { error } = await supabase.from("billing_charges").insert({
    builder_id: builderId,
    kind: "adjustment",
    description,
    amount_cents: signed,
    ...(MONTH.test(month) ? { invoice_month: month } : {}),
  });
  if (error) go(back, { error: friendly(error.message) });
  revalidatePath("/admin/billing", "layout");
  go(back, { saved: signed < 0 ? "Credit added." : "Charge added." });
}

export async function voidCharge(formData: FormData) {
  const back = backFrom(formData, "/admin/billing");
  await requireAdmin(back);
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (!reason) go(back, { error: "Say why you’re removing it (for example “Waived: first relist”)." });
  const supabase = await createClient();
  const { error } = await supabase.from("billing_charges").update({ voided_at: new Date().toISOString(), void_reason: reason }).eq("id", id);
  if (error) go(back, { error: friendly(error.message) });
  revalidatePath("/admin/billing", "layout");
  go(back, { saved: "Charge removed. It stays in the history as voided." });
}

export async function restoreCharge(formData: FormData) {
  const back = backFrom(formData, "/admin/billing");
  await requireAdmin(back);
  const supabase = await createClient();
  const { error } = await supabase.from("billing_charges").update({ voided_at: null }).eq("id", String(formData.get("id")));
  if (error) go(back, { error: friendly(error.message) });
  revalidatePath("/admin/billing", "layout");
  go(back, { saved: "Charge put back. It goes on the next invoice that’s built." });
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export async function buildInvoices(formData: FormData) {
  const back = backFrom(formData, "/admin/billing");
  await requireAdmin(back);
  const month = String(formData.get("month") ?? "");
  const builderId = String(formData.get("builder_id") ?? "") || null;
  if (!MONTH.test(month)) go(back, { error: "Pick a month." });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("build_invoices", { p_month: month, p_builder: builderId });
  if (error) go(back, { error: friendly(error.message) });
  revalidatePath("/admin/billing", "layout");
  const n = Number(data ?? 0);
  go(back, {
    saved: n === 0
      ? `Nothing to invoice for ${monthLabel(month)}${builderId ? " for this builder" : ""} (already sent, no charges, or billing not set up).`
      : `${n} draft invoice${n === 1 ? "" : "s"} ready for ${monthLabel(month)}. Check each one, then mark it sent.`,
  });
}

export async function setInvoiceStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const back = backFrom(formData, `/admin/billing/invoices/${id}`);
  await requireAdmin(back);
  const status = String(formData.get("status"));
  if (!["sent", "paid", "void"].includes(status)) go(back, { error: "Unknown status." });
  const patch: Record<string, string | null> = { status };
  if (status === "paid") patch.paid_note = String(formData.get("paid_note") ?? "").trim().slice(0, 300) || null;
  if (status === "void") {
    const reason = String(formData.get("void_reason") ?? "").trim().slice(0, 300);
    if (!reason) go(back, { error: "Say why the invoice is voided." });
    patch.void_reason = reason;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").update(patch).eq("id", id);
  if (error) go(back, { error: friendly(error.message) });
  revalidatePath("/admin/billing", "layout");
  revalidatePath("/billing", "layout");
  go(back, {
    saved:
      status === "sent" ? "Marked sent. It’s numbered and the owner can see it on their Billing page."
      : status === "paid" ? "Marked paid."
      : "Voided. Its charges go back to waiting and will be on the next invoice you build.",
  });
}

export async function markUnpaid(formData: FormData) {
  const id = String(formData.get("id"));
  const back = backFrom(formData, `/admin/billing/invoices/${id}`);
  await requireAdmin(back);
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").update({ status: "sent" }).eq("id", id);
  if (error) go(back, { error: friendly(error.message) });
  revalidatePath("/admin/billing", "layout");
  go(back, { saved: "Moved back to unpaid." });
}

export async function saveInvoiceNotes(formData: FormData) {
  const id = String(formData.get("id"));
  const back = `/admin/billing/invoices/${id}`;
  await requireAdmin(back);
  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({
      notes: String(formData.get("notes") ?? "").trim().slice(0, 1000) || null,
      quickbooks_invoice_id: String(formData.get("quickbooks_invoice_id") ?? "").trim().slice(0, 100) || null,
    })
    .eq("id", id);
  if (error) go(back, { error: friendly(error.message) });
  revalidatePath("/admin/billing", "layout");
  go(back, { saved: "Saved." });
}
