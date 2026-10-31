"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { sendQueuedEmails } from "@/lib/email";
import { sectionsForBoard, MLS_BOARD_SELECT, type MlsBoard } from "@/lib/mls-fields";
import { answerSources, canEditMlsAnswers } from "@/lib/ntreis-form";
import { editableFields } from "@/lib/permissions";

// The builder's side of broker work orders, in the home's "Your broker"
// section: pick the broker, accept or send back what the broker submitted,
// answer what they flagged and resend, and one-off links. Every one is a
// database function that checks the person (owner, managers, marketing, our
// staff for that builder) and the work order again.

const uuid = /^[0-9a-f-]{36}$/i;
const say = (msg: string) => msg.replace(/^.*?:\s(?=[A-Z])/, "");
function back(homeId: string, params: Record<string, string>): never {
  redirect(`/homes/${uuid.test(homeId) ? homeId : ""}?${new URLSearchParams({ ...params, at: "broker" })}#broker`);
}
const sendMail = (taskId: string) => {
  if (uuid.test(taskId)) after(() => sendQueuedEmails("tasks", taskId));
};

export async function setHomeBroker(fd: FormData) {
  await requireProfile();
  const home = String(fd.get("home_id") ?? "");
  const broker = String(fd.get("broker_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_home_broker", { p_home: home, p_broker: broker || null });
  if (error) back(home, { error: say(error.message) });
  revalidatePath(`/homes/${home}`);
  back(home, { saved: broker ? "This home’s work now goes to that broker only." : "This home’s work goes to any of your brokers." });
}

export async function acceptBrokerWork(fd: FormData) {
  await requireProfile();
  const home = String(fd.get("home_id") ?? "");
  const task = String(fd.get("task_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_broker_work", { p_task: task });
  if (error) back(home, { error: say(error.message) });
  sendMail(task);
  revalidatePath(`/homes/${home}`);
  revalidatePath("/homes");
  back(home, { saved: "Accepted. That work order is closed and your broker has been told." });
}

export async function returnBrokerWork(fd: FormData) {
  await requireProfile();
  const home = String(fd.get("home_id") ?? "");
  const task = String(fd.get("task_id") ?? "");
  const note = String(fd.get("note") ?? "").trim();
  if (!note) back(home, { error: "Say what still needs fixing." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_broker_work", { p_task: task, p_note: note });
  if (error) back(home, { error: say(error.message) });
  sendMail(task);
  revalidatePath(`/homes/${home}`);
  back(home, { saved: "Sent back to your broker with your note." });
}

// Answer one thing the broker flagged. "use" also changes the field to the
// broker's value when it's one of the home's own answers (as you, so the
// normal edit rules apply); otherwise it's recorded as changed or left as is.
export async function answerBrokerRequest(fd: FormData) {
  const me = await requireProfile();
  const home = String(fd.get("home_id") ?? "");
  const request = String(fd.get("request_id") ?? "");
  const answer = String(fd.get("answer") ?? "");
  const note = String(fd.get("note") ?? "").trim();
  const supabase = await createClient();

  if (answer === "use") {
    const { data: r } = await supabase.from("broker_requests").select("field_key, proposed_text, home_id").eq("id", request).maybeSingle();
    if (!r?.field_key || !r.proposed_text || !r.home_id) back(home, { error: "That one can’t be changed automatically. Change it, then choose “I changed it”." });
    const { data: h } = await supabase.from("homes").select("mls_board, mls_fields, field_sources").eq("id", r.home_id).maybeSingle();
    const { data: board } = h?.mls_board ? await supabase.from("mls_boards").select(MLS_BOARD_SELECT).eq("code", h.mls_board).maybeSingle() : { data: null };
    const field = sectionsForBoard(board as MlsBoard | null).flatMap((s) => s.fields).find((f) => f.key === r.field_key);
    const value: string = String(r.proposed_text).trim();
    const asNumber = (v: string) => {
      const n = Number(v.replace(/[$,\s]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    let patch: Record<string, unknown> | null = null;
    if (field?.source === "home" && field.column && (editableFields(me.role) as readonly string[]).includes(field.column)) {
      const v = field.type === "number" || field.type === "money" ? asNumber(value) : value;
      if (v === null) back(home, { error: `${field.label} needs a number. Change it on the home, then choose “I changed it”.` });
      patch = { [field.column]: v };
    } else if (field?.source === "builder" && canEditMlsAnswers(me.role)) {
      const v = field.type === "multi" ? value.split(",").map((x: string) => x.trim()).filter(Boolean)
        : field.type === "number" || field.type === "money" ? asNumber(value) : value;
      if (v === null) back(home, { error: `${field.label} needs a number. Change it on the home, then choose “I changed it”.` });
      if (field.options && (Array.isArray(v) ? v : [v]).some((x) => !field.options!.includes(String(x)))) {
        back(home, { error: `“${value}” isn’t one of the MLS’s choices for ${field.label}. Change it on the home, then choose “I changed it”.` });
      }
      patch = {
        mls_fields: { ...((h?.mls_fields ?? {}) as Record<string, unknown>), [field.key]: v },
        field_sources: { ...((h?.field_sources ?? {}) as Record<string, string>), ...answerSources([field.key]) },
      };
    }
    if (!patch) back(home, { error: "That field is set elsewhere (community setup or our team). Change it there, then choose “I changed it”." });
    const { data, error } = await supabase.from("homes").update(patch).eq("id", r.home_id).select("id");
    if (error || !data?.length) back(home, { error: error ? say(error.message) : "You can’t change that field." });
  }

  const { error } = await supabase.rpc("answer_broker_request", {
    p_request: request,
    p_answer: answer === "use" ? "accepted" : answer,
    p_note: note || null,
  });
  if (error) back(home, { error: say(error.message) });
  revalidatePath(`/homes/${home}`);
  back(home, { saved: answer === "use" ? "Changed to your broker’s value." : "Answer saved." });
}

export async function resendToBroker(fd: FormData) {
  await requireProfile();
  const home = String(fd.get("home_id") ?? "");
  const task = String(fd.get("task_id") ?? "");
  const note = String(fd.get("note") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("resend_to_broker", { p_task: task, p_note: note || null });
  if (error) back(home, { error: say(error.message) });
  sendMail(task);
  revalidatePath(`/homes/${home}`);
  back(home, { saved: "Sent back to your broker with your answers." });
}

export async function makeBrokerLink(fd: FormData) {
  await requireProfile();
  const home = String(fd.get("home_id") ?? "");
  const task = String(fd.get("task_id") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  if (!name) back(home, { error: "Enter who the link is for." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("make_broker_link", { p_task: task, p_name: name });
  if (error) back(home, { error: say(error.message) });
  revalidatePath(`/homes/${home}`);
  back(home, { saved: "Link made. Copy it below and send it to them." });
}

export async function turnOffBrokerLink(fd: FormData) {
  await requireProfile();
  const home = String(fd.get("home_id") ?? "");
  const link = String(fd.get("link_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("turn_off_broker_link", { p_link: link });
  if (error) back(home, { error: say(error.message) });
  revalidatePath(`/homes/${home}`);
  back(home, { saved: "Link turned off. It won’t open any more." });
}
