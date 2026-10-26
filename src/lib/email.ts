import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Sends the emails the database queued for a record someone just created
// (reverse prospecting request, issue report). Uses Resend when it's set up
// (RESEND_API_KEY and EMAIL_FROM). Until then, emails stay in the email log in
// Admin, marked "not sent", and the task is on the board either way.
export async function sendQueuedEmails(supabase: SupabaseClient, table: string, id: string) {
  const { data: emails } = await supabase.rpc("queued_emails_for", { p_table: table, p_id: id });
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  for (const e of (emails ?? []) as { id: string; to_email: string; subject: string; body: string }[]) {
    if (!key || !from) {
      await supabase.rpc("record_email_result", { p_id: e.id, p_status: "skipped", p_error: "Email service not set up yet" });
      continue;
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [e.to_email], subject: e.subject, text: e.body }),
      });
      await supabase.rpc("record_email_result", {
        p_id: e.id,
        p_status: res.ok ? "sent" : "failed",
        p_error: res.ok ? null : `Email service said ${res.status}`,
      });
    } catch (err) {
      await supabase.rpc("record_email_result", { p_id: e.id, p_status: "failed", p_error: String(err).slice(0, 200) });
    }
  }
}
