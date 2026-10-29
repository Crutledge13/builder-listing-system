import { Suspense } from "react";
import { CommunitiesFold } from "@/components/communities-fold";
import { SalesMlsSwitches } from "@/components/sales-mls-switches";
import { CommunityPicker } from "@/components/community-picker";
import { isPlatformAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { createJoinLink, invitePerson, setAssignments, setJoinLinkOn, setStaffBuilders, updatePerson } from "../actions";
import { JoinLinkForm } from "@/components/join-link-form";
import { CopyButton } from "@/components/mls-client";
import { headers } from "next/headers";
import { dateTime } from "@/lib/format";
import { AccessHistory } from "@/components/access-history";
import { invitesOn, pendingInvites } from "@/lib/invite-links";
import { InviteLink } from "@/components/invite-link";
import { PendingButton } from "@/components/pending-button";

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
  if (!(await isPlatformAdmin())) return null;
  const supabase = await createClient();
  const [{ data: builders }, { data: people }, { data: communities }, { data: assignments }, { data: staffBuilders }] = await Promise.all([
    supabase.from("builders").select("id, name").order("name"),
    supabase.from("profiles").select("id, email, full_name, role, builder_id, sales_mls_entry, sales_needs_approval").order("full_name"),
    supabase.from("communities").select("id, name, city, builder_id").order("name"),
    supabase.from("community_assignments").select("profile_id, community_id"),
    supabase.from("staff_builders").select("profile_id, builder_id"),
  ]);
  const canInvite = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pending = await pendingInvites((people ?? []).map((p) => p.id));
  const canJoin = invitesOn();
  const { data: joinLinks } = await supabase
    .from("join_links")
    .select("id, token, role, builder_id, label, expires_at, max_uses, use_count, revoked_at, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const builderName = new Map((builders ?? []).map((b) => [b.id, b.name.replace(" (demo)", "")]));
  const nowMs = new Date(h.get("date") ?? 0).getTime() || new Date().getTime();
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
                    {pending.has(p.id) && <div className="mb-3"><InviteLink profileId={p.id} name={p.full_name} /></div>}
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

                    {p.role === "listing_coordinator" && (() => {
                      const theirs = new Set((staffBuilders ?? []).filter((a) => a.profile_id === p.id).map((a) => a.builder_id));
                      return (
                        <form action={setStaffBuilders} className="mt-3 rounded-xl bg-soft p-3">
                          <input type="hidden" name="profile_id" value={p.id} />
                          <p className="text-sm font-medium">Builders they work on</p>
                          <p className="text-xs text-muted">
                            {theirs.size ? `Sees only these ${theirs.size === 1 ? "builder" : "builders"}: homes, tasks, media, MLS work and people.` : "None ticked: sees every builder. Tick builders to limit what they see."}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                            {(builders ?? []).map((b) => (
                              <label key={b.id} className="flex items-center gap-2 text-sm">
                                <input type="checkbox" name="builder_id" value={b.id} defaultChecked={theirs.has(b.id)} className="h-4 w-4 accent-[#3452c7]" />
                                {b.name.replace(" (demo)", "")}
                              </label>
                            ))}
                          </div>
                          <PendingButton pending="Saving…" className="mt-3 rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black">Save builders</PendingButton>
                        </form>
                      );
                    })()}

                    {p.role === "sales" && (
                      <CommunitiesFold names={theirCommunities.filter((c) => mine.has(c.id)).map((c) => c.name)} total={theirCommunities.length}>
                      <form action={setAssignments}>
                        <input type="hidden" name="profile_id" value={p.id} />
                        <input type="hidden" name="back" value="/admin/people" />
                        <CommunityPicker communities={theirCommunities} defaultSelected={[...mine]} scope />
                        {theirCommunities.length > 0 && (
                          <button className="mt-3 rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black">Save communities</button>
                        )}
                      </form>
                      </CommunitiesFold>
                    )}
                    {p.role === "sales" && (
                      <SalesMlsSwitches profileId={p.id} name={p.full_name} mlsEntry={!!p.sales_mls_entry} needsApproval={p.sales_needs_approval !== false} back="/admin/people" />
                    )}
                  </div>
                );
              })}
              {g.list.length === 0 && <p className="p-4 text-sm text-muted">Nobody yet.</p>}
            </div>
          </section>
        ))}
      </div>

      <div className="h-fit space-y-6">
      <form action={invitePerson} className="rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Invite a person</h2>
        <p className="mt-1 text-sm text-muted">You get an invite link to send them. It opens a page where they choose their password.</p>
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
          <button className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">Add and get invite link</button>
        </fieldset>
      </form>

      {/* Join links: send a link, they set up their own login. No email needed. */}
      <section id="join" className="scroll-mt-28 rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Join links</h2>
        <p className="mt-1 text-sm text-muted">
          One link for a role that you can send to several people (text, email, Slack). Each person who opens it fills in their own name and email,
          sets a password and is in right away. Use Invite a person above when you already know who it&rsquo;s for.
        </p>
        {!canJoin && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Turned off until the Supabase admin key is added in Vercel as SUPABASE_SERVICE_ROLE_KEY. That key creates logins, so it stays on the server and never goes in the code.
          </p>
        )}
        <div className="mt-4">
          <JoinLinkForm
            action={createJoinLink}
            disabled={!canJoin}
            roles={ROLES.filter((r) => r !== "platform_admin").map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            builders={(builders ?? []).map((b) => ({ id: b.id, name: b.name.replace(" (demo)", "") }))}
            communities={(communities ?? []).map((c) => ({ id: c.id, name: c.name, builder_id: c.builder_id }))}
          />
        </div>

        {(joinLinks ?? []).length > 0 && (
          <ul className="mt-5 divide-y divide-line border-t border-line">
            {(joinLinks ?? []).map((l) => {
              const off = !!l.revoked_at;
              const expired = !off && new Date(l.expires_at).getTime() <= nowMs;
              const full = !off && !expired && l.max_uses !== null && l.use_count >= l.max_uses;
              const live = !off && !expired && !full;
              const url = `${origin}/join/${l.token}`;
              return (
                <li key={l.id} className="py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{l.label ?? ROLE_LABELS[l.role as Role]}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? "bg-emerald-100 text-emerald-800" : "bg-line text-muted"}`}>
                      {live ? "On" : off ? "Off" : expired ? "Expired" : "Used up"}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {ROLE_LABELS[l.role as Role]}{l.builder_id ? `, ${builderName.get(l.builder_id) ?? "a builder"}` : ", our team"} · {l.use_count}
                    {l.max_uses ? ` of ${l.max_uses}` : ""} joined · {expired ? "ended" : "until"} {dateTime(l.expires_at)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3">
                    {live && <CopyButton value={url} label="Copy link" />}
                    {(live || off) && !expired && (
                      <form action={setJoinLinkOn}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="on" value={off ? "1" : "0"} />
                        <PendingButton pending={off ? "Turning on…" : "Turning off…"} className={`text-xs font-semibold underline ${off ? "" : "text-red-700"}`}>
                          {off ? "Turn back on" : "Turn off"}
                        </PendingButton>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      </div>
    </div>
  );
}
