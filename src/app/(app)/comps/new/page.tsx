import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { requireFeature } from "@/lib/features";
import { canRequestComps, isStaff } from "@/lib/permissions";
import { BackButton } from "@/components/back-button";
import { RequiredPill } from "@/components/required-pill";
import { requestComps } from "../actions";

export default function NewCompsPage(props: PageProps<"/comps/new">) {
  return (
    <div className="mx-auto max-w-3xl">
      <BackButton href="/comps" label="All comp requests" />
      <h1 className="mt-4 text-[28px] font-bold leading-tight tracking-tight">Request comps</h1>
      <p className="mt-1 text-muted">Tell us about the home or area. Our team pulls comparable sales and listings from the MLS and sends them back to you here.</p>
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-soft" />}>
        <Form searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<"/comps/new">["searchParams"] }) {
  const sp = await searchParams;
  const me = await requireProfile();
  await requireFeature(me, "comps");
  if (!canRequestComps(me.role)) return <p className="mt-8 text-muted">Your role can’t ask for comps.</p>;
  const supabase = await createClient();
  const homeId = typeof sp.home === "string" ? sp.home : null;
  const [{ data: communities }, { data: home }] = await Promise.all([
    supabase.from("communities").select("id, name, city, builders(name)").order("name"),
    homeId
      ? supabase.from("homes").select("id, unparsed_address, city, community_id, list_price, living_area, bedrooms_total, bathrooms_full, bathrooms_half, stories, year_built").eq("id", homeId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const community = home?.community_id ?? (typeof sp.community === "string" ? sp.community : "");
  const baths = home ? (home.bathrooms_full ?? 0) + (home.bathrooms_half ?? 0) * 0.5 : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  const staff = isStaff(me.role);

  return (
    <form action={requestComps} className="mt-6 space-y-8">
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {home && <input type="hidden" name="home_id" value={home.id} />}
      {home && <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm">For <b>{home.unparsed_address}</b>. We filled in what we know; change anything you like.</p>}

      <section>
        <h2 className="text-lg font-semibold">Where?</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Community</span>
            <select name="community_id" defaultValue={community} className="field-input">
              {!staff && <option value="">Not one of our communities (nearby area)</option>}
              {staff && <option value="" disabled>Choose a community</option>}
              {(communities ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}, {c.city}{staff ? ` (${(c.builders as unknown as { name: string })?.name.replace(" (demo)", "")})` : ""}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center text-sm font-medium">Address or area<RequiredPill kind="save" /></span>
            <input name="location" required maxLength={300} defaultValue={home?.unparsed_address ?? ""} placeholder="e.g. 1300 Pecan Ridge Dr, or “north Celina”" className="field-input" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">City</span>
            <input name="city" maxLength={80} defaultValue={home?.city ?? ""} placeholder="Leave blank to use the community’s" className="field-input" />
          </label>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">The home</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Num name="price_point" label="Price point ($)" value={home?.list_price} placeholder="e.g. 389990" />
          <Num name="living_area" label="Square feet" value={home?.living_area} placeholder="e.g. 2400" />
          <Num name="bedrooms" label="Beds" value={home?.bedrooms_total} />
          <Num name="bathrooms" label="Baths" value={baths} step="0.5" />
          <Num name="stories" label="Stories" value={home?.stories} />
          <Num name="year_built" label="Year built" value={home?.year_built} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">What to pull</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Comps from</span>
            <select name="comp_type" defaultValue="both" className="field-input">
              <option value="both">New and resale homes</option>
              <option value="new">New construction only</option>
              <option value="resale">Resale only</option>
            </select>
          </label>
          <Num name="radius_miles" label="Within (miles)" value={1} step="0.1" />
          <Num name="months_back" label="Sold in the last (months)" value={6} />
          <label className="block sm:col-span-3">
            <span className="mb-1.5 block text-sm font-medium">Anything else? (optional)</span>
            <textarea name="notes" rows={3} maxLength={2000} placeholder="e.g. Buyer is comparing us to the Lennar community across the road" className="field-input leading-relaxed" />
          </label>
        </div>
      </section>

      <button className="rounded-xl bg-accent px-6 py-3 font-semibold text-white hover:brightness-110">Send to our team</button>
    </form>
  );
}

function Num({ name, label, value, placeholder, step = "1" }: { name: string; label: string; value?: number | null; placeholder?: string; step?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input name={name} type="number" min="0" step={step} defaultValue={value ?? ""} placeholder={placeholder} className="field-input" />
    </label>
  );
}
