"use server";

import { redirect } from "next/navigation";
import { createClient as createAdminSupabase } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL } from "@/lib/supabase/config";

// Someone opened a join link and filled in their details. Their login is made
// here on our server with Supabase's admin key (no email is sent), the
// database sets up their account from the link (public.redeem_join_link),
// and they're signed straight in.
export async function joinWithLink(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = (error: string): never => redirect(`/join/${encodeURIComponent(token)}?${new URLSearchParams({ error })}`);

  const name = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const password = String(formData.get("password") ?? "");
  if (!name) back("Enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) back("That email address doesn’t look right.");
  if (password.length < 10) back("Pick a password with at least 10 characters.");
  if (password !== String(formData.get("password2") ?? "")) back("The two passwords don’t match.");

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) back("Joining isn’t switched on yet. Ask whoever sent you the link.");

  const supabase = await createClient();
  const { data: info } = await supabase.rpc("join_link_info", { p_token: token }).maybeSingle();
  if (!info || !(info as { ok: boolean }).ok) back("This join link isn’t working anymore. Ask whoever sent it for a new one.");

  const admin = createAdminSupabase(SUPABASE_URL, serviceKey!, { auth: { persistSession: false } });
  const { data: made, error: makeError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (makeError || !made.user) {
    back(/already|registered|exists/i.test(makeError?.message ?? "")
      ? "That email already has an account. Sign in instead, or ask for help if you forgot the password."
      : "Couldn’t set up your login. Try again in a minute.");
  }

  const { error: redeemError } = await admin.rpc("redeem_join_link", {
    p_token: token,
    p_user: made.user!.id,
    p_email: email,
    p_name: name,
    p_phone: phone || null,
  });
  if (redeemError) {
    await admin.auth.admin.deleteUser(made.user!.id); // nothing half set up
    back(/already has an account/i.test(redeemError.message)
      ? "That email already has an account. Sign in instead."
      : /isn.t working/i.test(redeemError.message)
        ? "This join link isn’t working anymore. Ask whoever sent it for a new one."
        : "Couldn’t set up your account. Try again in a minute.");
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) redirect("/login");
  redirect("/communities");
}
