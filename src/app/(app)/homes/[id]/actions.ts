"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { allowedTransitions, editableFields, type HomeField, type WorkflowStatus } from "@/lib/permissions";
import { centralToUtc } from "@/lib/time";

const NUMERIC: HomeField[] = [
  "list_price", "bedrooms_total", "bathrooms_full", "bathrooms_half", "living_area",
  "lot_size_acres", "stories", "garage_spaces", "year_built",
];

function back(id: string, params: Record<string, string>): never {
  const { at, ...rest } = params;
  redirect(`/homes/${id}?${new URLSearchParams(rest).toString()}${at ? `#${at}` : ""}`);
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
