import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { Notice } from "@/components/notice";
import { setFirstPassword } from "./actions";

export default function WelcomePage(props: PageProps<"/welcome">) {
  return (
    <div className="mx-auto max-w-md py-8">
      <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl bg-soft" />}>
        <Notice searchParams={props.searchParams} />
        <Welcome />
      </Suspense>
    </div>
  );
}

// Where invite links land: the person picks their password, then starts.
async function Welcome() {
  const me = await requireProfile();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.user_metadata?.needs_password) redirect("/communities");
  const company = me.builder_name?.replace(" (demo)", "");

  return (
    <div>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Welcome{me.full_name ? `, ${me.full_name.split(" ")[0]}` : ""}</h1>
      <p className="mt-1 text-muted">
        {company ? `You’ve been added to ${company} on Builder Listings. ` : ""}Choose a password so you can sign in again any time.
      </p>
      <form action={setFirstPassword} className="mt-6 space-y-4 rounded-2xl border border-line p-5">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Your name</span>
          <input name="full_name" defaultValue={me.full_name} autoComplete="name" className="field-input" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Email</span>
          <input value={me.email} readOnly className="field-input bg-soft" />
          <span className="mt-1 block text-xs text-muted">This is what you sign in with.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Password</span>
          <input name="password" type="password" required minLength={10} autoComplete="new-password" className="field-input" />
          <span className="mt-1 block text-xs text-muted">At least 10 characters.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Type it again</span>
          <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className="field-input" />
        </label>
        <button className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white hover:brightness-110">Save password and get started</button>
      </form>
    </div>
  );
}
