import { Suspense } from "react";
import { SetupNav } from "@/components/setup-nav";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { canAddCommunities } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { createCommunity } from "./actions";

export default function NewCommunityPage(props: PageProps<"/communities/new">) {
  return (
    <Suspense fallback={<div className="mt-16 h-64 animate-pulse rounded-2xl bg-soft" />}>
      <div className="mx-auto max-w-xl">
        <Link href="/communities" className="text-sm text-muted hover:text-foreground">← Communities</Link>
        <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight">Add a community</h1>
        <p className="mt-1 text-muted">A community holds homes, its own photos and its sales team.</p>
        <div className="mt-6"><Notice searchParams={props.searchParams} /></div>
        <NewCommunityForm />
        <SetupNav steps={["communities"]} path="/communities/new" />
      </div>
    </Suspense>
  );
}

async function NewCommunityForm() {
  const me = await requireProfile();
  sendPhotographersToJobs(me);
  if (!canAddCommunities(me.role)) redirect("/communities");
  const supabase = await createClient();
  const { data: builders } = me.role === "platform_admin"
    ? await supabase.from("builders").select("id, name").order("name")
    : { data: null };

  return (
    <form action={createCommunity} className="space-y-4 rounded-2xl border border-line p-5">
      {builders && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Builder</span>
          <select name="builder_id" required defaultValue="" className="field-input">
            <option value="" disabled>Pick a builder</option>
            {builders.map((b) => <option key={b.id} value={b.id}>{b.name.replace(" (demo)", "")}</option>)}
          </select>
        </label>
      )}
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Community name</span>
        <input name="name" required placeholder="Cedar Hollow" className="field-input" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">City</span>
          <input name="city" required placeholder="Georgetown" className="field-input" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">County</span>
          <input name="county" placeholder="Williamson" className="field-input" />
        </label>
      </div>
      <button className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white hover:brightness-110">Add community</button>
    </form>
  );
}
