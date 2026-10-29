"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { safePath } from "@/lib/safe-path";

// The two sales switches (owners, 29 Oct 2026): "MLS entry" and "Needs
// marketing approval". Saved with the person's own access, so the database's
// people rules decide who may change whom (owners, managers, marketing at that
// builder, our platform admins; nobody changes their own).
export async function setSalesMls(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("profile_id") ?? "");
  const back = safePath(String(formData.get("back") ?? ""), "/team");
  const go = (p: Record<string, string>): never => {
    const [path, hash] = back.split("#");
    redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(p).toString()}${hash ? `#${hash}` : ""}`);
  };
  if (id === me.id) go({ error: "You can’t change your own access." });

  const mlsEntry = formData.get("sales_mls_entry") === "on";
  // Approval stays on unless someone unticks it while MLS entry is on.
  const needsApproval = mlsEntry ? formData.get("sales_needs_approval") === "on" : true;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ sales_mls_entry: mlsEntry, sales_needs_approval: needsApproval })
    .eq("id", id)
    .eq("role", "sales")
    .select("full_name");
  if (error) go({ error: error.message.includes("row-level security") ? "Your role can’t change that person." : `Couldn’t save: ${error.message}` });
  if (!data?.length) go({ error: "Your role can’t change that person." });

  revalidatePath(back.split(/[?#]/)[0]);
  const name = data?.[0]?.full_name ?? "They";
  go({
    saved: !mlsEntry
      ? `${name} is a standard salesperson again.`
      : needsApproval
        ? `${name} can enter homes for the MLS. Marketing approves them before our team gets them.`
        : `${name} can enter homes for the MLS and send them straight to our team.`,
  });
}
