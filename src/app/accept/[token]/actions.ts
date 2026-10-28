"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signInTokenFor } from "@/lib/invite-links";

// The Continue button on an invite link: sign the person in, then on to
// choosing a password. Done only on this click (never when the link is just
// opened), so email scanners that open links can't use it up.
export async function acceptInvite(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const got = await signInTokenFor(token);
  if ("problem" in got) redirect(`/accept/${encodeURIComponent(token)}`);
  const supabase = await createClient();
  // If someone else is signed in on this browser, the invited person replaces them.
  await supabase.auth.signOut();
  const { error } = await supabase.auth.verifyOtp({ token_hash: got.tokenHash, type: "magiclink" });
  if (error) redirect(`/accept/${encodeURIComponent(token)}?error=signin`);
  redirect("/welcome");
}
