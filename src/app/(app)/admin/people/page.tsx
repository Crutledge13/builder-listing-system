import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { invitePerson, setAssignments, updatePerson } from "../actions";
import { AccessHistory } from "@/components/access-history";

export default function PeopleAdmin(props: PageProps<"/admin/people">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <People />
      <AccessHistory limit={60} />
    </Suspense>
  );
}

const ROLES = Object.keys(ROLE_LABELS) as Role[];

async function People() {
  const supabase = await createClient();
  const [{ data: builders }, { data: people }, { data: communities }, { data: assignments }] = await Promise.all([
    supabase.from("builders").select("id, name").order("name"),
    supabase.from("profiles").select("id, email, full_name, role, builder_id").order("full_name"),
    supabase.from("communities").select("id, name, builder_id").order("name"),
    supabase.from("community_assignments").select("profile_id, community_id"),
  ]);
  const canInvite = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const groups = [
    { id: "staff", name: "Our team and photographers", list: (people ?? []).filter((p) => !p.builder_id) },
    ...(builders ?? []).map((b) => ({ id: b.id, name: b.name.replace(" (demo)", ""), list: (people ?? []).filter((p) => p.builder_id === b.id) })),
  ];

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <div className="space-y-10">
        {groups.map((g) => (
          <section key={g.id} id={g.id} className="scroll-mt-28">
            <h2 className="text-lg font-semibold">{g.name}</h2>
            <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
              {g.list.map((p) => {
                const theirCommunities = (communities ?? []).filter((c) => c.builder_id === p.builder_id);
                const mine = new Set((assignments ?? []).filter((a) => a.profile_id === p.id).map((a) => a.community_id));
                return (
                  <div key={p.id} className="p-4">
                    <form action={updatePerson} className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end">
                      <input type="hidden" name="id" value={p.id} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{p.full_name}</div>
                        <div className="truncate text-sm text-muted">{p.email}</div>
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-muted">Role</span>
                        <select name="role" defaultValue={p.role} className="field-input">
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-muted">Builder</span>
                        <select name="builder_id" defaultValue={p.builder_id ?? ""} className="field-input">
                          <option value="">None (our team)</option>
                          {(builders ?? []).map((b) => <option key={b.id} value={b.id}>{b.name.replace(" (demo)", "")}</option>)}
                        </select>
                      </label>
                      <button className="rounded-lg border border-line px-3 py-2.5 text-sm font-semibold hover:border-foreground">Save</button>
                    </form>

                    {p.role === "sales" && (
                      <form action={setAssignments} className="mt-3 rounded-xl bg-soft p-3">
                        <input type="hidden" name="profile_id" value={p.id} />
                        <input type="hidden" name="back" value="/admin/people" />
                        <p className="text-sm font-medium">Communities this salesperson can see</p>
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                          {theirCommunities.map((c) => (
                            <label key={c.id} className="flex items-center gap-2 text-sm">
                              <input type="hidden" name="scope" value={c.id} />
                              <input type="checkbox" name="community_id" value={c.id} defaultChecked={mine.has(c.id)} className="h-4 w-4 accent-[#3452c7]" />
                              {c.name}
                            </label>
                          ))}
                          {theirCommunities.length === 0 && <span className="text-sm text-muted">This builder has no communities yet.</span>}
                        </div>
                        {theirCommunities.length > 0 && (
                          <button className="mt-3 rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black">Save communities</button>
                        )}
                      </form>
                    )}
                  </div>
                );
              })}
              {g.list.length === 0 && <p className="p-4 text-sm text-muted">Nobody yet.</p>}
            </div>
          </section>
        ))}
      </div>

      <form action={invitePerson} className="h-fit rounded-2xl border border-line p-5 lg:sticky lg:top-28">
        <h2 className="font-semibold">Invite a person</h2>
        <p className="mt-1 text-sm text-muted">They get an email to set their own password.</p>
        {!canInvite && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Turned off until the Supabase admin key is added in Vercel as SUPABASE_SERVICE_ROLE_KEY. That key creates logins, so it stays on the server and never goes in the code.
          </p>
        )}
        <fieldset disabled={!canInvite} className="disabled:opacity-60">
          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-medium">Full name</span>
            <input name="full_name" required className="field-input" />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-medium">Email</span>
            <input name="email" type="email" required autoCapitalize="none" className="field-input" />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-medium">Role</span>
            <select name="role" defaultValue="marketing" className="field-input">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-medium">Builder</span>
            <select name="builder_id" defaultValue="" className="field-input">
              <option value="">None (our team)</option>
              {(builders ?? []).map((b) => <option key={b.id} value={b.id}>{b.name.replace(" (demo)", "")}</option>)}
            </select>
          </label>
          <button className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Send invite</button>
        </fieldset>
      </form>
    </div>
  );
}
