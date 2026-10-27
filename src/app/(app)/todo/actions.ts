"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { centralToUtc } from "@/lib/time";

function back(formData: FormData, params: Record<string, string>): never {
  const to = String(formData.get("back") ?? "/todo");
  const safe = to.startsWith("/") && !to.startsWith("//") ? to : "/todo";
  revalidatePath("/todo");
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}${new URLSearchParams(params).toString()}`);
}

export async function addTodo(formData: FormData) {
  const me = await requireProfile();
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) back(formData, { error: "Give the to-do a title." });
  const builderId = me.role === "platform_admin" ? String(formData.get("builder_id") ?? "") : me.builder_id;
  if (!builderId) back(formData, { error: "Pick the builder." });
  const due = String(formData.get("due") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("builder_tasks").insert({
    builder_id: builderId,
    title,
    details: String(formData.get("details") ?? "").trim().slice(0, 4000) || null,
    assignee_id: String(formData.get("assignee_id") ?? "") || null,
    home_id: String(formData.get("home_id") ?? "") || null,
    due_at: due ? centralToUtc(due, "17:00") : null,
    priority: formData.get("priority") === "high" ? "high" : "normal",
    created_by: me.id,
  });
  if (error) back(formData, { error: error.message.includes("Assign it") ? error.message : error.message.includes("row-level") ? "Your role can’t add to-dos." : `Couldn’t add it: ${error.message}` });
  back(formData, { saved: "Added." });
}

export async function updateTodo(formData: FormData) {
  await requireProfile();
  const patch: Record<string, string | null> = {};
  const status = String(formData.get("status") ?? "");
  if (["todo", "in_progress", "done", "cancelled"].includes(status)) patch.status = status;
  if (formData.has("assignee_id")) patch.assignee_id = String(formData.get("assignee_id") ?? "") || null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("builder_tasks").update(patch).eq("id", String(formData.get("id"))).select("id");
  if (error || !data?.length) back(formData, { error: error?.message.includes("Assign it") ? error.message : "Couldn’t change that to-do." });
  back(formData, { saved: status === "done" ? "Done. Nice." : "Saved." });
}
