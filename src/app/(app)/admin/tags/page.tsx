import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { cx, dateTime } from "@/lib/format";
import { loadTagList, TAG_CATEGORIES, type ListTag } from "@/lib/tags";
import { addTag, approveTagRequest, mergeTag, rejectTagRequest, saveTag } from "./actions";

export default function TagsAdmin(props: PageProps<"/admin/tags">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Tags />
    </Suspense>
  );
}

type Request = {
  id: string;
  label: string;
  note: string | null;
  media_id: string | null;
  created_at: string;
  profiles: { full_name: string | null } | null;
  builders: { name: string } | null;
  media: { title: string } | null;
};

async function Tags() {
  const supabase = await createClient();
  const [list, { data: reqRows }, { data: mediaRows }] = await Promise.all([
    loadTagList(supabase, { includeRetired: true }),
    supabase
      .from("media_tag_requests")
      .select("id, label, note, media_id, created_at, profiles!media_tag_requests_requested_by_fkey(full_name), builders(name), media(title)")
      .eq("status", "pending")
      .order("created_at"),
    supabase.from("media").select("tags").is("deleted_at", null),
  ]);
  const requests = (reqRows ?? []) as unknown as Request[];
  const uses = new Map<string, number>();
  for (const m of mediaRows ?? []) for (const t of (m.tags as string[]) ?? []) uses.set(t.toLowerCase(), (uses.get(t.toLowerCase()) ?? 0) + 1);
  const count = (t: ListTag) => uses.get(t.label.toLowerCase()) ?? 0;
  const active = list.filter((t) => t.active);

  return (
    <div className="space-y-10">
      <p className="max-w-3xl text-muted">
        Everyone tags photos from this one list, and the AI only suggests tags from it, so a search for “Pool” finds every pool photo.
        The address, plan, community and room are tagged automatically and aren’t listed here. “Other names” are words people might type
        (or the AI might use) that should land on the tag.
      </p>

      <section id="requests" className="scroll-mt-28">
        <h2 className="text-lg font-semibold">Requests for new tags {requests.length > 0 && <span className="ml-1 rounded-full bg-accent px-2 py-0.5 text-sm text-white">{requests.length}</span>}</h2>
        {requests.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No requests waiting.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {requests.map((r) => (
              <div key={r.id} className="rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">“{r.label}”</p>
                  <p className="text-xs text-muted">
                    {r.profiles?.full_name ?? "Someone"}{r.builders ? `, ${r.builders.name.replace(" (demo)", "")}` : ""} · {dateTime(r.created_at)}
                    {r.media_id && <> · <Link href={`/media/${r.media_id}`} className="underline">{r.media?.title ?? "photo"}</Link></>}
                  </p>
                </div>
                {r.note && <p className="mt-1 text-sm">{r.note}</p>}
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  <form action={approveTagRequest} className="space-y-2 rounded-xl bg-soft p-3">
                    <input type="hidden" name="id" value={r.id} />
                    <p className="text-sm font-semibold">Add as a new tag</p>
                    <input name="label" defaultValue={r.label} maxLength={40} className="field-input py-1.5" aria-label="Tag name" />
                    <CategorySelect />
                    <button className="w-full rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white">Add to the list</button>
                  </form>
                  <form action={approveTagRequest} className="space-y-2 rounded-xl bg-soft p-3">
                    <input type="hidden" name="id" value={r.id} />
                    <p className="text-sm font-semibold">Use an existing tag</p>
                    <select name="use_tag" required className="field-input py-1.5" defaultValue="">
                      <option value="" disabled>Pick a tag</option>
                      {active.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <p className="text-xs text-muted">Their wording becomes another name for it.</p>
                    <button className="w-full rounded-lg border border-foreground px-3 py-2 text-sm font-semibold">Point them to it</button>
                  </form>
                  <form action={rejectTagRequest} className="space-y-2 rounded-xl bg-soft p-3">
                    <input type="hidden" name="id" value={r.id} />
                    <p className="text-sm font-semibold">Decline</p>
                    <input name="answer" maxLength={500} placeholder="Short reason (they’ll see it)" className="field-input py-1.5" />
                    <button className="w-full rounded-lg px-3 py-2 text-sm font-semibold text-red-700 underline">Decline</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Add a tag</h2>
        <form action={addTag} className="mt-3 grid gap-3 rounded-2xl border border-line p-4 sm:grid-cols-[1fr_180px_1fr_auto] sm:items-end">
          <label className="block"><span className="mb-1 block text-sm font-medium">Name</span><input name="label" required maxLength={40} placeholder="e.g. Wine room" className="field-input" /></label>
          <label className="block"><span className="mb-1 block text-sm font-medium">Group</span><CategorySelect /></label>
          <label className="block"><span className="mb-1 block text-sm font-medium">Other names (optional)</span><input name="aliases" placeholder="wine cellar, wine fridge" className="field-input" /></label>
          <button className="rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white">Add</button>
        </form>
      </section>

      {TAG_CATEGORIES.map((c) => {
        const tags = list.filter((t) => t.category === c.key);
        if (!tags.length) return null;
        return (
          <section key={c.key}>
            <h2 className="text-lg font-semibold">{c.label}</h2>
            <div className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {tags.map((t) => (
                <details key={t.id} className={cx("group", !t.active && "bg-soft/60")}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-soft">
                    <span>
                      <span className={cx("font-medium", !t.active && "text-muted line-through")}>{t.label}</span>
                      {!t.active && <span className="ml-2 rounded bg-line px-1.5 py-px text-[11px] font-semibold">Retired</span>}
                      {t.aliases.length > 0 && <span className="ml-2 text-xs text-muted">also: {t.aliases.join(", ")}</span>}
                    </span>
                    <span className="text-sm text-muted">
                      <Link href={`/media?tag=${encodeURIComponent(t.label)}`} className="hover:underline">{count(t)} {count(t) === 1 ? "photo" : "photos"}</Link>
                      <span className="ml-3 text-accent group-open:hidden">Edit</span>
                    </span>
                  </summary>
                  <div className="grid gap-4 border-t border-line bg-white px-4 py-4 lg:grid-cols-[1fr_280px]">
                    <form action={saveTag} className="grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="id" value={t.id} />
                      <label className="block"><span className="mb-1 block text-sm font-medium">Name</span><input name="label" defaultValue={t.label} required maxLength={40} className="field-input py-1.5" /></label>
                      <label className="block"><span className="mb-1 block text-sm font-medium">Group</span><CategorySelect value={t.category} /></label>
                      <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium">Other names, separated by commas</span><input name="aliases" defaultValue={t.aliases.join(", ")} className="field-input py-1.5" /></label>
                      <label className="flex items-center gap-2 text-sm sm:col-span-2">
                        <input type="checkbox" name="active" defaultChecked={t.active} className="h-4 w-4 accent-[#3452c7]" />
                        On the list (untick to retire: it can’t be picked any more but stays on photos that have it)
                      </label>
                      <div className="sm:col-span-2">
                        <button className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white">Save</button>
                        <span className="ml-3 text-xs text-muted">Renaming updates every photo with this tag.</span>
                      </div>
                    </form>
                    <form action={mergeTag} className="space-y-2 rounded-xl bg-soft p-3">
                      <input type="hidden" name="id" value={t.id} />
                      <p className="text-sm font-semibold">Merge into another tag</p>
                      <select name="into" required defaultValue="" className="field-input py-1.5">
                        <option value="" disabled>Pick a tag</option>
                        {list.filter((o) => o.id !== t.id).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                      <p className="text-xs text-muted">Its {count(t)} {count(t) === 1 ? "photo moves" : "photos move"} over and “{t.label}” becomes another name for that tag.</p>
                      <button className="w-full rounded-lg border border-foreground px-3 py-2 text-sm font-semibold">Merge</button>
                    </form>
                  </div>
                </details>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CategorySelect({ value = "feature" }: { value?: string }) {
  return (
    <select name="category" defaultValue={value} className="field-input py-1.5">
      {TAG_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
    </select>
  );
}
