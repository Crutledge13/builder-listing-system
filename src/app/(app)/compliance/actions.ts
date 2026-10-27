"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buyerAgentForRpc, missingBuyerAgent } from "@/lib/buyer-agent";

function back(formData: FormData, params: Record<string, string>): never {
  const to = String(formData.get("back") ?? "/communities");
  const [pathAndQuery, hash] = to.split("#");
  const [path, query] = pathAndQuery.split("?");
  const sp = new URLSearchParams(query ?? "");
  sp.delete("error");
  sp.delete("saved");
  Object.entries(params).forEach(([k, v]) => sp.set(k, v));
  redirect(`${path}?${sp.toString()}${hash ? `#${hash}` : ""}`);
}

// The weekly answer: still available, under contract, or sold.
export async function answerAvailability(formData: FormData) {
  const homeId = String(formData.get("home_id"));
  const answer = String(formData.get("answer"));
  const date = String(formData.get("date") ?? "") || null;
  const priceRaw = String(formData.get("price") ?? "").replace(/[$,]/g, "");
  const price = priceRaw ? Number(priceRaw) : null;
  if (answer === "sold" && (!price || Number.isNaN(price))) back(formData, { error: "Enter the close price so the MLS can be updated." });
  if (answer === "under_contract" && missingBuyerAgent(formData)) back(formData, { error: "Enter the buyer’s agent and their brokerage, or tick “The buyer has no agent”." });
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_availability", {
    p_home: homeId,
    p_answer: answer,
    p_date: date,
    p_price: price,
    p_buyer: answer === "under_contract" ? buyerAgentForRpc(formData) : null,
  });
  if (error) back(formData, { error: error.message.includes("can't") || error.message.includes("isn't") ? error.message : `Couldn’t save: ${error.message}` });
  revalidatePath("/", "layout");
  back(formData, {
    saved:
      answer === "available"
        ? "Thanks, marked still available."
        : answer === "sold"
          ? "Marked sold. Our team has an urgent task to update the MLS."
          : "Marked under contract. Our team has an urgent task to update the MLS.",
  });
}

// Our team: run the hourly compliance check right now.
export async function runChecksNow(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_listing_checks_now");
  if (error) back(formData, { error: "Only our team can run the check." });
  revalidatePath("/", "layout");
  back(formData, { saved: `Check finished: ${data ?? 0} open issue${data === 1 ? "" : "s"} found.` });
}

// Our team: close an alert by hand (e.g. checked and it's fine).
export async function resolveAlert(formData: FormData) {
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("home_alerts")
    .update({ resolved_at: new Date().toISOString(), resolved_by: me.user?.id, resolution: String(formData.get("note") ?? "").trim() || "Checked by our team" })
    .eq("id", String(formData.get("id")));
  if (error) back(formData, { error: "Only our team can close alerts." });
  revalidatePath("/", "layout");
  back(formData, { saved: "Alert closed." });
}
