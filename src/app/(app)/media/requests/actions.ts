"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { centralToUtc } from "@/lib/time";

const NEEDS = new Set(["photos", "twilight", "video", "drone", "floor_plan", "virtual_tour"]);

function safeBack(raw: FormDataEntryValue | null, fallback: string) {
  const s = String(raw ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}

function go(back: string, params: Record<string, string>): never {
  const [path, hash] = back.split("#");
  const sep = path.includes("?") ? "&" : "?";
  const q = new URLSearchParams(hash ? { ...params, at: hash } : params);
  redirect(`${path}${sep}${q.toString()}${hash ? `#${hash}` : ""}`);
}

function friendly(msg: string) {
  if (msg.includes("row-level security")) return "You don’t have permission to do that.";
  return msg;
}

function refresh() {
  revalidatePath("/media/requests");
  revalidatePath("/jobs");
  revalidatePath("/homes", "layout");
}

export async function createMediaRequest(formData: FormData) {
  const back = safeBack(formData.get("back"), "/media/requests");
  const target = String(formData.get("target") ?? ""); // "home:<id>" or "community:<id>"
  const [kind, id] = target.split(":");
  const needs = formData.getAll("needs").map(String).filter((n) => NEEDS.has(n));
  const notes = String(formData.get("notes") ?? "").trim();
  const due = String(formData.get("due_date") ?? "");
  if (!id || (kind !== "home" && kind !== "community")) go(back, { error: "Pick the home or community to shoot." });
  if (needs.length === 0) go(back, { error: "Tick at least one thing you need." });

  const supabase = await createClient();
  let communityId = id;
  if (kind === "home") {
    const { data: home } = await supabase.from("homes").select("community_id").eq("id", id).maybeSingle();
    if (!home) go(back, { error: "That home isn’t available to you." });
    communityId = home.community_id;
  }
  // Builder, address and names are filled in by the database from the home or community.
  const { error } = await supabase.from("media_requests").insert({
    home_id: kind === "home" ? id : null,
    community_id: communityId,
    builder_id: communityId,
    requested_by: communityId,
    address: "",
    community_name: "",
    builder_name: "",
    needs,
    notes: notes || null,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
  });
  if (error) go(back, { error: friendly(error.message) });
  refresh();
  go(back, { saved: "Request sent. Our team will assign a photographer." });
}

// One action for every change to a request; the database decides who may do what.
export async function updateMediaRequest(formData: FormData) {
  const back = safeBack(formData.get("back"), "/media/requests");
  const id = String(formData.get("request_id"));
  const op = String(formData.get("op"));
  const patch: Record<string, string | null> = {};
  let message = "Saved.";

  switch (op) {
    case "assign": {
      const pid = String(formData.get("photographer_id") ?? "");
      patch.photographer_id = pid || null;
      const date = String(formData.get("date") ?? "");
      const time = String(formData.get("time") ?? "");
      if (date && time) {
        const at = centralToUtc(date, time);
        if (!at) go(back, { error: "That date or time doesn’t look right." });
        patch.scheduled_for = at;
      }
      message = pid ? "Photographer assigned." : "Photographer removed.";
      break;
    }
    case "schedule": {
      const at = centralToUtc(String(formData.get("date") ?? ""), String(formData.get("time") ?? ""));
      if (!at) go(back, { error: "Pick a date and time for the shoot." });
      patch.scheduled_for = at;
      patch.status = "scheduled";
      message = "Shoot scheduled.";
      break;
    }
    case "deliver":
      patch.status = "delivered";
      patch.photographer_note = String(formData.get("note") ?? "").trim() || null;
      message = "Marked delivered. The builder’s team will review it.";
      break;
    case "complete":
      patch.status = "completed";
      message = "Marked complete. Thanks!";
      break;
    case "redo":
      patch.status = "scheduled";
      message = "Sent back to the photographer.";
      break;
    case "cancel":
      patch.status = "cancelled";
      message = "Request cancelled.";
      break;
    default:
      go(back, { error: "Unknown action." });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("media_requests").update(patch).eq("id", id).select("id");
  if (error) go(back, { error: friendly(error.message) });
  if (!data?.length) go(back, { error: "You can’t change this request." });
  refresh();
  go(back, { saved: message });
}

// The builder's contact for photographers (shown on every job card).
export async function saveShootContact(formData: FormData) {
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("builder_id").eq("id", me.user?.id ?? "").maybeSingle();
  const text = (k: string, max: number) => String(formData.get(k) ?? "").trim().slice(0, max) || null;
  const { data, error } = await supabase
    .from("builder_photo_info")
    .update({
      contact_name: text("contact_name", 80),
      contact_phone: text("contact_phone", 30),
      contact_email: text("contact_email", 200),
      access_notes: text("access_notes", 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("builder_id", profile?.builder_id ?? "")
    .select("builder_id");
  if (error || !data?.length) redirect(`/media/requests?error=${encodeURIComponent("Your role can’t change the photographer contact.")}`);
  revalidatePath("/media/requests");
  redirect(`/media/requests?saved=${encodeURIComponent("Saved. Photographers will see this on their jobs.")}`);
}
