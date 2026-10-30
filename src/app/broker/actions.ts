"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

// The broker's buttons. Each one calls a database function that checks the
// task belongs to a builder that invited this broker, so nothing here can
// reach any other builder's work.

async function brokerOnly() {
  const me = await requireProfile();
  if (me.role !== "broker") redirect("/");
  return me;
}

function backTo(taskId: string, params: Record<string, string>): never {
  const safeId = /^[0-9a-f-]{36}$/i.test(taskId) ? taskId : "";
  redirect(`/broker${safeId ? `/tasks/${safeId}` : ""}?${new URLSearchParams(params).toString()}`);
}

// Database messages are written for people; pass them on, minus the code.
const say = (msg: string) => msg.replace(/^.*?:\s(?=[A-Z])/, "");

export async function acceptBrokerTerms() {
  await brokerOnly();
  const supabase = await createClient();
  await supabase.rpc("broker_accept_terms");
  revalidatePath("/broker", "layout");
  redirect("/broker");
}

// Tick one line as entered in the MLS (no page reload).
export async function brokerToggleCheck(taskId: string, item: string, on: boolean) {
  await brokerOnly();
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_toggle_check", { p_task: taskId, p_item: item, p_on: on });
  if (error) throw new Error("Couldn’t save that.");
  revalidatePath(`/broker/tasks/${taskId}`);
}

export async function brokerSetStatus(formData: FormData) {
  await brokerOnly();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_set_status", { p_task: id, p_status: status });
  if (error) backTo(id, { error: say(error.message) });
  revalidatePath("/broker", "layout");
  if (status === "done") redirect(`/broker?${new URLSearchParams({ saved: "Done. The builder has been told." })}`);
  backTo(id, { saved: status === "in_progress" ? "Started." : "Moved back to your to-do list." });
}

export async function brokerMarkLive(formData: FormData) {
  await brokerOnly();
  const id = String(formData.get("id") ?? "");
  const mls = String(formData.get("mls_number") ?? "").trim();
  if (!mls) backTo(id, { error: "Enter the MLS number the MLS gave this listing." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_mark_live", { p_task: id, p_mls: mls });
  if (error) backTo(id, { error: say(error.message) });
  revalidatePath("/broker", "layout");
  redirect(`/broker?${new URLSearchParams({ saved: `Live on the MLS as #${mls}. The builder has been told.` })}`);
}

export async function brokerAddNote(formData: FormData) {
  await brokerOnly();
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) backTo(id, { error: "Write a note first." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_add_note", { p_task: id, p_body: body });
  if (error) backTo(id, { error: say(error.message) });
  revalidatePath(`/broker/tasks/${id}`);
  backTo(id, { saved: "Note sent to the builder." });
}
