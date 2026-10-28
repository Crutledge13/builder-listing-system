"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { setupOpen } from "@/lib/onboarding";
import { finishInvites } from "@/lib/invite-links";

function back(error: string): never {
  redirect(`/welcome?${new URLSearchParams({ error }).toString()}`);
}

// A new person's first password. Only for logins still waiting for one
// (opened from an invite link); everyone else changes theirs on My profile.
export async function setFirstPassword(formData: FormData) {
  const me = await requireProfile();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.user_metadata?.needs_password) redirect("/account#password");

  const name = String(formData.get("full_name") ?? "").trim().slice(0, 80);
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 10) back("Use at least 10 characters for your password.");
  if (password !== confirm) back("The two passwords don’t match.");

  const { error } = await supabase.auth.updateUser({ password, data: { needs_password: false } });
  if (error) back(/weak|pwned|leaked/i.test(error.message) ? "That password is too easy to guess. Try a longer one." : `Couldn’t save your password: ${error.message}`);
  await finishInvites(me.id); // their invite link stops working now
  if (name && name !== me.full_name) await supabase.rpc("update_my_profile", { p_full_name: name, p_phone: me.phone, p_job_title: me.job_title });

  // Builders who run the setup go straight to their checklist.
  if (me.role === "photographer") redirect("/jobs");
  if (await setupOpen(supabase, me.role, me.builder_id)) redirect("/setup?saved=" + encodeURIComponent("You’re in. Here’s everything we need to get your company set up."));
  redirect("/communities?saved=" + encodeURIComponent("You’re in. Welcome to Builder Listings."));
}
