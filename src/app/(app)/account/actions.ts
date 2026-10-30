"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { demoModeOn, requireProfile } from "@/lib/auth";
import { emailAllowed } from "@/lib/email-domains";

function go(params: Record<string, string>, hash = ""): never {
  redirect(`/account?${new URLSearchParams(params).toString()}${hash}`);
}

// Shared demo logins keep their email and password so the demo keeps working.
async function blockDemo(email: string, hash: string) {
  if (demoModeOn() && email.endsWith("@demo.test")) {
    go({ error: "Demo logins can’t change their email or password, so the demo keeps working for everyone. Your real login can." }, hash);
  }
}

export async function saveProfile(formData: FormData) {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", {
    p_full_name: String(formData.get("full_name") ?? ""),
    p_phone: String(formData.get("phone") ?? ""),
    p_job_title: String(formData.get("job_title") ?? ""),
  });
  if (error) go({ error: error.message.includes("name") ? "Enter your name." : "Couldn’t save your profile." });
  revalidatePath("/", "layout");
  go({ saved: "Profile saved." });
}

export async function saveAvatar(path: string): Promise<{ error?: string }> {
  const me = await requireProfile();
  const supabase = await createClient();
  const { data: before } = await supabase.from("profiles").select("avatar_path").eq("id", me.id).single();
  const { error } = await supabase.rpc("set_my_avatar", { p_path: path });
  if (error) return { error: "Couldn’t save your photo." };
  if (before?.avatar_path && before.avatar_path !== path) await supabase.storage.from("profile-photos").remove([before.avatar_path]);
  revalidatePath("/", "layout");
  return {};
}

export async function removeAvatar(): Promise<{ error?: string }> {
  const me = await requireProfile();
  const supabase = await createClient();
  const { data: before } = await supabase.from("profiles").select("avatar_path").eq("id", me.id).single();
  const { error } = await supabase.rpc("set_my_avatar", { p_path: null });
  if (error) return { error: "Couldn’t remove your photo." };
  if (before?.avatar_path) await supabase.storage.from("profile-photos").remove([before.avatar_path]);
  revalidatePath("/", "layout");
  return {};
}

// Changing the sign-in email: Supabase emails a confirmation link to the new
// address, and the change only happens once it's clicked.
export async function changeEmail(formData: FormData) {
  const me = await requireProfile();
  await blockDemo(me.email, "#email");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) go({ error: "Enter a valid email address." }, "#email");
  if (email === me.email) go({ error: "That’s already your email." }, "#email");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const supabase = await createClient();
  // Builder people keep an email their company approved (owners, 29 Oct 2026).
  if (me.builder_id && !(await emailAllowed(supabase, me.builder_id, email))) {
    go({ error: "That email isn’t approved for your company. Use your work email, or ask Builder Listing Services to approve it." }, "#email");
  }
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${origin}/auth/confirm?next=/account` });
  if (error) go({ error: error.message.includes("already") ? "Another login already uses that email." : `Couldn’t change your email: ${error.message}` }, "#email");
  go({ saved: `We sent a confirmation link to ${email} (and possibly to ${me.email} too, to make sure it’s really you). Your email changes once you click it; until then, keep signing in with ${me.email}.` }, "#email");
}

export async function changePassword(formData: FormData) {
  const me = await requireProfile();
  await blockDemo(me.email, "#password");
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next.length < 10) go({ error: "Use at least 10 characters for your new password." }, "#password");
  if (next !== confirm) go({ error: "The two new passwords don’t match." }, "#password");
  if (next === current) go({ error: "Pick a password different from your current one." }, "#password");
  const supabase = await createClient();
  // Make sure it's really them before changing it.
  const { error: wrong } = await supabase.auth.signInWithPassword({ email: me.email, password: current });
  if (wrong) go({ error: "Your current password isn’t right." }, "#password");
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) go({ error: error.message.toLowerCase().includes("weak") || error.message.toLowerCase().includes("pwned") ? "That password is too easy to guess. Try a longer one." : `Couldn’t change your password: ${error.message}` }, "#password");
  go({ saved: "Password changed. Use it next time you sign in." }, "#password");
}
