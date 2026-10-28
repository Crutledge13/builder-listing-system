"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { SKIPPABLE, type SkippableStep } from "@/lib/onboarding";

function back(builderId: string, staff: boolean, p: Record<string, string>): never {
  const q = new URLSearchParams(staff ? { builder: builderId, ...p } : p);
  redirect(`/setup?${q.toString()}`);
}

// The builder we're acting for: our staff pass one; builders use their own.
async function target(formData: FormData) {
  const me = await requireProfile();
  const staff = isStaff(me.role);
  const builderId = staff ? String(formData.get("builder_id") ?? "") : me.builder_id;
  if (!builderId) redirect("/setup");
  return { builderId, staff };
}

const friendly = (m: string) => (m.includes("owner or a manager") ? "Only the owner or a manager can change the setup checklist." : m);

export async function skipStep(formData: FormData) {
  const { builderId, staff } = await target(formData);
  const step = String(formData.get("step")) as SkippableStep;
  const skip = formData.get("skip") === "true";
  if (!SKIPPABLE.includes(step)) back(builderId, staff, { error: "That step can’t be skipped." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_setup_skip", { p_builder: builderId, p_step: step, p_skip: skip });
  if (error) back(builderId, staff, { error: friendly(error.message) });
  revalidatePath("/", "layout");
  back(builderId, staff, { saved: skip ? "Skipped. You can come back to it any time." : "Back on the list." });
}

export async function finishSetup(formData: FormData) {
  const { builderId, staff } = await target(formData);
  const done = formData.get("done") === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("finish_setup", { p_builder: builderId, p_done: done });
  if (error) back(builderId, staff, { error: friendly(error.message) });
  revalidatePath("/", "layout");
  back(builderId, staff, { saved: done ? "Setup marked done. The checklist stays under Setup checklist in the menu." : "Checklist reopened." });
}
