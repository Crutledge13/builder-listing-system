import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { addBuilder, renameBuilder, setBuilderMarkets } from "../actions";

export default function BuildersAdmin(props: PageProps<"/admin/builders">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Builders />
    </Suspense>
  );
}

async function Builders() {
  const supabase = await createClient();
  const [{ data: builders }, { data: communities }, { data: homes }, { data: people }, { data: boards }, { data: settings }] = await Promise.all([
    supabase.from("builders").select("id, name, created_at").order("name"),
    supabase.from("communities").select("id, builder_id"),
    supabase.from("homes").select("builder_id").is("deleted_at", null),
    supabase.from("profiles").select("builder_id"),
    supabase.from("mls_boards").select("code, short_name, region").eq("active", true).order("code"),
    supabase.from("builder_settings").select("builder_id, mls_boards, mls_locked"),
  ]);
  const settingsFor = (id: string) => (settings ?? []).find((x) => x.builder_id === id);
  const tally = (rows: { builder_id: string | null }[] | null, id: string) => (rows ?? []).filter((r) => r.builder_id === id).length;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <div className="divide-y divide-line rounded-2xl border border-line">
        {(builders ?? []).map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-4 p-4">
            <form action={renameBuilder} className="flex min-w-0 flex-1 items-center gap-2">
              <input type="hidden" name="id" value={b.id} />
              <label className="sr-only" htmlFor={`b-${b.id}`}>Builder name</label>
              <input id={`b-${b.id}`} name="name" defaultValue={b.name} className="field-input min-w-0 flex-1 font-semibold" />
              <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">Rename</button>
            </form>
            <div className="flex gap-4 text-sm text-muted">
              <Link href={`/admin/communities#${b.id}`} className="hover:text-foreground"><b className="text-foreground">{tally(communities, b.id)}</b> communities</Link>
              <span><b className="text-foreground">{tally(homes, b.id)}</b> homes</span>
              <Link href={`/admin/people#${b.id}`} className="hover:text-foreground"><b className="text-foreground">{tally(people, b.id)}</b> people</Link>
            </div>
            <form action={setBuilderMarkets} className="w-full rounded-xl bg-soft p-3">
              <input type="hidden" name="builder_id" value={b.id} />
              <p className="text-sm font-medium">MLS markets this builder lists in</p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {(boards ?? []).map((m) => (
                  <label key={m.code} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="mls" value={m.code} defaultChecked={settingsFor(b.id)?.mls_boards?.includes(m.code)} className="h-4 w-4 accent-[#3452c7]" />
                    {m.short_name} <span className="text-muted">({m.region})</span>
                  </label>
                ))}
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" name="locked" defaultChecked={settingsFor(b.id)?.mls_locked ?? true} className="h-4 w-4 accent-[#3452c7]" />
                With one market, lock every home to it (owners, managers and our team can still override a home)
              </label>
              <button className="mt-2 rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black">Save markets</button>
            </form>
          </div>
        ))}
      </div>

      <form action={addBuilder} className="h-fit rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Add a builder</h2>
        <p className="mt-1 text-sm text-muted">Their data stays completely separate from every other builder.</p>
        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-medium">Company name</span>
          <input name="name" required placeholder="Lone Star Homes" className="field-input" />
        </label>
        <fieldset className="mt-3">
          <legend className="mb-1 text-sm font-medium">Where they build (MLS)</legend>
          <div className="space-y-1.5">
            {(boards ?? []).map((m) => (
              <label key={m.code} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="mls" value={m.code} defaultChecked={m.code === "NTREIS"} className="h-4 w-4 accent-[#3452c7]" /> {m.short_name}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">One market: every home goes to that MLS. Several: each community gets a suggestion from its county.</p>
        </fieldset>
        <button className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Add builder</button>
        <p className="mt-3 text-xs text-muted">Next: add their communities, then invite their people.</p>
      </form>
    </div>
  );
}
