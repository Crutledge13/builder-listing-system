"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createAdminSupabase } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { rolesICanGive } from "@/lib/permissions";

function go(params: Record<string, string>): never {
  redirect(`/team?${new URLSearchParams(params).toString()}`);
}

function friendly(msg: string) {
  if (msg.includes("row-level security")) return "Your role can’t make that change.";
  if (msg.includes("duplicate key")) return "Someone with that email is already set up.";
  return msg;
}

// Builder owners add anyone at their company; managers add sales and marketing.
// The database checks the same thing (private.can_manage_person).
export async function inviteTeammate(formData: FormData) {
  const me = await requireProfile();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const communityIds = formData.getAll("community_id").map(String);
  if (!email || !fullName) go({ error: "Enter a name and email." });
  if (!rolesICanGive(me.role).includes(role as never)) go({ error: "Your role can’t add that kind of user." });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) go({ error: "Adding people isn’t switched on yet. Our team needs to finish one setup step." });

  const admin = createAdminSupabase(SUPABASE_URL, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName } });
  if (error || !data.user) go({ error: `Couldn’t invite: ${error?.message ?? "unknown error"}` });

  // The profile is saved with the inviter's own access, so the database rules decide.
  const supabase = await createClient();
  const { error: pErr } = await supabase.from("profiles").insert({ id: data.user.id, email, full_name: fullName, role, builder_id: me.builder_id });
  if (pErr) {
    await admin.auth.admin.deleteUser(data.user.id); // undo the login so nothing is half set up
    go({ error: friendly(pErr.message) });
  }
  if (role === "sales" && communityIds.length) {
    await supabase.from("community_assignments").insert(communityIds.map((c) => ({ profile_id: data.user.id, community_id: c })));
  }
  revalidatePath("/team");
  go({ saved: `Invited ${fullName}. They’ll get an email to set a password.` });
}

export async function updateTeammate(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("id"));
  const role = String(formData.get("role") ?? "");
  if (id === me.id) go({ error: "You can’t change your own access." });
  if (!rolesICanGive(me.role).includes(role as never)) go({ error: "Your role can’t give that role." });
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({ role }).eq("id", id).select("id");
  if (error) go({ error: friendly(error.message) });
  if (!data?.length) go({ error: "Your role can’t change that person." });
  if (role !== "sales") await supabase.from("community_assignments").delete().eq("profile_id", id);
  revalidatePath("/team");
  go({ saved: "Role saved." });
}

// Turning someone off keeps their history (who uploaded, who approved) but stops their login.
export async function setTeammateActive(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("id"));
  const active = formData.get("active") === "true";
  if (id === me.id) go({ error: "You can’t turn off your own access." });
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({ is_active: active }).eq("id", id).select("full_name");
  if (error) go({ error: friendly(error.message) });
  if (!data?.length) go({ error: "Your role can’t change that person." });
  revalidatePath("/team");
  go({ saved: active ? `${data[0].full_name} can sign in again.` : `${data[0].full_name} can no longer sign in.` });
}
