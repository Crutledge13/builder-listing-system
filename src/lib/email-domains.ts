import type { SupabaseClient } from "@supabase/supabase-js";

// Approved email domains per builder (owners, 29 Oct 2026). The database is
// the lock (profiles_email_domain_check); these helpers let screens check first
// and explain. A builder with none approved yet isn't checked.

export type ApprovedEmail = { id: string; builder_id: string; value: string; kind: "domain" | "address"; reason: string | null; created_at: string };

export const APPROVED_SELECT = "id, builder_id, value, kind, reason, created_at";

export function domainOf(email: string | null | undefined) {
  const at = (email ?? "").lastIndexOf("@");
  return at === -1 ? "" : (email ?? "").slice(at + 1).trim().toLowerCase();
}

// Email services anyone can sign up for (same list as private.is_personal_email_domain).
const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "yandex.com",
  "att.net", "sbcglobal.net", "bellsouth.net", "comcast.net", "verizon.net", "cox.net", "charter.net", "earthlink.net",
]);
export function isPersonalDomain(domain: string) {
  return PERSONAL.has(domain.toLowerCase());
}

// "acmehomes.com, acme-homes.com" -> clean list, personal services dropped.
export function readDomainList(text: string) {
  return [...new Set(text.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
}

export async function loadApproved(supabase: SupabaseClient, builderId?: string | null) {
  let q = supabase.from("builder_email_domains").select(APPROVED_SELECT).is("removed_at", null).order("kind").order("value");
  if (builderId) q = q.eq("builder_id", builderId);
  const { data } = await q;
  return (data ?? []) as ApprovedEmail[];
}

// Would the database accept this email for this builder? Asked before a login is made.
export async function emailAllowed(supabase: SupabaseClient, builderId: string, email: string) {
  const { data, error } = await supabase.rpc("email_allowed", { p_builder: builderId, p_email: email });
  return !error && data === true;
}

export function notApprovedMessage(email: string, approved: ApprovedEmail[]) {
  const domains = approved.filter((a) => a.kind === "domain").map((a) => `@${a.value}`);
  return `${email} isn’t an approved email for this company${domains.length ? ` (approved: ${domains.join(", ")})` : ""}. Ask Builder Listing Services to approve it.`;
}
