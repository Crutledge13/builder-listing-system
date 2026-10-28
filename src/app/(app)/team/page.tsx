import { Suspense } from "react";
import { SetupNav } from "@/components/setup-nav";
import { Avatar } from "@/components/avatar";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { ROLE_LABELS, canManageTeam, rolesICanGive, type Role } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { setAssignments } from "@/app/(app)/admin/actions";
import { AccessHistory } from "@/components/access-history";
import { inviteTeammate, setTeammateActive, updateTeammate } from "./actions";
import { pendingInvites } from "@/lib/invite-links";
import { InviteLink } from "@/components/invite-link";

export default function TeamPage(props: PageProps<"/team">) {
  return (
    <Suspense fallback={<div className="mt-16 h-64 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Team />
      <SetupNav steps={["team", "sales"]} path="/team" />
    </Suspense>
  );
}

const ROLE_HINTS: Partial<Record<Role, string>> = {
  builder_owner: "Everything for your company, including adding people.",
  manager: "Can do everything marketing can; usually follows along and reads the reports.",
  sales: "Only their communities: price, status, open houses, requests.",
  marketing: "Runs listings day to day: homes, prices, photos, approvals, communities and the team.",
};

async function Team() {
  const me = await requireProfile();
  if (me.role === "platform_admin") redirect("/admin/people");
  if (!canManageTeam(me.role)) redirect("/communities");
  const supabase = await createClient();
  const [{ data: people }, { data: communities }, { data: assignments }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, is_active, phone, job_title, avatar_updated_at").eq("builder_id", me.builder_id!).order("full_name"),
    supabase.from("communities").select("id, name").eq("builder_id", me.builder_id!).order("name"),
    supabase.from("community_assignments").select("profile_id, community_id"),
  ]);
  const canGive = rolesICanGive(me.role);
  const canInvite = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const active = (people ?? []).filter((p) => p.is_active);
  // People who haven't opened their invite and chosen a password yet.
  const pending = await pendingInvites(active.map((p) => p.id));
  const inactive = (people ?? []).filter((p) => !p.is_active);

  return (
    <div>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Your team</h1>
      <p className="mt-1 text-muted">
        Everyone at {me.builder_name?.replace(" (demo)", "")} who can sign in.{" "}
        {me.role === "builder_owner" ? "As the owner you can add anyone at your company." : "You can add and change sales and marketing users."}
      </p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="divide-y divide-line rounded-2xl border border-line">
            {active.map((p) => {
              const role = p.role as Role;
              const editable = p.id !== me.id && canGive.includes(role);
              const mine = new Set((assignments ?? []).filter((a) => a.profile_id === p.id).map((a) => a.community_id));
              return (
                <div key={p.id} className="p-4">
                  {pending.has(p.id) && editable && <div className="mb-3"><InviteLink profileId={p.id} name={p.full_name} /></div>}
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar id={p.id} name={p.full_name} version={p.avatar_updated_at} className="h-10 w-10 text-sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">
                        {p.full_name} {p.id === me.id && <span className="font-normal text-muted">(you, <Link href="/account" className="underline">edit your profile</Link>)</span>}
                      </div>
                      <div className="truncate text-sm text-muted">{[p.job_title, p.email, p.phone].filter(Boolean).join(" · ")}</div>
                    </div>
                    {editable ? (
                      <form action={updateTeammate} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <select name="role" defaultValue={role} className="field-input w-40 py-2" aria-label={`Role for ${p.full_name}`}>
                          {canGive.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">Save</button>
                      </form>
                    ) : (
                      <span className="rounded-full bg-soft px-3 py-1 text-sm">{ROLE_LABELS[role]}</span>
                    )}
                    {editable && (
                      <form action={setTeammateActive}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value="false" />
                        <button className="rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50">Turn off access</button>
                      </form>
                    )}
                  </div>

                  {role === "sales" && (
                    <form action={setAssignments} className="mt-3 rounded-xl bg-soft p-3">
                      <input type="hidden" name="profile_id" value={p.id} />
                      <input type="hidden" name="back" value="/team" />
                      <p className="text-sm font-medium">Communities they can see</p>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                        {(communities ?? []).map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-sm">
                            <input type="hidden" name="scope" value={c.id} />
                            <input type="checkbox" name="community_id" value={c.id} defaultChecked={mine.has(c.id)} className="h-4 w-4 accent-[#3452c7]" />
                            {c.name}
                          </label>
                        ))}
                      </div>
                      <button className="mt-3 rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black">Save communities</button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>

          {inactive.length > 0 && (
            <section className="mt-8">
              <h2 className="font-semibold">Access turned off</h2>
              <p className="text-sm text-muted">Their history stays, but they can’t sign in.</p>
              <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
                {inactive.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-muted">{p.full_name}</div>
                      <div className="truncate text-sm text-muted">{ROLE_LABELS[p.role as Role]}, {p.email}</div>
                    </div>
                    {canGive.includes(p.role as Role) && (
                      <form action={setTeammateActive}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value="true" />
                        <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">Turn back on</button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <form action={inviteTeammate} className="h-fit rounded-2xl border border-line p-5 lg:sticky lg:top-28">
          <h2 className="text-lg font-semibold">Add a person</h2>
          <p className="mt-1 text-sm text-muted">You’ll get an invite link to send them (text or email). It opens a page where they choose their password.</p>
          {!canInvite && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Adding people switches on once our team finishes one setup step. You can still change roles and access below.
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
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-medium">What can they do?</legend>
              <div className="space-y-2">
                {canGive.map((r, i) => (
                  <label key={r} className="flex gap-3 rounded-xl border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                    <input type="radio" name="role" value={r} defaultChecked={r === "sales" || (i === 0 && !canGive.includes("sales"))} className="mt-1 h-4 w-4 accent-[#3452c7]" />
                    <span>
                      <span className="block text-sm font-semibold">{ROLE_LABELS[r]}</span>
                      <span className="block text-xs text-muted">{ROLE_HINTS[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {(communities ?? []).length > 0 && (
              <fieldset className="mt-4">
                <legend className="mb-2 text-sm font-medium">Communities (for sales)</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {(communities ?? []).map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="community_id" value={c.id} className="h-4 w-4 accent-[#3452c7]" />
                      {c.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <button className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Add and get invite link</button>
          </fieldset>
        </form>
      </div>
      <AccessHistory />
    </div>
  );
}
