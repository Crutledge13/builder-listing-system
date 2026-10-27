"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { after } from "next/server";
import {
  allowedTransitions,
  canToggleDisclaimer,
  editableFields,
  isStaff,
  marketChoices,
  type HomeField,
  type MarketStatus,
  type WorkflowStatus,
} from "@/lib/permissions";
import { sendQueuedEmails } from "@/lib/email";
import { centralToUtc } from "@/lib/time";
import { answerSources, canEditMlsAnswers, readMlsAnswers } from "@/lib/ntreis-form";
import { cleanRooms, type Room } from "@/lib/rooms";

const NUMERIC: HomeField[] = [
  "list_price", "bedrooms_total", "bathrooms_full", "bathrooms_half", "living_area",
  "lot_size_acres", "stories", "garage_spaces", "year_built",
];

function back(id: string, params: Record<string, string>): never {
  // "at" names the section the form was in; the page shows the message there.
  redirect(`/homes/${id}?${new URLSearchParams(params).toString()}${params.at ? `#${params.at}` : ""}`);
}

// Turn a database refusal into a plain-English message.
function friendly(message: string) {
  if (message.includes("Not ready for the MLS")) return message;
  if (message.includes("already live on")) return message;
  if (message.includes("cannot change") || message.includes("cannot move")) return message;
  if (message.includes("MLS number is required")) return message;
  if (message.includes("row-level security")) return "You don’t have permission to do that.";
  return `Couldn’t save: ${message}`;
}

export async function saveHome(formData: FormData) {
  const id = String(formData.get("id"));
  const me = await requireProfile();
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
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
  // The builder's NTREIS answers, merged into what's saved.
  if (formData.has("mls_key") && canEditMlsAnswers(me.role)) {
    const { data: cur } = await supabase.from("homes").select("mls_fields, field_sources").eq("id", id).maybeSingle();
    const answers = readMlsAnswers(formData, (cur?.mls_fields ?? {}) as Record<string, unknown>);
    if (answers.badNumbers.length) back(id, { error: `${answers.badNumbers.join(", ")} must be a number`, at: "ntreis" });
    if (answers.changed.length) {
      patch.mls_fields = answers.values;
      patch.field_sources = { ...((cur?.field_sources ?? {}) as Record<string, string>), ...answerSources(answers.changed) };
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

// ---------------------------------------------------------------------------
// Change requests
// ---------------------------------------------------------------------------
export async function requestChange(formData: FormData) {
  const id = String(formData.get("id"));
  const message = String(formData.get("message") ?? "").trim();
  if (!message) back(id, { error: "Describe the change you need.", at: "requests" });

  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  // builder_id and requested_by are filled in by the database from the home and the signed-in user.
  const { error } = await supabase
    .from("change_requests")
    .insert({ home_id: id, message, builder_id: id, requested_by: me.user?.id });
  if (error) back(id, { error: friendly(error.message), at: "requests" });

  revalidatePath(`/homes/${id}`);
  back(id, { saved: "request", at: "requests" });
}

export async function resolveRequest(formData: FormData) {
  const id = String(formData.get("id"));
  const requestId = String(formData.get("request_id"));
  const status = String(formData.get("status"));
  const note = String(formData.get("note") ?? "").trim();
  if (!["done", "declined", "open"].includes(status)) back(id, { error: "Unknown request status.", at: "requests" });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("change_requests")
    .update({ status, resolution_note: note || null })
    .eq("id", requestId)
    .select("id");
  if (error) back(id, { error: friendly(error.message), at: "requests" });
  if (!data?.length) back(id, { error: "Your role can’t resolve change requests.", at: "requests" });

  revalidatePath(`/homes/${id}`);
  back(id, { saved: "resolved", at: "requests" });
}

// ---------------------------------------------------------------------------
// Open houses (times are entered in Central time)
// ---------------------------------------------------------------------------
export async function scheduleOpenHouse(formData: FormData) {
  const id = String(formData.get("id"));
  const date = String(formData.get("date") ?? "");
  const start = centralToUtc(date, String(formData.get("start") ?? ""));
  const end = centralToUtc(date, String(formData.get("end") ?? ""));
  const remarks = String(formData.get("remarks") ?? "").trim();
  if (!start || !end) back(id, { error: "Pick a date, start time and end time.", at: "open-houses" });
  if (new Date(end) <= new Date(start)) back(id, { error: "The end time needs to be after the start time.", at: "open-houses" });
  if (new Date(end) < new Date()) back(id, { error: "That time has already passed.", at: "open-houses" });

  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();

  // "Repeat this": a weekly series. The database creates the dates the MLS
  // allows (28 days out by default), adds more each day, and gives our team a
  // task each time new dates need entering on the MLS.
  const repeat = String(formData.get("repeat") ?? "once");
  if (repeat !== "once") {
    const untilDate = String(formData.get("until_date") ?? "");
    if (repeat === "until_date" && !/^\d{4}-\d{2}-\d{2}$/.test(untilDate)) back(id, { error: "Pick the last date for the repeating open house.", at: "open-houses" });
    if (repeat === "until_date" && untilDate < date) back(id, { error: "The last date needs to be after the first one.", at: "open-houses" });
    const weekday = new Date(date + "T12:00:00Z").getUTCDay();
    const { error } = await supabase.from("open_house_series").insert({
      home_id: id,
      builder_id: id, // replaced by the database with the home's builder
      created_by: me.user?.id,
      weekday,
      start_time: String(formData.get("start")).slice(0, 5),
      end_time: String(formData.get("end")).slice(0, 5),
      remarks: remarks || null,
      until_date: repeat === "until_date" ? untilDate : null,
      until_under_contract: repeat === "until_contract",
    });
    if (error) back(id, { error: friendly(error.message), at: "open-houses" });
    revalidatePath(`/homes/${id}`);
    back(id, { saved: "open-house-series", at: "open-houses" });
  }

  const { error } = await supabase.from("open_houses").insert({
    home_id: id,
    builder_id: id,
    created_by: me.user?.id,
    starts_at: start,
    ends_at: end,
    remarks: remarks || null,
  });
  if (error) back(id, { error: friendly(error.message), at: "open-houses" });

  revalidatePath(`/homes/${id}`);
  back(id, { saved: "open-house", at: "open-houses" });
}

export async function cancelOpenHouse(formData: FormData) {
  const id = String(formData.get("id"));
  const openHouseId = String(formData.get("open_house_id"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("open_houses")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", openHouseId)
    .select("id");
  if (error) back(id, { error: friendly(error.message), at: "open-houses" });
  if (!data?.length) back(id, { error: "Your role can’t change open houses.", at: "open-houses" });

  revalidatePath(`/homes/${id}`);
  back(id, { saved: "open-house-cancelled", at: "open-houses" });
}

export async function stopOpenHouseSeries(formData: FormData) {
  const id = String(formData.get("id"));
  const seriesId = String(formData.get("series_id"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("open_house_series")
    .update({ ended_at: new Date().toISOString(), ended_reason: "Stopped by the builder" })
    .eq("id", seriesId)
    .is("ended_at", null)
    .select("id");
  if (error) back(id, { error: friendly(error.message), at: "open-houses" });
  if (!data?.length) back(id, { error: "Your role can’t change open houses.", at: "open-houses" });
  revalidatePath(`/homes/${id}`);
  back(id, { saved: "open-house-series-stopped", at: "open-houses" });
}

// ---------------------------------------------------------------------------
// Listing status on the market: pause, off the market, under contract, sold
// ---------------------------------------------------------------------------
export async function setMarketStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const to = String(formData.get("market_status")) as MarketStatus;
  const me = await requireProfile();
  if (!marketChoices(me.role).includes(to)) back(id, { error: "Your role can’t make that change.", at: "home-status" });
  const supabase = await createClient();
  // The database ends repeating open houses, cancels future ones, and adds a
  // task for our team to update the MLS.
  const patch: Record<string, string | number | null> = { market_status: to };
  // The sale details the MLS needs for these statuses.
  if (to === "under_contract") {
    const d = String(formData.get("purchase_contract_date") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) back(id, { error: "Enter the contract date." });
    patch.purchase_contract_date = d;
  }
  if (to === "sold") {
    const d = String(formData.get("close_date") ?? "");
    const price = Number(String(formData.get("close_price") ?? "").replace(/[$,]/g, ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) back(id, { error: "Enter the close date." });
    if (!price || Number.isNaN(price)) back(id, { error: "Enter the close price." });
    patch.close_date = d;
    patch.close_price = price;
  }
  const { data, error } = await supabase.from("homes").update(patch).eq("id", id).select("id, workflow_status");
  if (error) back(id, { error: friendly(error.message), at: "home-status" });
  if (!data?.length) back(id, { error: "You don’t have permission to change this home.", at: "home-status" });
  revalidatePath("/", "layout");
  back(id, { saved: data[0].workflow_status === "live_on_mls" ? `market-${to}` : "status-saved", at: "home-status" });
}

export async function setDisclaimer(formData: FormData) {
  const id = String(formData.get("id"));
  const on = formData.get("on") === "true";
  const me = await requireProfile();
  if (!canToggleDisclaimer(me.role)) back(id, { error: "Your role can’t change that." });
  const supabase = await createClient();
  const { data, error } = await supabase.from("homes").update({ show_representative_disclaimer: on }).eq("id", id).select("id");
  if (error) back(id, { error: friendly(error.message) });
  if (!data?.length) back(id, { error: "You don’t have permission to change this home." });
  revalidatePath(`/homes/${id}`);
  revalidatePath("/media");
  back(id, { saved: on ? "disclaimer-on" : "disclaimer-off" });
}

// ---------------------------------------------------------------------------
// Reverse prospecting: a manual pull by our team
// ---------------------------------------------------------------------------
export async function requestReverseProspecting(formData: FormData) {
  const id = String(formData.get("id"));
  const notes = String(formData.get("notes") ?? "").trim();
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  // The database fills in the address and builder, adds a task, and queues an email to our team.
  const { data, error } = await supabase
    .from("reverse_prospect_requests")
    .insert({ home_id: id, builder_id: id, requested_by: me.user?.id, notes: notes || null })
    .select("id")
    .single();
  if (error || !data) back(id, { error: friendly(error?.message ?? "unknown"), at: "reverse-prospecting" });
  after(() => sendQueuedEmails("reverse_prospect_requests", data.id));
  revalidatePath(`/homes/${id}`);
  back(id, { saved: "reverse-requested", at: "reverse-prospecting" });
}

export async function updateReverseProspecting(formData: FormData) {
  const id = String(formData.get("id"));
  const requestId = String(formData.get("request_id"));
  const status = String(formData.get("status"));
  const note = String(formData.get("result_note") ?? "").trim();
  const me = await requireProfile();
  if (!["in_progress", "delivered", "cancelled"].includes(status)) back(id, { error: "Unknown status.", at: "reverse-prospecting" });
  if (status !== "cancelled" && !isStaff(me.role)) back(id, { error: "Our team updates these requests.", at: "reverse-prospecting" });
  const patch: Record<string, string> = { status };
  if (note) patch.result_note = note;
  const supabase = await createClient();
  const { data, error } = await supabase.from("reverse_prospect_requests").update(patch).eq("id", requestId).select("id");
  if (error) back(id, { error: friendly(error.message), at: "reverse-prospecting" });
  if (!data?.length) back(id, { error: "You can’t change that request.", at: "reverse-prospecting" });
  // Delivered: the person who asked gets an email (their inbox notice is added by the database).
  if (status === "delivered") after(() => sendQueuedEmails("reverse_prospect_requests", requestId));
  revalidatePath("/", "layout");
  back(id, { saved: `reverse-${status}`, at: "reverse-prospecting" });
}


// Which MLS this home goes to (owners, managers and our team; not once it's live).
export async function setHomeMls(formData: FormData) {
  const id = String(formData.get("id"));
  const board = String(formData.get("mls_board") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.from("homes").update({ mls_board: board || null }).eq("id", id).select("id");
  if (error) back(id, { error: friendly(error.message) });
  if (!data?.length) back(id, { error: "Your role can’t change the MLS for this home." });
  revalidatePath(`/homes/${id}`, "layout");
  back(id, { saved: "mls-board" });
}

// Construction stage: to be built, under construction, completed (move-in ready).
export async function setBuildStage(formData: FormData) {
  const id = String(formData.get("id"));
  const stage = String(formData.get("build_stage"));
  if (!["to_be_built", "under_construction", "move_in_ready"].includes(stage)) back(id, { error: "Unknown stage.", at: "home-status" });
  const supabase = await createClient();
  const { data, error } = await supabase.from("homes").update({ build_stage: stage }).eq("id", id).select("id");
  if (error) back(id, { error: friendly(error.message), at: "home-status" });
  if (!data?.length) back(id, { error: "Your role can’t change the construction status.", at: "home-status" });
  revalidatePath("/", "layout");
  back(id, { saved: stage === "move_in_ready" ? "stage-ready" : "stage", at: "home-status" });
}

// Room sizes (NTREIS's room list), saved into the home's MLS answers as RESO "Rooms".
export async function saveRooms(formData: FormData) {
  const id = String(formData.get("id"));
  const me = await requireProfile();
  if (!canEditMlsAnswers(me.role)) back(id, { error: "Your role can’t change room sizes.", at: "rooms" });
  let rooms: Room[] = [];
  try {
    rooms = cleanRooms(JSON.parse(String(formData.get("rooms_json") ?? "[]")));
  } catch {
    back(id, { error: "Couldn’t read the room list.", at: "rooms" });
  }
  const supabase = await createClient();
  const { data: cur } = await supabase.from("homes").select("mls_fields, field_sources").eq("id", id).maybeSingle();
  if (!cur) back(id, { error: "You don’t have permission to edit this home.", at: "rooms" });
  const { data, error } = await supabase
    .from("homes")
    .update({
      mls_fields: { ...((cur.mls_fields ?? {}) as Record<string, unknown>), Rooms: rooms },
      field_sources: { ...((cur.field_sources ?? {}) as Record<string, string>), "mls_fields.Rooms": "staff" },
    })
    .eq("id", id)
    .select("id");
  if (error) back(id, { error: friendly(error.message), at: "rooms" });
  if (!data?.length) back(id, { error: "You don’t have permission to edit this home.", at: "rooms" });
  revalidatePath(`/homes/${id}`);
  back(id, { saved: "1", at: "rooms" });
}
