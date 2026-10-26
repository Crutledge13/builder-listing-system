"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createAdminSupabase } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { SUPABASE_URL } from "@/lib/supabase/config";

// Every action here is for our platform admins. The database rules enforce
// this too; the check below just gives a clear message.
async function requireAdmin(back: string) {
  const me = await requireProfile();
  if (me.role !== "platform_admin") go(back, { error: "Only platform admins can do that." });
  return me;
}

function go(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "builder";
}

function friendly(msg: string) {
  if (msg.includes("row-level security")) return "You don’t have permission to do that.";
  if (msg.includes("duplicate key")) return "That already exists.";
  return msg;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
export async function addBuilder(formData: FormData) {
  await requireAdmin("/admin/builders");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) go("/admin/builders", { error: "Enter the builder’s name." });
  const supabase = await createClient();
  const { error } = await supabase.from("builders").insert({ name, slug: `${slugify(name)}-${Date.now().toString(36).slice(-4)}` });
  if (error) go("/admin/builders", { error: friendly(error.message) });
  revalidatePath("/admin", "layout");
  go("/admin/builders", { saved: `Added ${name}.` });
}

export async function renameBuilder(formData: FormData) {
  await requireAdmin("/admin/builders");
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) go("/admin/builders", { error: "The name can’t be blank." });
  const supabase = await createClient();
  const { error } = await supabase.from("builders").update({ name }).eq("id", id);
  if (error) go("/admin/builders", { error: friendly(error.message) });
  revalidatePath("/", "layout");
  go("/admin/builders", { saved: "Renamed." });
}

// ---------------------------------------------------------------------------
// Communities (assigning a community to a builder)
// ---------------------------------------------------------------------------
export async function addCommunity(formData: FormData) {
  await requireAdmin("/admin/communities");
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const county = String(formData.get("county") ?? "").trim();
  const builderId = String(formData.get("builder_id") ?? "");
  if (!name || !city || !builderId) go("/admin/communities", { error: "Enter a name, city and builder." });
  const supabase = await createClient();
  const { error } = await supabase.from("communities").insert({ name, city, county: county || null, builder_id: builderId });
  if (error) go("/admin/communities", { error: friendly(error.message) });
  revalidatePath("/", "layout");
  go("/admin/communities", { saved: `Added ${name}.` });
}

export async function updateCommunity(formData: FormData) {
  await requireAdmin("/admin/communities");
  const id = String(formData.get("id"));
  const patch = {
    name: String(formData.get("name") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    county: String(formData.get("county") ?? "").trim() || null,
    builder_id: String(formData.get("builder_id") ?? ""),
  };
  if (!patch.name || !patch.city || !patch.builder_id) go("/admin/communities", { error: "Name, city and builder are required." });
  const supabase = await createClient();
  const { error } = await supabase.from("communities").update(patch).eq("id", id);
  if (error) go("/admin/communities", { error: friendly(error.message) });
  revalidatePath("/", "layout");
  go("/admin/communities", { saved: `Saved ${patch.name}.` });
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
const BUILDER_ROLES = ["builder_owner", "manager", "sales", "marketing"];
// Roles with no builder: our staff and photographers (contractors who work across builders).
const STAFF_ROLES = ["platform_admin", "listing_coordinator", "photographer"];

export async function updatePerson(formData: FormData) {
  const me = await requireAdmin("/admin/people");
  const id = String(formData.get("id"));
  const role = String(formData.get("role") ?? "");
  const builderId = String(formData.get("builder_id") ?? "") || null;
  if (![...BUILDER_ROLES, ...STAFF_ROLES].includes(role)) go("/admin/people", { error: "Pick a role." });
  if (BUILDER_ROLES.includes(role) && !builderId) go("/admin/people", { error: "Builder roles need a builder." });
  if (id === me.id && role !== "platform_admin") go("/admin/people", { error: "You can’t remove your own admin role." });
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role, builder_id: STAFF_ROLES.includes(role) ? null : builderId })
    .eq("id", id);
  if (error) go("/admin/people", { error: friendly(error.message) });
  // Community assignments only apply to sales within the same builder.
  if (role !== "sales") await supabase.from("community_assignments").delete().eq("profile_id", id);
  revalidatePath("/admin/people");
  go("/admin/people", { saved: "Saved." });
}

// Used by our admins (Admin > People) and by builder owners and managers (community page).
export async function setAssignments(formData: FormData) {
  const profileId = String(formData.get("profile_id"));
  const communityIds = formData.getAll("community_id").map(String);
  const back = String(formData.get("back") ?? "/admin/people");
  const scope = formData.getAll("scope").map(String); // communities shown on the form
  const supabase = await createClient();

  // Remove unticked, add ticked, only within the communities that were on the form.
  const remove = scope.filter((c) => !communityIds.includes(c));
  if (remove.length) {
    const { error } = await supabase.from("community_assignments").delete().eq("profile_id", profileId).in("community_id", remove);
    if (error) go(back, { error: friendly(error.message) });
  }
  if (communityIds.length) {
    const { error } = await supabase
      .from("community_assignments")
      .upsert(communityIds.map((c) => ({ profile_id: profileId, community_id: c })), { onConflict: "profile_id,community_id", ignoreDuplicates: true });
    if (error) go(back, { error: friendly(error.message) });
  }
  revalidatePath("/", "layout");
  go(back, { saved: "Sales assignments saved." });
}

export async function invitePerson(formData: FormData) {
  await requireAdmin("/admin/people");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const builderId = String(formData.get("builder_id") ?? "") || null;
  if (!email || !fullName) go("/admin/people", { error: "Enter a name and email." });
  if (![...BUILDER_ROLES, ...STAFF_ROLES].includes(role)) go("/admin/people", { error: "Pick a role." });
  if (BUILDER_ROLES.includes(role) && !builderId) go("/admin/people", { error: "Builder roles need a builder." });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) go("/admin/people", { error: "Inviting people needs the SUPABASE_SERVICE_ROLE_KEY setting in Vercel. See the note on this page." });

  // Creating a login needs Supabase's admin key, which stays on the server.
  const admin = createAdminSupabase(SUPABASE_URL, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName } });
  if (error || !data.user) go("/admin/people", { error: `Couldn’t invite: ${error?.message ?? "unknown error"}` });

  const supabase = await createClient();
  const { error: pErr } = await supabase.from("profiles").insert({
    id: data.user.id,
    email,
    full_name: fullName,
    role,
    builder_id: STAFF_ROLES.includes(role) ? null : builderId,
  });
  if (pErr) go("/admin/people", { error: `The invite went out, but the account setup failed: ${friendly(pErr.message)}` });
  revalidatePath("/admin/people");
  go("/admin/people", { saved: `Invited ${fullName}. They’ll get an email to set a password.` });
}

// ---------------------------------------------------------------------------
// Requests inbox
// ---------------------------------------------------------------------------
export async function resolveFromInbox(formData: FormData) {
  const id = String(formData.get("request_id"));
  const status = String(formData.get("status"));
  const back = String(formData.get("back") ?? "/admin/requests");
  if (!["done", "declined"].includes(status)) go(back, { error: "Unknown status." });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("change_requests")
    .update({ status, resolution_note: String(formData.get("note") ?? "").trim() || null })
    .eq("id", id)
    .select("id");
  if (error) go(back, { error: friendly(error.message) });
  if (!data?.length) go(back, { error: "Your role can’t resolve change requests." });
  revalidatePath("/", "layout");
  go(back, { saved: status === "done" ? "Marked done." : "Declined." });
}
