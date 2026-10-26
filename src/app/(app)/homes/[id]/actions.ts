"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { allowedTransitions, editableFields, type HomeField, type WorkflowStatus } from "@/lib/permissions";

const NUMERIC: HomeField[] = [
  "list_price", "bedrooms_total", "bathrooms_full", "bathrooms_half", "living_area",
  "lot_size_acres", "stories", "garage_spaces", "year_built",
];

function back(id: string, params: Record<string, string>): never {
  redirect(`/homes/${id}?${new URLSearchParams(params).toString()}`);
}

// Turn a database refusal into a plain-English message.
function friendly(message: string) {
  if (message.includes("cannot change") || message.includes("cannot move")) return message;
  if (message.includes("MLS number is required")) return message;
  if (message.includes("row-level security")) return "You don’t have permission to do that.";
  return `Couldn’t save: ${message}`;
}

export async function saveHome(formData: FormData) {
  const id = String(formData.get("id"));
  const me = await requireProfile();
  const supabase = await createClient();

  const patch: Record<string, string | number | null> = {};
  for (const field of editableFields(me.role)) {
    if (!formData.has(field)) continue;
    const raw = String(formData.get(field) ?? "").trim();
    if (NUMERIC.includes(field)) {
      const n = raw === "" ? null : Number(raw.replace(/[$,]/g, ""));
      if (n !== null && Number.isNaN(n)) back(id, { error: `${field.replace(/_/g, " ")} must be a number` });
      patch[field] = n;
    } else {
      patch[field] = raw === "" ? null : raw;
    }
  }
  if (Object.keys(patch).length === 0) back(id, { error: "Your role can’t edit these fields." });

  const { data, error } = await supabase.from("homes").update(patch).eq("id", id).select("id");
  if (error) back(id, { error: friendly(error.message) });
  if (!data?.length) back(id, { error: "You don’t have permission to edit this home." });

  revalidatePath("/homes");
  back(id, { saved: "1" });
}

export async function changeStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const to = String(formData.get("to")) as WorkflowStatus;
  const from = String(formData.get("from")) as WorkflowStatus;
  const mls = String(formData.get("mls_number") ?? "").trim();

  const me = await requireProfile();
  if (!allowedTransitions(me.role, from).includes(to)) {
    back(id, { error: "Your role can’t make that status change." });
  }

  const patch: Record<string, string> = { workflow_status: to };
  if (to === "live_on_mls") {
    if (!mls) back(id, { error: "Enter the MLS number before marking the listing live." });
    patch.mls_number = mls;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("homes").update(patch).eq("id", id).select("id");
  if (error) back(id, { error: friendly(error.message) });
  if (!data?.length) back(id, { error: "You don’t have permission to change this listing." });

  revalidatePath("/homes");
  revalidatePath("/approvals");
  back(id, { saved: "status" });
}
