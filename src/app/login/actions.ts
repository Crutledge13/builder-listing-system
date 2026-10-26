"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !signedIn.user) redirect("/login?error=invalid");
  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", signedIn.user.id).maybeSingle();
  if (profile && !profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }
  redirect("/communities");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
