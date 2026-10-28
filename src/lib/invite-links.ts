import "server-only";
import { headers } from "next/headers";
import { createClient as createAdminSupabase, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/config";

// Invite links. Instead of relying on Supabase's invite email (a few an hour
// on the built-in sender), we create the login and hand back a link that
// whoever invited them copies and sends any way they like. The link opens
// /auth/confirm, which signs the person in, then /welcome, where they choose a
// password. Until they do, their login is marked needs_password, and a new
// link can be made at any time. A link is never made for someone who has
// already set a password, so a link can't be used to get into an active account.

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

async function linkFor(hashedToken: string, type: "invite" | "magiclink") {
  const q = new URLSearchParams({ token_hash: hashedToken, type, next: "/welcome" });
  return `${await siteOrigin()}/auth/confirm?${q.toString()}`;
}

// Makes the login (no email is sent). The caller then saves the profile with
// their own database access, so the database rules decide who can add whom.
export async function createInvitedLogin(email: string, fullName: string): Promise<{ userId: string; link: string } | { error: string }> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: fullName, needs_password: true } },
  });
  if (error || !data.user || !data.properties?.hashed_token) {
    const msg = error?.message ?? "unknown error";
    return { error: /already.*registered|already exists/i.test(msg) ? "Someone with that email already has a login." : `Couldn’t make the login: ${msg}` };
  }
  return { userId: data.user.id, link: await linkFor(data.properties.hashed_token, "invite") };
}

// Undo a login when its profile couldn't be saved, so nothing is half set up.
export async function deleteLogin(userId: string) {
  await adminClient().auth.admin.deleteUser(userId);
}

// A fresh link for someone who hasn't set a password yet.
export async function freshInviteLink(userId: string): Promise<{ link: string } | { error: string }> {
  const admin = adminClient();
  const { data: got, error } = await admin.auth.admin.getUserById(userId);
  if (error || !got.user?.email) return { error: "That login wasn’t found." };
  if (!got.user.user_metadata?.needs_password) return { error: "They’ve already set a password and sign in at the login page." };
  // Not yet opened: a new invite link. Opened but no password chosen: a sign-in link.
  const type = got.user.email_confirmed_at ? "magiclink" : "invite";
  const { data, error: linkErr } = await admin.auth.admin.generateLink({ type, email: got.user.email });
  if (linkErr || !data.properties?.hashed_token) return { error: `Couldn’t make a link: ${linkErr?.message ?? "unknown error"}` };
  return { link: await linkFor(data.properties.hashed_token, type) };
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
