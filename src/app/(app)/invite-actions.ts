"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { rolesICanGive, type Role } from "@/lib/permissions";
import { freshInviteLink, invitesOn } from "@/lib/invite-links";

export type InviteLinkState = { link?: string; error?: string; at?: number };

// A copyable invite link for someone who hasn't set a password yet. Our
// platform admins can make one for anyone; a builder's owner, managers and
// marketing only for the people they're allowed to manage at their company.
export async function getInviteLink(_prev: InviteLinkState, formData: FormData): Promise<InviteLinkState> {
  const me = await requireProfile();
  if (!invitesOn()) return { error: "Invite links switch on once SUPABASE_SERVICE_ROLE_KEY is set in Vercel." };
  const id = String(formData.get("profile_id") ?? "");
  const supabase = await createClient();
  const [{ data: target }, { data: brokerOk }] = await Promise.all([
    supabase.from("profiles").select("id, role, builder_id, is_active").eq("id", id).maybeSingle(),
    // A builder's outside broker (active, still working for them): that builder's
    // owner or our admins may send the link. Owners can't read a broker's profile
    // directly, so the database answers this one.
    supabase.rpc("can_invite_broker", { p_broker: id }),
  ]);
  if (!target && !brokerOk) return { error: "That person wasn’t found." };
  if (target && !target.is_active) return { error: "Their access is turned off. Turn it back on first." };
  const allowed =
    me.role === "platform_admin" ||
    !!brokerOk ||
    (!!target && !!me.builder_id && target.builder_id === me.builder_id && rolesICanGive(me.role).includes(target.role as Role));
  if (!allowed) return { error: "Your role can’t make an invite link for that person." };
  const res = await freshInviteLink(id, me.id);
  return "error" in res ? { error: res.error } : { link: res.link, at: Date.now() };
}
