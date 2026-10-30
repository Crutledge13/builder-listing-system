import "server-only";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { createClient as createAdminSupabase, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/config";

// Invite links. We create the person's login (no email is sent) and the
// person who added them copies a link and sends it any way they like.
//
// The link is our own: /accept/<token>, good for 48 hours (INVITE_HOURS). It
// shows a page with a Continue button, and only that button signs the person
// in. Email security scanners (Outlook / Microsoft Safe Links) open every link
// in an email to check it; they don't press buttons, so they can no longer use
// up the link before the person gets to it. After signing in, /welcome asks
// for a password; until they set one their login is marked needs_password and
// the link keeps working. Once a password is set the link stops working, and a
// link is never made for someone who already has one, so a link can't be used
// to get into an active account. Making a new link replaces the old one.

export const INVITE_HOURS = 48;

export function invitesOn() {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function adminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Invites need the SUPABASE_SERVICE_ROLE_KEY setting in Vercel.");
  return createAdminSupabase(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// This site's own address, from the request (so test, preview and live each
// make links to themselves).
async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// Makes the login (no email is sent). The caller then saves the profile with
// their own database access, so the database rules decide who can add whom.
// appMetadata: set only by our server, never by the person (brokers get
// role "broker" here, which the sign-in router uses to keep them in /broker).
export async function createInvitedLogin(email: string, fullName: string, appMetadata?: Record<string, string>): Promise<{ userId: string } | { error: string }> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true, // nothing to confirm by email: the invite link is the proof
    user_metadata: { full_name: fullName, needs_password: true },
    ...(appMetadata ? { app_metadata: appMetadata } : {}),
  });
  if (error || !data.user) {
    const msg = error?.message ?? "unknown error";
    return { error: /already.*registered|already exists|already been registered/i.test(msg) ? "Someone with that email already has a login." : `Couldn’t make the login: ${msg}` };
  }
  return { userId: data.user.id };
}

// Undo a login when its profile couldn't be saved, so nothing is half set up.
export async function deleteLogin(userId: string) {
  await adminClient().auth.admin.deleteUser(userId);
}

// A fresh link for someone who hasn't set a password yet. Replaces any
// earlier link for them.
export async function freshInviteLink(userId: string, createdBy: string): Promise<{ link: string; expiresAt: string } | { error: string }> {
  const admin = adminClient();
  const { data: got, error } = await admin.auth.admin.getUserById(userId);
  if (error || !got.user?.email) return { error: "That login wasn’t found." };
  if (!got.user.user_metadata?.needs_password) return { error: "They’ve already set a password and sign in at the login page." };
  // Logins made by the older invite flow may not be confirmed yet.
  if (!got.user.email_confirmed_at) await admin.auth.admin.updateUserById(userId, { email_confirm: true });

  const now = new Date();
  await admin.from("invite_tokens").update({ revoked_at: now.toISOString() }).eq("profile_id", userId).is("revoked_at", null).is("used_at", null);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_HOURS * 3600_000).toISOString();
  const { error: insErr } = await admin.from("invite_tokens").insert({ token, profile_id: userId, created_by: createdBy, expires_at: expiresAt });
  if (insErr) return { error: `Couldn’t make a link: ${insErr.message}` };
  return { link: `${await siteOrigin()}/accept/${token}`, expiresAt };
}

export type InviteInfo = { profileId: string; email: string; firstName: string; builderName: string | null };

// What the /accept page may show about a link (the person's first name and
// company), or why it can't be used.
export async function lookupInvite(token: string): Promise<{ ok: InviteInfo } | { problem: "expired" | "used" | "unknown" }> {
  if (!invitesOn() || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) return { problem: "unknown" };
  const admin = adminClient();
  const { data: row } = await admin
    .from("invite_tokens")
    .select("profile_id, expires_at, used_at, revoked_at, profiles!invite_tokens_profile_id_fkey(full_name, email, is_active, builders!profiles_builder_id_fkey(name))")
    .eq("token", token)
    .maybeSingle();
  if (!row) return { problem: "unknown" };
  if (row.used_at) return { problem: "used" };
  if (row.revoked_at || new Date(row.expires_at) < new Date()) return { problem: "expired" };
  const p = row.profiles as unknown as { full_name: string; email: string; is_active: boolean; builders: { name: string } | null } | null;
  if (!p?.is_active) return { problem: "unknown" };
  const { data: got } = await admin.auth.admin.getUserById(row.profile_id);
  if (!got.user?.user_metadata?.needs_password) return { problem: "used" };
  return { ok: { profileId: row.profile_id, email: p.email, firstName: p.full_name.split(" ")[0], builderName: p.builders?.name.replace(" (demo)", "") ?? null } };
}

// The sign-in for a valid link: a one-time Supabase token the caller verifies
// straight away (so it never sits in an email for a scanner to open).
export async function signInTokenFor(token: string): Promise<{ tokenHash: string } | { problem: "expired" | "used" | "unknown" }> {
  const found = await lookupInvite(token);
  if ("problem" in found) return found;
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "magiclink", email: found.ok.email });
  if (error || !data.properties?.hashed_token) return { problem: "unknown" };
  return { tokenHash: data.properties.hashed_token };
}

// The person set their password: their links stop working.
export async function finishInvites(profileId: string) {
  if (!invitesOn()) return;
  await adminClient().from("invite_tokens").update({ used_at: new Date().toISOString() }).eq("profile_id", profileId).is("used_at", null);
}

// Which of these people still need to choose a password (their invite is open).
export async function pendingInvites(ids: string[]): Promise<Set<string>> {
  if (!invitesOn() || !ids.length) return new Set();
  const want = new Set(ids);
  const admin = adminClient();
  const out = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data.users.length) break;
    for (const u of data.users) if (want.has(u.id) && u.user_metadata?.needs_password) out.add(u.id);
    if (data.users.length < 1000) break;
  }
  return out;
}
