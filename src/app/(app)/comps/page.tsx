import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { requireFeature } from "@/lib/features";
import { builderFocus } from "@/lib/builder-focus";
import { canRequestComps, isStaff } from "@/lib/permissions";
import { cx, dateTime, money, num } from "@/lib/format";
import { COMP_STATUS } from "@/lib/comps";


export default function CompsPage() {
  return (
    <Suspense fallback={<div className="mt-16 h-64 animate-pulse rounded-2xl bg-soft" />}>
      <Comps />
    </Suspense>
  );
}

async function Comps() {
  const me = await requireProfile();
  sendPhotographersToJobs(me);
  await requireFeature(me, "comps");
  const staff = isStaff(me.role);
  const supabase = await createClient();
  const focus = await builderFocus(me.role);
  let q = supabase
    .from("comp_requests")
    .select("id, location, city, zip_codes, price_point, living_area, bedrooms, bathrooms, status, requester_name, created_at, delivered_at, builders(name), communities(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (focus) q = q.eq("builder_id", focus);
  const { data } = await q;
  const rows = (data ?? []) as unknown as {
    id: string; location: string; city: string | null; zip_codes: string[] | null; price_point: number | null; living_area: number | null; bedrooms: number | null; bathrooms: number | null;
    status: string; requester_name: string | null; created_at: string; delivered_at: string | null; builders: { name: string } | null; communities: { name: string } | null;
  }[];
  const open = rows.filter((r) => r.status === "requested" || r.status === "in_progress");
  const done = rows.filter((r) => r.status === "delivered" || r.status === "cancelled");

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">Comps</h1>
          <p className="mt-1 text-muted">
            {staff ? "Comp requests from every builder. Pull them from the MLS, add them here, and send them back." : "Ask our team for comparable sales and listings. Everything they send is kept here."}
          </p>
        </div>
        {canRequestComps(me.role) && !staff && (
          <Link href="/comps/new" className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110">+ Request comps</Link>
        )}
      </div>

      {[{ title: "Open", list: open }, { title: "Done", list: done }].map((g) => (
        <section key={g.title} className="mt-8">
          <h2 className="text-[22px] font-semibold">{g.title} <span className="font-normal text-muted">{g.list.length}</span></h2>
          {g.list.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-line px-6 py-8 text-center text-muted">{g.title === "Open" ? "Nothing waiting." : "Nothing yet."}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
              {g.list.map((r) => (
                <li key={r.id}>
                  <Link href={`/comps/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-soft">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{r.location}{r.city ? `, ${r.city}` : ""}{r.zip_codes?.length ? ` · ${r.zip_codes.join(", ")}` : ""}</p>
                      <p className="text-sm text-muted">
                        {[r.price_point ? money(r.price_point) : null, r.living_area ? `${num(r.living_area)} sq ft` : null, r.bedrooms != null ? `${r.bedrooms} bd` : null, r.bathrooms != null ? `${r.bathrooms} ba` : null].filter(Boolean).join(" · ")}
                        {" · "}
                        {r.communities?.name ?? "Nearby area"}{staff && r.builders ? ` (${r.builders.name.replace(" (demo)", "")})` : ""} · asked by {r.requester_name ?? "someone"} {dateTime(r.created_at)}
                      </p>
                    </div>
                    <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", COMP_STATUS[r.status].style)}>{COMP_STATUS[r.status].label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
