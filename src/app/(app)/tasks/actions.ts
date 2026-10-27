"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { enterOwnMls } from "@/lib/mls-entry";
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

// Our team, or a builder that enters its own listings in the MLS (the database
// limits them to their own MLS work).
async function mlsWorker(formData: FormData) {
  const me = await requireProfile();
  if (!isStaff(me.role) && !(await enterOwnMls(me.role, me.builder_id))) back(formData, { error: "Tasks are for our team." });
  return me;
}

export async function setTaskStatus(formData: FormData) {
  await mlsWorker(formData);
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
  await mlsWorker(formData);
  const id = String(formData.get("id"));
  const assignee = String(formData.get("assignee_id") ?? "") || null;
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ assignee_id: assignee }).eq("id", id);
  if (error) back(formData, { error: "Couldn’t assign that task." });
  revalidatePath("/tasks");
  back(formData, { saved: assignee ? "Assigned." : "Unassigned." });
}

export async function addTaskNote(formData: FormData) {
  const me = await mlsWorker(formData);
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

// Tick one line of a task's work sheet as entered in the MLS (no page reload).
export async function toggleTaskCheck(taskId: string, item: string, on: boolean) {
  const me = await requireProfile();
  if (!isStaff(me.role) && !(await enterOwnMls(me.role, me.builder_id))) throw new Error("Tasks are for our team.");
  const supabase = await createClient();
  const { data: t } = await supabase.from("tasks").select("checked").eq("id", taskId).single();
  if (!t) throw new Error("Task not found.");
  const set = new Set<string>(t.checked ?? []);
  if (on) set.add(item);
  else set.delete(item);
  const { error } = await supabase.from("tasks").update({ checked: [...set] }).eq("id", taskId);
  if (error) throw new Error("Couldn’t save that.");
  revalidatePath(`/tasks/${taskId}`);
}

// After entering a new listing: record its MLS number and mark it live.
// That closes the "Enter in MLS" task automatically.
export async function markListingLive(formData: FormData) {
  await mlsWorker(formData);
  const homeId = String(formData.get("home_id"));
  const mls = String(formData.get("mls_number") ?? "").trim();
  if (!mls) back(formData, { error: "Enter the MLS number the MLS gave this listing." });
  const supabase = await createClient();
  const { data, error } = await supabase.from("homes").update({ workflow_status: "live_on_mls", mls_number: mls }).eq("id", homeId).select("id");
  if (error) back(formData, { error: error.message.includes("cannot") ? "Your role can’t mark this listing live." : `Couldn’t save: ${error.message}` });
  if (!data?.length) back(formData, { error: "Couldn’t find that home." });
  revalidatePath("/", "layout");
  back(formData, { saved: `Live on the MLS as #${mls}. Task done.` });
}
