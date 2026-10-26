import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { Notice } from "@/components/notice";
import { reportIssue } from "./actions";

export default function HelpPage(props: PageProps<"/help">) {
  return (
    <Suspense fallback={<div className="mt-16 h-64 animate-pulse rounded-2xl bg-soft" />}>
      <div className="mx-auto max-w-2xl">
        <Notice searchParams={props.searchParams} />
        <Help searchParams={props.searchParams} />
      </div>
    </Suspense>
  );
}

const TIPS = [
  { q: "How do I get a listing onto the MLS?", a: "Fill in the home, submit it for review, and a manager or owner approves it. Our team enters it into the MLS and adds the MLS number." },
  { q: "Where do photos go?", a: "Every home has a media folder. Uploads are private, AI suggests the room, and you can fix any label." },
  { q: "How do I pause a listing?", a: "On the home, use Pause listing in the status box. Our team updates the MLS, and any open houses stop." },
  { q: "Who can see what?", a: "Your builder’s team sees only your homes. Salespeople see only their communities. Photographers see only their jobs." },
];

async function Help({ searchParams }: { searchParams: PageProps<"/help">["searchParams"] }) {
  const sp = await searchParams;
  const me = await requireProfile();
  const supabase = await createClient();
  const { data: mine } = await supabase
    .from("issue_reports")
    .select("id, kind, message, status, created_at")
    .eq("reported_by", me.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const from = typeof sp.from === "string" ? sp.from : "";

  return (
    <div>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Help</h1>
      <p className="mt-1 text-muted">Quick answers, or tell our team about a problem. Reports go straight onto our task list.</p>

      <form action={reportIssue} className="mt-8 rounded-2xl border border-line p-5">
        <h2 className="text-lg font-semibold">Report an issue or ask a question</h2>
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-medium">What kind?</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {[["problem", "Something’s broken"], ["question", "I have a question"], ["idea", "I have an idea"]].map(([v, l], i) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="kind" value={v} defaultChecked={i === 0} className="h-4 w-4 accent-[#3452c7]" />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium">What happened, or what do you need?</span>
          <textarea name="message" required rows={5} className="field-input leading-relaxed" placeholder="I tried to schedule an open house on 1214 Pecan Ridge and…" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-sm font-medium">Which page? (optional)</span>
          <input name="page" defaultValue={from} placeholder="The address or page name" className="field-input" />
        </label>
        <button className="mt-4 rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:brightness-110">Send to our team</button>
      </form>

      {mine && mine.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Your reports</h2>
          <ul className="mt-3 space-y-2">
            {mine.map((r) => (
              <li key={r.id} className="rounded-xl border border-line px-4 py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{r.message.slice(0, 120)}{r.message.length > 120 ? "…" : ""}</span>
                  <span className={r.status === "open" ? "text-amber-800" : "text-emerald-700"}>{r.status === "open" ? "Open" : "Resolved"}</span>
                </div>
                <div className="text-muted">{dateTime(r.created_at)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Quick answers</h2>
        <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
          {TIPS.map((t) => (
            <details key={t.q} className="px-4 py-3">
              <summary className="cursor-pointer font-medium">{t.q}</summary>
              <p className="mt-2 text-muted">{t.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
