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
  const [builders, communities, homes, people, media, openRequests, readyForMls, inReview] = await Promise.all([
    count("builders"),
    count("communities"),
    count("homes", (q) => q.is("deleted_at", null)),
    count("profiles"),
    count("media", (q) => q.is("deleted_at", null)),
    count("change_requests", (q) => q.eq("status", "open")),
    count("homes", (q) => q.eq("workflow_status", "approved_for_mls").is("deleted_at", null)),
    count("homes", (q) => q.eq("workflow_status", "in_review").is("deleted_at", null)),
  ]);

  const tiles = [
    { n: readyForMls, label: "ready to enter into the MLS", href: "/approvals", urgent: readyForMls > 0 },
    { n: openRequests, label: "open change requests", href: "/admin/requests", urgent: openRequests > 0 },
    { n: inReview, label: "waiting on builder approval", href: "/approvals" },
    { n: builders, label: "builders", href: "/admin/builders" },
    { n: communities, label: "communities", href: "/admin/communities" },
    { n: homes, label: "homes", href: "/homes" },
    { n: people, label: "people with logins", href: "/admin/people" },
    { n: media, label: "photos, videos and floor plans", href: "/media" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {tiles.map((t) => (
        <Link key={t.label} href={t.href} className={`rounded-2xl border p-5 transition-shadow hover:shadow-md ${t.urgent ? "border-accent bg-accent-soft" : "border-line"}`}>
          <div className="text-3xl font-bold tabular-nums">{t.n}</div>
          <div className="mt-1 text-sm text-muted">{t.label}</div>
        </Link>
      ))}
    </div>
  );
}
