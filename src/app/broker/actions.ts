"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { after } from "next/server";
import { sendQueuedEmails } from "@/lib/email";

const mail = (taskId: string) => {
  if (/^[0-9a-f-]{36}$/i.test(taskId)) after(() => sendQueuedEmails("tasks", taskId));
};

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
  backTo(id, { saved: status === "in_progress" ? "Started. It’s yours to work on." : "Moved back to your to-do list." });
}

// Done in the MLS: send it to the builder to check and accept (a new listing
// needs its MLS number and the link to the live listing).
export async function brokerSubmit(formData: FormData) {
  await brokerOnly();
  const id = String(formData.get("id") ?? "");
  const mls = String(formData.get("mls_number") ?? "").trim();
  const url = String(formData.get("mls_url") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_submit", { p_task: id, p_mls: mls, p_url: url });
  if (error) backTo(id, { error: say(error.message) });
  mail(id);
  revalidatePath("/broker", "layout");
  redirect(`/broker?${new URLSearchParams({ saved: "Sent to the builder. They’ll check it and accept it; you’ll get an email when they do." })}`);
}

// Something looks wrong: flag fields or photos and send it back to the builder.
export async function brokerSendBack(formData: FormData) {
  await brokerOnly();
  const id = String(formData.get("id") ?? "");
  let items: unknown = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    backTo(id, { error: "Couldn’t read that. Try again." });
  }
  const note = String(formData.get("note") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_send_back", { p_task: id, p_items: items, p_note: note || null });
  if (error) backTo(id, { error: say(error.message) });
  mail(id);
  revalidatePath("/broker", "layout");
  backTo(id, { saved: "Sent back to the builder. You’ll get an email when they’ve answered." });
}

export async function brokerAddNote(formData: FormData) {
  await brokerOnly();
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) backTo(id, { error: "Write a note first." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_add_note", { p_task: id, p_body: body });
  if (error) backTo(id, { error: say(error.message) });
  mail(id);
  revalidatePath(`/broker/tasks/${id}`);
  backTo(id, { saved: "Note sent to the builder." });
}
