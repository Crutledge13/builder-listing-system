"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendQueuedEmails } from "@/lib/email";

// Emails this work order queued (to the builder), sent once email is set up.
async function mail(token: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("broker_link_task_id", { p_token: token });
  if (typeof data === "string") after(() => sendQueuedEmails("tasks", data));
}

// Buttons on a one-off broker link. No sign-in: each database function checks
// the link is live and the work order open, and works on that one only.

const okToken = (t: string) => /^[\w-]{20,64}$/.test(t);
const say = (msg: string) => msg.replace(/^.*?:\s(?=[A-Z])/, "");
function backTo(token: string, params: Record<string, string>): never {
  redirect(`/w/${okToken(token) ? token : "x"}?${new URLSearchParams(params).toString()}`);
}

export async function linkToggle(token: string, item: string, on: boolean) {
  if (!okToken(token)) throw new Error("Couldn’t save that.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_link_toggle", { p_token: token, p_item: item, p_on: on });
  if (error) throw new Error("Couldn’t save that.");
}

export async function linkSubmit(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_link_submit", {
    p_token: token, p_mls: String(formData.get("mls_number") ?? "").trim(), p_url: String(formData.get("mls_url") ?? "").trim(),
  });
  if (error) backTo(token, { error: say(error.message) });
  await mail(token);
  backTo(token, { saved: "Sent to the builder. They’ll check it and accept it." });
}

export async function linkNote(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) backTo(token, { error: "Write a note first." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_link_note", { p_token: token, p_body: body });
  if (error) backTo(token, { error: say(error.message) });
  await mail(token);
  backTo(token, { saved: "Note sent to the builder." });
}

export async function linkSendBack(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  let items: unknown = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    backTo(token, { error: "Couldn’t read that. Try again." });
  }
  const note = String(formData.get("note") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("broker_link_send_back", { p_token: token, p_items: items, p_note: note || null });
  if (error) backTo(token, { error: say(error.message) });
  await mail(token);
  backTo(token, { saved: "Sent back to the builder. Open this link again once they’ve answered." });
}
