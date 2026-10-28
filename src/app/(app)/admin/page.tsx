import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default function AdminOverview() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
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
