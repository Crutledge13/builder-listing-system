"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendQueuedEmails } from "@/lib/email";

export async function reportIssue(formData: FormData) {
  const kind = String(formData.get("kind") ?? "problem");
  const message = String(formData.get("message") ?? "").trim();
  const page = String(formData.get("page") ?? "").trim();
  if (!message) redirect("/help?error=" + encodeURIComponent("Tell us what happened."));

  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  // Name, role and builder are filled in by the database; it also makes a task and queues an email.
  const { data, error } = await supabase
    .from("issue_reports")
    .insert({ kind: ["problem", "question", "idea"].includes(kind) ? kind : "problem", message, page: page || null, reported_by: me.user?.id })
    .select("id")
    .single();
  if (error || !data) redirect("/help?error=" + encodeURIComponent("Couldn’t send that. Please try again."));
  after(() => sendQueuedEmails(supabase, "issue_reports", data.id));
  redirect("/help?saved=" + encodeURIComponent("Thanks. Our team has it and will follow up."));
}
