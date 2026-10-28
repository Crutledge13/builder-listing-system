"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEMO_USERS, demoModeOn } from "@/lib/auth";
import { safePath } from "@/lib/safe-path";

// Demo-only: sign in as a different fake user so you can show each role's view.
// Works only when DEMO_MODE is on, only for someone already signed in as a
// demo user, and only to switch to another demo user.
export async function switchDemoUser(formData: FormData) {
  if (!demoModeOn()) redirect("/communities");

  const target = String(formData.get("email") ?? "");
  if (!DEMO_USERS.some((u) => u.email === target)) redirect("/homes");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email?.endsWith("@demo.test")) redirect("/homes");

  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({
    email: target,
    password: process.env.DEMO_PASSWORD!,
  });
  if (error) redirect("/login?error=invalid");

  const back = String(formData.get("back") ?? "/communities");
  redirect(safePath(back, "/communities"));
}
