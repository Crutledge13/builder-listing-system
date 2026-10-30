"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canBulkChangePrices } from "@/lib/permissions";

// Raise or lower the picked homes' prices at once (owners, 29 Oct 2026).
// public.bulk_change_prices does it as the signed-in person, all or nothing.
export async function bulkChangePrices(formData: FormData) {
  const communityId = String(formData.get("community_id"));
  const back = (params: Record<string, string>): never => redirect(`/communities/${communityId}/prices?${new URLSearchParams(params)}`);
  const me = await requireProfile();
  if (!canBulkChangePrices(me.role)) back({ error: "Your role can’t change prices. Salespeople can send a price change request from each home." });
  const homes = formData.getAll("home_id").map(String);
  const direction = formData.get("direction") === "raise" ? "raise" : "lower";
  const unit = formData.get("unit") === "percent" ? "_pct" : "";
  const amount = Number(String(formData.get("amount") ?? "").replace(/[$,%\s]/g, ""));
  if (!homes.length) back({ error: "Tick at least one home." });
  if (!Number.isFinite(amount) || amount <= 0) back({ error: "Enter how much to change the prices by." });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_change_prices", { p_homes: homes, p_mode: direction + unit, p_amount: amount });
  if (error) back({ error: error.message.includes("row-level security") ? "You don’t have permission to change those prices." : error.message });
  revalidatePath("/", "layout");
  const what = unit ? `${amount}%` : `$${amount.toLocaleString("en-US")}`;
  redirect(`/communities/${communityId}?saved=${encodeURIComponent(
    `${direction === "raise" ? "Raised" : "Lowered"} ${data} ${data === 1 ? "price" : "prices"} by ${what}. Each home’s price history has the change (with undo), and live listings have an MLS update for our team.`,
  )}`);
}
