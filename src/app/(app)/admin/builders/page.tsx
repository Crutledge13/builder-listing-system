import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { addBuilder, renameBuilder } from "../actions";

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
  const [{ data: builders }, { data: communities }, { data: homes }, { data: people }] = await Promise.all([
    supabase.from("builders").select("id, name, created_at").order("name"),
    supabase.from("communities").select("id, builder_id"),
    supabase.from("homes").select("builder_id").is("deleted_at", null),
    supabase.from("profiles").select("builder_id"),
  ]);
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
        <button className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Add builder</button>
        <p className="mt-3 text-xs text-muted">Next: add their communities, then invite their people.</p>
      </form>
    </div>
  );
}
