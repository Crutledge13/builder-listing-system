import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { num } from "@/lib/format";
import { addAiCredits, setAiAllowance, setAiDefault } from "./actions";

export default function AdminOverview(props: PageProps<"/admin">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <div className="mb-6"><Notice searchParams={props.searchParams} /></div>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const supabase = await createClient();
  const count = async (table: string, f?: (q: ReturnType<ReturnType<typeof supabase.from>["select"]>) => unknown) => {
    let q = supabase.from(table).select("*", { count: "exact", head: true });
    if (f) q = f(q) as typeof q;
    const { count: n } = await q;
    return n ?? 0;
  };
  const [builders, communities, homes, people, media, openRequests, readyForMls, inReview, tagRequests] = await Promise.all([
    count("builders"),
    count("communities"),
    count("homes", (q) => q.is("deleted_at", null)),
    count("profiles"),
    count("media", (q) => q.is("deleted_at", null)),
    count("change_requests", (q) => q.eq("status", "open")),
    count("homes", (q) => q.eq("workflow_status", "approved_for_mls").is("deleted_at", null)),
    count("homes", (q) => q.eq("workflow_status", "in_review").is("deleted_at", null)),
    count("media_tag_requests", (q) => q.eq("status", "pending")),
  ]);

  const tiles = [
    { n: readyForMls, label: "ready to enter into the MLS", href: "/approvals", urgent: readyForMls > 0 },
    { n: openRequests, label: "open change requests", href: "/admin/requests", urgent: openRequests > 0 },
    { n: inReview, label: "waiting on builder approval", href: "/approvals" },
    ...(tagRequests > 0 ? [{ n: tagRequests, label: "new photo tags requested", href: "/admin/tags#requests", urgent: true }] : []),
    { n: builders, label: "builders", href: "/admin/builders" },
    { n: communities, label: "communities", href: "/admin/communities" },
    { n: homes, label: "homes", href: "/homes" },
    { n: people, label: "people with logins", href: "/admin/people" },
    { n: media, label: "photos, videos and floor plans", href: "/media" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`rounded-2xl border p-5 transition-shadow hover:shadow-md ${t.urgent ? "border-accent bg-accent-soft" : "border-line"}`}>
            <div className="text-3xl font-bold tabular-nums">{t.n}</div>
            <div className="mt-1 text-sm text-muted">{t.label}</div>
          </Link>
        ))}
      </div>
      <AiCredits />
      <StorageMeter />
    </div>
  );
}

const BUCKET_NAMES: Record<string, string> = {
  media: "Photos and videos",
  "plan-files": "Floor plan files",
  branding: "Logos and brand guides",
  deliverables: "Delivered files",
  "profile-photos": "Headshots",
};

const size = (b: number) => (b >= 1_073_741_824 ? `${(b / 1_073_741_824).toFixed(2)} GB` : `${Math.round(b / 1_048_576)} MB`);

// File storage used vs the plan's limit (app_settings.storage_limit_mb).
async function StorageMeter() {
  const supabase = await createClient();
  const [{ data: rows }, { data: limitRow }] = await Promise.all([
    supabase.rpc("storage_usage"),
    supabase.from("app_settings").select("value").eq("key", "storage_limit_mb").maybeSingle(),
  ]);
  const list = (rows ?? []) as { bucket: string; files: number; bytes: number }[];
  const used = list.reduce((s, r) => s + Number(r.bytes), 0);
  const limit = Number(limitRow?.value ?? 1024) * 1_048_576;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const tone = pct >= 100 ? "bg-red-600" : pct >= 80 ? "bg-amber-500" : "bg-accent";

  return (
    <section className="rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">File storage</h2>
        <span className="text-sm tabular-nums text-muted">{size(used)} of {size(limit)} used</span>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-soft" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {pct >= 80 && (
        <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {pct >= 100 ? "Storage is over the plan's limit." : "Storage is over 80% of the plan's limit."} Upgrade the Supabase plan before adding more photos or video, then update the limit in Admin → Settings.
        </p>
      )}
      {list.length > 0 && (
        <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm text-muted sm:grid-cols-2">
          {list.map((r) => (
            <li key={r.bucket} className="flex justify-between gap-3">
              <span>{BUCKET_NAMES[r.bucket] ?? r.bucket}</span>
              <span className="tabular-nums">{size(Number(r.bytes))} · {r.files} files</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type AiRow = { builder_id: string; builder_name: string; allowance: number; extra: number; used: number; photos: number; plans: number; guides: number; cost_usd: number; team_cost_usd: number };
const usd = (n: number) => (n < 0.01 && n > 0 ? "under $0.01" : `$${n.toFixed(2)}`);

// This month's AI credits per builder, what they really cost us, and the controls.
async function AiCredits() {
  const supabase = await createClient();
  const [{ data }, { data: def }, { data: own }] = await Promise.all([
    supabase.rpc("ai_usage_summary"),
    supabase.from("app_settings").select("value").eq("key", "ai_credits_default").maybeSingle(),
    supabase.from("ai_allowances").select("builder_id, monthly_credits"),
  ]);
  const rows = (data ?? []) as AiRow[];
  const custom = new Map((own ?? []).map((r) => [r.builder_id as string, r.monthly_credits as number]));
  const total = rows.reduce((s, r) => s + Number(r.cost_usd) + Number(r.team_cost_usd), 0);
  const keyMissing = !process.env.ANTHROPIC_API_KEY;

  return (
    <section className="rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">AI credits this month</h2>
        <span className="text-sm tabular-nums text-muted">Real AI cost so far: {usd(total)}</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Labeling a photo uses 1 credit (about $0.0003 to us); reading a floor plan or brand guide uses 25 (about $0.02–0.04).
        Credits reset on the 1st. Our team’s and photographers’ AI runs are free for builders and shown separately.
      </p>
      {keyMissing && <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">AI is off: add ANTHROPIC_API_KEY in Vercel to turn it on.</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="pb-2 font-medium">Builder</th><th className="pb-2 font-medium">Credits used</th><th className="pb-2 font-medium">Photos / plans</th><th className="pb-2 font-medium">Real cost (builder / our team)</th><th className="pb-2 font-medium">Monthly credits</th><th className="pb-2 font-medium">Add extra this month</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const cap = r.allowance + r.extra;
              return (
                <tr key={r.builder_id} className="align-top">
                  <td className="py-2.5 pr-3 font-medium">{r.builder_name.replace(" (demo)", "")}</td>
                  <td className={`py-2.5 pr-3 tabular-nums ${cap && r.used >= cap * 0.9 ? "font-semibold text-amber-900" : ""}`}>{num(r.used)} of {num(cap)}{r.extra ? <span className="block text-xs text-muted">incl. {num(r.extra)} extra</span> : null}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{num(r.photos)} / {num(r.plans)}{r.guides ? <span className="block text-xs text-muted">{r.guides} brand guide{r.guides === 1 ? "" : "s"}</span> : null}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{usd(Number(r.cost_usd))} / {usd(Number(r.team_cost_usd))}</td>
                  <td className="py-2.5 pr-3">
                    <form action={setAiAllowance} className="flex gap-1.5">
                      <input type="hidden" name="builder_id" value={r.builder_id} />
                      <input name="monthly_credits" inputMode="numeric" defaultValue={custom.get(r.builder_id) ?? ""} placeholder={`Default (${num(Number(def?.value ?? 0))})`} aria-label="Monthly credits" className="field-input w-36 py-1.5" />
                      <button className="rounded-lg border border-line px-2.5 text-xs font-semibold hover:border-foreground">Save</button>
                    </form>
                  </td>
                  <td className="py-2.5">
                    <form action={addAiCredits} className="flex gap-1.5">
                      <input type="hidden" name="builder_id" value={r.builder_id} />
                      <input name="credits" inputMode="numeric" placeholder="e.g. 500" aria-label="Extra credits" className="field-input w-24 py-1.5" />
                      <button className="rounded-lg border border-line px-2.5 text-xs font-semibold hover:border-foreground">Add</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form action={setAiDefault} className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="ai-default" className="text-muted">Every builder gets</label>
        <input id="ai-default" name="default_credits" inputMode="numeric" defaultValue={Number(def?.value ?? 0)} className="field-input w-28 py-1.5" />
        <span className="text-muted">credits a month unless set above.</span>
        <button className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:border-foreground">Save default</button>
      </form>
    </section>
  );
}
