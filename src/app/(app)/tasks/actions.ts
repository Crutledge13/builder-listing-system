"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { centralToUtc } from "@/lib/time";

function back(formData: FormData, params: Record<string, string>): never {
  const to = String(formData.get("back") ?? "/tasks");
  const [path, query] = to.split("?");
  const sp = new URLSearchParams(query ?? "");
  Object.entries(params).forEach(([k, v]) => sp.set(k, v));
  redirect(`${path}?${sp.toString()}`);
}

async function staffOnly(formData: FormData) {
  const me = await requireProfile();
  if (!isStaff(me.role)) back(formData, { error: "Tasks are for our team." });
  return me;
}

export async function setTaskStatus(formData: FormData) {
  await staffOnly(formData);
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["todo", "in_progress", "done", "cancelled"].includes(status)) back(formData, { error: "Unknown status." });
  const supabase = await createClient();
  const { data: task, error } = await supabase.from("tasks").update({ status }).eq("id", id).select("source_table, source_id, title").single();
  if (error || !task) back(formData, { error: "Couldn’t update that task." });

  // Finishing a help request or reverse prospecting task closes the request too,
  // so the builder sees it was handled.
  if (status === "done" && task.source_id) {
    if (task.source_table === "issue_reports") await supabase.from("issue_reports").update({ status: "closed" }).eq("id", task.source_id);
    if (task.source_table === "reverse_prospect_requests")
      await supabase.from("reverse_prospect_requests").update({ status: "delivered" }).eq("id", task.source_id).neq("status", "delivered");
  }
  revalidatePath("/", "layout");
  back(formData, { saved: status === "done" ? `Done: ${task.title}` : status === "in_progress" ? "Started." : "Moved back to to-do." });
}

export async function assignTask(formData: FormData) {
  await staffOnly(formData);
  const id = String(formData.get("id"));
  const assignee = String(formData.get("assignee_id") ?? "") || null;
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ assignee_id: assignee }).eq("id", id);
  if (error) back(formData, { error: "Couldn’t assign that task." });
  revalidatePath("/tasks");
  back(formData, { saved: assignee ? "Assigned." : "Unassigned." });
}

export async function addTaskNote(formData: FormData) {
  const me = await staffOnly(formData);
  const id = String(formData.get("id"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) back(formData, { error: "Write a note first." });
  const supabase = await createClient();
  const { error } = await supabase.from("task_notes").insert({ task_id: id, author_id: me.id, body });
  if (error) back(formData, { error: "Couldn’t save the note." });
  revalidatePath("/tasks");
  back(formData, { saved: "Note added." });
}

export async function createTask(formData: FormData) {
  const me = await staffOnly(formData);
  const title = String(formData.get("title") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();
  const due = String(formData.get("due") ?? "");
  const homeId = String(formData.get("home_id") ?? "") || null;
  const builderId = String(formData.get("builder_id") ?? "") || null;
  if (!title) back(formData, { error: "Give the task a title." });
  const supabase = await createClient();
  let builder = builderId;
  let community: string | null = null;
  if (homeId) {
    const { data: h } = await supabase.from("homes").select("builder_id, community_id").eq("id", homeId).maybeSingle();
    builder = h?.builder_id ?? builder;
    community = h?.community_id ?? null;
  }
  const { error } = await supabase.from("tasks").insert({
    kind: "other",
    title,
    details: details || null,
    priority: formData.get("priority") === "high" ? "high" : "normal",
    due_at: due ? centralToUtc(due, "17:00") : null,
    home_id: homeId,
    builder_id: builder,
    community_id: community,
    assignee_id: String(formData.get("assignee_id") ?? "") || me.id,
    created_by: me.id,
  });
  if (error) back(formData, { error: "Couldn’t add that task." });
  revalidatePath("/", "layout");
  back(formData, { saved: `Added: ${title}` });
}
