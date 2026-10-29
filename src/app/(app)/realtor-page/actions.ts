"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { SHARE_SWITCHES } from "@/lib/share-settings";

// Save the realtor page switches. The database decides who may (owners,
// managers, marketing and our admins: private.can_edit_branding).
export async function saveShareSettings(formData: FormData) {
  const me = await requireProfile();
  const builderId = String(formData.get("builder_id") ?? "");
  const back = (p: Record<string, string>): never =>
    redirect(`/realtor-page?${new URLSearchParams(isStaff(me.role) ? { builder: builderId, ...p } : p).toString()}`);
  if (!/^[0-9a-f-]{36}$/i.test(builderId)) back({ error: "Pick a builder first." });

  const row: Record<string, unknown> = { builder_id: builderId };
  for (const s of SHARE_SWITCHES) row[s.key] = formData.get(s.key) === "on";

  const supabase = await createClient();
  const { data, error } = await supabase.from("share_page_settings").upsert(row).select("builder_id");
  if (error || !data?.length) {
    back({ error: error && !/row-level security|42501|permission/i.test(error.message) ? `Couldn’t save: ${error.message}` : "Your role can’t change the realtor page." });
  }
  revalidatePath("/realtor-page");
  const off = SHARE_SWITCHES.filter((s) => !row[s.key]).map((s) => s.label.toLowerCase());
  back({ saved: off.length ? `Saved. Realtor pages now leave out: ${off.join(", ")}.` : "Saved. Realtor pages show everything." });
}
