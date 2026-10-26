import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/config";

// Sends the emails the database queued for a record someone just created
// (reverse prospecting request, issue report).
//
// Reading and marking queued emails is server-only: it uses the service key
// (SUPABASE_SERVICE_ROLE_KEY), which signed-in users never have. Sending uses
// Resend (RESEND_API_KEY and EMAIL_FROM). Until both are set, emails wait in
// the log under Admin > Settings; the task is on the board either way.
export async function sendQueuedEmails(table: string, id: string) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return; // stays queued
  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } });
  const { data: emails } = await admin.rpc("queued_emails_for", { p_table: table, p_id: id });
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  for (const e of (emails ?? []) as { id: string; to_email: string; subject: string; body: string }[]) {
    if (!key || !from) {
      await admin.rpc("record_email_result", { p_id: e.id, p_status: "skipped", p_error: "Email service not set up yet" });
      continue;
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [e.to_email], subject: e.subject, text: e.body }),
      });
      await admin.rpc("record_email_result", {
        p_id: e.id,
        p_status: res.ok ? "sent" : "failed",
        p_error: res.ok ? null : `Email service said ${res.status}`,
      });
    } catch (err) {
      await admin.rpc("record_email_result", { p_id: e.id, p_status: "failed", p_error: String(err).slice(0, 200) });
    }
  }
}
