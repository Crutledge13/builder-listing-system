"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { createInvitedLogin, deleteLogin, invitesOn } from "@/lib/invite-links";
import { safePath } from "@/lib/safe-path";

// Adding and removing a builder's outside broker (broker mode). The builder's
// owner does it on the Team page; our admins on Admin > Builders. The database
// checks who may (private.can_manage_brokers) in link_broker / add_broker / remove_broker.

function go(formData: FormData, params: Record<string, string>): never {
  const to = safePath(String(formData.get("back") ?? "/team"), "/team");
  const [path, hash] = to.split("#");
  const [base, query] = path.split("?");
  const sp = new URLSearchParams(query ?? "");
  Object.entries(params).forEach(([k, v]) => sp.set(k, v));
  redirect(`${base}?${sp.toString()}#${hash || "broker"}`);
}

const say = (msg: string) => msg.replace(/^.*?:\s(?=[A-Z])/, "");

export async function addBroker(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!builderId || !email.includes("@")) go(formData, { error: "Enter the broker’s email." });
  const supabase = await createClient();

  // Already a broker for another builder? Link them; no new login needed.
  const { data: linked, error: linkErr } = await supabase.rpc("link_broker", { p_builder: builderId, p_email: email });
  if (linkErr) go(formData, { error: say(linkErr.message) });
  if (linked === "linked") {
    revalidatePath("/", "layout");
    go(formData, { saved: "Added. They already have a broker login, so they’ll see your listings next time they sign in." });
  }
  if (linked === "already") go(formData, { saved: "They’re already your broker." });

  if (!fullName) go(formData, { error: "Enter the broker’s name." });
  if (!invitesOn()) go(formData, { error: "Adding people isn’t switched on yet. Our team needs to finish one setup step." });
  const made = await createInvitedLogin(email, fullName, { role: "broker" });
  if ("error" in made) go(formData, { error: made.error });
  const { error } = await supabase.rpc("add_broker", { p_builder: builderId, p_user: made.userId, p_email: email, p_name: fullName, p_phone: phone || null });
  if (error) {
    await deleteLogin(made.userId); // nothing half set up
    go(formData, { error: say(error.message) });
  }
  revalidatePath("/", "layout");
  go(formData, { saved: `Added ${fullName}. Copy their invite link below and send it to them.` });
}

export async function removeBroker(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id") ?? "");
  const brokerId = String(formData.get("broker_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_broker", { p_builder: builderId, p_broker: brokerId });
  if (error) go(formData, { error: say(error.message) });
  revalidatePath("/", "layout");
  go(formData, { saved: "Removed. They no longer see your listings." });
}
