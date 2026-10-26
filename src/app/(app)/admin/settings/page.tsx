import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { cx, dateTime } from "@/lib/format";
import { saveSettings } from "../actions";

export default function SettingsAdmin(props: PageProps<"/admin/settings">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Settings />
    </Suspense>
  );
}

const EMAIL_STYLE: Record<string, string> = {
  sent: "bg-emerald-100 text-emerald-800",
  skipped: "bg-soft text-muted",
  failed: "bg-red-100 text-red-800",
  queued: "bg-amber-100 text-amber-900",
};
const EMAIL_LABEL: Record<string, string> = { sent: "Sent", skipped: "Not sent (email not set up)", failed: "Failed", queued: "Waiting" };

async function Settings() {
  const supabase = await createClient();
  const [{ data: settings }, { data: emails }] = await Promise.all([
    supabase.from("app_settings").select("key, value"),
    supabase.from("email_outbox").select("id, to_email, subject, status, error, created_at").order("created_at", { ascending: false }).limit(25),
  ]);
  const get = (k: string) => settings?.find((s) => s.key === k)?.value;
  const emailOn = !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

  return (
    <div className="grid gap-10 lg:grid-cols-[360px_1fr]">
      <form action={saveSettings} className="h-fit space-y-4 rounded-2xl border border-line p-5">
        <h2 className="font-semibold">System settings</h2>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">How far ahead the MLS takes open houses (days)</span>
          <input name="mls_open_house_window_days" type="number" min={7} max={120} defaultValue={Number(get("mls_open_house_window_days") ?? 28)} className="field-input" />
          <span className="mt-1 block text-xs text-muted">Repeating open houses add dates up to this far out, and our team gets a reminder for each new batch.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Team email</span>
          <input name="team_email" type="email" defaultValue={String(get("team_email") ?? "")} className="field-input" />
          <span className="mt-1 block text-xs text-muted">Where reverse prospecting requests and help reports are emailed.</span>
        </label>
        <button className="w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Save settings</button>
      </form>

      <section>
        <h2 className="font-semibold">Email log</h2>
        <p className="mt-1 text-sm text-muted">
          {emailOn
            ? "Emails go out through the email service."
            : "The email service isn’t set up yet (RESEND_API_KEY and EMAIL_FROM in Vercel), so emails are logged here instead of sent. Tasks are created either way."}
        </p>
        <div className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {(emails ?? []).map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{e.subject}</div>
                <div className="text-muted">To {e.to_email}, {dateTime(e.created_at)}</div>
              </div>
              <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", EMAIL_STYLE[e.status])}>{EMAIL_LABEL[e.status]}</span>
            </div>
          ))}
          {!emails?.length && <p className="p-4 text-sm text-muted">No emails yet.</p>}
        </div>
      </section>
    </div>
  );
}
