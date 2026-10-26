import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { addCommunity, updateCommunity } from "../actions";

export default function CommunitiesAdmin(props: PageProps<"/admin/communities">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Communities />
    </Suspense>
  );
}

async function Communities() {
  const supabase = await createClient();
  const [{ data: builders }, { data: communities }, { data: homes }, { data: team }] = await Promise.all([
    supabase.from("builders").select("id, name").order("name"),
    supabase.from("communities").select("id, name, city, county, builder_id").order("name"),
    supabase.from("homes").select("community_id").is("deleted_at", null),
    supabase.from("community_assignments").select("community_id, profiles(full_name)"),
  ]);
  const homeCount = (id: string) => (homes ?? []).filter((h) => h.community_id === id).length;
  const salesFor = (id: string) =>
    (team ?? []).filter((t) => t.community_id === id).map((t) => (t.profiles as unknown as { full_name: string })?.full_name);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <div className="space-y-10">
        {(builders ?? []).map((b) => (
          <section key={b.id} id={b.id} className="scroll-mt-28">
            <h2 className="text-lg font-semibold">{b.name.replace(" (demo)", "")}</h2>
            <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
              {(communities ?? []).filter((c) => c.builder_id === b.id).map((c) => {
                const n = homeCount(c.id);
                return (
                  <form key={c.id} action={updateCommunity} className="grid gap-3 p-4 sm:grid-cols-[1.4fr_1fr_1fr_1.3fr_auto] sm:items-end">
                    <input type="hidden" name="id" value={c.id} />
                    <Field label="Name" name="name" value={c.name} />
                    <Field label="City" name="city" value={c.city} />
                    <Field label="County" name="county" value={c.county ?? ""} />
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-muted">Builder</span>
                      <select name="builder_id" defaultValue={c.builder_id} disabled={n > 0} className="field-input">
                        {(builders ?? []).map((o) => <option key={o.id} value={o.id}>{o.name.replace(" (demo)", "")}</option>)}
                      </select>
                      {n > 0 && <input type="hidden" name="builder_id" value={c.builder_id} />}
                    </label>
                    <button className="rounded-lg border border-line px-3 py-2.5 text-sm font-semibold hover:border-foreground">Save</button>
                    <p className="text-sm text-muted sm:col-span-5">
                      <Link href={`/communities/${c.id}`} className="underline">{n} homes</Link>
                      {n > 0 ? ". The builder can’t change once a community has homes." : ". Not used yet, so you can move it to another builder."}
                      {" "}Sales team: {salesFor(c.id).join(", ") || "nobody assigned"}.
                    </p>
                  </form>
                );
              })}
              {(communities ?? []).every((c) => c.builder_id !== b.id) && <p className="p-4 text-sm text-muted">No communities yet.</p>}
            </div>
          </section>
        ))}
      </div>

      <form action={addCommunity} className="h-fit rounded-2xl border border-line p-5 lg:sticky lg:top-28">
        <h2 className="font-semibold">Add a community</h2>
        <p className="mt-1 text-sm text-muted">Pick the builder it belongs to. Only that builder’s people will see it.</p>
        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-medium">Builder</span>
          <select name="builder_id" required defaultValue="" className="field-input">
            <option value="" disabled>Choose a builder</option>
            {(builders ?? []).map((b) => <option key={b.id} value={b.id}>{b.name.replace(" (demo)", "")}</option>)}
          </select>
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium">Community name</span>
          <input name="name" required placeholder="Cedar Hollow" className="field-input" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium">City</span>
          <input name="city" required placeholder="Prosper" className="field-input" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium">County</span>
          <input name="county" placeholder="Collin" className="field-input" />
        </label>
        <button className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Add community</button>
      </form>
    </div>
  );
}

function Field({ label, name, value }: { label: string; name: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input name={name} defaultValue={value} className="field-input" />
    </label>
  );
}
